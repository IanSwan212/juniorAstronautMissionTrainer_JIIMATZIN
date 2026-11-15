import { ErrorNoEncontrado } from '../compartido/errores.js';

export function crearModeloEscenarios(repo) {
  return {
    listar() { return repo.listarPublicados(); },
    async obtener(code, version) {
      const escenario = await repo.buscarPublicado(code, version);
      if (!escenario) throw new ErrorNoEncontrado('escenario_no_encontrado', 'No existe un escenario publicado con ese id/versión');
      return escenario;
    },
  };
}
