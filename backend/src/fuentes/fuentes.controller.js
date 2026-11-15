import { z } from 'zod';
import { presentarFuente } from './fuentes.view.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'id de fuente inválido') });

export function crearControladorFuentes(modelo) {
  return {
    async obtener(req, res) {
      const { id } = parametros.parse(req.params);
      res.json(presentarFuente(await modelo.obtener(id)));
    },
  };
}
