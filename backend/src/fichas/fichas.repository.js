/** Fichas editoriales de ciencia, independientes de la publicación de escenarios. */
export function crearRepositorioFichas(pool) {
  return {
    async buscarAprobada(code, language, recordId) {
      // Una sentencia mantiene ficha, revisión y evidencias en la misma instantánea.
      // Una aprobación antigua nunca se salta un rechazo o revisión pendiente posterior.
      const { rows } = await pool.query(
        `SELECT f.fact_key, f.record_id, f.language, f.title,
                f.scientific_statement, f.child_explanation, f.mission_context,
                f.game_adaptation, f.limitations,
                p.schema_version, p.processor_id, p.source_context,
                evidence.items AS evidence, mechanics.ids AS mechanic_ids
           FROM ciencia.fact_cards f
           JOIN ciencia.processed_records p USING (record_id)
           JOIN LATERAL (
             SELECT decision, reviewed_at, review_id
               FROM ciencia.fact_reviews
              WHERE fact_record_id = f.record_id
              ORDER BY reviewed_at DESC, review_id DESC LIMIT 1
           ) review ON review.decision = 'approved'
           JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
                      'index', e.evidence_index, 'type', e.evidence_type,
                      'sourceFileId', e.source_file_id, 'locator', e.locator,
                      'expected', e.expected,
                      'verifiedAgainstPreservedSource', e.verified_against_preserved_source
                    ) ORDER BY e.evidence_index) AS items,
                    bool_and(e.verified_against_preserved_source) AS verified
               FROM ciencia.fact_evidence e
              WHERE e.fact_record_id = f.record_id
           ) evidence ON evidence.items IS NOT NULL AND evidence.verified
           CROSS JOIN LATERAL (
             SELECT COALESCE(jsonb_agg(m.mechanic_id ORDER BY m.mechanic_id), '[]'::jsonb) AS ids
               FROM ciencia.fact_mechanics m WHERE m.fact_record_id = f.record_id
           ) mechanics
          WHERE f.fact_key = $1 AND f.language = $2
            AND ($3::text IS NULL OR f.record_id = $3)
            AND p.quality_status IN ('accepted', 'not_applicable')
          ORDER BY review.reviewed_at DESC, review.review_id DESC, f.record_id
          LIMIT 1`,
        [code, language, recordId ?? null],
      );
      return rows[0] ?? null;
    },
  };
}
