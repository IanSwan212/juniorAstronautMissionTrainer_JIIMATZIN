import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirPaquete } from '../src/importador/paquete.js';
import { recorrerPaquete } from '../src/importador/validacion.js';
import { fecha, horaMarciana, rutaRelativa } from '../src/importador/formato.js';
import { datosPrueba, crearPaquetePrueba } from '../test-support/paquete.js';

test('paquete mínimo: hashes, contratos y proyecciones sin PostgreSQL', async () => {
  const fixture = await crearPaquetePrueba();
  let p;
  try {
    p = await abrirPaquete(fixture.path, fixture.sha256);
    const rows = [];
    const result = await recorrerPaquete(p, async (table, row) => rows.push([table, row]));
    assert.equal(result.record_count, 4);
    const empty = rows.find(([t, r]) => t === 'environment_hours' && r.lmst_hour === 1)[1];
    assert.equal(empty.temperature_mean_k, null);
    assert.equal(empty.pressure_mean_pa, null);
    assert.equal(rows.find(([t]) => t === 'observations')[1].source_timestamp_seconds, 398334263);
    assert.equal(rows.find(([t]) => t === 'fact_evidence')[1].expected, null);
  } finally { await p?.cerrar(); await fixture.cerrar(); }
});

test('ZIP: rechaza hash incorrecto, rutas inseguras, archivo alterado y conteo incorrecto', async () => {
  for (const change of ['hash', 'path', 'tamper', 'count']) {
    const spec = datosPrueba();
    if (change === 'path') spec.tamper = { '../escape.txt': 'unsafe' };
    if (change === 'tamper') spec.tamper = { 'db_ready/sources.jsonl': '{}\n' };
    if (change === 'count') spec.counts_override = { 'sources.jsonl': 2 };
    const fixture = await crearPaquetePrueba(spec);
    try { await assert.rejects(abrirPaquete(fixture.path, change === 'hash' ? '0'.repeat(64) : fixture.sha256)); }
    finally { await fixture.cerrar(); }
  }
});

test('preflight rechaza unidades, LMST, procesador, membresías, faltantes y vínculos de ficha inválidos', async () => {
  const mutations = [
    (s) => { s.rows['observations.jsonl'][0].data.unit = 'Pa'; },
    (s) => { s.rows['observations.jsonl'][0].data.lmst = '00010M24:00:00.000'; },
    (s) => { s.rows['observations.jsonl'][0].processor_id = '0'.repeat(64); },
    (s) => { s.rows['release_members.jsonl'][0].record_type = 'fact'; },
    (s) => { s.rows['environment_hours.jsonl'][1].data.temperature.sample_mean = 0; },
    (s) => { s.rows['fact_evidence.jsonl'][0].language = 'en'; },
    (s) => { s.rows['fact_mechanics.jsonl'] = []; },
    (s) => { s.rows['observations.jsonl'][0].data.value = -999; },
  ];
  for (const mutate of mutations) {
    const spec = datosPrueba(); mutate(spec);
    const fixture = await crearPaquetePrueba(spec);
    let p;
    try { p = await abrirPaquete(fixture.path, fixture.sha256); await assert.rejects(recorrerPaquete(p)); }
    finally { await p?.cerrar(); await fixture.cerrar(); }
  }
});

test('fechas terrestres y marcianas conservan su significado; rutas relativas verificadas', () => {
  assert.equal(fecha('2026-11-14T00:00:00+00:00'), '2026-11-14T00:00:00Z');
  assert.equal(fecha(null), null);
  assert.throws(() => fecha('2026-02-30T00:00:00Z'));
  assert.equal(horaMarciana('00010M23:59:59.000', 10), 23);
  assert.throws(() => horaMarciana('00010M23:59:59.000', 11));
  for (const path of ['../file', '/file', 'C:/file', 'folder\\file', 'folder//file']) assert.throws(() => rutaRelativa(path));
});
