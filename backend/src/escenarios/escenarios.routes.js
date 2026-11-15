import { Router } from 'express';
import { crearRepositorioEscenarios } from './escenarios.repository.js';
import { crearModeloEscenarios } from './escenarios.model.js';
import { crearControladorEscenarios } from './escenarios.controller.js';

/** Composición local: conecta persistencia, modelo y controlador con sus rutas. */
export function crearRutasEscenarios(pool) {
  const controlador = crearControladorEscenarios(crearModeloEscenarios(crearRepositorioEscenarios(pool)));
  const router = Router();
  router.get('/', controlador.listar);
  router.get('/:id', controlador.obtener);
  return router;
}
