// Comando administrativo offline; nunca se monta en las rutas HTTP.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import pg from 'pg';
import { abrirPaquete } from './paquete.js';
import { recorrerPaquete } from './validacion.js';
import { importarPaquete } from './carga.js';

const ayuda = `Uso: pnpm --filter @jiimatzin/backend importar -- --archivo <paquete.zip> --sha256 <hash> [--validar]

--validar   Verifica integridad, contratos y proyecciones sin conectar a PostgreSQL.
Sin --validar, carga ciencia en una transacción y conserva status=candidate.
Requiere Python 3 (PYTHON permite indicar su ejecutable) y DATABASE_URL para cargar.
Las relaciones, restricciones y estadísticas de linaje se comprueban al cargar.
No publica el paquete, no aprueba fichas y no ejecuta el pipeline del ZIP.`;

let paquete;
let pool;
try {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const { values } = parseArgs({ args, options: {
    archivo: { type: 'string' }, sha256: { type: 'string' }, validar: { type: 'boolean', default: false },
    ayuda: { type: 'boolean', default: false },
  } });
  if (values.ayuda) console.log(ayuda);
  else {
    if (!values.archivo || !/^[0-9a-f]{64}$/.test(values.sha256 ?? '')) throw new Error(ayuda);
    paquete = await abrirPaquete(resolve(values.archivo), values.sha256);
    console.error(`Integridad verificada: ${paquete.checksums_verified} hashes; ${paquete.manifest.release_id}`);
    let result;
    if (values.validar) result = { release_id: paquete.manifest.release_id, mode: 'validation_only', ...(await recorrerPaquete(paquete)) };
    else {
      if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL de PostgreSQL es obligatoria para cargar');
      const ssl = process.env.DATABASE_SSL ?? 'disable';
      if (!['disable', 'require', 'no-verify'].includes(ssl)) throw new Error('DATABASE_SSL inválido');
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000,
        ssl: ssl === 'disable' ? false : { rejectUnauthorized: ssl === 'require' } });
      result = await importarPaquete(pool, paquete, { progreso: (message) => console.error(message) });
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(`Importación abortada: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
  await paquete?.cerrar();
}
