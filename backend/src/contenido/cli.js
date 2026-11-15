import {parseArgs} from 'node:util';
import pg from 'pg';
import {leerDesglose,importarContenido} from './contenido.importar.js';

const help='Uso: pnpm contenido -- <validar|importar> --archivo <JSON> --sha256 <SHA-256> [--csv-directorio <carpeta>] [--actor <referencia>]';
let pool;
try {
  const args=process.argv.slice(2);if(args[0]==='--')args.shift();
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{archivo:{type:'string'},sha256:{type:'string'},
    'csv-directorio':{type:'string'},actor:{type:'string'},ayuda:{type:'boolean'}}});
  if(values.ayuda)console.log(help);
  else {
    const [action]=positionals;
    if(positionals.length!==1||!['validar','importar'].includes(action)||!values.archivo||!/^[0-9a-f]{64}$/.test(values.sha256??''))throw new Error(help);
    const input=await leerDesglose(values.archivo,{sha256:values.sha256,csvDirectory:values['csv-directorio']});
    if(action==='validar')console.log(JSON.stringify({valid:true,sourceSha256:input.sourceSha256,warnings:input.warnings},null,2));
    else {
      if(!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL??''))throw new Error('DATABASE_URL es obligatoria');
      const ssl=process.env.DATABASE_SSL??'disable';if(!['disable','require','no-verify'].includes(ssl))throw new Error('DATABASE_SSL inválido');
      pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,
        ssl:ssl==='disable'?false:{rejectUnauthorized:ssl==='require'}});
      console.log(JSON.stringify({...await importarContenido(pool,input,values.actor),warnings:input.warnings},null,2));
    }
  }
}catch(error){console.error(`Contenido abortado: ${error.message}`);process.exitCode=1;}finally{await pool?.end();}
