import { test, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { crearApp } = await import('../src/app.js');
const { filaEscenario } = await import('../test-support/escenario.js');

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

test('cabeceras: escenarios, salud y errores sin caché, límite informado', async () => {
  const ok = await get('/api/v1/scenarios');
  assert.equal(ok.headers.get('cache-control'), 'no-store');
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

test('lista de escenarios fija publicación científica y versiones como texto', async () => {
  respuestas = [[filaEscenario()]];
  const r = await get('/api/v1/scenarios');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { escenarios: [{ scenarioId:'mars-demo',scenarioVersion:'2',
    releaseId:'rel_'+'1'.repeat(32),rulesVersion:'educational-1',language:'es',title:'Escenario de prueba' }] });
  assert.match(consultas[0].sql,/juego.available_scenarios/);
});

test('escenario completo usa una sola consulta y conserva horas vacías y revisiones', async () => {
  respuestas = [[filaEscenario()]];
  const r = await get('/api/v1/scenarios/mars-demo?version=2');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.schemaVersion,'2');assert.equal(body.scenarioVersion,'2');
  assert.equal(body.releaseId,'rel_'+'1'.repeat(32));assert.deepEqual(body.rules,{mode:'educational'});
  assert.equal(body.conditions[0].recordId,'1'.repeat(64));assert.equal(body.conditions[0].value,207);
  assert.equal(body.conditions[1].data.temperature.sample_mean,null);
  assert.equal(body.conditions[1].data.pressure.sample_mean,null);
  assert.equal(body.facts[0].recordId,'3'.repeat(64));assert.deepEqual(body.factIds,['fact_demo']);
  assert.deepEqual(body.sourceCoverage,{start:null,end:null});assert.equal(body.retrievedAt,null);
  assert.deepEqual(body.marsCoverage,{startSol:10,endSol:10,timeBasis:'mars_lmst'});
  assert.equal(consultas.length,1);assert.deepEqual(consultas[0].parametros,['mars-demo',2]);
});

test('escenario sin versión solicita la última publicada sin perder su identidad científica', async () => {
  respuestas = [[filaEscenario()]];
  const r = await get('/api/v1/scenarios/mars-demo');
  assert.equal(r.status,200);
  const body=await r.json();assert.equal(body.dataMode,'historical');assert.equal(body.datasetVersion,'1.0.0');
  assert.deepEqual(consultas[0].parametros,['mars-demo',null]);
});

test('ficha científica conserva evidencia, límites e identidad de contenido', async () => {
  const recordId = 'a'.repeat(64);
  const evidence = [{ index: 0, type: 'document_quote', sourceFileId: `sha256:${'b'.repeat(64)}`,
    locator: { section: 'body' }, expected: 'Quote', verifiedAgainstPreservedSource: true }];
  respuestas = [[{ fact_key: 'fact_demo', record_id: recordId, language: 'en', title: 'Title',
    schema_version: '1.0.0', processor_id: 'processor', source_context: 'other_mission_educational',
    child_explanation: 'Explanation', scientific_statement: 'Claim', mission_context: 'ISS',
    game_adaptation: 'Adaptation', limitations: ['Limit'], mechanic_ids: ['mechanic'], evidence }]];
  const r = await get(`/api/v1/facts/fact_demo?lang=en&recordId=${recordId}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), {
    id: 'fact_demo', recordId, schemaVersion: '1.0.0', processorId: 'processor', language: 'en',
    title: 'Title', explanation: 'Explanation', backedFact: 'Claim', missionContext: 'ISS',
    sourceContext: 'other_mission_educational', gameAdaptation: 'Adaptation', limitations: ['Limit'],
    mechanicIds: ['mechanic'], references: [evidence[0].sourceFileId], evidence,
  });
  assert.deepEqual(consultas.map((c) => c.parametros), [['fact_demo', 'en', recordId]]);
  assert.match(consultas[0].sql, /FROM ciencia.fact_cards/);
});

test('ficha sin lang usa es; ausencia usa una única consulta', async () => {
  const r = await get('/api/v1/facts/no-existe');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.codigo, 'ficha_no_encontrada');
  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].parametros, ['no-existe', 'es', null]);
});

test('fuente científica conserva institución y producto sin inventar atribución', async () => {
  respuestas = [[{ source_id: 'nasa_pds_nmsu_rems', institution: 'NASA PDS', product: 'MSL REMS', url: null }]];
  const r = await get('/api/v1/sources/nasa_pds_nmsu_rems');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /^public, max-age=\d+$/);
  assert.deepEqual(await r.json(), { id: 'nasa_pds_nmsu_rems', institution: 'NASA PDS', product: 'MSL REMS', url: null });
  assert.deepEqual(consultas[0].parametros, ['nasa_pds_nmsu_rems']);
  assert.match(consultas[0].sql, /FROM ciencia.sources/);
});

test('validación de fichas y fuentes rechaza entradas antes de consultar SQL', async () => {
  for (const ruta of [
    '/api/v1/facts/ficha?lang=english', '/api/v1/facts/%27%3B--', '/api/v1/sources/%27%3B--',
    '/api/v1/facts/ficha?lang=es&lang=en', '/api/v1/facts/ficha?recordId=invalid',
    '/api/v1/facts/ficha?version=1', '/api/v1/facts/ficha?recordId[]=abc',
    '/api/v1/facts/ficha?recordId=' + 'a'.repeat(65),
  ]) {
    const r = await get(ruta);
    assert.equal(r.status, 400, ruta);
    assert.equal((await r.json()).error.codigo, 'consulta_invalida');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(consultas.length, 0);
});

test('versiones inválidas no se convierten en consultas ambiguas ni errores SQL', async () => {
  for (const query of ['version=', 'version=0', 'version=1.0', 'version=1e2', 'version=2147483648', 'version=1&version=2', 'version[]=1', 'version=1&otro=2']) {
    assert.equal((await get(`/api/v1/scenarios/demo?${query}`)).status, 400, query);
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
