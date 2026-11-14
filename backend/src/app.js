import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { registroSolicitudes } from './middleware/registro.js';
import { noEncontrado, manejadorErrores } from './middleware/errores.js';
import { crearRutasSalud } from './modules/salud/salud.routes.js';
import { crearRutasApi } from './routes/api.js';

/**
 * Fábrica de la aplicación. Recibe el pool para poder sustituirlo en pruebas.
 * El prototipo es de solo lectura: no hay endpoints públicos de importación ni edición.
 */
export function crearApp({ pool }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, methods: ['GET', 'HEAD', 'OPTIONS'] }));
  app.use(registroSolicitudes);

  app.use('/health', crearRutasSalud({ pool }));
  app.use('/api/v1', crearRutasApi({ pool }));

  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}
