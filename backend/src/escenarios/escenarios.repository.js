/** Persistencia del modelo de escenarios. Solo consultas parametrizadas. */
export function crearRepositorioEscenarios(pool) {
  return {
    async listarPublicados() {
      const { rows } = await pool.query(
        `SELECT code, version, rules_version, language
           FROM scenarios
          WHERE publication_status = 'published'
          ORDER BY code, version DESC`,
      );
      return rows;
    },

    /** Sin versión → la publicada más reciente. */
    async buscarPublicado(code, version) {
      const { rows } = await pool.query(
        `SELECT id, code, version, rules_version, language, config
           FROM scenarios
          WHERE code = $1
            AND publication_status = 'published'
            AND ($2::int IS NULL OR version = $2)
          ORDER BY version DESC
          LIMIT 1`,
        [code, version ?? null],
      );
      return rows[0] ?? null;
    },

    /** Observaciones y registros externos elegidos para el escenario, con su contexto. */
    async listarCondiciones(scenarioId) {
      const { rows } = await pool.query(
        `SELECT sr.game_sol, sr.game_phase, sr.justification,
                o.id AS obs_id, o.variable, o.value, o.unit, o.quality_status,
                o.observed_at, o.mission_sol,
                r.id AS rec_id, r.record_type, r.occurred_at, r.payload,
                d.context AS dataset_context, d.external_id AS dataset_external_id
           FROM scenario_records sr
           LEFT JOIN observations o      ON o.id = sr.observation_id
           LEFT JOIN external_records r  ON r.id = sr.external_record_id
           LEFT JOIN datasets d          ON d.id = COALESCE(o.dataset_id, r.dataset_id)
          WHERE sr.scenario_id = $1
          ORDER BY sr.game_sol NULLS LAST, sr.id`,
        [scenarioId],
      );
      return rows;
    },

    /** Fichas esenciales (solo aprobadas) con el momento en que aparecen. */
    async listarFichas(scenarioId) {
      const { rows } = await pool.query(
        `SELECT f.code, f.language, f.version, f.title, f.explanation, f.game_adaptation,
                sf.game_sol, sf.game_phase
           FROM scenario_facts sf
           JOIN fact_cards f ON f.id = sf.fact_id
          WHERE sf.scenario_id = $1 AND f.review_status = 'approved'
          ORDER BY sf.game_sol NULLS LAST, f.code`,
        [scenarioId],
      );
      return rows;
    },
  };
}
