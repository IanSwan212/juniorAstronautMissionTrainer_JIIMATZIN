import { Router } from 'express';
import { crearRepositorioFichas } from './fichas.repository.js';
import { crearModeloFichas } from './fichas.model.js';
import { crearControladorFichas } from './fichas.controller.js';
import { sinCache } from '../infraestructura/http/limites.js';

export function crearRutasFichas(pool) {
  const controlador = crearControladorFichas(crearModeloFichas(crearRepositorioFichas(pool)));
  const router = Router();
  // Una decisión posterior puede retirar una ficha aunque se fije recordId.
  router.get('/:id', sinCache, controlador.obtener);
  return router;
}
