"""Audita el ZIP suministrado sin extraer ni ejecutar su contenido (Python 3)."""
import collections
import hashlib
import json
import pathlib
import sys
import zipfile


def digest(stream):
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()


def main(path):
    with path.open('rb') as stream:
        archive_hash = digest(stream)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Miembros ZIP duplicados')
        for name in names:
            p = pathlib.PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts or '\\' in name:
                raise ValueError(f'Ruta no segura: {name}')
        roots = [n[:-len('manifest.json')] for n in names if n.count('/') == 1 and n.endswith('/manifest.json')]
        if len(roots) != 1:
            raise ValueError('Se requiere una raíz inequívoca')
        root = roots[0]
        manifest = json.loads(archive.read(root + 'manifest.json'))
        verified = 0
        for line in archive.read(root + 'checksums.sha256').decode('utf-8-sig').splitlines():
            expected, relative = line.split(maxsplit=1)
            relative = relative.lstrip('*')
            with archive.open(root + relative) as stream:
                if digest(stream) != expected:
                    raise ValueError(f'Hash incorrecto: {relative}')
            verified += 1
        counts = {}
        variables = collections.Counter()
        for filename, expected in manifest['db_ready_line_counts'].items():
            count = 0
            with archive.open(root + 'db_ready/' + filename) as stream:
                for line in stream:
                    row = json.loads(line)
                    count += 1
                    if filename == 'observations.jsonl':
                        variables[row['data']['variable']] += 1
            if count != expected:
                raise ValueError(f'Conteo incorrecto: {filename}: {count} != {expected}')
            counts[filename] = count
        print(json.dumps({'zip_sha256': archive_hash, 'release_id': manifest['release_id'],
                          'checksums_verified': verified, 'line_counts': counts,
                          'observation_variables': variables,
                          'scope': 'integridad interna, JSON y conteos; no certifica calidad científica ni FK'},
                         ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1]))
