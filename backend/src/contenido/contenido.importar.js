import { readFile,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from '../importador/validacion.js';
import { validarDesglose,cambioRecurso,costoCarta } from './contenido.schema.js';

const digest=(value)=>createHash('sha256').update(value).digest('hex');
export const secciones=['recursos','personajes','soles','minijuegos','emergencias','cartas_mejora','finales','datos_reales'];
export function documentoOrdenado(d) {
  return {...d,...Object.fromEntries(secciones.map(name=>[name,[...d[name]].sort((a,b)=>
    name==='soles'?a.sol-b.sol:a.id.localeCompare(b.id,'en'))]))};
}

/** RFC 4180: BOM, CRLF, comas y saltos de línea dentro de campos entrecomillados. */
export function leerCsv(text) {
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted) {if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw new Error('Comillas CSV inválidas');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r') {
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}
    } else {if(closed)throw new Error('Texto después de comillas CSV');field+=c;}
  }
  if(quoted)throw new Error('Campo CSV sin cerrar');
  if(field||row.length||closed){row.push(field);rows.push(row);}
  const header=rows.shift();
  if(!header?.length||new Set(header).size!==header.length)throw new Error('Cabecera CSV inválida');
  return rows.map(row=>{if(row.length!==header.length)throw new Error('Número de columnas CSV inválido');
    return Object.fromEntries(header.map((key,i)=>[key,row[i]]));});
}

export async function leerDesglose(archivo,{sha256,csvDirectory}={}) {
  if((await stat(archivo)).size>5*1024*1024)throw new Error('Desglose excede 5 MiB');
  const bytes=await readFile(archivo),sourceSha256=digest(bytes);
  if(sha256&&sourceSha256!==sha256)throw new Error('El SHA-256 del desglose no coincide');
  const document=validarDesglose(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
  const warnings=[];
  if(csvDirectory)for(const name of secciones.filter(n=>n!=='recursos')) {
    const file=join(csvDirectory,`${name}.csv`);
    if((await stat(file)).size>5*1024*1024)throw new Error('CSV excede 5 MiB');
    const rows=leerCsv(await readFile(file,'utf8')),key=name==='soles'?'sol':'id';
    if(rows.length!==document[name].length||new Set(rows.map(r=>r[key])).size!==rows.length)throw new Error(`Conteo/IDs CSV incompatibles: ${name}`);
    for(const row of rows) {
      const original=document[name].find(r=>String(r[key])===row[key]);
      if(!original)throw new Error(`Fila CSV desconocida: ${name}/${row[key]}`);
      for(const [column,value]of Object.entries(row)) {
        const expected=original[column];let parsed=value;
        if(value===''&&(expected==null))parsed=expected;
        else if(typeof expected==='boolean') {if(!/^(true|false)$/i.test(value))throw new Error('Booleano CSV inválido');parsed=value.toLowerCase()==='true';}
        else if(typeof expected==='number'||(expected!==null&&typeof expected==='object')){try{parsed=JSON.parse(value);}catch{throw new Error(`JSON CSV inválido: ${name}/${column}`);}}
        if(canonical(parsed)!==canonical(expected))throw new Error(`CSV difiere del JSON: ${name}/${row[key]}/${column}`);
      }
      for(const column of Object.keys(original))if(!Object.hasOwn(row,column))warnings.push(`El CSV ${name} omite ${row[key]}.${column}; se conserva el valor del JSON`);
    }
  }
  return {document,sourceSha256,warnings};
}

// Proyecciones normalizadas y auditables; SQL usa exclusivamente estas constantes.
export function filasCatalogo(d) {
  const rows={};
  const table=(name,columns,values)=>rows[name]={columns,values};
  table('recursos',['id','payload'],d.recursos.map(x=>[x.id,x]));
  table('personajes',['id','nombre','rol','jugable','payload'],d.personajes.map(x=>[x.id,x.nombre,x.rol,x.jugable,x]));
  table('datos_narrativos',['id','payload'],d.datos_reales.map(x=>[x.id,x]));
  table('minijuegos',['id','recurso','dato_id','gana','falla','payload'],d.minijuegos.map(x=>[x.id,x.recurso,x.dato,cambioRecurso(x.gana).cambio,cambioRecurso(x.falla).cambio,x]));
  table('emergencias',['id','sol_sugerido','dato_id','payload'],d.emergencias.map(x=>[x.id,x.sol_sugerido,x.dato,x]));
  table('opciones_emergencia',['emergencia_id','position','recurso','cambio','texto'],d.emergencias.flatMap(x=>x.opciones.map((o,i)=>[x.id,i,o.costo.recurso,o.costo.cambio,o.opcion])));
  table('cartas_mejora',['id','dato_id','costo_recurso','costo_cambio','payload'],d.cartas_mejora.map(x=>{const c=costoCarta(x.costo_sugerido);return [x.id,x.dato,c?.recurso??null,c?.cambio??null,x];}));
  table('finales',['id','dato_id','payload'],d.finales.map(x=>[x.id,x.dato??null,x]));
  table('soles',['sol','minijuego_id','emergencia_id','payload'],d.soles.map(x=>[x.sol,x.minijuego_sugerido,x.emergencia_sugerida,x]));
  table('audio',['tipo','etiqueta','asset_id'],Object.entries(d.audio).flatMap(([tipo,entries])=>Object.entries(entries).map(([key,value])=>[tipo,key,value])));
  table('variables',['nombre','tipo'],Object.entries(d.variables_del_juego));
  return rows;
}
async function comparar(client,catalogId,rows) {
  for(const [table,{columns,values}]of Object.entries(rows)) {
    const actual=(await client.query(`SELECT ${columns.join(',')} FROM juego.${table} WHERE catalog_id=$1`,[catalogId])).rows;
    const sort=x=>x.map(canonical).sort();
    if(canonical(sort(actual.map(x=>columns.map(c=>x[c]))))!==canonical(sort(values)))throw new Error(`Catálogo persistido inconsistente: ${table}`);
  }
}
export async function importarContenido(pool,{document:input,sourceSha256},actor) {
  const document=validarDesglose(input);
  if(!/^[0-9a-f]{64}$/.test(sourceSha256)||!actor?.trim()||actor.length>200)throw new Error('Se requieren huella y actor válidos');
  const contentHash=digest(canonical(documentoOrdenado(document))),catalogId=`cat_${contentHash}`,rows=filasCatalogo(document);
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout='10s'");await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('SELECT pg_advisory_xact_lock(728319,1)');
    const {rows:[existing]}=await client.query('SELECT * FROM juego.catalogos WHERE catalog_id=$1 FOR UPDATE',[catalogId]);
    if(existing) {
      if(!existing.sealed||canonical(documentoOrdenado(existing.document))!==canonical(documentoOrdenado(document)))throw new Error('Identidad de catálogo incompatible');
      await comparar(client,catalogId,rows);
    } else {
      await client.query(`INSERT INTO juego.catalogos(catalog_id,content_sha256,source_sha256,source_version,document,actor_ref)
        VALUES($1,$2,$3,$4,$5::jsonb,$6)`,[catalogId,contentHash,sourceSha256,document.version,JSON.stringify(document),actor]);
      for(const [table,{columns,values}]of Object.entries(rows))for(const row of values) {
        const params=[catalogId,...row.map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v)];
        await client.query(`INSERT INTO juego.${table}(catalog_id,${columns.join(',')}) VALUES(${params.map((_,i)=>`$${i+1}`).join(',')})`,params);
      }
      await comparar(client,catalogId,rows);
      await client.query('UPDATE juego.catalogos SET sealed=true WHERE catalog_id=$1',[catalogId]);
    }
    await client.query('COMMIT');
    return {catalogId,contentHash,sourceSha256,created:!existing,counts:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.values.length]))};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
