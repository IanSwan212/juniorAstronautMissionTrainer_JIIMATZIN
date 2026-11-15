import { ErrorNoEncontrado } from '../compartido/errores.js';

export function crearModeloFichas(repo) {
  return {
    async obtener(code, language) {
      const ficha = await repo.buscarAprobada(code, language);
      if (!ficha) {
        throw new ErrorNoEncontrado('ficha_no_encontrada', 'No existe una ficha aprobada con ese id/idioma');
      }
      const evidencias = await repo.listarEvidencias(ficha.id);
      return { ficha, evidencias };
    },
  };
}
