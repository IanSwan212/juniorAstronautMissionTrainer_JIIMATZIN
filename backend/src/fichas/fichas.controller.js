import { z } from 'zod';
import { presentarFicha } from './fichas.view.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,95}$/, 'id de ficha inválido') });
const consulta = z.object({ lang: z.string().regex(/^[a-z]{2}$/, 'lang debe ser un código de 2 letras').default('es') });

export function crearControladorFichas(modelo) {
  return {
    async obtener(req, res) {
      const { id } = parametros.parse(req.params);
      const { lang } = consulta.parse(req.query);
      res.json(presentarFicha(await modelo.obtener(id, lang)));
    },
  };
}
