import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
const { crearApp } = await import('../src/app.js');

// La ejecución habitual sin PostgreSQL mantiene esta suite desactivada.
// El script test:integracion proporciona una BD NUEVA con nombre controlado.
describe('API con PostgreSQL y migraciones desde cero', { skip: !process.env.TEST_DATABASE_URL }, () => {
  let pool;
  let servidor;
  let base;
  const record1 = '1'.repeat(64);
  const record2 = '2'.repeat(64);
  const fileId = `sha256:${'a'.repeat(64)}`;
  const get = (ruta) => fetch(base + ruta);

  before(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /^\/jiimatzin_test_[0-9a-f]{32}$/, 'Usa pnpm test:integracion para crear una BD aislada');
    pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    for (const migration of ['20261114000000_esquema-inicial.sql', '20261115000000_dataset-cientifico.sql','20261116000000_publicaciones.sql','20261117000000_escenarios-cientificos.sql','20261118000000_contenido-juego.sql']) {
      const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
      await pool.query(sql.split('-- Down Migration')[0]);
    }
    await pool.query(`INSERT INTO ciencia.sources VALUES ('nasa_pages','NASA','Reference pages','https://www.nasa.gov/')`);
    await pool.query(`INSERT INTO ciencia.datasets VALUES ('facts','nasa_pages','References',NULL,'other_mission_educational')`);
    await pool.query(`INSERT INTO ciencia.processors VALUES ('processor','1.0.0',NULL,'{}')`);
    await pool.query(`INSERT INTO ciencia.source_files VALUES ($1,$2,1)`, [fileId, 'a'.repeat(64)]);
    await pool.query(`INSERT INTO ciencia.source_file_locations
      (source_file_id,root_key,relative_path) VALUES ($1,'A','private/original.txt')`, [fileId]);
    await pool.query(`INSERT INTO ciencia.mechanics VALUES ('mech_filter','Filtro',false,'project')`);
    for (const record of [record1, record2]) {
      await pool.query(`INSERT INTO ciencia.processed_records
        (record_id,record_type,dataset_id,processor_id,schema_version,source_context,quality_status,quality_reasons,payload)
        VALUES ($1,'fact','facts','processor','1.0.0','other_mission_educational','not_applicable','[]',
                '{"data":{"review_status":"approved"},"private":"no exponer"}')`, [record]);
      await pool.query(`INSERT INTO ciencia.fact_cards
        (record_id,fact_key,language,title,scientific_statement,child_explanation,mission_context,game_adaptation,limitations)
        VALUES ($1,'fact_demo','es','Título','Hecho histórico','Explicación','Apolo 13','Adaptación','["Sin fórmula física"]')`, [record]);
      await pool.query(`INSERT INTO ciencia.fact_evidence VALUES
        ($1,0,'document_quote',$2,'{"section":"body"}','"Texto original"',true),
        ($1,1,'document_quote',$2,'{"section":"table"}','{"value":null}',true)`, [record, fileId]);
      await pool.query(`INSERT INTO ciencia.fact_mechanics VALUES ($1,'mech_filter')`, [record]);
    }
    servidor = crearApp({ pool }).listen(0, '127.0.0.1');
    await new Promise((resolve) => servidor.once('listening', resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(async () => {
    if (servidor) {
      servidor.closeAllConnections();
      await new Promise((resolve, reject) => servidor.close((err) => err ? reject(err) : resolve()));
    }
    await pool?.end();
  });

  test('fuente usa source_id real y no fabrica campos del modelo anterior', async () => {
    const r = await get('/api/v1/sources/nasa_pages');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id: 'nasa_pages', institution: 'NASA', product: 'Reference pages', url: 'https://www.nasa.gov/' });
    assert.equal((await get('/api/v1/sources/no-existe')).status, 404);
  });

  test('payload aprobado no sustituye la revisión humana; ficha sin revisión → 404', async () => {
    assert.equal((await get('/api/v1/facts/fact_demo')).status, 404);
  });

  test('ficha aprobada conserva identidad, límites, evidencias ordenadas y referencias únicas', async () => {
    await pool.query(`INSERT INTO ciencia.fact_reviews (fact_record_id,decision,reviewer_ref,notes,reviewed_at)
      VALUES ($1,'approved','private-reviewer','private-notes','2026-11-14T00:00:00Z')`, [record1]);
    const r = await get('/api/v1/facts/fact_demo');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.recordId, record1);
    assert.equal(body.schemaVersion, '1.0.0');
    assert.equal(body.processorId, 'processor');
    assert.deepEqual(body.limitations, ['Sin fórmula física']);
    assert.deepEqual(body.mechanicIds, ['mech_filter']);
    assert.deepEqual(body.references, [fileId]);
    assert.deepEqual(body.evidence.map((e) => e.index), [0, 1]);
    assert.deepEqual(body.evidence[1].expected, { value: null });
    assert.equal(body.evidence[0].verifiedAgainstPreservedSource, true);
    assert.doesNotMatch(JSON.stringify(body), /private|reviewer|payload|version/);
    assert.equal((await get('/api/v1/facts/fact_demo?lang=en')).status, 404);
  });

  test('recordId fija revisión; sin recordId gana la aprobación más reciente', async () => {
    await pool.query(`INSERT INTO ciencia.fact_reviews (fact_record_id,decision,reviewer_ref,reviewed_at)
      VALUES ($1,'approved','reviewer','2026-11-14T01:00:00Z')`, [record2]);
    assert.equal((await (await get('/api/v1/facts/fact_demo')).json()).recordId, record2);
    assert.equal((await (await get(`/api/v1/facts/fact_demo?recordId=${record1}`)).json()).recordId, record1);
    assert.equal((await get(`/api/v1/facts/otra_ficha?recordId=${record1}`)).status, 404);
    assert.equal((await get(`/api/v1/facts/fact_demo?recordId=${'3'.repeat(64)}`)).status, 404);
  });

  test('rechazo o pendiente posterior revoca aprobación; desempate por review_id', async () => {
    for (const decision of ['rejected', 'pending_human_review']) {
      await pool.query(`INSERT INTO ciencia.fact_reviews (fact_record_id,decision,reviewer_ref,reviewed_at)
        VALUES ($1,$2,'reviewer','2026-11-14T01:00:00Z')`, [record2, decision]);
      assert.equal((await get(`/api/v1/facts/fact_demo?recordId=${record2}`)).status, 404);
    }
    assert.equal((await (await get('/api/v1/facts/fact_demo')).json()).recordId, record1);
  });

  test('no expone evidencia no verificada, fichas sin evidencia ni registros en cuarentena', async () => {
    await pool.query(`UPDATE ciencia.fact_evidence SET verified_against_preserved_source=false
      WHERE fact_record_id=$1 AND evidence_index=1`, [record1]);
    assert.equal((await get(`/api/v1/facts/fact_demo?recordId=${record1}`)).status, 404);
    await pool.query(`UPDATE ciencia.fact_evidence SET verified_against_preserved_source=true WHERE fact_record_id=$1`, [record1]);
    await pool.query(`UPDATE ciencia.processed_records SET quality_status='quarantine' WHERE record_id=$1`, [record1]);
    assert.equal((await get(`/api/v1/facts/fact_demo?recordId=${record1}`)).status, 404);
    await pool.query(`UPDATE ciencia.processed_records SET quality_status='not_applicable' WHERE record_id=$1`, [record1]);
    await pool.query(`DELETE FROM ciencia.fact_evidence WHERE fact_record_id=$1`, [record1]);
    assert.equal((await get(`/api/v1/facts/fact_demo?recordId=${record1}`)).status, 404);
  });

  test('escenario de public se conserva sin confundirse con el catálogo científico', async () => {
    const { rows: [source] } = await pool.query(`INSERT INTO public.sources
      (code,name,provider,access_type) VALUES ('legacy','Fuente','NASA','manual') RETURNING id`);
    const { rows: [dataset] } = await pool.query(`INSERT INTO public.datasets
      (source_id,external_id,product) VALUES ($1,'test','REMS') RETURNING id`, [source.id]);
    const { rows: [capture] } = await pool.query(`INSERT INTO public.import_runs
      (dataset_id,captured_at,status) VALUES ($1,now(),'succeeded') RETURNING id`, [dataset.id]);
    const { rows: [file] } = await pool.query(`INSERT INTO public.source_files
      (import_run_id,uri,sha256,size_bytes,kind) VALUES ($1,'fixture.txt',$2,1,'original') RETURNING id`,
      [capture.id, 'b'.repeat(64)]);
    const { rows: [observation] } = await pool.query(`INSERT INTO public.observations
      (dataset_id,source_file_id,record_index,mission_sol,variable,raw_value,value,unit,quality_status)
      VALUES ($1,$2,0,11,'AMBIENT_TEMP','-999',NULL,'K','missing') RETURNING id`, [dataset.id, file.id]);
    const { rows: [scenario] } = await pool.query(`INSERT INTO public.scenarios
      (code,version,rules_version,language,publication_status,published_at)
      VALUES ('demo',1,'test','es','published',now()) RETURNING id`);
    await pool.query(`INSERT INTO public.scenarios (code,version,rules_version,language)
      VALUES ('demo',2,'test','es')`);
    await pool.query(`INSERT INTO public.scenario_records
      (scenario_id,observation_id,game_sol,game_phase,justification)
      VALUES ($1,$2,1,'morning','Prueba faltante')`, [scenario.id, observation.id]);
    const r = await get('/api/v1/scenarios/demo');
    assert.equal(r.status, 404);
    assert.equal((await pool.query('SELECT value FROM public.observations WHERE id=$1',[observation.id])).rows[0].value,null);
    assert.equal((await get('/api/v1/scenarios/demo?version=2')).status, 404);
    assert.equal((await (await get('/api/v1/scenarios')).json()).escenarios.length, 0);
  });
});
