import { Router } from 'express';
import { z } from 'zod';
import { crearRepositorioEscenarios } from './escenarios.repository.js';
import { crearServicioEscenarios } from './escenarios.service.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'id de escenario inválido') });
const consulta = z.object({ version: z.coerce.number().int().positive().optional() });

export function crearRutasEscenarios(pool) {
  const servicio = crearServicioEscenarios(crearRepositorioEscenarios(pool));
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await servicio.listar());
  });

  router.get('/:id', async (req, res) => {
    const { id } = parametros.parse(req.params);
    const { version } = consulta.parse(req.query);
    res.json(await servicio.obtener(id, version));
  });

  return router;
}
