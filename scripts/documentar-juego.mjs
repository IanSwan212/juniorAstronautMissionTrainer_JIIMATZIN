import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const names=['20261117000000_escenarios-cientificos.sql','20261118000000_contenido-juego.sql'];
const sql=(await Promise.all(names.map(async name=>(await readFile(new URL(`backend/migrations/${name}`,root),'utf8')).split('-- Down Migration')[0]))).join('\n');
const tables=[...sql.matchAll(/CREATE TABLE juego\.(\w+)\s*\(([\s\S]*?)\n\);/g)];
if(tables.length!==19)throw new Error(`Se esperaban 19 tablas; recibidas ${tables.length}`);
const er=['erDiagram'],doc=['# Modelo y diccionario de juego','','Generado con `node scripts/documentar-juego.mjs` desde las migraciones 20261117 y 20261118.',
  'Incluye 19 tablas: cinco de escenarios y catorce de catálogos y vínculos.',
  'Los tipos, campos, claves y restricciones se conservan en las declaraciones SQL. Las relaciones usan NO ACTION.',
  'La tabla `ciencia.release_members` está fuera de este esquema; fija las revisiones científicas.', '',
  '## Relaciones','','```mermaid'];
for(const [,name,body]of tables){
  er.push(`    ${name} {`,`        text referencia "Ver DDL completo"`,'    }');
  for(const [,schema,parent]of body.matchAll(/REFERENCES (juego|ciencia)\.(\w+)/g))
    er.push(`    ${schema==='juego'?parent:`ciencia_${parent}`} ||--o{ ${name} : referencia`);
}
doc.push(...er,'```','','## Tablas','');
for(const [,name,body]of tables)doc.push(`### ${name}`,'','```sql',`CREATE TABLE juego.${name} (${body}\n);`,'```','');
doc.push('## Protección y procedencia','',
  '`catalogos` conserva la versión declarada, SHA-256 del archivo, hash semántico, documento original, fecha y actor.',
  'Las filas del catálogo se cargan en una transacción y se sellan. Los triggers impiden cambios posteriores,',
  'relaciones añadidas y TRUNCATE; una corrección requiere otra identidad. El sello del catálogo conserva contenido',
  'y no representa una aprobación científica ni publicación de escenario.',
  '`scenario_content` fija catálogo y recursos iniciales; `vinculos_datos` relaciona entradas narrativas con fichas',
  'ya seleccionadas en el escenario. Los vínculos son referencias complementarias, no aprobaciones de los textos originales.',
  'La protección de esas selecciones exige escenario borrador y READ COMMITTED. El retiro conserva las revisiones.',
  'La reversión se rechaza cuando el catálogo está vinculado a cualquier escenario que haya sido publicado.', '',
  'Los payloads de `datos_narrativos` son administrativos y no se entregan en las respuestas públicas.',
  'Los archivos de audio/imagen y el estado mutable de las partidas no se guardan en estas tablas.', '');
await writeFile(new URL('docs/13-modelo-juego.md',root),doc.join('\n'));
await writeFile(new URL('docs/diagramas/juego-er.mmd',root),er.join('\n')+'\n');
console.log(JSON.stringify({tables:tables.length,foreignKeys:er.filter(x=>x.includes('--')).length}));
