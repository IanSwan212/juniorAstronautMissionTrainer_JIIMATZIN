import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { crearBorradorEscenario,cambiarPublicacionEscenario } from './escenarios.admin.js';
import { exportarEscenario } from './escenarios.exportar.js';

const help=`Uso: pnpm --filter @jiimatzin/backend escenarios -- <crear|publicar|retirar|exportar>
crear: --definicion <JSON> --actor <referencia>
publicar/retirar: --id <slug> --version <entero> --actor <referencia> [--motivo <texto>]
exportar: --id <slug> --version <entero> [--directorio <carpeta>]
El borrador puede referenciar un candidato. Publicar/exportar requieren contenido publicado y revisado.`;
let pool;
try {
  const args=process.argv.slice(2);if(args[0]==='--')args.shift();
  const {positionals,values}=parseArgs({args,allowPositionals:true,options:{
    definicion:{type:'string'},actor:{type:'string'},id:{type:'string'},version:{type:'string'},motivo:{type:'string'},directorio:{type:'string'},ayuda:{type:'boolean'},
  }});
  if(values.ayuda) console.log(help);
  else {
    const [action]=positionals;
    if(positionals.length!==1 || !['crear','publicar','retirar','exportar'].includes(action)) throw new Error(help);
    const allowed={crear:['definicion','actor'],publicar:['id','version','actor'],retirar:['id','version','actor','motivo'],exportar:['id','version','directorio']}[action];
    if(Object.keys(values).some((key)=>!allowed.includes(key))) throw new Error('Opción incompatible con la acción');
    if(!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL??''))throw new Error('DATABASE_URL es obligatoria');
    const ssl=process.env.DATABASE_SSL??'disable';
    if(!['disable','require','no-verify'].includes(ssl))throw new Error('DATABASE_SSL inválido');
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,
      ssl:ssl==='disable'?false:{rejectUnauthorized:ssl==='require'}});
    let result;
    if(action==='crear') {
      if(!values.definicion)throw new Error('Falta --definicion');
      result=await crearBorradorEscenario(pool,JSON.parse(await readFile(resolve(values.definicion),'utf8')),values.actor);
    } else {
      if(!/^[1-9][0-9]*$/.test(values.version??''))throw new Error('Falta --version entera positiva');
      const options={scenarioId:values.id,version:Number(values.version)};
      result=action==='exportar'
        ? await exportarEscenario(pool,{...options,directory:values.directorio??fileURLToPath(new URL('../../../frontend/public/escenarios/',import.meta.url))})
        : await cambiarPublicacionEscenario(pool,{...options,actor:values.actor,action:action==='publicar'?'published':'retired',...(values.motivo?{reason:values.motivo}:{})});
    }
    console.log(JSON.stringify(result,null,2));
  }
} catch(error){console.error(`Escenario abortado: ${error.message}`);process.exitCode=1;}
finally{await pool?.end();}
