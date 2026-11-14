import pg from 'pg';
import { env } from '../config/env.js';

// int8 (bigint) llega como string por defecto; los ids del proyecto caben de sobra en Number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function crearPool() {
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    statement_timeout: 5000,
  });
}
