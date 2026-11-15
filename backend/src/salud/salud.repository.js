export function crearRepositorioSalud(pool) {
  return {
    async comprobarConexion() {
      await pool.query('SELECT 1');
    },
  };
}
