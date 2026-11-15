"""Construye paquetes mínimos de prueba; nunca ejecuta el pipeline del ZIP."""
import hashlib
import json
import pathlib
import sys
import zipfile

spec = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
files = {}
counts = {}
for filename, rows in spec['rows'].items():
    files['db_ready/' + filename] = ''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows).encode()
    counts[filename] = len(rows)
files['pipeline/build.py'] = b'raise RuntimeError("This file must never be executed")\n'
schemas = pathlib.Path(__file__).resolve().parents[1] / 'src/importador/schemas'
for schema in schemas.glob('*.json'):
    files['schemas/' + schema.name] = schema.read_bytes()
files['evidence/original.txt'] = b'Preserved source for tests\n'
sha = lambda b: hashlib.sha256(b).hexdigest()
inventory = {n: sha(b) for n, b in files.items() if not n.startswith('pipeline/')}
manifest = {
    'schema_version': '1.0.0', 'dataset_version': '1.0.0', 'release_id': spec['release_id'],
    'processor_id': spec['processor_id'], 'policy_version': 'test_policy', 'status': 'candidate_validated',
    'files': inventory, 'db_ready_line_counts': {**counts, **spec.get('counts_override', {})},
    'content_hash_reproducible': sha(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode()),
    'pipeline_files_sha256': {'build.py': sha(files['pipeline/build.py'])},
    'build_metadata_excluded_from_content_hash': {'built_at_utc': '2026-11-14T00:00:00Z'},
    'counts': {'temperature': {'accepted': sum(r['data']['variable'] == 'ambient_temperature' for r in spec['rows']['observations.jsonl'])},
               'pressure': {'accepted': sum(r['data']['variable'] == 'pressure' for r in spec['rows']['observations.jsonl'])}},
}
manifest['counts'].update({
    'observations_selected': counts['observations.jsonl'], 'positions': counts['environment_hours.jsonl'],
    'facts': counts['fact_cards.jsonl'], 'flr_accepted': counts['solar_events.jsonl'],
    'radlab_rows': counts['radiation_samples.jsonl'], 'instrument_events': counts['instrument_events.jsonl'],
    'empty_hours_by_variable': {v: sum(r['data'][v]['count'] == 0 for r in spec['rows']['environment_hours.jsonl']) for v in ['temperature', 'pressure']},
    'empty_variable_hour_pairs': sum(r['data'][v]['count'] == 0 for r in spec['rows']['environment_hours.jsonl'] for v in ['temperature', 'pressure']),
    'fully_empty_hours': sum(r['data']['temperature']['count'] == r['data']['pressure']['count'] == 0 for r in spec['rows']['environment_hours.jsonl']),
})
files['manifest.json'] = json.dumps(manifest, ensure_ascii=False).encode()
files['checksums.sha256'] = ''.join(f'{sha(b)}  {name}\n' for name, b in sorted(files.items())).encode()
files.update({name: value.encode() for name, value in spec.get('tamper', {}).items()})
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, content in files.items():
        archive.writestr('package/' + name, content)
