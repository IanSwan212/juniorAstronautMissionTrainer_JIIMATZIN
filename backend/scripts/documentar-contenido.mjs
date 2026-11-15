import { readFile,writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { desgloseSchema } from '../src/contenido/contenido.schema.js';
import { gameplaySchema } from '../src/contenido/contenido.view.js';

const root=new URL('../../contrato/',import.meta.url);
const schema=z.toJSONSchema(gameplaySchema);delete schema.$schema;
const scenario=JSON.parse(await readFile(new URL('scenario.schema.json',root),'utf8'));
scenario.properties.gameplay=schema;
scenario.description='API v1, contrato 2. Catálogo de juego opcional fijado por versión; compatible con escenarios científicos sin catálogo.';
await writeFile(new URL('scenario.schema.json',root),JSON.stringify(scenario,null,2)+'\n');
await writeFile(new URL('contenido-juego.schema.json',root),JSON.stringify(z.toJSONSchema(desgloseSchema),null,2)+'\n');
console.log('Contratos de catálogo y escenario actualizados.');
