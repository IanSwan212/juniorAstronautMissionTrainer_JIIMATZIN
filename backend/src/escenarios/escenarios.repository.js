/** Lectura de una versión completa en una sola instantánea de PostgreSQL. */
export function crearRepositorioEscenarios(pool) {
  return {
    async listarPublicados() {
      const { rows } = await pool.query(`SELECT scenario_id AS code,version,rules_version,language,release_id,title
        FROM juego.available_scenarios ORDER BY scenario_id,version DESC`);
      return rows;
    },
    async buscarPublicado(code, version) {
      const { rows } = await pool.query(`WITH selected AS (
          SELECT * FROM juego.available_scenarios WHERE scenario_id=$1 AND ($2::int IS NULL OR version=$2)
          ORDER BY version DESC LIMIT 1
        ), chosen_records AS (
          SELECT x.*,p.record_type,p.dataset_id,p.processor_id,p.selection_policy_id,p.source_context,
            p.quality_status,p.quality_reasons,p.payload,m.usage_tier
          FROM selected s JOIN juego.scenario_records x ON x.scenario_id=s.scenario_id AND x.scenario_version=s.version
          JOIN ciencia.processed_records p USING(record_id)
          JOIN ciencia.release_members m ON m.release_id=x.release_id AND m.record_id=x.record_id
        ), chosen_facts AS (
          SELECT x.*,f.fact_key,f.language,f.title,f.child_explanation,f.game_adaptation,f.limitations,p.source_context
          FROM selected s JOIN juego.scenario_facts x ON x.scenario_id=s.scenario_id AND x.scenario_version=s.version
          JOIN ciencia.fact_cards f USING(record_id) JOIN ciencia.processed_records p USING(record_id)
        ), files AS (
          SELECT DISTINCT ref.source_file_id FROM ciencia.record_source_refs ref
          WHERE ref.record_id IN (SELECT record_id FROM chosen_records UNION SELECT record_id FROM chosen_facts)
        ), capture_dates AS (
          SELECT f.source_file_id,max(c.captured_at_utc) AS captured_at FROM files f
          LEFT JOIN ciencia.capture_files cf ON cf.source_file_id=f.source_file_id AND EXISTS (
            SELECT 1 FROM ciencia.release_resources rr JOIN selected s USING(release_id)
            WHERE rr.table_name='capture_files' AND rr.resource_key=jsonb_build_object(
              'capture_id',cf.capture_id,'source_file_id',cf.source_file_id,'role',cf.role))
          LEFT JOIN ciencia.captures c ON c.capture_id=cf.capture_id AND EXISTS (
            SELECT 1 FROM ciencia.release_resources rr JOIN selected s USING(release_id)
            WHERE rr.table_name='captures' AND rr.resource_key=jsonb_build_object('capture_id',c.capture_id))
          GROUP BY f.source_file_id
        )
        SELECT s.scenario_id AS code,s.version,s.release_id,s.rules_version,s.language,s.title,s.model_assumptions,
          g.definition AS rules,r.dataset_version,r.schema_version AS dataset_schema_version,
          CASE WHEN count_dates.n>0 AND count_dates.known=count_dates.n THEN count_dates.latest ELSE NULL END AS retrieved_at,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'record_id',x.record_id,'record_type',x.record_type,'game_sol',x.game_sol,'game_phase',x.game_phase,
            'role',x.role,'justification',x.justification,'dataset_id',x.dataset_id,'source_context',x.source_context,
            'quality_status',x.quality_status,'quality_reasons',x.quality_reasons,'usage_tier',x.usage_tier,
            'data',x.payload->'data','processor_id',x.processor_id,'selection_policy_id',x.selection_policy_id,
            'lineage_id',x.payload->'provenance'->'lineage_id',
            'source_refs',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceFileId',ref.source_file_id,'locator',ref.locator)
              ORDER BY ref.ref_index) FROM ciencia.record_source_refs ref WHERE ref.record_id=x.record_id),'[]'::jsonb)
          ) ORDER BY x.position) FROM chosen_records x),'[]'::jsonb) AS conditions,
          COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.position) FROM chosen_facts f),'[]'::jsonb) AS facts
        FROM selected s JOIN juego.game_rule_sets g USING(rules_version)
        JOIN ciencia.dataset_releases r USING(release_id)
        CROSS JOIN (SELECT count(*) AS n,count(captured_at) AS known,max(captured_at) AS latest FROM capture_dates) count_dates`,
        [code, version ?? null]);
      return rows[0] ?? null;
    },
  };
}
