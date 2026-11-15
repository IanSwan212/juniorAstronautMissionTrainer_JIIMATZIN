import { mkdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { resolve,join,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { crearRepositorioEscenarios } from './escenarios.repository.js';
import { crearModeloEscenarios } from './escenarios.model.js';
import { presentarEscenario } from './escenarios.view.js';
import { contratoEscenario } from './escenarios.contract.js';

const args=z.strictObject({scenarioId:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  version:z.number().int().min(1).max(2147483647),directory:z.string().min(1)});
async function leer(path) {try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function escribir(path,text) {
  const temp=`${path}.${randomUUID()}.tmp`;
  try {await writeFile(temp,text,{flag:'wx'});await rename(temp,path);}
  finally {await unlink(temp).catch((e)=>{if(e.code!=='ENOENT')throw e;});}
}

export async function exportarEscenario(pool,options) {
  const o=args.parse(options);const root=resolve(o.directory);
  const folder=join(root,o.scenarioId);
  if(!folder.startsWith(root+sep)) throw new Error('Ruta de exportación fuera del directorio previsto');
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT pg_advisory_xact_lock(728319,1)');
    const repo=crearRepositorioEscenarios(client);
    const scenario=presentarEscenario(await crearModeloEscenarios(repo).obtener(o.scenarioId,o.version));
    contratoEscenario.parse(scenario);
    const text=JSON.stringify(scenario,null,2)+'\n';
    const versioned=join(folder,`v${o.version}.json`);
    const alias=join(root,`${o.scenarioId}.json`);
    const existing=await leer(versioned);
    if(existing!==null && existing!==text) throw new Error('El respaldo de esa versión ya existe con otro contenido');
    const latest=await repo.buscarPublicado(o.scenarioId);
    const oldAlias=await leer(alias);
    const previous=oldAlias===null?null:JSON.parse(oldAlias);
    if(previous && (previous.scenarioId!==o.scenarioId || !/^[1-9][0-9]*$/.test(previous.scenarioVersion))) throw new Error('Alias de respaldo incompatible');
    const updateAlias=latest?.version===o.version && (!previous || Number(previous.scenarioVersion)<=o.version);
    await mkdir(folder,{recursive:true});
    if(existing===null) await escribir(versioned,text);
    if(updateAlias && oldAlias!==text) await escribir(alias,text);
    await client.query('COMMIT');
    return {scenarioId:o.scenarioId,scenarioVersion:String(o.version),releaseId:scenario.releaseId,
      versionedPath:versioned,latestPath:updateAlias?alias:null};
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
