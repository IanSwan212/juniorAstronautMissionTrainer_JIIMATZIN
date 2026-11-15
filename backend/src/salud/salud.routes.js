import { Router } from 'express';
import { crearRepositorioSalud } from './salud.repository.js';
import { crearModeloSalud } from './salud.model.js';
import { crearControladorSalud } from './salud.controller.js';

export function crearRutasSalud({ pool }) {
  const controlador = crearControladorSalud(crearModeloSalud(crearRepositorioSalud(pool)));
  const router = Router();
  router.get('/', controlador.obtener);
  router.get('/listo', controlador.listo);
  return router;
}
