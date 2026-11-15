/** Atribución y contexto público de una fuente (p. ej. donki, osdr, rems). */
export function crearRepositorioFuentes(pool) {
  return {
    async buscarPorCodigo(code) {
      const { rows } = await pool.query(
        `SELECT code, name, provider, url, access_type, attribution, challenge_resource
           FROM sources
          WHERE code = $1`,
        [code],
      );
      return rows[0] ?? null;
    },
  };
}
