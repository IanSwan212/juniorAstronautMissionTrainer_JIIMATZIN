import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

// Crea una BD nueva, migra desde cero y la elimina al terminar. Nunca ejecuta
// migraciones ni inserta fixtures en la BD de DATABASE_URL.
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await admin.connect();
  const suites = process.argv.includes('--contenido') ? ['test/contenido.integracion.test.js']
    : process.argv.includes('--escenarios') ? ['test/escenarios.integracion.test.js']
    : process.argv.includes('--publicaciones') ? ['test/publicaciones.integracion.test.js']
    : ['test/integracion.test.js','test/importador.integracion.test.js','test/publicaciones.integracion.test.js','test/escenarios.integracion.test.js','test/contenido.integracion.test.js'];
  for (const suite of suites) {
    const database = `jiimatzin_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${database}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    try {
      const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--test', suite], {
          cwd: new URL('../', import.meta.url),
          env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: url.href, RATE_LIMIT_MAX: '0' },
          stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('exit', (code) => resolve(code ?? 1));
      });
      if (exitCode !== 0) process.exitCode = exitCode;
    } finally {
      // Nombre generado con prefijo fijo y UUID; nunca viene del usuario.
      await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    }
  }
} finally {
  await admin.end();
}
