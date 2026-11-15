import { Router } from 'express';
import { crearRepositorioFichas } from './fichas.repository.js';
import { crearModeloFichas } from './fichas.model.js';
import { crearControladorFichas } from './fichas.controller.js';

export function crearRutasFichas(pool) {
  const controlador = crearControladorFichas(crearModeloFichas(crearRepositorioFichas(pool)));
  const router = Router();
  router.get('/:id', controlador.obtener);
  return router;
}
