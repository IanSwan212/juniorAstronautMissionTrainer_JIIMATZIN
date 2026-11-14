export function crearRepositorioFichas(pool) {
  return {
    /** Última versión aprobada de la ficha (code = etiqueta dato:<id> de Ink). */
    async buscarAprobada(code, language) {
      const { rows } = await pool.query(
        `SELECT id, code, language, version, title, explanation, backed_fact,
                mission_context, game_adaptation, source_refs
           FROM fact_cards
          WHERE code = $1 AND language = $2 AND review_status = 'approved'
          ORDER BY version DESC
          LIMIT 1`,
        [code, language],
      );
      return rows[0] ?? null;
    },

    /** Cada evidencia apunta a exactamente una referencia (estudio, registro o archivo). */
    async listarEvidencias(factId) {
      const { rows } = await pool.query(
        `SELECT e.claim, e.locator, st.accession, st.publication_doi, st.data_doi,
                s.code AS source_code, s.name AS source_name, s.url AS source_url
           FROM fact_evidence e
           LEFT JOIN studies st          ON st.id = e.study_id
           LEFT JOIN external_records er ON er.id = e.external_record_id
           LEFT JOIN source_files sf     ON sf.id = e.source_file_id
           LEFT JOIN import_runs ir      ON ir.id = sf.import_run_id
           JOIN datasets d ON d.id = COALESCE(st.dataset_id, er.dataset_id, ir.dataset_id)
           JOIN sources s  ON s.id = d.source_id
          WHERE e.fact_id = $1
          ORDER BY e.id`,
        [factId],
      );
      return rows;
    },
  };
}
