import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Cada caso corre en un proceso aparte porque env.js valida al importarse.
function cargarConEntorno(vars) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/infraestructura/config/env.js')"], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, ...vars },
    encoding: 'utf8',
  });
}

const PROD_VALIDO = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:clave-larga@db.ejemplo.org:5432/jiimatzin',
  DATABASE_SSL: 'require',
  CORS_ORIGINS: 'https://equipo.github.io',
  TRUST_PROXY: '1',
};

test('producción con configuración correcta arranca', () => {
  assert.equal(cargarConEntorno(PROD_VALIDO).status, 0);
});

test('producción sin CORS_ORIGINS se rechaza', () => {
  const r = cargarConEntorno({ ...PROD_VALIDO, CORS_ORIGINS: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CORS_ORIGINS/);
});

test('producción rechaza comodín y orígenes http', () => {
  for (const origen of ['*', 'http://equipo.github.io']) {
    const r = cargarConEntorno({ ...PROD_VALIDO, CORS_ORIGINS: origen });
    assert.notEqual(r.status, 0, origen);
  }
});

test('producción rechaza BD local, contraseña de desarrollo y sin TLS', () => {
  assert.notEqual(cargarConEntorno({ ...PROD_VALIDO, DATABASE_URL: 'postgresql://u:p@localhost:5432/x' }).status, 0);
  assert.notEqual(cargarConEntorno({ ...PROD_VALIDO, DATABASE_URL: 'postgresql://jiimatzin:jiimatzin_dev@h.org/x' }).status, 0);
  assert.notEqual(cargarConEntorno({ ...PROD_VALIDO, DATABASE_SSL: 'disable' }).status, 0);
});

test('producción no permite desactivar el límite de peticiones', () => {
  assert.notEqual(cargarConEntorno({ ...PROD_VALIDO, RATE_LIMIT_MAX: '0' }).status, 0);
});

test('DATABASE_URL con otro protocolo se rechaza', () => {
  assert.notEqual(cargarConEntorno({ NODE_ENV: 'development', DATABASE_URL: 'mysql://u:p@h/x' }).status, 0);
});

test('desarrollo sigue sin exigir nada más que DATABASE_URL', () => {
  const r = cargarConEntorno({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/x' });
  assert.equal(r.status, 0);
});
