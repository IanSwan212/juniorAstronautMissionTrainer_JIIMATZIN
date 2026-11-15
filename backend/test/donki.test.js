import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { crearApp } = await import('../src/app.js');
const { crearClienteDonki } = await import('../src/donki/donki.cliente.js');
const { ErrorFuenteExterna } = await import('../src/compartido/errores.js');
const { leerFlr, isoZ } = await import('../src/donki/donki.normalizador.js');

const pool = { async query() { return { rows: [] }; } };

// --- cliente simulado y reloj controlable ---
let reloj = new Date('2026-11-14T12:00:00Z');
let llamadas = [];
let siguiente; // () => Promise<{url, httpStatus, texto}> | lanza
const cliente = {
  async obtenerFlr(ventana) {
    llamadas.push(ventana);
    return siguiente(ventana);
  },
};
const flr = (id, extra = {}) => ({
  flrID: id, catalog: 'M2M_CATALOG', instruments: [{ displayName: 'GOES-P: EXIS 1.0-8.0' }],
  beginTime: '2026-11-14T01:33Z', peakTime: '2026-11-14T01:41Z', endTime: '2026-11-14T01:48Z',
  classType: 'M1.0', sourceLocation: 'N25W60', activeRegionNum: 13663, linkedEvents: null,
  link: `https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/${id}/-1`, versionId: 2, ...extra,
});
const responder = (lista) => async () => ({ url: 'https://x/get/FLR', httpStatus: 200, texto: JSON.stringify(lista) });

let servidor;
let base;
before(async () => {
  servidor = crearApp({ pool, donki: { cliente, ahora: () => reloj } }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const URL_VIVO = '/api/v1/live/donki/flares';
const get = (q = '') => fetch(`${base}${URL_VIVO}${q}`);
const reiniciar = () => { llamadas = []; reloj = new Date('2026-11-14T12:00:00Z'); };

test('respuesta: sobre de la limpieza, metadatos de captura y ventana por defecto (3 días UTC)', async () => {
  reiniciar();
  siguiente = responder([flr('2026-11-14T01:33:00-FLR-001')]);
  const r = await get('?days=3&_=a'); // `_` desconocido se ignora
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(llamadas[0], { start: '2026-11-12', end: '2026-11-14' });
  assert.equal(j.schema_version, '1.0.0');
  assert.equal(j.data_mode, 'near_real_time');
  assert.equal(j.is_mars_surface_measurement, false);
  assert.equal(j.retrieved_at, '2026-11-14T12:00:00.000Z');
  assert.deepEqual(j.period_requested, { startDate: '2026-11-12', endDate: '2026-11-14' });
  assert.deepEqual(j.source.params, { startDate: '2026-11-12', endDate: '2026-11-14', catalog: 'M2M_CATALOG', class: 'ALL', version: 'Latest' });
  assert.match(j.source.source_file_id, /^sha256:[0-9a-f]{64}$/);
  assert.equal(j.count, 1);
  assert.equal(j.completeness, 'not_asserted');
  assert.deepEqual(j.freshness, { cache: 'miss', age_s: 0, ttl_s: 300, stale: false });
  const sobre = j.events[0];
  assert.equal(sobre.record_type, 'solar_event');
  assert.equal(sobre.quality_status, 'accepted');
  assert.equal(sobre.usage_tier, 'runtime');
  assert.match(sobre.record_id, /^[0-9a-f]{64}$/);
  assert.match(sobre.processor_id, /^[0-9a-f]{64}$/);
  assert.deepEqual(sobre.provenance.source_refs[0].locator, { kind: 'json_pointer', pointer: '/0' });
  assert.equal(sobre.data.begin_time, '2026-11-14T01:33:00Z');
  assert.equal(sobre.data.begin_time_original, '2026-11-14T01:33Z');
  assert.equal(sobre.data.linked_events_supplied, false);
  assert.equal(sobre.data.is_mars_surface_measurement, false);
  assert.match(r.headers.get('cache-control'), /^public, max-age=\d+$/);
});

test('caché: segunda petición no llama a NASA y reporta hit; vence tras el TTL', async () => {
  reiniciar();
  siguiente = responder([flr('A')]);
  await get('?startDate=2026-11-10&endDate=2026-11-11');
  const hit = await (await get('?startDate=2026-11-10&endDate=2026-11-11')).json();
  assert.equal(llamadas.length, 1);
  assert.equal(hit.freshness.cache, 'hit');
  reloj = new Date(reloj.getTime() + 301_000);
  const miss = await (await get('?startDate=2026-11-10&endDate=2026-11-11')).json();
  assert.equal(llamadas.length, 2);
  assert.equal(miss.freshness.cache, 'miss');
});

test('peticiones concurrentes de la misma ventana comparten una sola consulta a NASA', async () => {
  reiniciar();
  siguiente = async () => { await new Promise((r) => setTimeout(r, 30)); return responder([flr('A')])(); };
  await Promise.all([get('?startDate=2026-10-01&endDate=2026-10-02'), get('?startDate=2026-10-01&endDate=2026-10-02'), get('?startDate=2026-10-01&endDate=2026-10-02')]);
  assert.equal(llamadas.length, 1);
});

test('si NASA falla se sirve la copia previa marcada stale; sin copia, error con código', async (t) => {
  reiniciar();
  t.mock.method(console, 'error', () => {});
  siguiente = responder([flr('A')]);
  await get('?startDate=2026-09-01&endDate=2026-09-02');
  reloj = new Date(reloj.getTime() + 400_000);
  siguiente = async () => { throw new ErrorFuenteExterna('fuente_error', 'x', { estado: 502 }); };
  const j = await (await get('?startDate=2026-09-01&endDate=2026-09-02')).json();
  assert.equal(j.freshness.stale, true);
  assert.equal(j.freshness.cache, 'stale');
  assert.equal(j.count, 1);

  const sin = await get('?startDate=2026-09-05&endDate=2026-09-06');
  assert.equal(sin.status, 502);
  assert.equal((await sin.json()).error.codigo, 'fuente_error');
  assert.equal(sin.headers.get('cache-control'), 'no-store');
});

test('429 de NASA → 503 con Retry-After y sin reintentos', async () => {
  reiniciar();
  siguiente = async () => { throw new ErrorFuenteExterna('fuente_limitada', 'x', { estado: 503, reintentarEnS: 45 }); };
  const r = await get('?startDate=2026-08-01&endDate=2026-08-02');
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('retry-after'), '45');
  assert.equal((await r.json()).error.codigo, 'fuente_limitada');
  assert.equal(llamadas.length, 1);
});

test('respuesta de NASA inválida → 502 fuente_respuesta_invalida', async () => {
  reiniciar();
  for (const [q, texto] of [['2026-07-01', '<html>'], ['2026-07-02', '{"a":1}'], ['2026-07-03', '[1,2]']]) {
    siguiente = async () => ({ url: 'u', httpStatus: 200, texto });
    const r = await get(`?startDate=${q}&endDate=${q}`);
    assert.equal(r.status, 502, texto);
    assert.equal((await r.json()).error.codigo, 'fuente_respuesta_invalida');
  }
});

test('cuerpo vacío con 200 se trata como cero eventos y se declara', async () => {
  reiniciar();
  siguiente = async () => ({ url: 'u', httpStatus: 200, texto: '' });
  const j = await (await get('?startDate=2026-06-01&endDate=2026-06-02')).json();
  assert.equal(j.count, 0);
  assert.equal(j.source.empty_body, true);
  assert.deepEqual(j.coverage, { start: null, end: null });
});

test('validación de parámetros antes de consultar a NASA', async () => {
  reiniciar();
  const malas = ['?days=0', '?days=31', '?days=x', '?days=2&startDate=2026-11-01', '?endDate=2026-11-01',
    '?startDate=2026-11-10&endDate=2026-11-01', '?startDate=2026-11-10&endDate=2026-11-20',
    '?startDate=2026-02-30', '?startDate=hoy', '?startDate=2026-09-01&endDate=2026-11-01'];
  for (const q of malas) {
    const r = await get(q);
    assert.equal(r.status, 400, q);
    assert.equal((await r.json()).error.codigo, 'consulta_invalida', q);
    assert.equal(r.headers.get('cache-control'), 'no-store', q);
  }
  assert.equal(llamadas.length, 0);
});

test('reglas de la limpieza: exclusiones, duplicados, conflictos, faltantes y orden', () => {
  const lista = [
    flr('B', { beginTime: '2026-11-14T05:00Z' }),
    flr('A', { beginTime: '2026-11-14T01:00Z', peakTime: null, endTime: null, linkedEvents: [{ activityID: 'x' }], sourceLocation: '', activeRegionNum: null, versionId: null }),
    flr('A', { beginTime: '2026-11-14T01:00Z', peakTime: null, endTime: null, linkedEvents: [{ activityID: 'x' }], sourceLocation: '', activeRegionNum: null, versionId: null }),
    flr('C', { beginTime: 'ayer' }),
    flr('D', { classType: '' }),
    flr('E', { link: undefined }),
    flr('F', { peakTime: '2026-11-14T00:10Z' }), // pico antes del inicio → marcado, no excluido
    flr('G'), flr('G', { classType: 'X9.9' }), // conflicto → ambos fuera
    flr(' ', {}),
  ];
  const { aceptados, decisiones } = leerFlr(lista);
  assert.deepEqual(aceptados.map((a) => a.evento.external_id), ['A', 'F', 'B']);
  const a = aceptados[0].evento;
  assert.deepEqual([a.peak_time, a.end_time, a.source_location, a.active_region, a.source_version], [null, null, null, null, null]);
  assert.equal(a.linked_events_supplied, true);
  assert.equal(aceptados[1].evento.time_sequence_consistent, false);
  const motivos = Object.fromEntries(decisiones.filter((d) => d.decision !== 'accepted').map((d) => [d.event_id, d.reasons]));
  assert.deepEqual(motivos.C, ['missing_or_invalid_begin_time']);
  assert.deepEqual(motivos.D, ['missing_class_type']);
  assert.deepEqual(motivos.E, ['missing_source_reference']);
  assert.deepEqual(motivos.G, ['conflicting_duplicate_id']);
  assert.equal(decisiones.filter((d) => d.decision === 'duplicate_identical').length, 1);
  assert.equal(isoZ('2026-11-14T01:33:05.5Z'), '2026-11-14T01:33:05.5Z');
  assert.equal(isoZ('2026-11-14 01:33'), null);
  assert.throws(() => leerFlr({}), TypeError);
});

test('cliente: URL oficial con parámetros fijos, sin clave, 404/429/timeout mapeados', async () => {
  let pedida;
  const ok = crearClienteDonki({ baseUrl: 'https://ccmc.gsfc.nasa.gov/DONKI-API/', timeoutMs: 1000, fetchFn: async (u) => { pedida = u; return new Response('[]', { status: 200 }); } });
  await ok.obtenerFlr({ start: '2024-05-08', end: '2024-05-14' });
  assert.equal(pedida.origin + pedida.pathname, 'https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR');
  assert.deepEqual(Object.fromEntries(pedida.searchParams), { startDate: '2024-05-08', endDate: '2024-05-14', catalog: 'M2M_CATALOG', class: 'ALL', version: 'Latest' });
  const con = (fetchFn) => crearClienteDonki({ baseUrl: 'https://x', timeoutMs: 1000, fetchFn }).obtenerFlr({ start: 'a', end: 'b' });
  await assert.rejects(con(async () => new Response('', { status: 404 })), { codigo: 'fuente_error', estado: 502 });
  await assert.rejects(con(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })), { codigo: 'fuente_limitada', estado: 503, reintentarEnS: 120 });
  await assert.rejects(con(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }), { codigo: 'fuente_sin_respuesta', estado: 504 });
  await assert.rejects(con(async () => { throw new TypeError('fetch failed'); }), { codigo: 'fuente_no_disponible', estado: 502 });
});

// Paridad con la limpieza: mismo resultado que build.py sobre la captura oficial (si el dataset está junto al repo).
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const CAPTURA = `${RAIZ}datasets_reextraidos/2026-11-14_nueva_extraccion/capturas/M01_DONKI/FLR_oficial/20261114T225940807046Z_20fcf5/attempt_01.response.json`;
const LIMPIO = `${RAIZ}JIIMATZIN_Dataset_v1.0.0/db_ready/solar_events.jsonl`;
test('paridad con db_ready/solar_events.jsonl (93 eventos de la captura oficial)', { skip: !(existsSync(CAPTURA) && existsSync(LIMPIO)) }, () => {
  const bytes = readFileSync(CAPTURA);
  const esperados = readFileSync(LIMPIO, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const { aceptados } = leerFlr(JSON.parse(bytes.toString('utf8')));
  assert.equal(aceptados.length, esperados.length);
  assert.deepEqual(aceptados.map((a) => a.evento), esperados.map((e) => e.data));
  assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, esperados[0].provenance.source_refs[0].source_file_id);
});
