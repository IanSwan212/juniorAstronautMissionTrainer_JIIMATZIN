import { z } from 'zod';
import { presentarEscenario, presentarListaEscenarios } from './escenarios.view.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'id de escenario inválido') });
const consulta = z.strictObject({
  version: z.string().regex(/^[1-9][0-9]*$/, 'version debe ser un entero positivo')
    .transform(Number).pipe(z.number().int().max(2147483647)).optional(),
});

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
