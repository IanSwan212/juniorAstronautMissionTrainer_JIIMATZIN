import { Router } from 'express';
import { crearRutasEscenarios } from './escenarios/escenarios.routes.js';
import { crearRutasFichas } from './fichas/fichas.routes.js';
import { crearRutasFuentes } from './fuentes/fuentes.routes.js';

/** Monta todos los módulos bajo /api/v1. Para añadir un recurso: nuevo módulo + una línea aquí. */
export function crearRutasApi({ pool }) {
  const router = Router();
  router.use('/scenarios', crearRutasEscenarios(pool));
  router.use('/facts', crearRutasFichas(pool));
  router.use('/sources', crearRutasFuentes(pool));
  return router;
}
