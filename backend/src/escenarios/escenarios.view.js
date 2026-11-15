/** Vista JSON del contrato v1; no consulta datos ni recibe objetos de Express. */
function aCondicion(f) {
  const base = {
    gameSol: f.game_sol,
    gamePhase: f.game_phase,
    justification: f.justification,
    context: f.dataset_context ?? null,
    dataset: f.dataset_external_id ?? null,
  };
  if (f.obs_id != null) {
    return {
      ...base,
      kind: 'observation',
      evidenceId: `obs:${f.obs_id}`,
      variable: f.variable,
      value: f.value, // null si la observación es faltante (p. ej. −999 de REMS)
      unit: f.unit,
      quality: f.quality_status,
      observedAt: f.observed_at,
      missionSol: f.mission_sol,
    };
  }
  return {
    ...base,
    kind: 'record',
    evidenceId: `rec:${f.rec_id}`,
    variable: f.record_type,
    value: null,
    unit: null,
    quality: null,
    occurredAt: f.occurred_at,
    payload: f.payload,
  };
}

export function presentarListaEscenarios(filas) {
  return {
    escenarios: filas.map((f) => ({
      scenarioId: f.code,
      scenarioVersion: String(f.version),
      rulesVersion: f.rules_version,
      language: f.language,
    })),
  };
}

export function presentarEscenario({ escenario: esc, condiciones, fichas }) {
  const cfg = esc.config ?? {};
  return {
    schemaVersion: '1',
    scenarioId: esc.code,
    scenarioVersion: String(esc.version),
    rulesVersion: esc.rules_version,
    language: esc.language,
    dataMode: cfg.dataMode ?? 'historical',
    sourceCoverage: cfg.sourceCoverage ?? { start: null, end: null },
    retrievedAt: cfg.retrievedAt ?? null,
    conditions: condiciones.map(aCondicion),
    factIds: fichas.map((f) => f.code),
    facts: fichas.map((f) => ({
      id: f.code,
      language: f.language,
      version: f.version,
      title: f.title,
      explanation: f.explanation,
      gameAdaptation: f.game_adaptation,
      appearsAt: { gameSol: f.game_sol, gamePhase: f.game_phase },
    })),
    modelAssumptions: cfg.modelAssumptions ?? [],
  };
}
