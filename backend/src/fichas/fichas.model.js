import { ErrorNoEncontrado } from '../compartido/errores.js';

export function crearModeloFichas(repo) {
  return {
    async obtener(code, language, recordId) {
      const ficha = await repo.buscarAprobada(code, language, recordId);
      if (!ficha) {
        throw new ErrorNoEncontrado('ficha_no_encontrada', 'No existe una ficha aprobada con ese id/idioma');
      }
      return ficha;
    },
  };
}
