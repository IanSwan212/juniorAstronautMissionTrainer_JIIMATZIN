import { env } from './config/env.js';
import { crearPool } from './db/pool.js';
import { crearApp } from './app.js';

const pool = crearPool();
const app = crearApp({ pool });

const servidor = app.listen(env.PORT, () => {
  console.log(`API de JIIMATZIN escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

function cerrar() {
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
