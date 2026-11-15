import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import pg from 'pg';
import { abrirPaquete } from '../importador/paquete.js';
import { comprobarPublicacion,retirarPublicacion } from './publicaciones.model.js';

const help=`Uso: pnpm --filter @jiimatzin/backend publicaciones -- <validar|publicar|retirar> --release <id> --actor <referencia>
  validar/publicar: --archivo <ZIP> --sha256 <huella externa>
  retirar: --motivo <texto>
Validar registra un informe; publicar exige validación técnica y revisión humana vigente.
Retirar conserva contenido e historial. No hay endpoints HTTP de administración.`;
let paquete;
let pool;
try {
  const args=process.argv.slice(2); if(args[0]==='--') args.shift();
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    release:{type:'string'},actor:{type:'string'},archivo:{type:'string'},sha256:{type:'string'},motivo:{type:'string'},ayuda:{type:'boolean'},
  }});
  if(values.ayuda) console.log(help);
  else {
    const [action]=positionals;
    if(positionals.length!==1 || !['validar','publicar','retirar'].includes(action)) throw new Error(help);
    if(!/^rel_[0-9a-f]{32}$/.test(values.release??'') || !values.actor?.trim()) throw new Error('Se requieren --release y --actor');
    if(!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL??'')) throw new Error('DATABASE_URL es obligatoria');
    const ssl=process.env.DATABASE_SSL??'disable';
    if(!['disable','require','no-verify'].includes(ssl)) throw new Error('DATABASE_SSL inválido');
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,
      ssl:ssl==='disable'?false:{rejectUnauthorized:ssl==='require'}});
    const options={releaseId:values.release,actor:values.actor};
    let result;
    if(action==='retirar') {
      if(values.archivo || values.sha256) throw new Error('Retirar no acepta --archivo ni --sha256');
      result=await retirarPublicacion(pool,{...options,motivo:values.motivo});
    } else {
      if(!values.archivo || !/^[0-9a-f]{64}$/.test(values.sha256??'') || values.motivo) throw new Error('Se requieren --archivo y --sha256; --motivo solo aplica a retirar');
      paquete=await abrirPaquete(resolve(values.archivo),values.sha256);
      result=await comprobarPublicacion(pool,paquete,{...options,publicar:action==='publicar',progreso:(m)=>console.error(m)});
      if(!result.technical_ok) process.exitCode=1;
      else if(action==='publicar' && result.status!=='published') process.exitCode=2;
    }
    console.log(JSON.stringify(result,null,2));
  }
} catch(error) { console.error(`Publicación abortada: ${error.message}`); process.exitCode=1; }
finally { await pool?.end(); await paquete?.cerrar(); }
