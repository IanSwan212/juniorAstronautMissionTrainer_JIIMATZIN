export function crearModeloSalud(repo) {
  return {
    async comprobarDisponibilidad() {
      try {
        await repo.comprobarConexion();
        return true;
      } catch {
        return false;
      }
    },
  };
}
