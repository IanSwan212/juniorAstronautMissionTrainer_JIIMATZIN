import { ErrorNoEncontrado } from '../compartido/errores.js';

export function crearModeloFuentes(repo) {
  return {
    async obtener(id) {
      const fuente = await repo.buscarPorId(id);
      if (!fuente) throw new ErrorNoEncontrado('fuente_no_encontrada', 'No existe esa fuente');
      return fuente;
    },
  };
}
