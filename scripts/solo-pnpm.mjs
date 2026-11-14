// Este proyecto usa únicamente pnpm. Se ejecuta como "preinstall" y aborta con npm o yarn.
const agente = process.env.npm_config_user_agent ?? '';

if (!agente.startsWith('pnpm/')) {
  console.error('\nEste proyecto usa únicamente pnpm.');
  console.error('Instálalo con:  corepack enable   (o)   npm i -g pnpm');
  console.error('Luego:          pnpm install\n');
  process.exit(1);
}
