import { columnas, claves, proyectar } from './formato.js';
import { recorrerPaquete } from './validacion.js';

/** Tablas/columnas salen de listas versionadas; los valores siempre son parámetros. */
export function crearCarga(client) {
  const stages = new Map();
  const inserted = {};
  async function stage(table) {
    if (!Object.hasOwn(columnas, table)) throw new Error('Tabla de carga desconocida');
    if (stages.has(table)) return stages.get(table);
    const names = columnas[table].split(' ');
    const keys = claves[table].split(' ');
    const temp = `import_${table}`;
    await client.query(`CREATE TEMP TABLE ${temp} ON COMMIT DROP AS SELECT ${names.join(',')} FROM ciencia.${table} WITH NO DATA`);
    await client.query(`CREATE UNIQUE INDEX ON ${temp} (${keys.join(',')}) NULLS NOT DISTINCT`);
    const { rows } = await client.query(`SELECT attname FROM pg_attribute
      WHERE attrelid=$1::regclass AND atttypid IN ('jsonb'::regtype,'json'::regtype) AND attnum>0`, [`ciencia.${table}`]);
    const jsonFields = new Set(rows.map((r) => r.attname));
    const value = { temp, names, keys, jsonFields, buffer: [] };
    stages.set(table, value);
    return value;
  }
  async function flush(table) {
    const s = stages.get(table);
    if (!s?.buffer.length) return;
    const select = s.names.map((name) => s.jsonFields.has(name) ? `raw.value->'${name}'` : `typed.${name}`);
    await client.query(`INSERT INTO ${s.temp} (${s.names.join(',')})
      SELECT ${select.join(',')} FROM jsonb_array_elements($1::jsonb) raw
      CROSS JOIN LATERAL jsonb_populate_record(NULL::ciencia.${table}, raw.value) typed`, [JSON.stringify(s.buffer)]);
    s.buffer = [];
  }
  async function comparar(table) {
    const s = stages.get(table);
    if (!s) return;
    await flush(table);
    await client.query(`ANALYZE ${s.temp}`);
    const join = s.keys.map((key) => `t.${key} ${key === 'archive_member' ? 'IS NOT DISTINCT FROM' : '='} s.${key}`).join(' AND ');
    const target = s.names.map((name) => `t.${name}`).join(',');
    const incoming = s.names.map((name) => `s.${name}`).join(',');
    const result = await client.query(`SELECT 1 FROM ${s.temp} s LEFT JOIN ciencia.${table} t ON ${join}
      WHERE t.${s.keys[0]} IS NULL OR ROW(${target}) IS DISTINCT FROM ROW(${incoming}) LIMIT 1`);
    if (result.rowCount) throw new Error(`Conflicto de contenido en ciencia.${table}; no se sobrescribe una revisión existente`);
  }
  return {
    preparar: stage,
    comparar,
    async agregar(table, row) {
      const s = await stage(table);
      s.buffer.push(row);
      if (s.buffer.length >= 1000) await flush(table);
    },
    async guardar(table) {
      const s = stages.get(table);
      if (!s) return;
      await flush(table);
      await client.query(`ANALYZE ${s.temp}`);
      const { rowCount } = await client.query(`INSERT INTO ciencia.${table} (${s.names.join(',')})
        SELECT ${s.names.join(',')} FROM ${s.temp} WHERE true ON CONFLICT DO NOTHING`);
      inserted[table] = rowCount;
      await comparar(table);
    },
    inserted,
  };
}

const mergeOrder = [
  'sources', 'datasets', 'source_files', 'source_file_locations', 'captures', 'capture_files', 'studies', 'mechanics',
  'instrument_events', 'processed_records', 'record_source_refs', 'observations', 'environment_hours', 'solar_events',
  'radiation_samples', 'fact_cards', 'release_members', 'lineage_members', 'fact_evidence', 'fact_mechanics', 'hour_event_annotations',
];

export async function comprobarRelaciones(client) {
  const checks = [
    [`SELECT 1 FROM import_environment_hours GROUP BY mission_day,lmst_hour HAVING count(*)>1 LIMIT 1`, 'Más de una revisión por hora'],
    [`SELECT 1 FROM import_solar_events GROUP BY external_id HAVING count(*)>1 LIMIT 1`, 'Más de una revisión por evento solar'],
    [`SELECT 1 FROM import_fact_cards GROUP BY fact_key,language HAVING count(*)>1 LIMIT 1`, 'Más de una revisión por ficha e idioma'],
    [`SELECT 1 FROM import_lineage_members l JOIN import_observations o ON o.record_id=l.observation_record_id
       JOIN import_environment_hours h ON h.record_id=l.aggregate_record_id
       WHERE o.source_sol<>h.source_sol OR o.lmst_hour<>h.lmst_hour
          OR o.variable<>CASE l.role WHEN 'temperature' THEN 'ambient_temperature' ELSE 'pressure' END LIMIT 1`, 'Linaje incompatible con variable, sol u hora'],
    // La validación previa exige que cada miembro sea una observación del paquete.
    // Igualdad de total y cardinalidad prueba la biyección sin un LEFT JOIN que,
    // con LIMIT/HAVING y sin índice inverso, puede elegir un bucle cuadrático.
    [`SELECT 1 FROM (SELECT count(*) AS n,count(DISTINCT observation_record_id) AS unique_n FROM import_lineage_members) l
       CROSS JOIN (SELECT count(*) AS n FROM import_observations) o
       WHERE l.n<>o.n OR l.unique_n<>o.n`, 'Observación sin un único agregado horario'],
  ];
  for (const role of ['temperature', 'pressure']) {
    const unit = role === 'temperature' ? 'k' : 'pa';
    checks.push([`SELECT 1 FROM import_environment_hours h LEFT JOIN (
        SELECT l.aggregate_record_id,count(*) AS n,min(o.value) AS lo,max(o.value) AS hi,avg(o.value) AS mean,
               min(o.lmst) AS first_lmst,max(o.lmst) AS last_lmst
          FROM import_lineage_members l JOIN import_observations o ON o.record_id=l.observation_record_id
         WHERE l.role='${role}' GROUP BY l.aggregate_record_id
      ) s ON s.aggregate_record_id=h.record_id
      WHERE h.${role}_selected_count<>COALESCE(s.n,0)
         OR h.${role}_min_${unit} IS DISTINCT FROM s.lo OR h.${role}_max_${unit} IS DISTINCT FROM s.hi
         OR h.${role}_first_lmst IS DISTINCT FROM s.first_lmst OR h.${role}_last_lmst IS DISTINCT FROM s.last_lmst
         OR abs(h.${role}_mean_${unit}-s.mean)>1e-10*greatest(1,abs(s.mean)) LIMIT 1`, `Agregado ${role} incompatible con sus muestras`]);
  }
  for (const [sql, message] of checks) if ((await client.query(sql)).rowCount) throw new Error(message);
}

export async function importarPaquete(pool, paquete, { progreso = () => {} } = {}) {
  // Preflight completo antes de escribir metadatos o registrar un intento.
  progreso('Validando registros, política y relaciones del paquete');
  const verified = await recorrerPaquete(paquete);
  progreso(`Validación previa completada: ${verified.record_count} registros`);
  const client = await pool.connect();
  const m = paquete.manifest;
  let runId;
  let locked = false;
  try {
    // Serializa las cargas, incluso cuando dos publicaciones comparten IDs.
    await client.query("SELECT pg_advisory_lock(728319, 1)"); locked = true;
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const bootstrap = crearCarga(client);
    for (const filename of ['quality_policies.jsonl', 'processors.jsonl']) {
      for await (const row of paquete.filas(filename)) {
        for (const [table, values] of proyectar(filename, row, {})) await bootstrap.agregar(table, values);
      }
      await bootstrap.guardar(filename.slice(0, -6));
    }
    const release = { release_id: m.release_id, dataset_version: m.dataset_version, schema_version: m.schema_version,
      processor_id: m.processor_id, manifest_sha256: paquete.manifest_sha256, content_hash: m.content_hash_reproducible,
      archive_sha256: paquete.archive_sha256, build_metadata: m.build_metadata_excluded_from_content_hash, manifest: m };
    await client.query(`INSERT INTO ciencia.dataset_releases
      (release_id,dataset_version,schema_version,processor_id,manifest_sha256,content_hash,archive_sha256,build_metadata,manifest)
      SELECT release_id,dataset_version,schema_version,processor_id,manifest_sha256,content_hash,archive_sha256,build_metadata,manifest
      FROM jsonb_populate_record(NULL::ciencia.dataset_releases,$1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(release)]);
    const { rows: [existing] } = await client.query(`SELECT status,
      ROW(dataset_version,schema_version,processor_id,manifest_sha256,content_hash,archive_sha256,build_metadata,manifest)
      IS NOT DISTINCT FROM ROW($2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::jsonb,$9::jsonb) AS same
      FROM ciencia.dataset_releases WHERE release_id=$1 FOR UPDATE`,
      [m.release_id, m.dataset_version, m.schema_version, m.processor_id, paquete.manifest_sha256, m.content_hash_reproducible,
        paquete.archive_sha256, JSON.stringify(release.build_metadata), JSON.stringify(m)]);
    if (!existing?.same) throw new Error('Conflicto de contenido en dataset_releases');
    if (existing.status !== 'candidate') throw new Error('Solo se permite importar o reintentar publicaciones candidate');
    await client.query('COMMIT');
    const { rows: [run] } = await client.query(`INSERT INTO ciencia.import_runs (release_id,status) VALUES ($1,'running') RETURNING import_run_id`, [m.release_id]);
    runId = run.import_run_id;
    progreso('Preparando carga transaccional por lotes');
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL statement_timeout = '120s'");
    const load = crearCarga(client);
    // Las tablas vacías también participan en las comprobaciones relacionales.
    for (const table of mergeOrder) await load.preparar(table);
    await recorrerPaquete(paquete, async (table, row) => {
      if (!['quality_policies', 'processors'].includes(table)) await load.agregar(table, row);
    });
    for (const table of mergeOrder) { progreso(`Cargando ${table}`); await load.guardar(table); }
    progreso('Contrastando linaje, conteos y estadísticas');
    await comprobarRelaciones(client);
    const counts = { ...verified, inserted: load.inserted };
    await client.query(`UPDATE ciencia.import_runs SET status='succeeded',finished_at=clock_timestamp(),counts=$2::jsonb WHERE import_run_id=$1`, [runId, JSON.stringify(counts)]);
    await client.query('COMMIT');
    progreso('Carga terminada; la publicación conserva estado candidate');
    return { release_id: m.release_id, status: 'candidate', import_run_id: runId, ...counts };
  } catch (error) {
    await client.query('ROLLBACK');
    if (runId != null) await client.query(`UPDATE ciencia.import_runs SET status='failed',finished_at=clock_timestamp(),errors=$2::jsonb WHERE import_run_id=$1`,
      [runId, JSON.stringify([{ message: error.message, ...(error.code ? { code: error.code } : {}) }])]);
    throw error;
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(728319, 1)'); }
    finally { client.release(); }
  }
}

