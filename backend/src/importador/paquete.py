"""Verifica el ZIP sin ejecutar su pipeline; prepara solo archivos db_ready en tmp."""
import hashlib
import json
import pathlib
import re
import stat
import sys
import zipfile


def digest(stream):
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()


def safe_path(name):
    p = pathlib.PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name:
        raise ValueError(f'Ruta no segura: {name}')
    return name


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Clave JSON duplicada: {key}')
        result[key] = value
    return result


def load_json(data):
    return json.loads(data, object_pairs_hook=unique_object,
                      parse_constant=lambda s: (_ for _ in ()).throw(ValueError(f'Número JSON inválido: {s}')))


def prepare(archive_path, expected_hash, output):
    if not re.fullmatch('[0-9a-f]{64}', expected_hash):
        raise ValueError('Se requiere un SHA-256 externo de 64 caracteres hexadecimales')
    with open(archive_path, 'rb') as stream:
        archive_hash = digest(stream)
        if archive_hash != expected_hash:
            raise ValueError('El SHA-256 del ZIP no coincide con el esperado')
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            infos = archive.infolist()
            names = [safe_path(i.filename) for i in infos]
            if len(names) != len(set(names)) or len(names) > 10000:
                raise ValueError('Miembros ZIP duplicados o inventario excesivo')
            if sum(i.file_size for i in infos) > 2 * 1024**3:
                raise ValueError('ZIP descomprimido excede 2 GiB')
            for info in infos:
                if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise ValueError('No se aceptan enlaces simbólicos ni archivos cifrados')
            roots = [n[:-13] for n in names if n.endswith('/manifest.json') and n.count('/') == 1]
            if 'manifest.json' in names:
                roots.append('')
            if len(roots) != 1:
                raise ValueError('El ZIP debe tener una sola raíz con manifest.json')
            root = roots[0]
            manifest_bytes = archive.read(root + 'manifest.json')
            manifest = load_json(manifest_bytes)
            checks = {}
            for line in archive.read(root + 'checksums.sha256').decode('utf-8-sig').splitlines():
                match = re.fullmatch(r'([0-9a-f]{64})\s+\*?(.+)', line)
                if not match:
                    raise ValueError('Entrada inválida en checksums.sha256')
                hash_value, path = match.groups()
                safe_path(path)
                if path in checks:
                    raise ValueError(f'Checksum duplicado: {path}')
                checks[path] = hash_value
                with archive.open(root + path) as member:
                    if digest(member) != hash_value:
                        raise ValueError(f'Hash incorrecto: {path}')
            if checks.get('manifest.json') != hashlib.sha256(manifest_bytes).hexdigest():
                raise ValueError('El manifiesto no está cubierto por checksums.sha256')
            for path, hash_value in manifest['files'].items():
                safe_path(path)
                if checks.get(path) != hash_value:
                    raise ValueError(f'Inventarios inconsistentes: {path}')
            canonical = json.dumps(manifest['files'], sort_keys=True, separators=(',', ':'), ensure_ascii=False)
            if hashlib.sha256(canonical.encode()).hexdigest() != manifest['content_hash_reproducible']:
                raise ValueError('content_hash_reproducible no coincide con el inventario')
            for name, hash_value in manifest['pipeline_files_sha256'].items():
                if checks.get('pipeline/' + safe_path(name)) != hash_value:
                    raise ValueError(f'Hash de procesador inconsistente: {name}')
            counts = manifest['db_ready_line_counts']
            output = pathlib.Path(output)
            for filename, expected_count in counts.items():
                if not re.fullmatch('[a-z_]+[.]jsonl', filename) or type(expected_count) is not int or expected_count < 0:
                    raise ValueError('Archivo o conteo JSONL no válido')
                path = 'db_ready/' + filename
                if path not in manifest['files']:
                    raise ValueError(f'JSONL fuera del inventario: {filename}')
                count = 0
                with archive.open(root + path) as source, (output / filename).open('wb') as target:
                    for line in source:
                        load_json(line)  # Rechaza claves repetidas, NaN, Infinity y líneas vacías.
                        target.write(line)
                        count += 1
                if count != expected_count:
                    raise ValueError(f'Conteo incorrecto: {filename}: {count} != {expected_count}')
            # La comparación de esquemas se hace con copias versionadas, no con
            # código ni validadores ejecutables incluidos en el paquete.
            schema_root = pathlib.Path(__file__).parent / 'schemas'
            for schema in schema_root.glob('*.json'):
                if load_json(archive.read(root + 'schemas/' + schema.name)) != load_json(schema.read_bytes()):
                    raise ValueError(f'Contrato no soportado: {schema.name}')
            info = {'manifest': manifest, 'archive_sha256': archive_hash,
                    'manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
                    'checksums_verified': len(checks)}
            (output / 'info.json').write_text(json.dumps(info, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    try:
        prepare(*sys.argv[1:])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
