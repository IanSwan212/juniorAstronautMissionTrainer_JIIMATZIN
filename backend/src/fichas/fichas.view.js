/** Proyección pública: conserva afirmación, adaptación y evidencia por separado. */
export function presentarFicha({ ficha, evidencias }) {
  return {
    id: ficha.code,
    language: ficha.language,
    version: ficha.version,
    title: ficha.title,
    explanation: ficha.explanation,
    backedFact: ficha.backed_fact,
    missionContext: ficha.mission_context,
    gameAdaptation: ficha.game_adaptation,
    references: ficha.source_refs,
    evidence: evidencias.map((e) => ({
      claim: e.claim,
      locator: e.locator,
      studyAccession: e.accession,
      publicationDoi: e.publication_doi,
      dataDoi: e.data_doi,
      source: { id: e.source_code, name: e.source_name, url: e.source_url },
    })),
  };
}
