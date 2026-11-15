import { ZodError } from 'zod';
import { ErrorNoEncontrado, ErrorFuenteExterna } from '../../compartido/errores.js';

export class ErrorHttp extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

export function noEncontrado(req, _res, next) {
  next(new ErrorHttp(404, 'ruta_no_encontrada', `No existe la ruta ${req.method} ${req.path}`));
}

// Express 5 reenvía aquí también los errores de handlers async.
// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, _req, res, _next) {
  res.set('Cache-Control', 'no-store'); // un error nunca se cachea
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        codigo: 'consulta_invalida',
        mensaje: 'Parámetros inválidos',
        detalles: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      },
    });
  }
  if (err instanceof ErrorHttp) {
    return res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message } });
  }
  if (err instanceof ErrorFuenteExterna) {
    if (err.reintentarEnS) res.set('Retry-After', String(err.reintentarEnS));
    return res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message } });
  }
  if (err instanceof ErrorNoEncontrado) {
    return res.status(404).json({ error: { codigo: err.codigo, mensaje: err.message } });
  }
  console.error(err);
  return res.status(500).json({ error: { codigo: 'error_interno', mensaje: 'Error interno del servidor' } });
}
