import { z } from 'zod';
import { presentarFlares } from './donki.view.js';

const DIA_MS = 86_400_000;
const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'usa el formato AAAA-MM-DD')
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().startsWith(s);
  }, 'fecha inexistente');
const diaUtc = (d) => d.toISOString().slice(0, 10);
const sumarDias = (s, n) => diaUtc(new Date(Date.parse(`${s}T00:00:00Z`) + n * DIA_MS));

/**
 * Ventana consultada (fechas UTC inclusivas):
 *  - por defecto, los últimos `days` días UTC incluido hoy (days=3 → hoy y los 2 anteriores);
 *  - o bien `startDate` (+ `endDate`, por defecto hoy). No se mezclan `days` y fechas.
 */
export function crearControladorDonki({ modelo, ttlS, maxDias, ahora = () => new Date() }) {
  const consulta = z
    .object({
      days: z.coerce.number().int().min(1).max(maxDias).optional(),
      startDate: fechaIso.optional(),
      endDate: fechaIso.optional(),
    })
    .superRefine((q, ctx) => {
      const falla = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
      if (q.days !== undefined && (q.startDate || q.endDate)) falla('days', 'no se combina con startDate/endDate');
      if (q.endDate && !q.startDate) falla('endDate', 'requiere startDate');
    });

  return {
    async flares(req, res) {
      const q = consulta.parse(req.query);
      const hoy = diaUtc(ahora());
      const dias = q.days ?? (q.startDate ? undefined : 3);
      const start = q.startDate ?? sumarDias(hoy, -(dias - 1));
      const end = q.endDate ?? hoy;

      const problemas = [];
      if (end < start) problemas.push({ campo: 'endDate', mensaje: 'no puede ser anterior a startDate' });
      if (end > hoy) problemas.push({ campo: 'endDate', mensaje: 'no puede ser futura (UTC)' });
      if ((Date.parse(end) - Date.parse(start)) / DIA_MS + 1 > maxDias) {
        problemas.push({ campo: 'startDate', mensaje: `el rango no puede superar ${maxDias} días` });
      }
      if (problemas.length) {
        res.set('Cache-Control', 'no-store'); // un error nunca se cachea
        return res.status(400).json({ error: { codigo: 'consulta_invalida', mensaje: 'Parámetros inválidos', detalles: problemas } });
      }

      const resultado = await modelo.obtener({ start, end });
      // Casi en tiempo real: el cliente no debe retener más que la caché del servidor.
      res.set('Cache-Control', `public, max-age=${Math.max(0, Math.min(ttlS - resultado.edadS, 60))}`);
      res.json(presentarFlares(resultado, { ttlS }));
    },
  };
}
