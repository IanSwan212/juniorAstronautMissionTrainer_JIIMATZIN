/** Proyección explícita: no devuelve payload ni identidad/notas del revisor. */
export function presentarFicha(ficha) {
  return {
    id: ficha.fact_key,
    recordId: ficha.record_id,
    schemaVersion: ficha.schema_version,
    processorId: ficha.processor_id,
    language: ficha.language,
    title: ficha.title,
    explanation: ficha.child_explanation,
    backedFact: ficha.scientific_statement,
    missionContext: ficha.mission_context,
    sourceContext: ficha.source_context,
    gameAdaptation: ficha.game_adaptation,
    limitations: ficha.limitations,
    mechanicIds: ficha.mechanic_ids,
    references: [...new Set(ficha.evidence.map((e) => e.sourceFileId))],
    evidence: ficha.evidence,
  };
}
