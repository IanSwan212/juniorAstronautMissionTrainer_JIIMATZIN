// Este proyecto usa únicamente pnpm. Se ejecuta como "preinstall" y aborta con npm o yarn.
const agente = process.env.npm_config_user_agent ?? '';

// npm y yarn siempre definen el agente; pnpm 11 puede omitirlo en algunos comandos (p. ej. add).
if (agente && !agente.startsWith('pnpm/')) {
  console.error('\nEste proyecto usa únicamente pnpm.');
  console.error('Instálalo con:  corepack enable   (o)   npm i -g pnpm');
  console.error('Luego:          pnpm install\n');
  process.exit(1);
}
