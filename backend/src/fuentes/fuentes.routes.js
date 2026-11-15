import { Router } from 'express';
import { crearRepositorioFuentes } from './fuentes.repository.js';
import { crearModeloFuentes } from './fuentes.model.js';
import { crearControladorFuentes } from './fuentes.controller.js';

export function crearRutasFuentes(pool) {
  const controlador = crearControladorFuentes(crearModeloFuentes(crearRepositorioFuentes(pool)));
  const router = Router();
  router.get('/:id', controlador.obtener);
  return router;
}
