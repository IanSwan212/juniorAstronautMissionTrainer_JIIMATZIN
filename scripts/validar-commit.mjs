// Valida el primer renglón del mensaje de commit: tipo(ámbito): descripción
// Uso: node scripts/validar-commit.mjs <archivo-con-mensaje>
import { readFileSync } from 'node:fs';

const TIPOS = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'];
const patron = new RegExp(`^(${TIPOS.join('|')})\\([a-z0-9áéíóúñ_/-]+\\)!?: \\S.{2,}$`, 'u');
const LIMITE = 72;

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node scripts/validar-commit.mjs <archivo>');
  process.exit(2);
}

const encabezado = readFileSync(archivo, 'utf8').split(/\r?\n/)[0].trim();

// Commits generados por git que no siguen la convención.
if (/^(Merge |Revert |fixup! |squash! )/.test(encabezado)) process.exit(0);

const errores = [];
if (!patron.test(encabezado)) errores.push('El formato debe ser  tipo(ámbito): descripción');
if (encabezado.length > LIMITE) errores.push(`El encabezado mide ${encabezado.length} caracteres (máximo ${LIMITE})`);
if (/\.$/.test(encabezado)) errores.push('El encabezado no debe terminar en punto');

if (errores.length) {
  console.error(`\nMensaje de commit rechazado: "${encabezado}"\n`);
  for (const e of errores) console.error(`  - ${e}`);
  console.error(`\nTipos válidos: ${TIPOS.join(', ')}`);
  console.error('Ejemplo: feat(juego): agrega pantalla de selección de nivel');
  console.error('Detalle: CONTRIBUTING.md\n');
  process.exit(1);
}
