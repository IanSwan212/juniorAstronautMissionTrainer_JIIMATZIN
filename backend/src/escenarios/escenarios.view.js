import { presentarContenido } from '../contenido/contenido.view.js';
/** Proyección pública del contrato 2; excluye payloads y metadatos administrativos. */
function condicion(r) {
  const data = r.data;
  const measurement = r.record_type === 'observation' || r.record_type === 'radiation_sample';
  return {
    kind: r.record_type, recordId: r.record_id, role: r.role,
    gameSol: r.game_sol, gamePhase: r.game_phase, justification: r.justification,
    context: r.source_context, dataset: r.dataset_id, usageTier: r.usage_tier,
    quality: r.quality_status, qualityReasons: r.quality_reasons,
    variable: measurement ? data.variable : r.record_type,
    value: measurement ? data.value : null, unit: measurement ? data.unit : null,
    data,
    provenance: { processorId: r.processor_id, selectionPolicyId: r.selection_policy_id,
      lineageId: r.lineage_id ?? null, sourceRefs: r.source_refs },
  };
}

function utcCoverage(conditions) {
  if (!conditions.length) return { start: null, end: null };
  const spans = conditions.map((c) => {
    if (c.kind === 'solar_event') return [c.data.begin_time,c.data.end_time ?? c.data.peak_time ?? c.data.begin_time];
    if (c.kind === 'radiation_sample' && c.data.observed_at_utc) return [c.data.observed_at_utc,c.data.observed_at_utc];
    return null;
  });
  if (spans.some((s) => s === null)) return { start: null, end: null };
  return { start: new Date(Math.min(...spans.map((s) => Date.parse(s[0])))).toISOString(),
    end: new Date(Math.max(...spans.map((s) => Date.parse(s[1])))).toISOString() };
}

export function presentarListaEscenarios(rows) {
  return { escenarios: rows.map((r) => ({ scenarioId:r.code,scenarioVersion:String(r.version),
    releaseId:r.release_id,rulesVersion:r.rules_version,language:r.language,title:r.title })) };
}

export function presentarEscenario(r) {
  const conditions = r.conditions.map(condicion);
  const mars = conditions.filter((c) => ['observation','environment_hour'].includes(c.kind)).map((c) => c.data.source_sol);
  return {
    schemaVersion:'2',scenarioId:r.code,scenarioVersion:String(r.version),title:r.title,language:r.language,
    releaseId:r.release_id,datasetVersion:r.dataset_version,datasetSchemaVersion:r.dataset_schema_version,
    rulesVersion:r.rules_version,rules:r.rules,dataMode:'historical',
    sourceCoverage:utcCoverage(conditions),
    marsCoverage:mars.length ? { startSol:Math.min(...mars),endSol:Math.max(...mars),timeBasis:'mars_lmst' } : null,
    retrievedAt:r.retrieved_at ? new Date(r.retrieved_at).toISOString() : null,
    conditions,factIds:r.facts.map((f) => f.fact_key),
    facts:r.facts.map((f) => ({ id:f.fact_key,recordId:f.record_id,language:f.language,title:f.title,
      explanation:f.child_explanation,gameAdaptation:f.game_adaptation,limitations:f.limitations,sourceContext:f.source_context,
      appearsAt:{ gameSol:f.game_sol,gamePhase:f.game_phase } })),
    modelAssumptions:r.model_assumptions,
    ...(r.gameplay?{gameplay:presentarContenido(r.gameplay,r.facts)}:{}),
  };
}
