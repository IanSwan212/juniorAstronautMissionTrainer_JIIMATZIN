import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { crearApp } = await import('../src/app.js');

// Pool simulado: sin filas. Permite probar rutas, validación y errores sin PostgreSQL.
let consultaFalla = false;
const pool = {
  async query() {
    if (consultaFalla) throw new Error('bd caída');
    return { rows: [] };
  },
};

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
