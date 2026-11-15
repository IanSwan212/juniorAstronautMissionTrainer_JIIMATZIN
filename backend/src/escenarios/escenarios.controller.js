import { z } from 'zod';
import { presentarEscenario, presentarListaEscenarios } from './escenarios.view.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'id de escenario inválido') });
const consulta = z.object({ version: z.coerce.number().int().positive().optional() });

export function crearControladorEscenarios(modelo) {
  return {
    async listar(_req, res) {
      res.json(presentarListaEscenarios(await modelo.listar()));
    },
    async obtener(req, res) {
      const { id } = parametros.parse(req.params);
      const { version } = consulta.parse(req.query);
      res.json(presentarEscenario(await modelo.obtener(id, version)));
    },
  };
}
