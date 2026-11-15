import { test, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { crearApp } = await import('../src/app.js');

// Pool simulado: sin filas. Permite probar rutas, validación y errores sin PostgreSQL.
let consultaFalla = false;
let respuestas = [];
let consultas = [];
const pool = {
  async query(sql, parametros) {
    consultas.push({ sql, parametros });
    if (consultaFalla) throw new Error('bd caída');
    return { rows: respuestas.shift() ?? [] };
  },
};

beforeEach(() => {
  consultaFalla = false;
  respuestas = [];
  consultas = [];
});
afterEach(() => assert.equal(respuestas.length, 0, 'Se deben consumir las consultas previstas'));

let servidor;
let base;
before(async () => {
  servidor = crearApp({ pool }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const get = (ruta) => fetch(base + ruta);

test('GET /health responde ok', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { estado: 'ok' });
});

test('GET /health/listo es 503 si la BD falla', async () => {
  consultaFalla = true;
  const r = await get('/health/listo');
  consultaFalla = false;
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { estado: 'degradado', bd: 'error' });
});

test('GET /api/v1/scenarios lista vacía', async () => {
  const r = await get('/api/v1/scenarios');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { escenarios: [] });
});

test('escenario inexistente → 404 con código', async () => {
  const r = await get('/api/v1/scenarios/mars-demo');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.codigo, 'escenario_no_encontrado');
});

test('versión inválida → 400', async () => {
  const r = await get('/api/v1/scenarios/mars-demo?version=abc');
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.codigo, 'consulta_invalida');
});

test('id con caracteres peligrosos → 400', async () => {
  const r = await get('/api/v1/scenarios/%27%3B--');
  assert.equal(r.status, 400);
});

test('ficha y fuente inexistentes → 404', async () => {
  assert.equal((await get('/api/v1/facts/no-existe?lang=en')).status, 404);
  assert.equal((await get('/api/v1/sources/no-existe')).status, 404);
});

test('cabeceras: contenido cacheable, salud y errores sin caché, límite informado', async () => {
  const ok = await get('/api/v1/scenarios');
  assert.match(ok.headers.get('cache-control'), /^public, max-age=\d+$/);
  assert.ok(ok.headers.get('ratelimit') || ok.headers.get('ratelimit-policy'));
  assert.equal(ok.headers.get('x-powered-by'), null);
  assert.equal((await get('/health')).headers.get('cache-control'), 'no-store');
  assert.equal((await get('/api/v1/scenarios/no-existe')).headers.get('cache-control'), 'no-store');
});

test('ruta desconocida → 404 JSON', async () => {
  const r = await get('/api/v1/nada');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.codigo, 'ruta_no_encontrada');
});

test('salud básica no consulta la BD y disponibilidad sana responde 200', async () => {
  consultaFalla = true;
  assert.equal((await get('/health')).status, 200);
  assert.equal(consultas.length, 0);
  consultaFalla = false;
  const r = await get('/health/listo');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { estado: 'ok', bd: 'ok' });
  assert.equal(consultas[0].sql, 'SELECT 1');
});

test('lista de escenarios conserva el contrato público y versiones como texto', async () => {
  respuestas = [[{ code: 'mars-demo', version: 2, rules_version: 'educational-1', language: 'es' }]];
  const r = await get('/api/v1/scenarios');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    escenarios: [{ scenarioId: 'mars-demo', scenarioVersion: '2', rulesVersion: 'educational-1', language: 'es' }],
  });
  assert.match(consultas[0].sql, /publication_status = 'published'/);
});

test('escenario completo conserva faltantes, contexto, eventos y fichas', async () => {
  respuestas = [
    [{ id: 10, code: 'mars-demo', version: 2, rules_version: 'educational-1', language: 'es', config: {
      dataMode: 'historical', sourceCoverage: { start: '2024-05-01T00:00:00Z', end: '2024-05-02T00:00:00Z' },
      retrievedAt: '2026-11-14T00:00:00Z', modelAssumptions: ['Ejemplo de prueba'],
    } }],
    [
      { game_sol: 1, game_phase: 'morning', justification: 'Ejemplo faltante', dataset_context: 'Marte exterior',
        dataset_external_id: 'rems-test', obs_id: 20, variable: 'AMBIENT_TEMP', value: null, unit: 'K',
        quality_status: 'missing', observed_at: '2012-08-17T00:00:00Z', mission_sol: 11 },
      { game_sol: 2, game_phase: 'day', justification: 'Antecedente', rec_id: 21, record_type: 'CME',
        occurred_at: '2024-05-01T00:00:00Z', payload: { externalId: 'test-event' } },
    ],
    [{ code: 'ficha-demo', language: 'es', version: 1, title: 'Título', explanation: 'Explicación',
      game_adaptation: 'Adaptación', game_sol: 1, game_phase: 'night' }],
  ];
  const r = await get('/api/v1/scenarios/mars-demo?version=2');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    schemaVersion: '1', scenarioId: 'mars-demo', scenarioVersion: '2', rulesVersion: 'educational-1', language: 'es',
    dataMode: 'historical', sourceCoverage: { start: '2024-05-01T00:00:00Z', end: '2024-05-02T00:00:00Z' },
    retrievedAt: '2026-11-14T00:00:00Z',
    conditions: [
      { gameSol: 1, gamePhase: 'morning', justification: 'Ejemplo faltante', context: 'Marte exterior',
        dataset: 'rems-test', kind: 'observation', evidenceId: 'obs:20', variable: 'AMBIENT_TEMP', value: null,
        unit: 'K', quality: 'missing', observedAt: '2012-08-17T00:00:00Z', missionSol: 11 },
      { gameSol: 2, gamePhase: 'day', justification: 'Antecedente', context: null, dataset: null,
        kind: 'record', evidenceId: 'rec:21', variable: 'CME', value: null, unit: null, quality: null,
        occurredAt: '2024-05-01T00:00:00Z', payload: { externalId: 'test-event' } },
    ],
    factIds: ['ficha-demo'],
    facts: [{ id: 'ficha-demo', language: 'es', version: 1, title: 'Título', explanation: 'Explicación',
      gameAdaptation: 'Adaptación', appearsAt: { gameSol: 1, gamePhase: 'night' } }],
    modelAssumptions: ['Ejemplo de prueba'],
  });
  assert.deepEqual(consultas.map((c) => c.parametros), [['mars-demo', 2], [10], [10]]);
  assert.match(consultas[0].sql, /publication_status = 'published'/);
  assert.match(consultas[2].sql, /review_status = 'approved'/);
});

test('escenario sin versión y sin configuración conserva los valores predeterminados', async () => {
  respuestas = [[{ id: 10, code: 'mars-demo', version: 1, rules_version: 'v1', language: 'es', config: null }], [], []];
  const r = await get('/api/v1/scenarios/mars-demo');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    schemaVersion: '1', scenarioId: 'mars-demo', scenarioVersion: '1', rulesVersion: 'v1', language: 'es',
    dataMode: 'historical', sourceCoverage: { start: null, end: null }, retrievedAt: null,
    conditions: [], factIds: [], facts: [], modelAssumptions: [],
  });
  assert.deepEqual(consultas[0].parametros, ['mars-demo', null]);
});

test('ficha conserva evidencia y consulta por código e idioma', async () => {
  respuestas = [
    [{ id: 30, code: 'ficha-demo', language: 'en', version: 3, title: 'Title', explanation: 'Explanation',
      backed_fact: 'Claim', mission_context: 'ISS', game_adaptation: 'Adaptation', source_refs: ['reference'] }],
    [{ claim: 'Claim', locator: 'Table 1', accession: 'OSD-test', publication_doi: null, data_doi: 'test-doi',
      source_code: 'osdr', source_name: 'OSDR', source_url: 'https://example.org/osdr' }],
  ];
  const r = await get('/api/v1/facts/ficha-demo?lang=en');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    id: 'ficha-demo', language: 'en', version: 3, title: 'Title', explanation: 'Explanation',
    backedFact: 'Claim', missionContext: 'ISS', gameAdaptation: 'Adaptation', references: ['reference'],
    evidence: [{ claim: 'Claim', locator: 'Table 1', studyAccession: 'OSD-test', publicationDoi: null, dataDoi: 'test-doi',
      source: { id: 'osdr', name: 'OSDR', url: 'https://example.org/osdr' } }],
  });
  assert.deepEqual(consultas.map((c) => c.parametros), [['ficha-demo', 'en'], [30]]);
  assert.match(consultas[0].sql, /review_status = 'approved'/);
});

test('ficha sin lang usa es y no consulta evidencias si no existe', async () => {
  const r = await get('/api/v1/facts/no-existe');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.codigo, 'ficha_no_encontrada');
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].parametros, ['no-existe', 'es']);
});

test('fuente conserva atribución y campos públicos', async () => {
  respuestas = [[{ code: 'rems', name: 'REMS', provider: 'NASA', url: 'https://example.org/rems',
    access_type: 'download', attribution: 'Atribución', challenge_resource: true }]];
  const r = await get('/api/v1/sources/rems');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    id: 'rems', name: 'REMS', provider: 'NASA', url: 'https://example.org/rems',
    accessType: 'download', attribution: 'Atribución', challengeResource: true,
  });
  assert.deepEqual(consultas[0].parametros, ['rems']);
});

test('validación de fichas y fuentes rechaza entradas antes de consultar SQL', async () => {
  for (const ruta of ['/api/v1/facts/ficha?lang=english', '/api/v1/facts/%27%3B--', '/api/v1/sources/%27%3B--']) {
    const r = await get(ruta);
    assert.equal(r.status, 400, ruta);
    assert.equal((await r.json()).error.codigo, 'consulta_invalida');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(consultas.length, 0);
});

test('errores de persistencia llegan al manejador HTTP sin revelar detalles', async (t) => {
  t.mock.method(console, 'error', () => {});
  consultaFalla = true;
  for (const ruta of ['/api/v1/scenarios', '/api/v1/scenarios/mars-demo', '/api/v1/facts/ficha', '/api/v1/sources/rems']) {
    const r = await get(ruta);
    assert.equal(r.status, 500, ruta);
    assert.deepEqual(await r.json(), { error: { codigo: 'error_interno', mensaje: 'Error interno del servidor' } });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
