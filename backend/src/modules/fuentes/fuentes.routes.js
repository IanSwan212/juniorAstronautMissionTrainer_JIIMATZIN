import { Router } from 'express';
import { z } from 'zod';
import { ErrorHttp } from '../../middleware/errores.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'id de fuente inválido') });

export function crearRutasFuentes(pool) {
  const router = Router();

  // Atribución y contexto público de una fuente (p. ej. donki, osdr, rems).
  router.get('/:id', async (req, res) => {
    const { id } = parametros.parse(req.params);
    const { rows } = await pool.query(
      `SELECT code, name, provider, url, access_type, attribution, challenge_resource
         FROM sources
        WHERE code = $1`,
      [id],
    );
    const fuente = rows[0];
    if (!fuente) throw new ErrorHttp(404, 'fuente_no_encontrada', 'No existe esa fuente');

    res.json({
      id: fuente.code,
      name: fuente.name,
      provider: fuente.provider,
      url: fuente.url,
      accessType: fuente.access_type,
      attribution: fuente.attribution,
      challengeResource: fuente.challenge_resource,
    });
  });

  return router;
}
