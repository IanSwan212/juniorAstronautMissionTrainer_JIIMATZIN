// Genera el diccionario y el ER desde la migración, sin conectar a PostgreSQL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const migrations = ['20261115000000_dataset-cientifico.sql','20261116000000_publicaciones.sql'];
const sql = (await Promise.all(migrations.map(async (migration) =>
  (await readFile(new URL(`backend/migrations/${migration}`,root),'utf8')).split('-- Down Migration')[0])))
  .join('\n').replace(/^\s*--.*$/gm,'');
const descriptions = {
  sources: 'Instituciones y productos de origen.',
  datasets: 'Colecciones de datos asociadas a una fuente.',
  source_files: 'Identidad de archivos por contenido SHA-256, independiente de su ubicación.',
  source_file_locations: 'Ubicaciones de un mismo archivo, con raíz y miembro ZIP opcional.',
  captures: 'Recuperaciones de los proveedores, con parámetros públicos y estado HTTP.',
  capture_files: 'Archivos obtenidos en una captura y su papel en ella.',
  quality_policies: 'Definiciones versionadas de selección y calidad del proyecto.',
  processors: 'Identidad y hashes del código y configuración de procesamiento.',
  dataset_releases: 'Construcciones concretas del paquete, manifiesto y estado de publicación.',
  import_runs: 'Ejecuciones de carga a PostgreSQL; distintas de las capturas del proveedor.',
  processed_records: 'Identidad común y sobre JSON completo de cada registro procesado.',
  record_source_refs: 'Procedencia de un registro: archivo y localizador de fila, campo o sección.',
  release_members: 'Registros incluidos en cada publicación y su nivel de uso.',
  observations: 'Valores REMS seleccionados, tiempos marcianos, unidades e indicadores originales.',
  environment_hours: 'Estadísticas por hora local marciana, conteos y cobertura de las muestras.',
  lineage_members: 'Observaciones que participan en cada agregado horario, por variable.',
  instrument_events: 'Anotaciones documentales del instrumento, identificadas por revisión de archivo.',
  hour_event_annotations: 'Anotaciones instrumentales asociadas a cada agregado horario.',
  solar_events: 'Eventos FLR históricos del catálogo DONKI; no son dosis recibidas en Marte.',
  radiation_samples: 'Tasas de dosis del anexo educativo ISS; conservan su convención temporal.',
  studies: 'Antecedentes bibliográficos por estudio y revisión de archivo.',
  fact_cards: 'Texto científico, explicación infantil, adaptación al juego y limitaciones.',
  fact_evidence: 'Evidencias de una revisión concreta de ficha y su comprobación recibida.',
  mechanics: 'Identificadores educativos de mecánicas; no definen algoritmos de juego.',
  fact_mechanics: 'Relación entre revisiones de fichas y mecánicas.',
  fact_reviews: 'Historial administrativo de revisión humana de una ficha.',
  publication_events: 'Bitácora de comprobación técnica, publicación y retiro; conserva operador, usuario de BD e informe.',
  release_resources: 'Cierre de las claves de metadatos incluidas en una publicación; protege sus revisiones compartidas.'
};

// Divide por comas de primer nivel: respeta CHECK, PK compuestas y literales SQL.
function declarations(body) {
  let depth = 0, quoted = false, start = 0;
  const result = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'") {
      if (quoted && body[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    }
    if (quoted) continue;
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { result.push(body.slice(start, i).trim()); start = i + 1; }
  }
  result.push(body.slice(start).trim());
  return result.map(s => s.replace(/\s+/g, ' '));
}

const tables = [...sql.matchAll(/CREATE TABLE ciencia\.(\w+)\s*\(([\s\S]*?)\n\);/g)]
  .map(([, name, body]) => ({ name, declarations: declarations(body) }));
for (const [,name,constraint] of sql.matchAll(/ALTER TABLE ciencia\.(\w+) ADD CONSTRAINT ([\s\S]*?);/g)) {
  tables.find((t)=>t.name===name).declarations.push(`CONSTRAINT ${constraint.replace(/\s+/g,' ')}`);
}
if (tables.length !== 28 || tables.some(t => !descriptions[t.name])) throw new Error('Catálogo incompleto');
const er = ['erDiagram'];
const dictionary = [
  '# Diccionario de datos de ciencia', '',
  'Generado desde las migraciones científicas y de publicación con `node scripts/documentar-bd.mjs`.', '',
  'Este archivo describe el DDL versionado. No consulta la instancia local ni cuenta sus filas.', '',
  'PK significa clave primaria; FK, clave foránea. Las declaraciones conservan tipos,',
  'valores por defecto y restricciones SQL. Una columna de PK es obligatoria aunque',
  'su declaración individual no incluya `NOT NULL`. Las FK usan la acción por defecto',
  '`NO ACTION`; no hay borrado automático en cascada en este esquema.', '',
  'El modelo se explica en [08](08-diseno-dataset-cientifico.md) y los controles',
  'administrativos en [12-publicacion.md](12-publicacion.md). Los triggers, funciones',
  'y permisos se consultan en `backend/migrations/20261116000000_publicaciones.sql`.', '',
  '## Tablas', '', '| Tabla | Propósito |', '| --- | --- |',
  ...tables.map(t => `| [${t.name}](#${t.name}) | ${descriptions[t.name]} |`), ''
];
for (const table of tables) {
  const columns = table.declarations.filter(d => !/^(FOREIGN|PRIMARY|UNIQUE|CHECK|CONSTRAINT)\b/.test(d));
  const constraints = table.declarations.filter(d => !columns.includes(d));
  dictionary.push(`## ${table.name}`, '', descriptions[table.name], '', '| Columna | Declaración SQL |', '| --- | --- |');
  for (const col of columns) {
    const [, name, declaration] = col.match(/^(\w+)\s+([\s\S]+)$/);
    dictionary.push(`| \`${name}\` | \`${declaration.replaceAll('|', '\\|')}\` |`);
  }
  if (constraints.length) dictionary.push('', 'Restricciones de tabla:', '', '```sql', ...constraints, '```');
  dictionary.push('');
  const pk = new Set(), fkColumns = new Set();
  for (const d of table.declarations) {
    if (d.startsWith('PRIMARY KEY')) for (const c of d.match(/\(([^)]+)\)/)[1].split(/,\s*/)) pk.add(c);
    else if (d.includes('PRIMARY KEY')) pk.add(d.split(' ')[0]);
    if (d.startsWith('FOREIGN KEY')) for (const c of d.match(/\(([^)]+)\)/)[1].split(/,\s*/)) fkColumns.add(c);
    else if (d.includes('REFERENCES')) fkColumns.add(d.split(' ')[0]);
  }
  er.push(`    ${table.name} {`);
  for (const column of columns) {
    const [name, type] = column.split(' ');
    if (pk.has(name) || fkColumns.has(name)) {
      const keys = [pk.has(name) && 'PK', fkColumns.has(name) && 'FK'].filter(Boolean).join(',');
      er.push(`        ${type} ${name} ${keys}`);
    }
  }
  er.push('    }');
  for (const declaration of table.declarations) {
    for (const fk of declaration.matchAll(/REFERENCES ciencia\.(\w+)/g)) {
      const one = columns.some(c => /^record_id\b/.test(c) && c.includes('PRIMARY KEY'))
        && fk[1] === 'processed_records';
      const label = declaration.startsWith('FOREIGN KEY')
        ? declaration.match(/^FOREIGN KEY \(([^)]+)\)/)[1].replaceAll(', ', '_')
        : declaration.split(' ')[0];
      const optional = !declaration.startsWith('FOREIGN KEY') && !pk.has(label)
        && !declaration.includes('NOT NULL');
      er.push(`    ${fk[1]} ${optional ? '|o' : '||'}--${one ? 'o|' : 'o{'} ${table.name} : ${label}`);
    }
  }
}
await mkdir(new URL('docs/diagramas/', root), { recursive: true });
await writeFile(new URL('docs/10-diccionario-bd.md', root), dictionary.join('\n'));
await writeFile(new URL('docs/diagramas/ciencia-er.mmd', root), er.join('\n') + '\n');
await writeFile(new URL('docs/11-diagrama-er.md', root), [
  '# Diagrama ER del esquema ciencia', '',
  'Generado desde la migración con `node scripts/documentar-bd.mjs`.',
  `Incluye las ${tables.length} tablas y todas las FK declaradas. Los nodos muestran columnas PK/FK;`,
  'las demás columnas y restricciones se consultan en el [diccionario](10-diccionario-bd.md).', '',
  'La notación distingue FK obligatorias y opcionales, con cero o más hijos; los cinco',
  'subtipos de `processed_records` tienen como máximo una fila por registro.',
  'El DDL exige el tipo correcto del subtipo, pero no exige su existencia al',
  'insertar el registro padre: ese cierre lo verifican el importador y el control de publicación.', '',
  '`release_resources` referencia claves lógicas de metadatos mediante JSON; esa',
  'relación se verifica contra el ZIP y no añade FK SQL hacia cada tabla. Ver',
  '[12-publicacion.md](12-publicacion.md).', '',
  '```mermaid', ...er, '```', '',
  'Fuente Mermaid independiente: [ciencia-er.mmd](diagramas/ciencia-er.mmd).', '',
  'Para obtener un ER con todas las columnas de tu instancia real, genera el',
  'diagrama en pgAdmin siguiendo la [guía de acceso](09-acceso-postgresql-local.md).', ''
].join('\n'));
console.log(JSON.stringify({ tables: tables.length, foreign_keys: er.filter(l => l.includes('--')).length, documents: 3 }));
