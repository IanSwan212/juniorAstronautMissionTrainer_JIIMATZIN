import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ordenArchivos } from '../src/importador/validacion.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const code = sha('raise RuntimeError("This file must never be executed")\n');
const processor = sha(JSON.stringify({ code_and_config: { 'build.py': code }, schema_version: '1.0.0' }));
export const fixtureId = (n) => String(n).repeat(64);

export function datosPrueba(release = `rel_${'1'.repeat(32)}`) {
  const file = `sha256:${sha('Preserved source for tests\n')}`;
  const rows = Object.fromEntries(ordenArchivos.map((filename) => [filename, []]));
  const envelope = (id, type, data) => ({ schema_version: '1.0.0', record_id: fixtureId(id), record_type: type,
    dataset_id: type === 'fact' ? 'facts' : 'rems', source_context: type === 'fact' ? 'other_mission_educational' : 'mars_historical_observation',
    processor_id: processor, selection_policy_id: type === 'fact' ? null : 'test_policy',
    quality_status: type === 'observation' ? 'accepted' : 'not_applicable', quality_reasons: [], usage_tier: 'runtime',
    provenance: { lineage_id: type === 'environment_hour' ? fixtureId(id) : null,
      source_refs: [{ source_file_id: file, locator: { section: 'body' } }] }, data });
  rows['sources.jsonl'] = [{ source_id: 'test_source', institution: 'NASA', product: 'Test', url: null }];
  rows['datasets.jsonl'] = ['rems', 'facts'].map((id) => ({ dataset_id: id, source_id: 'test_source', product: 'Test',
    platform: null, source_context: id === 'rems' ? 'mars_historical_observation' : 'other_mission_educational' }));
  rows['source_files.jsonl'] = [{ source_file_id: file, sha256: file.slice(7), size_bytes: 27,
    locations: [{ input: 'A', path: 'original.txt' }] }];
  rows['quality_policies.jsonl'] = [{ policy_id: 'test_policy', status: 'project_policy', variables: {
    ambient_temperature: { unit: 'K', flags_length: 9, required_positions: { 2: 'asic', 7: 'operational', 8: 'reliable' } },
    pressure: { unit: 'Pa', flags_length: 2, required_positions: { 1: 'shadow' } },
  } }];
  rows['processors.jsonl'] = [{ processor_id: processor, schema_version: '1.0.0', policy_id: 'test_policy', code_and_config_sha256: { 'build.py': code } }];
  rows['captures.jsonl'] = [{ capture_id: 'test_capture', input: 'A', public_params: {}, attempts: [], final_status: 'reused', http_status: null }];
  rows['capture_files.jsonl'] = [{ capture_id: 'test_capture', source_file_id: file, role: 'original' }];
  rows['observations.jsonl'] = [envelope(1, 'observation', { variable: 'ambient_temperature', value: 207, unit: 'K',
    source_sol: 10, lmst: '00010M00:00:00.000', ltst: '00010 00:35:00', sclk: 398334263, time_basis: 'mars_lmst',
    flags_original: '  111111111', flags_normalized: '111111111' })];
  const empty = (unit) => ({ unit, count: 0, source_count: 0, rows_in_group: 0, min: null, max: null, sample_mean: null,
    first_lmst: null, last_lmst: null, coverage_label: 'empty', selection_fraction: null });
  rows['environment_hours.jsonl'] = [
    envelope(2, 'environment_hour', { source_sol: 10, mission_day: 1, lmst_hour: 0, aggregation_rule: 'hourly', event_annotation_ids: [],
      temperature: { unit: 'K', count: 1, source_count: 1, rows_in_group: 1, min: 207, max: 207, sample_mean: 207,
        first_lmst: '00010M00:00:00.000', last_lmst: '00010M00:00:00.000', coverage_label: 'selected', selection_fraction: 1 }, pressure: empty('Pa') }),
    envelope(3, 'environment_hour', { source_sol: 10, mission_day: 1, lmst_hour: 1, aggregation_rule: 'hourly', event_annotation_ids: [], temperature: empty('K'), pressure: empty('Pa') }),
  ];
  rows['lineage_members.jsonl'] = [{ aggregate_id: fixtureId(2), aggregate_record_id: fixtureId(2), record_id: fixtureId(1), role: 'temperature' }];
  rows['fact_cards.jsonl'] = [envelope(4, 'fact', { fact_key: 'fact_imported', language: 'es', title: 'Título', scientific_statement: 'Hecho',
    child_explanation: 'Explicación', mission_context: 'Apolo 13', game_adaptation: 'Adaptación', limitations: ['Sin fórmula'],
    mechanic_ids: ['test_mechanic'], reference_ids: [file], review_status: 'pending_human_review' })];
  rows['mechanics.jsonl'] = [{ mechanic_id: 'test_mechanic', description: 'Mecánica educativa', is_formula: false, origin: 'project' }];
  rows['fact_mechanics.jsonl'] = [{ release_id: release, fact_record_id: fixtureId(4), fact_key: 'fact_imported', language: 'es', mechanic_id: 'test_mechanic' }];
  rows['fact_evidence.jsonl'] = [{ release_id: release, fact_record_id: fixtureId(4), fact_key: 'fact_imported', language: 'es', evidence_index: 0,
    evidence_type: 'document_quote', source_file_id: file, locator: { section: 'body' }, expected: null, verified_against_preserved_source: true }];
  rows['release_members.jsonl'] = [...rows['observations.jsonl'], ...rows['environment_hours.jsonl'], ...rows['fact_cards.jsonl']].map((r) =>
    ({ release_id: release, record_id: r.record_id, record_type: r.record_type, usage_tier: r.usage_tier }));
  return { release_id: release, processor_id: processor, rows };
}

export async function crearPaquetePrueba(spec = datosPrueba()) {
  const root = await realpath(tmpdir());
  const dir = await mkdtemp(join(root, 'jiimatzin-fixture-'));
  const cleanup = async () => {
    if (dirname(dir) !== root || !basename(dir).startsWith('jiimatzin-fixture-')) throw new Error('Temporal inesperado');
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await writeFile(join(dir, 'spec.json'), JSON.stringify(spec));
    const path = join(dir, 'package.zip');
    await promisify(execFile)(process.env.PYTHON ?? 'python', [fileURLToPath(new URL('./crear-paquete.py', import.meta.url)), join(dir, 'spec.json'), path], { windowsHide: true });
    return { path, sha256: sha(await readFile(path)), cerrar: cleanup };
  } catch (error) { await cleanup(); throw error; }
}
