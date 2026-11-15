import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const run = promisify(execFile);

export async function abrirPaquete(archivo, sha256, { python = process.env.PYTHON ?? 'python' } = {}) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'jiimatzin-import-'));
  async function cerrar() {
    // Solo se elimina el directorio temporal creado por esta invocación.
    if (dirname(directory) !== tempRoot || !basename(directory).startsWith('jiimatzin-import-')) {
      throw new Error('Directorio temporal fuera de la raíz esperada');
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await run(python, [fileURLToPath(new URL('./paquete.py', import.meta.url)), archivo, sha256, directory], {
      windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const info = JSON.parse(await readFile(join(directory, 'info.json'), 'utf8'));
    return {
      ...info,
      async *filas(filename) {
        if (!Object.hasOwn(info.manifest.db_ready_line_counts, filename)) throw new Error(`Archivo no inventariado: ${filename}`);
        const input = createReadStream(join(directory, filename), { encoding: 'utf8' });
        const lines = createInterface({ input, crlfDelay: Infinity });
        try {
          let count = 0;
          for await (const line of lines) { count++; yield JSON.parse(line); }
          if (count !== info.manifest.db_ready_line_counts[filename]) throw new Error(`Conteo modificado: ${filename}`);
        } finally { lines.close(); input.destroy(); }
      },
      cerrar,
    };
  } catch (error) {
    await cerrar();
    throw new Error(error.stderr?.trim() || error.message, { cause: error });
  }
}
