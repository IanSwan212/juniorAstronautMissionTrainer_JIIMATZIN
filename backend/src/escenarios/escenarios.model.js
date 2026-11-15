import { ErrorNoEncontrado } from '../compartido/errores.js';

/** Casos de uso del modelo: contenido publicado, sin dependencias de HTTP. */
export function crearModeloEscenarios(repo) {
  return {
    listar() {
      return repo.listarPublicados();
    },

    async obtener(code, version) {
      const escenario = await repo.buscarPublicado(code, version);
      if (!escenario) {
        throw new ErrorNoEncontrado('escenario_no_encontrado', 'No existe un escenario publicado con ese id/versión');
      }
      const [condiciones, fichas] = await Promise.all([
        repo.listarCondiciones(escenario.id),
        repo.listarFichas(escenario.id),
      ]);
      return { escenario, condiciones, fichas };
    },
  };
}
