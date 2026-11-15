import { createHash } from 'node:crypto';

/**
 * Normalizador DONKI FLR → sobre estándar de la limpieza (JIIMATZIN_Dataset v1.0.0).
 * Port fiel de `read_flr` y `ENV` de pipeline/build.py: mismas reglas de aceptación,
 * duplicados, fechas ISO-Z, orden y forma del registro (`envelope` + `solar_event.data`).
 * No añade etiquetas de peligro ni interpreta la clase: conserva `class_type` tal cual.
 */

export const SCHEMA_VERSION = '1.0.0';
export const DATASET_ID = 'donki_flr_live';
export const SOURCE_CONTEXT = 'solar_event_catalogue';

/** Serialización canónica (claves ordenadas, sin espacios), equivalente a `canon` de build.py. */
export function canon(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canon).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(valor[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

export const sha256 = (datos) => createHash('sha256').update(datos).digest('hex');
const hid = (valor) => sha256(canon(valor));

/** Identifica el algoritmo de normalización (no hay código Python en vivo: se declara la versión). */
export const PROCESSOR_ID = hid({
  processor: 'donki-live-flr-normalizer',
  version: '1',
  derived_from: 'pipeline/build.py read_flr',
  schema_version: SCHEMA_VERSION,
});

const ISO_Z = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(:\d\d(?:\.\d+)?)?Z$/;

/** 'YYYY-MM-DDTHH:MMZ' → 'YYYY-MM-DDTHH:MM:00Z'. Cualquier otra forma → null (no se adivina). */
export function isoZ(valor) {
  if (typeof valor !== 'string') return null;
  const m = ISO_Z.exec(valor);
  return m ? `${m[1]}${m[2] ?? ':00'}Z` : null;
}

const vacio = (v) => v === null || v === undefined || v === '';
const textoNoVacio = (v) => typeof v === 'string' && v.length > 0;

/**
 * @param {unknown} lista respuesta JSON de DONKI /get/FLR
 * @returns {{ aceptados: {indice:number, evento:object}[], decisiones: object[] }}
 */
export function leerFlr(lista) {
  if (!Array.isArray(lista) || !lista.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
    throw new TypeError('La respuesta FLR no es una lista de objetos');
  }
  const aceptados = [];
  const decisiones = [];
  const vistos = new Map(); // flrID → { x, conflicto }

  lista.forEach((x, i) => {
    const eid = x.flrID;
    const motivos = [];
    if (!textoNoVacio(eid) || eid.trim() === '') motivos.push('missing_id');
    const inicio = isoZ(x.beginTime);
    if (inicio === null) motivos.push('missing_or_invalid_begin_time');
    if (!textoNoVacio(x.classType)) motivos.push('missing_class_type');
    if (!textoNoVacio(x.link)) motivos.push('missing_source_reference');

    if (vistos.has(eid)) {
      const previo = vistos.get(eid);
      const igual = canon(x) === canon(previo.x);
      decisiones.push({
        pointer: `/${i}`,
        event_id: eid,
        decision: igual ? 'duplicate_identical' : 'conflict',
        reasons: [igual ? 'duplicate_copy' : 'conflicting_duplicate_id'],
      });
      if (!igual) previo.conflicto = true;
      return;
    }
    vistos.set(eid, { x, conflicto: false });

    if (motivos.length) {
      decisiones.push({ pointer: `/${i}`, event_id: eid ?? null, decision: 'excluded', reasons: motivos });
      return;
    }

    const pico = isoZ(x.peakTime);
    const fin = isoZ(x.endTime);
    const secuencia = [inicio, pico, fin].filter(Boolean);
    const consistente =
      secuencia.every((t, k) => k === 0 || secuencia[k - 1] <= t) &&
      (vacio(x.peakTime) || pico !== null) &&
      (vacio(x.endTime) || fin !== null);

    const evento = {
      external_id: eid,
      event_type: 'FLR',
      begin_time: inicio,
      peak_time: pico,
      end_time: fin,
      begin_time_original: x.beginTime,
      peak_time_original: x.peakTime ?? null,
      end_time_original: x.endTime ?? null,
      class_type: x.classType,
      catalog: x.catalog ?? null,
      instruments: (Array.isArray(x.instruments) ? x.instruments : [])
        .filter((ins) => ins && typeof ins === 'object' && ins.displayName)
        .map((ins) => ins.displayName),
      source_location: x.sourceLocation || null,
      active_region: Number.isInteger(x.activeRegionNum) ? x.activeRegionNum : null,
      linked_events: x.linkedEvents || [],
      linked_events_supplied: x.linkedEvents !== null && x.linkedEvents !== undefined,
      source_url: x.link,
      source_version: Number.isInteger(x.versionId) ? x.versionId : null,
      time_sequence_consistent: consistente,
      is_mars_surface_measurement: false,
    };
    aceptados.push({ indice: i, evento });
    decisiones.push({
      pointer: `/${i}`,
      event_id: eid,
      decision: 'accepted',
      reasons: consistente ? [] : ['time_sequence_inconsistent_flagged'],
    });
  });

  const conflictos = new Set([...vistos].filter(([, v]) => v.conflicto).map(([k]) => k));
  const finales = aceptados.filter(({ evento }) => !conflictos.has(evento.external_id));
  for (const d of decisiones) {
    if (conflictos.has(d.event_id) && d.decision === 'accepted') {
      d.decision = 'excluded';
      d.reasons = ['conflicting_duplicate_id'];
    }
  }
  finales.sort((a, b) =>
    a.evento.begin_time < b.evento.begin_time ? -1 : a.evento.begin_time > b.evento.begin_time ? 1
      : a.evento.external_id < b.evento.external_id ? -1 : a.evento.external_id > b.evento.external_id ? 1 : 0);
  return { aceptados: finales, decisiones };
}

/** Sobre `envelope.schema.json` de la limpieza, con `data` conforme a `solar_event.data.schema.json`. */
export function crearSobre({ evento, indice, sourceFileId }) {
  const recordId = hid({
    k: { kind: 'donki_flr_live', external_id: evento.external_id, source_version: evento.source_version },
    p: PROCESSOR_ID,
    s: SCHEMA_VERSION,
    pol: null,
  });
  return {
    schema_version: SCHEMA_VERSION,
    record_id: recordId,
    record_type: 'solar_event',
    dataset_id: DATASET_ID,
    source_context: SOURCE_CONTEXT,
    processor_id: PROCESSOR_ID,
    selection_policy_id: null,
    quality_status: 'accepted',
    quality_reasons: [],
    usage_tier: 'runtime',
    provenance: {
      source_refs: [{ source_file_id: sourceFileId, locator: { kind: 'json_pointer', pointer: `/${indice}` } }],
      lineage_id: null,
    },
    data: evento,
  };
}
