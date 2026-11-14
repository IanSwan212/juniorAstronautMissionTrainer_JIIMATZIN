import { Router } from 'express';

export function crearRutasSalud({ pool }) {
  const router = Router();

  // Estado básico del servicio, sin secretos ni dependencia de la BD.
  router.get('/', (_req, res) => res.json({ estado: 'ok' }));

  // Disponibilidad: comprueba la conexión a PostgreSQL.
  router.get('/listo', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ estado: 'ok', bd: 'ok' });
    } catch {
      res.status(503).json({ estado: 'degradado', bd: 'error' });
    }
  });

  return router;
}
