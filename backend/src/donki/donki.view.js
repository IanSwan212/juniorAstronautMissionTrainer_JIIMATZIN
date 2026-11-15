import { SCHEMA_VERSION, SOURCE_CONTEXT } from './donki.normalizador.js';
import { PARAMETROS_FLR } from './donki.cliente.js';

/**
 * Respuesta de `GET /api/v1/live/donki/flares`. Los registros siguen el sobre de la limpieza
 * (snake_case, `schema_version` 1.0.0); los metadatos de captura reflejan `runtime/donki_flr_catalogue.json`.
 * Contrato: contrato/donki-live.schema.json
 */
export function presentarFlares({ carga, capturadoEn, cache, edadS }, { ttlS }) {
  const eventos = carga.eventos;
  const inicios = eventos.map((e) => e.data.begin_time); // ya vienen ordenados
  const excluidos = carga.decisiones.filter((d) => d.decision !== 'accepted' && d.decision !== 'duplicate_identical');
  return {
    schema_version: SCHEMA_VERSION,
    data_mode: 'near_real_time',
    source_context: SOURCE_CONTEXT,
    is_mars_surface_measurement: false,
    retrieved_at: capturadoEn.toISOString(),
    period_requested: { startDate: carga.ventana.start, endDate: carga.ventana.end },
    coverage: { start: inicios[0] ?? null, end: inicios.at(-1) ?? null },
    source: {
      id: 'nasa_ccmc_donki',
      product: 'FLR',
      params: { startDate: carga.ventana.start, endDate: carga.ventana.end, ...PARAMETROS_FLR },
      http_status: carga.httpStatus,
      source_file_id: carga.sourceFileId,
      empty_body: carga.cuerpoVacio,
    },
    freshness: { cache, age_s: edadS, ttl_s: ttlS, stale: cache === 'stale' },
    count: eventos.length,
    input_count: carga.entradas,
    ordering: 'begin_time, external_id',
    review: {
      excluded: excluidos,
      duplicates_ignored: carga.decisiones.filter((d) => d.decision === 'duplicate_identical').length,
      time_sequence_flagged: carga.decisiones
        .filter((d) => d.decision === 'accepted' && d.reasons.includes('time_sequence_inconsistent_flagged'))
        .map((d) => d.event_id),
    },
    completeness: 'not_asserted',
    events: eventos,
  };
}
