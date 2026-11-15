import { createHash } from 'node:crypto';
import { z } from 'zod';
import { tipos, validarFila, proyectar } from './formato.js';

export const ordenArchivos = [
  'sources.jsonl', 'datasets.jsonl', 'source_files.jsonl', 'quality_policies.jsonl', 'processors.jsonl',
  'captures.jsonl', 'capture_files.jsonl', 'studies.jsonl', 'mechanics.jsonl', 'instrument_events.jsonl',
  'observations.jsonl', 'environment_hours.jsonl', 'solar_events.jsonl', 'radiation_samples.jsonl', 'fact_cards.jsonl',
  'lineage_members.jsonl', 'release_members.jsonl', 'fact_evidence.jsonl', 'fact_mechanics.jsonl', 'hour_event_annotations.jsonl',
];
const manifestSchema = z.object({
  schema_version: z.literal('1.0.0'), dataset_version: z.literal('1.0.0'),
  release_id: z.string().regex(/^rel_[0-9a-f]{32}$/), processor_id: z.string().regex(/^[0-9a-f]{64}$/),
  policy_version: z.string().min(1), status: z.literal('candidate_validated'),
  content_hash_reproducible: z.string().regex(/^[0-9a-f]{64}$/),
  db_ready_line_counts: z.record(z.string(), z.number().int().nonnegative()),
});
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (a, b) => canonical(a) === canonical(b);
function exigir(condition, message) { if (!condition) throw new Error(message); }

export async function recorrerPaquete(paquete, recibir = async () => {}) {
  const m = paquete.manifest;
  manifestSchema.parse(m);
  exigir(same(Object.keys(m.db_ready_line_counts).sort(), [...ordenArchivos].sort()), 'El paquete debe contener exactamente los 20 JSONL soportados');
  const context = { records: new Map(), facts: new Map(), hours: new Map(), events: new Map(),
    sources: new Set(), datasets: new Map(), files: new Set(), policies: new Map(), processors: new Set(),
    members: new Set(), evidence: new Map(), mechanics: new Map(), annotations: new Map() };
  const counts = {};
  const variables = { ambient_temperature: 0, pressure: 0 };
  for (const filename of ordenArchivos) {
    let line = 0;
    for await (const row of paquete.filas(filename)) {
      line++;
      try {
        validarFila(filename, row, m);
        const type = tipos[filename];
        if (filename === 'sources.jsonl') context.sources.add(row.source_id);
        if (filename === 'datasets.jsonl') {
          exigir(context.sources.has(row.source_id), 'Fuente de dataset no incluida');
          context.datasets.set(row.dataset_id, row.source_context);
        }
        if (filename === 'source_files.jsonl') context.files.add(row.source_file_id);
        if (filename === 'quality_policies.jsonl') {
          exigir(row.policy_id === m.policy_version, 'Política ajena al manifiesto');
          context.policies.set(row.policy_id, row);
        }
        if (filename === 'processors.jsonl') {
          exigir(context.policies.has(row.policy_id) && row.processor_id === m.processor_id, 'Procesador o política ajenos');
          for (const [name, hash] of Object.entries(row.code_and_config_sha256)) exigir(m.pipeline_files_sha256[name] === hash, 'Código/configuración del procesador inconsistentes');
          const digest = createHash('sha256').update(canonical({ code_and_config: row.code_and_config_sha256, schema_version: row.schema_version })).digest('hex');
          exigir(digest === row.processor_id, 'Identidad del procesador incorrecta');
          context.processors.add(row.processor_id);
        }
        if (filename === 'instrument_events.jsonl') {
          const events = context.events.get(row.event_annotation_id) ?? [];
          events.push(row); context.events.set(row.event_annotation_id, events);
        }
        if (type) {
          exigir(!context.records.has(row.record_id), 'record_id duplicado en el paquete');
          exigir(context.processors.has(row.processor_id), 'Procesador no incluido');
          exigir(context.datasets.has(row.dataset_id), 'Dataset no incluido');
          // El catálogo editorial agrupa antecedentes de varias misiones;
          // el contexto específico de cada ficha vive en el registro.
          if (type !== 'fact') exigir(context.datasets.get(row.dataset_id) === row.source_context, 'Contexto de dataset inconsistente');
          exigir(row.selection_policy_id === null || context.policies.has(row.selection_policy_id), 'Política no incluida');
          exigir(row.provenance.source_refs.length > 0 && row.provenance.source_refs.every((r) => context.files.has(r.source_file_id)), 'Referencia de procedencia no incluida');
          context.records.set(row.record_id, `${type}:${row.usage_tier}`);
          if (type === 'observation') {
            const d = row.data;
            const policy = context.policies.get(row.selection_policy_id)?.variables?.[d.variable];
            exigir(policy && policy.unit === d.unit, 'Definición de política de calidad ausente o incompatible');
            exigir(d.flags_original.trim() === d.flags_normalized && d.flags_normalized.length === policy.flags_length
              && /^[01X]+$/.test(d.flags_normalized), 'Flags normalizados incompatibles');
            exigir(Object.keys(policy.required_positions).every((i) => d.flags_normalized[Number(i)] === '1'), 'Observación incumple flags exigidos por la política');
            variables[d.variable]++;
          }
          if (type === 'environment_hour') context.hours.set(row.record_id, row);
          if (type === 'fact') context.facts.set(row.record_id, row);
        }
        if (filename === 'release_members.jsonl') {
          exigir(row.release_id === m.release_id && context.records.get(row.record_id) === `${row.record_type}:${row.usage_tier}`, 'Membresía, subtipo o nivel de uso incompatible');
          exigir(!context.members.has(row.record_id), 'Membresía duplicada');
          context.members.add(row.record_id);
        }
        if (filename === 'lineage_members.jsonl') {
          exigir(context.records.get(row.record_id)?.startsWith('observation:'), 'Miembro de linaje no es observación del paquete');
        }
        if (filename === 'fact_evidence.jsonl' || filename === 'fact_mechanics.jsonl') {
          const fact = context.facts.get(row.fact_record_id);
          exigir(fact && fact.data.fact_key === row.fact_key && fact.data.language === row.language && row.release_id === m.release_id, 'Relación de ficha, idioma o publicación incompatible');
          if (filename === 'fact_evidence.jsonl') {
            exigir(context.files.has(row.source_file_id) && fact.data.reference_ids.includes(row.source_file_id), 'Evidencia fuera de las referencias de la ficha');
            exigir(fact.provenance.source_refs.some((r) => r.source_file_id === row.source_file_id && same(r.locator, row.locator)), 'Localizador de evidencia ajeno a la procedencia');
            const ids = context.evidence.get(row.fact_record_id) ?? new Set();
            ids.add(row.source_file_id); context.evidence.set(row.fact_record_id, ids);
          } else {
            const ids = context.mechanics.get(row.fact_record_id) ?? new Set();
            exigir(!ids.has(row.mechanic_id), 'Mecánica de ficha duplicada');
            ids.add(row.mechanic_id); context.mechanics.set(row.fact_record_id, ids);
          }
        }
        if (filename === 'hour_event_annotations.jsonl') {
          const ids = context.annotations.get(row.aggregate_record_id) ?? new Set();
          exigir(!ids.has(row.event_annotation_id), 'Anotación horaria duplicada');
          ids.add(row.event_annotation_id); context.annotations.set(row.aggregate_record_id, ids);
        }
        const projected = proyectar(filename, row, context);
        for (const [table, values] of projected) await recibir(table, values);
      } catch (error) {
        throw new Error(`${filename}:${line}: ${error.message}`, { cause: error });
      }
    }
    counts[filename] = line;
  }
  exigir(context.members.size === context.records.size, 'No todos los registros tienen membresía');
  exigir(variables.ambient_temperature === m.counts.temperature.accepted && variables.pressure === m.counts.pressure.accepted, 'Conteos de variables incompatibles con el manifiesto');
  exigir(context.records.size === m.db_ready_line_counts['release_members.jsonl'], 'Conteo de registros incompatible');
  for (const [key, filename] of Object.entries({ observations_selected: 'observations.jsonl', positions: 'environment_hours.jsonl',
    facts: 'fact_cards.jsonl', flr_accepted: 'solar_events.jsonl', radlab_rows: 'radiation_samples.jsonl', instrument_events: 'instrument_events.jsonl' })) {
    exigir(m.counts[key] === counts[filename], `Conteo resumen incompatible: ${key}`);
  }
  const hours = [...context.hours.values()].map((r) => r.data);
  const emptyTemperature = hours.filter((h) => h.temperature.count === 0).length;
  const emptyPressure = hours.filter((h) => h.pressure.count === 0).length;
  exigir(m.counts.empty_hours_by_variable.temperature === emptyTemperature && m.counts.empty_hours_by_variable.pressure === emptyPressure
    && m.counts.empty_variable_hour_pairs === emptyTemperature + emptyPressure
    && m.counts.fully_empty_hours === hours.filter((h) => h.temperature.count === 0 && h.pressure.count === 0).length,
  'Conteos de horas vacías incompatibles');
  for (const [id, fact] of context.facts) {
    exigir(same([...(context.evidence.get(id) ?? [])].sort(), [...fact.data.reference_ids].sort()), 'Referencias de ficha incompletas');
    exigir(same([...(context.mechanics.get(id) ?? [])].sort(), [...fact.data.mechanic_ids].sort()), 'Mecánicas de ficha incompletas');
  }
  for (const [id, hour] of context.hours) exigir(same([...(context.annotations.get(id) ?? [])].sort(), [...hour.data.event_annotation_ids].sort()), 'Anotaciones horarias incompletas');
  return { line_counts: counts, observation_variables: variables, record_count: context.records.size };
}
