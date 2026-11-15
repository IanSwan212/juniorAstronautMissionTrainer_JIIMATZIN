import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const text = z.string().min(1);
const integer = z.number().int();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const fileId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const object = z.record(z.string(), z.json());
const nullableText = z.string().nullable().optional();
const member = z.object({ release_id: text, fact_record_id: hash, fact_key: text, language: z.literal('es') });

export const archivos = {
  'sources.jsonl': z.strictObject({ source_id: text, institution: text, product: text, url: nullableText }),
  'datasets.jsonl': z.strictObject({ dataset_id: text, source_id: text, product: text, platform: nullableText, source_context: text }),
  'source_files.jsonl': z.strictObject({ source_file_id: fileId, sha256: hash, size_bytes: integer.nonnegative(),
    locations: z.array(z.strictObject({ input: z.enum(['A', 'B']), path: text, archive_member: nullableText })).min(1) }),
  'captures.jsonl': z.object({ capture_id: text, input: z.enum(['A', 'B']), endpoint: nullableText,
    public_params: object.optional(), captured_at_utc: nullableText, http_status: integer.min(100).max(599).nullable().optional(),
    attempts: z.array(z.json()), final_status: text }).passthrough(),
  'capture_files.jsonl': z.strictObject({ capture_id: text, source_file_id: fileId, role: text }),
  'quality_policies.jsonl': z.object({ policy_id: text, status: text }).passthrough(),
  'processors.jsonl': z.strictObject({ processor_id: hash, schema_version: z.literal('1.0.0'), policy_id: text,
    code_and_config_sha256: z.record(z.string(), hash) }),
  'studies.jsonl': z.object({ accession: text, source_file_id: fileId, title: text }).passthrough(),
  'mechanics.jsonl': z.strictObject({ mechanic_id: text, description: text, is_formula: z.boolean(), origin: text }),
  'instrument_events.jsonl': z.strictObject({ source_file_id: fileId, event_annotation_id: text, sol: integer.nonnegative(),
    event_text: z.string(), gts_cal: z.boolean(), hs_defrost: z.boolean(), hs_regen: z.boolean(), ps_cal: z.boolean() }),
  'lineage_members.jsonl': z.strictObject({ aggregate_id: hash, aggregate_record_id: hash, record_id: hash,
    role: z.enum(['temperature', 'pressure']) }),
  'release_members.jsonl': z.strictObject({ release_id: text, record_id: hash, record_type: text,
    usage_tier: z.enum(['runtime', 'educational', 'archive']) }),
  'fact_evidence.jsonl': member.extend({ evidence_index: integer.nonnegative(), evidence_type: text, source_file_id: fileId,
    locator: object, expected: z.json(), verified_against_preserved_source: z.boolean() }).strict(),
  'fact_mechanics.jsonl': member.extend({ mechanic_id: text }).strict(),
  'hour_event_annotations.jsonl': z.strictObject({ aggregate_record_id: hash, event_annotation_id: text,
    source_sol: integer.nonnegative(), lmst_hour: integer.min(0).max(23) }),
};

export const tipos = {
  'observations.jsonl': 'observation', 'environment_hours.jsonl': 'environment_hour',
  'solar_events.jsonl': 'solar_event', 'radiation_samples.jsonl': 'radiation_sample', 'fact_cards.jsonl': 'fact',
};
const schemaFiles = { observation: 'observation', environment_hour: 'environment_hour', solar_event: 'solar_event',
  radiation_sample: 'radiation_sample', fact: 'fact' };
const schema = async (name) => z.fromJSONSchema(JSON.parse(await readFile(new URL(`./schemas/${name}.schema.json`, import.meta.url), 'utf8')));
const envelope = await schema('envelope');
const schemas = Object.fromEntries(await Promise.all(Object.entries(schemaFiles).map(async ([type, name]) => [type, await schema(`${name}.data`)])));

export function rutaRelativa(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00]/.test(value) || value.startsWith('/') || value.split('/').some((p) => !p || p === '.' || p === '..')) {
    throw new Error('Ruta de archivo no relativa o no segura');
  }
  return value;
}

export function fecha(value) {
  if (value == null) return null;
  value = value.replace(/\+00:00$/, 'Z');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Timestamp UTC inválido');
  }
  // Date.parse normaliza fechas imposibles como 30 de febrero; se rechazan.
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('Fecha UTC inexistente');
  return value;
}

function missionDate(value) {
  if (value == null) return null;
  const match = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(value);
  if (!match) throw new Error('Fecha de misión con formato no soportado');
  const iso = `${match[3]}-${match[1]}-${match[2]}`;
  fecha(`${iso}T00:00:00Z`);
  return iso;
}

export function horaMarciana(lmst, sol) {
  const match = /^(\d{5})M(\d{2}):(\d{2}):(\d{2})\.(\d+)$/.exec(lmst);
  if (!match || Number(match[1]) !== sol || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    throw new Error('LMST inválido o incompatible con source_sol');
  }
  return Number(match[2]);
}

export function validarFila(filename, row, manifest) {
  const type = tipos[filename];
  if (!type) { archivos[filename].parse(row); return; }
  envelope.parse(row);
  if (row.record_type !== type) throw new Error(`record_type no corresponde a ${filename}`);
  schemas[type].parse(row.data);
  if (row.processor_id !== manifest.processor_id || row.schema_version !== manifest.schema_version) throw new Error('Procesador o versión inconsistente');
  if (row.selection_policy_id !== null && row.selection_policy_id !== manifest.policy_version) throw new Error('Política de selección inconsistente');
  const d = row.data;
  if (type === 'observation') {
    horaMarciana(d.lmst, d.source_sol);
    if (!Number.isSafeInteger(d.sclk)) throw new Error('sclk entero obligatorio');
    if (row.quality_status !== 'accepted' || d.value === -999 || !Number.isFinite(d.value)) throw new Error('Observación no seleccionada o faltante');
    if (d.unit !== (d.variable === 'pressure' ? 'Pa' : 'K')) throw new Error('Unidad incompatible');
    if (d.variable === 'ambient_temperature' && d.value <= 0) throw new Error('Temperatura no positiva');
    if (d.variable === 'ambient_temperature' && (d.uncertainty != null || d.uncertainty_unit != null)) throw new Error('Incertidumbre no aplicable');
    if (d.variable === 'pressure' && (!Number.isFinite(d.uncertainty) || d.uncertainty < 0 || d.uncertainty_unit !== 'Pa')) throw new Error('Incertidumbre de presión inválida');
  }
  if (type === 'environment_hour') {
    if (d.lmst_hour > 23 || d.mission_day !== d.source_sol - 9 || !row.provenance.lineage_id || !d.aggregation_rule) throw new Error('Hora, día o linaje incompatible');
    for (const [variable, unit] of [['temperature', 'K'], ['pressure', 'Pa']]) {
      const s = d[variable];
      if (s.unit !== unit || s.count > s.source_count || s.source_count > s.rows_in_group) throw new Error('Estadísticas o unidades incompatibles');
      if (s.count === 0) {
        if ([s.min, s.max, s.sample_mean, s.first_lmst, s.last_lmst].some((x) => x !== null)) throw new Error('Una hora vacía debe conservar sus faltantes');
      } else {
        if (![s.min, s.max, s.sample_mean].every(Number.isFinite) || s.min > s.sample_mean || s.sample_mean > s.max) throw new Error('Estadísticas inválidas');
        if (horaMarciana(s.first_lmst, d.source_sol) !== d.lmst_hour || horaMarciana(s.last_lmst, d.source_sol) !== d.lmst_hour) throw new Error('Cobertura LMST incompatible');
      }
      const fraction = s.source_count === 0 ? null : s.count / s.source_count;
      if (fraction === null ? s.selection_fraction !== null : !Number.isFinite(s.selection_fraction) || Math.abs(s.selection_fraction - fraction) > 1e-12) throw new Error('Fracción de selección incompatible');
    }
  }
  if (type === 'solar_event') {
    const times = [d.begin_time, d.peak_time, d.end_time].map((t) => t == null ? null : Date.parse(fecha(t)));
    if ((times[1] !== null && times[1] < times[0]) || (times[2] !== null && times[2] < times[0]) || (times[1] !== null && times[2] !== null && times[2] < times[1])) throw new Error('Secuencia temporal FLR incompatible con la BD');
    if (d.is_mars_surface_measurement !== false || !d.catalog) throw new Error('Contexto solar inválido');
  }
  if (type === 'radiation_sample' && (d.observed_at_utc != null || row.source_context !== 'other_mission_educational')) throw new Error('No reinterpretar la convención temporal ni el contexto ISS');
}

const fields = (value, names) => Object.fromEntries(names.split(' ').map((key) => [key, value[key] ?? null]));
export const columnas = {
  sources: 'source_id institution product url', datasets: 'dataset_id source_id product platform source_context',
  source_files: 'source_file_id sha256 size_bytes', source_file_locations: 'source_file_id root_key relative_path archive_member',
  captures: 'capture_id input_group endpoint public_params captured_at_utc http_status attempts final_status metadata',
  capture_files: 'capture_id source_file_id role', quality_policies: 'policy_id definition status',
  processors: 'processor_id schema_version policy_id code_and_config_sha256',
  processed_records: 'record_id record_type dataset_id processor_id selection_policy_id schema_version source_context quality_status quality_reasons payload',
  record_source_refs: 'record_id ref_index source_file_id locator', release_members: 'release_id record_id usage_tier',
  observations: 'record_id record_type variable value unit source_sol lmst ltst lmst_hour source_timestamp_seconds time_basis uncertainty uncertainty_unit flags_original flags_normalized',
  environment_hours: 'record_id record_type source_sol mission_day lmst_hour aggregation_rule lineage_id temperature_min_k temperature_max_k temperature_mean_k pressure_min_pa pressure_max_pa pressure_mean_pa temperature_raw_row_count temperature_present_value_count temperature_selected_count pressure_raw_row_count pressure_present_value_count pressure_selected_count temperature_first_lmst temperature_last_lmst temperature_coverage_label pressure_first_lmst pressure_last_lmst pressure_coverage_label',
  lineage_members: 'aggregate_record_id observation_record_id role',
  instrument_events: 'source_file_id event_annotation_id sol event_text gts_cal hs_defrost hs_regen ps_cal',
  hour_event_annotations: 'aggregate_record_id annotation_source_file_id event_annotation_id',
  solar_events: 'record_id record_type external_id event_type class_type begin_time peak_time end_time catalog active_region source_location source_url source_version',
  radiation_samples: 'record_id record_type variable value unit spacecraft instrument_id timestamp_original time_basis observed_at_utc seconds_since_previous',
  studies: 'accession source_file_id title description publication_doi project_identifier experiment_platform mission_start mission_end experiment_start experiment_end metadata',
  fact_cards: 'record_id record_type fact_key language title scientific_statement child_explanation mission_context game_adaptation limitations',
  fact_evidence: 'fact_record_id evidence_index evidence_type source_file_id locator expected verified_against_preserved_source',
  mechanics: 'mechanic_id description is_formula origin', fact_mechanics: 'fact_record_id mechanic_id',
};
export const claves = {
  sources: 'source_id', datasets: 'dataset_id', source_files: 'source_file_id',
  source_file_locations: columnas.source_file_locations, captures: 'capture_id', capture_files: columnas.capture_files,
  quality_policies: 'policy_id', processors: 'processor_id', processed_records: 'record_id',
  record_source_refs: 'record_id ref_index', release_members: 'release_id record_id', observations: 'record_id',
  environment_hours: 'record_id', lineage_members: columnas.lineage_members,
  instrument_events: 'source_file_id event_annotation_id', hour_event_annotations: columnas.hour_event_annotations,
  solar_events: 'record_id', radiation_samples: 'record_id', studies: 'accession source_file_id', fact_cards: 'record_id',
  fact_evidence: 'fact_record_id evidence_index', mechanics: 'mechanic_id', fact_mechanics: columnas.fact_mechanics,
};

export function proyectar(filename, row, context) {
  const type = tipos[filename];
  const result = [];
  const add = (table, values) => result.push([table, fields(values, columnas[table])]);
  if (type) {
    const d = row.data;
    add('processed_records', { ...row, payload: row });
    row.provenance.source_refs.forEach((ref, i) => add('record_source_refs', { record_id: row.record_id, ref_index: i, ...ref }));
    if (type === 'environment_hour') {
      const projected = { ...d, record_id: row.record_id, record_type: type, lineage_id: row.provenance.lineage_id };
      for (const [variable, suffix] of [['temperature', 'k'], ['pressure', 'pa']]) {
        const s = d[variable];
        Object.assign(projected, {
          [`${variable}_min_${suffix}`]: s.min, [`${variable}_max_${suffix}`]: s.max, [`${variable}_mean_${suffix}`]: s.sample_mean,
          [`${variable}_raw_row_count`]: s.rows_in_group, [`${variable}_present_value_count`]: s.source_count,
          [`${variable}_selected_count`]: s.count, [`${variable}_first_lmst`]: s.first_lmst,
          [`${variable}_last_lmst`]: s.last_lmst, [`${variable}_coverage_label`]: s.coverage_label,
        });
      }
      add('environment_hours', projected);
    } else {
      const table = filename.slice(0, -6);
      add(table, { ...d, record_id: row.record_id, record_type: type,
        ...(type === 'observation' ? { lmst_hour: horaMarciana(d.lmst, d.source_sol), source_timestamp_seconds: d.sclk } : {}) });
    }
  } else if (filename === 'source_files.jsonl') {
    if (row.source_file_id !== `sha256:${row.sha256}`) throw new Error('Identidad de archivo incompatible');
    add('source_files', row);
    for (const location of row.locations) add('source_file_locations', {
      source_file_id: row.source_file_id, root_key: location.input,
      relative_path: rutaRelativa(location.path), archive_member: location.archive_member == null ? null : rutaRelativa(location.archive_member),
    });
  } else if (filename === 'quality_policies.jsonl') {
    add('quality_policies', { ...row, definition: row });
  } else if (filename === 'captures.jsonl') {
    add('captures', { ...row, input_group: row.input, public_params: row.public_params ?? {}, captured_at_utc: fecha(row.captured_at_utc), metadata: row });
  } else if (filename === 'studies.jsonl') {
    add('studies', { ...row, metadata: row,
      mission_start: missionDate(row.mission_start_original), mission_end: missionDate(row.mission_end_original),
      experiment_start: missionDate(row.experiment_start_original), experiment_end: missionDate(row.experiment_end_original) });
  } else if (filename === 'lineage_members.jsonl') {
    const hour = context.hours.get(row.aggregate_record_id);
    if (!hour || row.aggregate_id !== hour.provenance.lineage_id) throw new Error('aggregate_id no corresponde al linaje horario');
    add('lineage_members', { ...row, observation_record_id: row.record_id });
  } else if (filename === 'hour_event_annotations.jsonl') {
    const matches = context.events.get(row.event_annotation_id) ?? [];
    const hour = context.hours.get(row.aggregate_record_id)?.data;
    if (matches.length !== 1 || !hour || hour.source_sol !== row.source_sol || hour.lmst_hour !== row.lmst_hour || matches[0].sol !== row.source_sol) {
      throw new Error('Anotación instrumental ambigua o incompatible con la hora');
    }
    add('hour_event_annotations', { ...row, annotation_source_file_id: matches[0].source_file_id });
  } else {
    add(filename.slice(0, -6), row);
  }
  return result;
}
