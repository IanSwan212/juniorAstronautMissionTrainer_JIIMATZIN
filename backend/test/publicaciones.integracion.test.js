import { describe,test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { datosPrueba,crearPaquetePrueba,fixtureId } from '../test-support/paquete.js';
import { abrirPaquete } from '../src/importador/paquete.js';
import { importarPaquete } from '../src/importador/carga.js';
import { comprobarPublicacion,retirarPublicacion } from '../src/publicaciones/publicaciones.model.js';

describe('Publicación administrativa con PostgreSQL', {skip:!process.env.TEST_DATABASE_URL},()=>{
  let pool,fixture,paquete,sqlMigration;
  const actor='test-admin';
  const releaseId=`rel_${'1'.repeat(32)}`;
  const options={releaseId,actor};
  const cli=(action)=>promisify(execFile)(process.execPath,[fileURLToPath(new URL('../src/publicaciones/cli.js',import.meta.url)),action,
    '--release',releaseId,'--actor','test-cli','--archivo',fixture.path,'--sha256',fixture.sha256],
    {windowsHide:true,env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL}});
  const review=async(decision)=>pool.query(`INSERT INTO ciencia.fact_reviews(fact_record_id,decision,reviewer_ref)
    VALUES($1,$2,'synthetic-human-fixture')`,[fixtureId(4),decision]);
  before(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname,/^\/jiimatzin_test_[0-9a-f]{32}$/);
    pool=new pg.Pool({connectionString:url.href,max:4,connectionTimeoutMillis:5000});
    for(const name of ['20261114000000_esquema-inicial.sql','20261115000000_dataset-cientifico.sql']){
      await pool.query((await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8')).split('-- Down Migration')[0]);
    }
    sqlMigration=await readFile(new URL('../migrations/20261116000000_publicaciones.sql',import.meta.url),'utf8');
    const [up,down]=sqlMigration.split('-- Down Migration');
    await pool.query(up); await pool.query(down); await pool.query(up);
    await pool.query((await readFile(new URL('../migrations/20261117000000_escenarios-cientificos.sql',import.meta.url),'utf8')).split('-- Down Migration')[0]);
    fixture=await crearPaquetePrueba(); paquete=await abrirPaquete(fixture.path,fixture.sha256);
    await importarPaquete(pool,paquete);
  });
  after(async()=>{await paquete?.cerrar();await fixture?.cerrar();await pool?.end();});

  test('validar deja candidato, distingue técnica de revisión humana y registra el operador',async()=>{
    const r=await comprobarPublicacion(pool,paquete,options);
    assert.equal(r.technical_ok,true); assert.equal(r.ready_for_publication,false); assert.equal(r.status,'candidate');
    assert.equal(r.pending_facts.length,1);assert.equal(r.pending_facts[0].decision,'missing');
    const {rows:[e]}=await pool.query('SELECT action,actor_ref,database_actor FROM ciencia.publication_events WHERE event_id=$1',[r.check_event_id]);
    assert.equal(e.action,'checked');assert.equal(e.actor_ref,actor);assert.ok(e.database_actor);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.fact_reviews')).rows[0].n,0);
  });
  test('publicar pendiente no modifica estado ni crea un sello',async()=>{
    const r=await comprobarPublicacion(pool,paquete,{...options,publicar:true});
    assert.equal(r.publication_event_id,null);assert.equal(r.status,'candidate');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.release_resources')).rows[0].n,0);
    await assert.rejects(cli('publicar'),(error)=>{
      assert.equal(error.code,2);const report=JSON.parse(error.stdout);
      assert.equal(report.technical_ok,true);assert.equal(report.status,'candidate');return true;
    });
  });
  test('alterar payload y proyección coherentemente se detecta contra el ZIP',async()=>{
    await pool.query("UPDATE ciencia.processed_records SET payload=jsonb_set(payload,'{data,value}','208') WHERE record_id=$1",[fixtureId(1)]);
    await pool.query('UPDATE ciencia.observations SET value=208 WHERE record_id=$1',[fixtureId(1)]);
    try{
      const r=await comprobarPublicacion(pool,paquete,options);
      assert.equal(r.technical_ok,false);assert.equal(r.blockers[0].code,'contenido_inconsistente');
      await assert.rejects(cli('validar'),(error)=>{
        assert.equal(error.code,1);assert.equal(JSON.parse(error.stdout).technical_ok,false);return true;
      });
    }finally{
      await pool.query('UPDATE ciencia.processed_records SET payload=$2::jsonb WHERE record_id=$1',[fixtureId(1),JSON.stringify(datosPrueba().rows['observations.jsonl'][0])]);
      await pool.query('UPDATE ciencia.observations SET value=207 WHERE record_id=$1',[fixtureId(1)]);
    }
  });
  test('relaciones adicionales no pasan una comparación parcial',async()=>{
    await pool.query(`INSERT INTO ciencia.fact_evidence SELECT fact_record_id,1,evidence_type,source_file_id,locator,expected,verified_against_preserved_source FROM ciencia.fact_evidence WHERE evidence_index=0`);
    try{const r=await comprobarPublicacion(pool,paquete,options);assert.equal(r.technical_ok,false);assert.match(r.blockers[0].message,/adicionales/);}
    finally{await pool.query('DELETE FROM ciencia.fact_evidence WHERE evidence_index=1');}
  });
  test('la última decisión humana prevalece sobre una aprobación anterior',async()=>{
    await review('approved'); await review('rejected');
    const r=await comprobarPublicacion(pool,paquete,{...options,publicar:true});
    assert.equal(r.ready_for_publication,false);assert.equal(r.pending_facts[0].decision,'rejected');
  });
  test('no se publica por UPDATE directo ni con un comprobante de otra transacción',async()=>{
    await assert.rejects(pool.query("UPDATE ciencia.dataset_releases SET status='published',published_at=now() WHERE release_id=$1",[releaseId]),/procedimiento administrativo/);
    await review('approved');
    const r=await comprobarPublicacion(pool,paquete,options);assert.equal(r.ready_for_publication,true);
    await assert.rejects(pool.query("INSERT INTO ciencia.publication_events(release_id,action,actor_ref,report) VALUES($1,'published','test','{}')",[releaseId]),/misma transacción/);
  });
  test('publicación válida registra el sello y protege todas las revisiones',async()=>{
    const r=await comprobarPublicacion(pool,paquete,{...options,publicar:true});
    assert.equal(r.status,'published');assert.ok(r.publication_event_id);
    assert.ok((await pool.query('SELECT published_at FROM ciencia.dataset_releases WHERE release_id=$1',[releaseId])).rows[0].published_at);
    assert.ok((await pool.query('SELECT count(*)::int AS n FROM ciencia.release_resources')).rows[0].n>0);
  });
  test('DML de datos, relaciones y metadatos publicados queda bloqueado; TRUNCATE también',async()=>{
    for(const sql of [
      'UPDATE ciencia.observations SET value=208',
      "UPDATE ciencia.processed_records SET payload='{}'",
      'DELETE FROM ciencia.lineage_members',
      "UPDATE ciencia.release_members SET usage_tier='archive'",
      "UPDATE ciencia.sources SET institution='modified'",
      'UPDATE ciencia.source_files SET size_bytes=99',
      "UPDATE ciencia.source_file_locations SET relative_path='changed.txt'",
      'DELETE FROM ciencia.capture_files',
      'DELETE FROM ciencia.release_resources',
      'TRUNCATE ciencia.observations CASCADE',
    ]) await assert.rejects(pool.query(sql),/inmutable|TRUNCATE/);
    await assert.rejects(pool.query(`INSERT INTO ciencia.fact_evidence SELECT fact_record_id,2,evidence_type,source_file_id,locator,expected,verified_against_preserved_source FROM ciencia.fact_evidence WHERE evidence_index=0`),/inmutable/);
  });
  test('revisión humana e intentos cerrados son historiales de solo anexado',async()=>{
    await assert.rejects(review('rejected'),/Retirar/);
    await assert.rejects(pool.query("UPDATE ciencia.fact_reviews SET decision='approved'"),/solo anexado/);
    await assert.rejects(pool.query('DELETE FROM ciencia.fact_reviews'),/solo anexado/);
    await assert.rejects(pool.query('DELETE FROM ciencia.publication_events'),/inmutable/);
    await assert.rejects(pool.query("UPDATE ciencia.import_runs SET counts='{}'"),/inmutable/);
    await assert.rejects(pool.query(`INSERT INTO ciencia.fact_reviews(fact_record_id,decision,reviewer_ref,reviewed_at) VALUES($1,'approved','test',now()+interval '1 day')`,[fixtureId(4)]),/futura/);
  });
  test('retirar registra el motivo, permite revocar aprobación y conserva contenido inmutable',async()=>{
    await assert.rejects(retirarPublicacion(pool,{...options,motivo:''}));
    const r=await retirarPublicacion(pool,{...options,motivo:'Synthetic withdrawal test'});
    assert.equal(r.status,'retired');await review('rejected');
    await assert.rejects(pool.query('UPDATE ciencia.observations SET value=209'),/inmutable/);
    await assert.rejects(pool.query(sqlMigration.split('-- Down Migration')[1]),/protecciones/);
  });
  test('rol de lectura no puede escribir ni acceder a la bitácora administrativa',async()=>{
    const client=await pool.connect();const role=`reader_${randomUUID().replaceAll('-','')}`;
    try{
      await client.query('BEGIN');await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA ciencia TO ${role}`);
      await client.query(`GRANT SELECT ON ciencia.observations TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM ciencia.observations')).rows[0].n,1);
      for(const sql of ['DELETE FROM ciencia.observations','SELECT * FROM ciencia.publication_events']){
        await client.query('SAVEPOINT denied');await assert.rejects(client.query(sql),(e)=>e.code==='42501');await client.query('ROLLBACK TO SAVEPOINT denied');
      }
    }finally{await client.query('ROLLBACK');client.release();}
  });
  test('una segunda publicación puede reutilizar registros ya sellados sin mutarlos',async()=>{
    const spec=datosPrueba(`rel_${'2'.repeat(32)}`);const f=await crearPaquetePrueba(spec);let p;
    try{
      p=await abrirPaquete(f.path,f.sha256);const loaded=await importarPaquete(pool,p);
      assert.equal(loaded.inserted.processed_records,0);
      await review('approved');const r=await comprobarPublicacion(pool,p,{actor,releaseId:spec.release_id,publicar:true});assert.equal(r.status,'published');
    }finally{await p?.cerrar();await f.cerrar();}
  });
  test('escrituras con una instantánea antigua no eluden los bloqueos',async()=>{
    const client=await pool.connect();try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await assert.rejects(client.query('UPDATE ciencia.observations SET value=209'),/READ COMMITTED/);
    }finally{await client.query('ROLLBACK');client.release();}
  });
  test('una escritura concurrente espera el cierre y después respeta el sello',async()=>{
    const spec=JSON.parse(JSON.stringify(datosPrueba(`rel_${'3'.repeat(32)}`))
      .replaceAll(fixtureId(1),'a'.repeat(64)).replaceAll(fixtureId(2),'b'.repeat(64))
      .replaceAll(fixtureId(3),'c'.repeat(64)).replaceAll(fixtureId(4),'d'.repeat(64)));
    const f=await crearPaquetePrueba(spec);let p,writer,concurrent;
    try{
      p=await abrirPaquete(f.path,f.sha256);await importarPaquete(pool,p);
      await pool.query("INSERT INTO ciencia.fact_reviews(fact_record_id,decision,reviewer_ref) VALUES($1,'approved','synthetic-human-fixture')",['d'.repeat(64)]);
      writer=await pool.connect();await writer.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await writer.query("SET LOCAL statement_timeout='10s'");
      const r=await comprobarPublicacion(pool,p,{actor,releaseId:spec.release_id,publicar:true,progreso:()=>{
        concurrent??=writer.query('UPDATE ciencia.observations SET value=209 WHERE record_id=$1',['a'.repeat(64)])
          .then(()=>null,(error)=>error);
      }});
      assert.equal(r.status,'published');const error=await concurrent;
      assert.equal(error?.code,'55000');assert.match(error.message,/inmutable/);
      assert.equal((await pool.query('SELECT value FROM ciencia.observations WHERE record_id=$1',['a'.repeat(64)])).rows[0].value,207);
    }finally{
      if(writer){await writer.query('ROLLBACK');writer.release();}
      await p?.cerrar();await f.cerrar();
    }
  });
});
