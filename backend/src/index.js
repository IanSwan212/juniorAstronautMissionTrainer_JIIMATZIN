import { env } from './config/env.js';
import { crearPool } from './db/pool.js';
import { crearApp } from './app.js';

const pool = crearPool();

// Un error en un cliente inactivo del pool (p. ej. la BD reinicia) no debe tumbar el proceso.
pool.on('error', (err) => console.error('Error en conexión inactiva de la BD:', err.message));

const app = crearApp({ pool });
const servidor = app.listen(env.PORT, () => {
  console.log(`API de JIIMATZIN escuchando en el puerto ${env.PORT} (${env.NODE_ENV})`);
});

// Límites contra conexiones lentas o colgadas.
servidor.requestTimeout = 15_000;
servidor.headersTimeout = 10_000;
servidor.keepAliveTimeout = 65_000; // mayor que el de la mayoría de balanceadores (60 s)

let cerrando = false;
function cerrar(motivo, codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  console.log(`Cerrando (${motivo})…`);
  const forzar = setTimeout(() => process.exit(1), 10_000);
  forzar.unref();
  servidor.close(async () => {
    await pool.end().catch(() => {});
    process.exit(codigo);
  });
  servidor.closeIdleConnections();
}

process.on('SIGINT', () => cerrar('SIGINT'));
process.on('SIGTERM', () => cerrar('SIGTERM'));
// Estado desconocido: registrar y salir para que el hosting reinicie el proceso.
process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err);
  cerrar('uncaughtException', 1);
});
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin manejar:', err);
  cerrar('unhandledRejection', 1);
});
