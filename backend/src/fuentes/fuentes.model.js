import { ErrorNoEncontrado } from '../compartido/errores.js';

export function crearModeloFuentes(repo) {
  return {
    async obtener(code) {
      const fuente = await repo.buscarPorCodigo(code);
      if (!fuente) throw new ErrorNoEncontrado('fuente_no_encontrada', 'No existe esa fuente');
      return fuente;
    },
  };
}
