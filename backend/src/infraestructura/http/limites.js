import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

/** Límite por IP (usa TRUST_PROXY para ver la IP real tras un balanceador). Desactivado con RATE_LIMIT_MAX=0. */
export const limitarPeticiones =
  env.RATE_LIMIT_MAX === 0
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_S * 1000,
        limit: env.RATE_LIMIT_MAX,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, res) =>
          res.status(429).json({ error: { codigo: 'demasiadas_peticiones', mensaje: 'Demasiadas peticiones, intenta más tarde' } }),
      });

/** Contenido publicado: cacheable. El resto (salud, errores) nunca. */
export function cacheContenido(_req, res, next) {
  res.set('Cache-Control', env.CACHE_SECONDS > 0 ? `public, max-age=${env.CACHE_SECONDS}` : 'no-store');
  next();
}

export function sinCache(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}
