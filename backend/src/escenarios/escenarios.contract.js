import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const contratoEscenario=z.fromJSONSchema(JSON.parse(await readFile(
  new URL('../../../contrato/scenario.schema.json',import.meta.url),'utf8')));
