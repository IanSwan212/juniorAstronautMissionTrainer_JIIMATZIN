import { z } from 'zod';
import { crearCarga, comprobarRelaciones } from '../importador/carga.js';
import { columnas, claves } from '../importador/formato.js';
import { recorrerPaquete, canonical } from '../importador/validacion.js';

const entrada = z.strictObject({
  releaseId: z.string().regex(/^rel_[0-9a-f]{32}$/),
  actor: z.string().trim().min(1).max(200),
});
export const tablasRecursos = ['sources','datasets','source_files','source_file_locations','captures','capture_files',
  'quality_policies','processors','studies','mechanics','instrument_events'];
const scientificTables = Object.keys(columnas);
const lockTables = [...scientificTables,'dataset_releases','import_runs','fact_reviews','release_resources','publication_events'].sort();

async function bloquear(client) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query("SET LOCAL lock_timeout='10s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query('SELECT pg_advisory_xact_lock(728319,1)');
  // Impide cambios de datos, revisiones y TRUNCATE mientras se coteja el ZIP.
  // Los SELECT de la API pueden continuar.
  await client.query(`LOCK TABLE ${lockTables.map((t) => `ciencia.${t}`).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
}

async function pendientes(client, releaseId) {
  const { rows } = await client.query(`SELECT f.record_id,f.fact_key,f.language,review.decision,
      EXISTS(SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id) AS has_evidence,
      NOT EXISTS(SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id AND NOT e.verified_against_preserved_source) AS verified
    FROM ciencia.release_members m JOIN ciencia.fact_cards f USING(record_id)
    LEFT JOIN LATERAL (SELECT decision FROM ciencia.fact_reviews WHERE fact_record_id=f.record_id
      ORDER BY reviewed_at DESC,review_id DESC LIMIT 1) review ON true
    WHERE m.release_id=$1 AND m.usage_tier IN ('runtime','educational') ORDER BY f.fact_key,f.record_id`, [releaseId]);
  return rows.filter((r) => r.decision !== 'approved' || !r.has_evidence || !r.verified).map((r) => ({
    recordId:r.record_id, factKey:r.fact_key, language:r.language, decision:r.decision ?? 'missing',
    reason:r.decision !== 'approved' ? 'revision_humana_pendiente' : 'evidencia_no_verificada',
  }));
}

async function comprobarContenido(client, paquete, progreso) {
  const carga = crearCarga(client);
  for (const table of scientificTables) await carga.preparar(table);
  const counts = await recorrerPaquete(paquete, (table, row) => carga.agregar(table, row));
  for (const table of scientificTables) {
    progreso(`Comparando ${table} con el paquete original`);
    await carga.comparar(table); // Solo SELECT en tablas permanentes: jamás repara ni inserta contenido.
  }
  const releaseId = paquete.manifest.release_id;
  const { rows:[memberCount] } = await client.query('SELECT count(*)::int AS n FROM ciencia.release_members WHERE release_id=$1',[releaseId]);
  if (memberCount.n !== counts.record_count) throw new Error('Membresías adicionales o ausentes en la publicación');
  // Las proyecciones esperadas deben ser conjuntos exactos, no solo subconjuntos.
  const scopes = {
    record_source_refs:['record_id','processed_records'], observations:['record_id','processed_records'],
    environment_hours:['record_id','processed_records'], solar_events:['record_id','processed_records'],
    radiation_samples:['record_id','processed_records'], fact_cards:['record_id','processed_records'],
    lineage_members:['aggregate_record_id','environment_hours'], hour_event_annotations:['aggregate_record_id','environment_hours'],
    fact_evidence:['fact_record_id','fact_cards'], fact_mechanics:['fact_record_id','fact_cards'],
    capture_files:['capture_id','captures'],
  };
  for (const [table,[field,parent]] of Object.entries(scopes)) {
    const pk = parent==='captures' ? 'capture_id' : 'record_id';
    const { rows:[r] } = await client.query(`SELECT
      (SELECT count(*) FROM ciencia.${table} t JOIN import_${parent} p ON p.${pk}=t.${field}) AS actual,
      (SELECT count(*) FROM import_${table}) AS expected`);
    if (r.actual !== r.expected) throw new Error(`Relaciones adicionales o ausentes en ${table}`);
  }
  await comprobarRelaciones(client);
  const resources = {};
  for (const table of tablasRecursos) resources[table]=(await client.query(`SELECT count(*)::int AS n FROM import_${table}`)).rows[0].n;
  return { counts, resources };
}

async function registrarRecursos(client, releaseId) {
  for (const table of tablasRecursos) {
    const keys = claves[table].split(' ');
    const key = `jsonb_build_object(${keys.flatMap((k) => [`'${k}'`,k]).join(',')})`;
    await client.query(`INSERT INTO ciencia.release_resources (release_id,table_name,resource_key)
      SELECT $1,$2,${key} FROM import_${table} ON CONFLICT DO NOTHING`, [releaseId,table]);
  }
}

export async function comprobarPublicacion(pool, paquete, options) {
  const { publicar=false, progreso=()=>{}, ...args } = options;
  const { releaseId,actor } = entrada.parse(args);
  if (paquete.manifest.release_id !== releaseId) throw new Error('El ZIP no corresponde al release_id solicitado');
  const client = await pool.connect();
  try {
    await bloquear(client);
    const { rows:[release] } = await client.query('SELECT * FROM ciencia.dataset_releases WHERE release_id=$1 FOR UPDATE',[releaseId]);
    if (!release) throw new Error('Publicación no encontrada');
    if (release.archive_sha256 !== paquete.archive_sha256 || release.manifest_sha256 !== paquete.manifest_sha256
      || canonical(release.manifest) !== canonical(paquete.manifest)
      || release.content_hash !== paquete.manifest.content_hash_reproducible
      || release.processor_id !== paquete.manifest.processor_id) throw new Error('El ZIP o manifiesto no coincide con la construcción importada');
    const report = { validator_version:'publication-1', release_id:releaseId, archive_sha256:paquete.archive_sha256,
      manifest_sha256:paquete.manifest_sha256, technical_ok:false, ready_for_publication:false, blockers:[] };
    await client.query('SAVEPOINT technical_check');
    try {
      const { rows:[run] } = await client.query('SELECT status,counts FROM ciencia.import_runs WHERE release_id=$1 ORDER BY import_run_id DESC LIMIT 1',[releaseId]);
      if (run?.status !== 'succeeded' || run.counts.record_count !== paquete.manifest.db_ready_line_counts['release_members.jsonl']) throw new Error('Falta una última importación exitosa con los conteos esperados');
      const result = await comprobarContenido(client,paquete,progreso);
      Object.assign(report,{ technical_ok:true, counts:result.counts, resource_counts:result.resources });
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT technical_check');
      report.blockers.push({ code:'contenido_inconsistente', message:error.message });
    }
    const pendingFacts=await pendientes(client,releaseId);
    report.pending_facts=pendingFacts;
    if (pendingFacts.length) report.blockers.push({ code:'revision_humana_pendiente', count:pendingFacts.length });
    if (release.status !== 'candidate') report.blockers.push({ code:'estado_no_publicable', status:release.status });
    report.ready_for_publication=report.technical_ok && report.blockers.length===0;
    const { rows:[check] } = await client.query(`INSERT INTO ciencia.publication_events(release_id,action,actor_ref,report)
      VALUES($1,'checked',$2,$3::jsonb) RETURNING event_id`,[releaseId,actor,JSON.stringify(report)]);
    let eventId=null;
    if (publicar && report.ready_for_publication) {
      await registrarRecursos(client,releaseId);
      const { rows:[event] } = await client.query(`INSERT INTO ciencia.publication_events(release_id,action,actor_ref,report)
        VALUES($1,'published',$2,'{}') RETURNING event_id`,[releaseId,actor]);
      eventId=event.event_id;
    }
    await client.query('COMMIT');
    return { ...report, check_event_id:check.event_id, publication_event_id:eventId,
      status:eventId ? 'published' : release.status };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function retirarPublicacion(pool, options) {
  const { motivo,...args } = options;
  const { releaseId,actor } = entrada.parse(args);
  const reason=z.string().trim().min(1).max(2000).parse(motivo);
  const client=await pool.connect();
  try {
    await bloquear(client);
    const { rows:[event] }=await client.query(`INSERT INTO ciencia.publication_events(release_id,action,actor_ref,report,reason)
      VALUES($1,'retired',$2,'{}',$3) RETURNING event_id`,[releaseId,actor,reason]);
    await client.query('COMMIT');
    return { release_id:releaseId,status:'retired',event_id:event.event_id };
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
