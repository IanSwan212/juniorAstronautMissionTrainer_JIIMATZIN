import { Router } from 'express';
import { env } from '../infraestructura/config/env.js';
import { crearClienteDonki } from './donki.cliente.js';
import { crearModeloDonki } from './donki.model.js';
import { crearControladorDonki } from './donki.controller.js';

/** `cliente` es inyectable para pruebas; por defecto consulta la API oficial de DONKI. */
export function crearRutasDonki({ cliente, ahora } = {}) {
  const origen = cliente ?? crearClienteDonki({ baseUrl: env.DONKI_BASE_URL, timeoutMs: env.DONKI_TIMEOUT_MS });
  const modelo = crearModeloDonki({ cliente: origen, ttlS: env.DONKI_CACHE_SECONDS, ahora });
  const controlador = crearControladorDonki({ modelo, ttlS: env.DONKI_CACHE_SECONDS, maxDias: env.DONKI_MAX_DAYS, ahora });
  const router = Router();
  router.get('/flares', controlador.flares);
  return router;
}
