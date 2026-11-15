/** Catálogo científico; no expone ubicaciones de archivos ni metadatos de captura. */
export function crearRepositorioFuentes(pool) {
  return {
    async buscarPorId(id) {
      const { rows } = await pool.query(
        `SELECT source_id, institution, product, url
           FROM ciencia.sources
          WHERE source_id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },
  };
}
