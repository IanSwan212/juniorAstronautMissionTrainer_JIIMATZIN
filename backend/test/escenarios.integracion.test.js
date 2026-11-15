import { describe,test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { z } from 'zod';
import pg from 'pg';
import { datosPrueba,crearPaquetePrueba,fixtureId } from '../test-support/paquete.js';
import { abrirPaquete } from '../src/importador/paquete.js';
import { importarPaquete } from '../src/importador/carga.js';
import { comprobarPublicacion,retirarPublicacion } from '../src/publicaciones/publicaciones.model.js';
import { crearBorradorEscenario,cambiarPublicacionEscenario } from '../src/escenarios/escenarios.admin.js';
import { exportarEscenario } from '../src/escenarios/escenarios.exportar.js';
import { validarEscenario,cargarEscenario } from '../../frontend/src/api/cargarEscenario.js';
import { obtenerFicha } from '../../frontend/src/api/index.js';

process.env.NODE_ENV='test';process.env.DATABASE_URL??='postgresql://test:test@localhost:5432/test';
const {crearApp}=await import('../src/app.js');
const contract=z.fromJSONSchema(JSON.parse(await readFile(new URL('../../contrato/scenario.schema.json',import.meta.url),'utf8')));

describe('Escenarios científicos y respaldo del frontend',{skip:!process.env.TEST_DATABASE_URL},()=>{
  let pool,fixture,paquete,server,base,directory,definition;
  const actor='test-editor';const releaseId=`rel_${'1'.repeat(32)}`;
  const change=(version,action,reason)=>cambiarPublicacionEscenario(pool,{scenarioId:'fixture',version,actor,action,...(reason?{reason}:{})});
  const get=(path)=>fetch(base+path);
  const data=async(version)=>{const r=await get(`/api/v1/scenarios/fixture${version?`?version=${version}`:''}`);assert.equal(r.status,200);return r.json();};
  before(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL);assert.match(url.pathname,/^\/jiimatzin_test_[0-9a-f]{32}$/);
    pool=new pg.Pool({connectionString:url.href,max:4,connectionTimeoutMillis:5000});
    for(const name of ['20261114000000_esquema-inicial.sql','20261115000000_dataset-cientifico.sql','20261116000000_publicaciones.sql']){
      await pool.query((await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8')).split('-- Down Migration')[0]);
    }
    const [up,down]=(await readFile(new URL('../migrations/20261117000000_escenarios-cientificos.sql',import.meta.url),'utf8')).split('-- Down Migration');
    await pool.query(up);await pool.query(down);await pool.query(up);
    const spec=datosPrueba();spec.rows['captures.jsonl'][0].captured_at_utc='2026-11-14T00:00:00Z';
    const envelope=structuredClone(spec.rows['observations.jsonl'][0]);
    spec.rows['datasets.jsonl'].push(
      {dataset_id:'solar',source_id:'test_source',product:'FLR',platform:'DONKI',source_context:'solar_event_catalogue'},
      {dataset_id:'rad',source_id:'test_source',product:'ISS',platform:'ISS',source_context:'other_mission_educational'});
    spec.rows['solar_events.jsonl']=[{...envelope,record_id:fixtureId(5),record_type:'solar_event',dataset_id:'solar',source_context:'solar_event_catalogue',selection_policy_id:null,
      data:{external_id:'test-FLR',event_type:'FLR',begin_time:'2024-05-08T01:33:00Z',begin_time_original:'2024-05-08T01:33Z',
        peak_time:'2024-05-08T01:34:00Z',peak_time_original:'2024-05-08T01:34Z',end_time:'2024-05-08T01:35:00Z',end_time_original:'2024-05-08T01:35Z',
        class_type:'M1.0',catalog:'M2M_CATALOG',instruments:[],linked_events:[],linked_events_supplied:false,source_url:'https://example.org/flr',
        source_version:1,source_location:null,active_region:null,is_mars_surface_measurement:false,time_sequence_consistent:true}}];
    spec.rows['radiation_samples.jsonl']=[{...envelope,record_id:fixtureId(6),record_type:'radiation_sample',dataset_id:'rad',source_context:'other_mission_educational',
      selection_policy_id:null,usage_tier:'educational',data:{variable:'absorbed_dose_rate',value:9.8,unit:'uGy/h',spacecraft:'ISS',instrument_id:'DosTel1',
        timestamp_original:'2022-04-01T23:00:00',time_basis:'radlab_original_convention_unspecified',observed_at_utc:null,
        row_position:0,row_index_supplied:0,seconds_since_previous:null}}];
    for(const file of ['solar_events.jsonl','radiation_samples.jsonl'])for(const row of spec.rows[file])spec.rows['release_members.jsonl'].push({
      release_id:releaseId,record_id:row.record_id,record_type:row.record_type,usage_tier:row.usage_tier});
    fixture=await crearPaquetePrueba(spec);paquete=await abrirPaquete(fixture.path,fixture.sha256);await importarPaquete(pool,paquete);
    directory=join(dirname(fixture.path),'exports');
    definition={scenarioId:'fixture',version:1,releaseId,rulesVersion:'fixture-rules-1',rules:{mode:'educational',parameters:{}},language:'es',
      title:'Escenario científico de prueba',modelAssumptions:['Selección editorial sintética'],
      conditions:[2,3,1,5,6].map((n)=>({recordId:fixtureId(n),role:n>4?'reference':'environment',gameSol:1,gamePhase:null,justification:'Selección de prueba'})),
      facts:[{recordId:fixtureId(4),gameSol:1,gamePhase:'night'}]};
    server=crearApp({pool}).listen(0,'127.0.0.1');await new Promise((r)=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  });
  after(async()=>{
    if(server){server.closeAllConnections();await new Promise((r)=>server.close(r));}
    await paquete?.cerrar();await fixture?.cerrar();await pool?.end();
  });
  test('borrador idempotente y candidato no aparecen en la API ni se exportan',async()=>{
    assert.equal((await crearBorradorEscenario(pool,definition,actor)).created,true);
    assert.equal((await crearBorradorEscenario(pool,definition,actor)).created,false);
    assert.equal((await get('/api/v1/scenarios/fixture')).status,404);
    assert.deepEqual(await (await get('/api/v1/scenarios')).json(),{escenarios:[]});
    await assert.rejects(change(1,'published'),/publicación científica activa/);
    await assert.rejects(exportarEscenario(pool,{scenarioId:'fixture',version:1,directory}),/publicado/);
  });
  test('rechaza otra membresía, tipo ambiente incompatible, archivo y ficha de otro idioma',async()=>{
    const bad=(name)=>({...structuredClone(definition),scenarioId:name});
    let d=bad('missing');d.conditions[0].recordId='9'.repeat(64);await assert.rejects(crearBorradorEscenario(pool,d,actor));
    d=bad('solar-environment');d.conditions[0].recordId=fixtureId(5);await assert.rejects(crearBorradorEscenario(pool,d,actor),/ambiente/);
    d=bad('wrong-language');d.language='en';await assert.rejects(crearBorradorEscenario(pool,d,actor),/Idioma/);
    await pool.query("UPDATE ciencia.release_members SET usage_tier='archive' WHERE record_id=$1",[fixtureId(3)]);
    try{await assert.rejects(crearBorradorEscenario(pool,bad('archive'),actor),/elegible/);}
    finally{await pool.query("UPDATE ciencia.release_members SET usage_tier='runtime' WHERE record_id=$1",[fixtureId(3)]);}
    await assert.rejects(crearBorradorEscenario(pool,{...definition,title:'Cambio bajo misma versión'},actor),/otro contenido/);
    await assert.rejects(crearBorradorEscenario(pool,{...bad('rules-conflict'),rules:{modified:true}},actor),/reglas/);
  });
  test('publicar enlaza ciencia aprobada y fija reglas y selección',async()=>{
    await pool.query("INSERT INTO ciencia.fact_reviews(fact_record_id,decision,reviewer_ref) VALUES($1,'approved','synthetic-human-fixture')",[fixtureId(4)]);
    assert.equal((await comprobarPublicacion(pool,paquete,{releaseId,actor,publicar:true})).status,'published');
    await crearBorradorEscenario(pool,{...definition,scenarioId:'invalid-contract'},actor);
    await pool.query(`UPDATE juego.scenarios SET model_assumptions='[1]' WHERE scenario_id='invalid-contract'`);
    await assert.rejects(cambiarPublicacionEscenario(pool,{scenarioId:'invalid-contract',version:1,actor,action:'published'}));
    assert.equal((await pool.query(`SELECT publication_status FROM juego.scenarios WHERE scenario_id='invalid-contract'`)).rows[0].publication_status,'draft');
    await change(1,'published');
    assert.ok((await pool.query('SELECT published_at FROM juego.game_rule_sets')).rows[0].published_at);
  });
  test('contrato 2 conserva nulos, contextos, tiempos e identidades y lo acepta el frontend',async(t)=>{
    const body=await data(1);contract.parse(body);validarEscenario(body,{scenarioId:'fixture',version:1,releaseId});
    assert.equal(body.schemaVersion,'2');assert.equal(body.releaseId,releaseId);assert.deepEqual(body.rules,definition.rules);
    assert.equal(body.conditions[0].data.pressure.sample_mean,null);
    assert.equal(body.conditions[1].data.temperature.sample_mean,null);
    assert.equal(body.conditions[2].value,207);assert.equal(body.conditions[2].data.source_sol,10);
    assert.equal(body.conditions[3].data.is_mars_surface_measurement,false);
    assert.equal(body.conditions[4].context,'other_mission_educational');assert.equal(body.conditions[4].unit,'uGy/h');
    assert.equal(body.conditions[4].data.observed_at_utc,null);assert.equal(body.conditions[4].role,'reference');
    assert.deepEqual(body.sourceCoverage,{start:null,end:null});assert.deepEqual(body.marsCoverage,{startSol:10,endSol:10,timeBasis:'mars_lmst'});
    assert.equal(body.retrievedAt,'2026-11-14T00:00:00.000Z');assert.equal(body.facts[0].recordId,fixtureId(4));
    assert.doesNotMatch(JSON.stringify(body),/reviewer|capture_path|root_key|"payload"|database_actor/);
    assert.equal((await get('/api/v1/scenarios/fixture')).headers.get('cache-control'),'no-store');
    const native=globalThis.fetch;let requested;
    t.mock.method(globalThis,'fetch',async(url,options)=>{requested=String(url);return native(base+url,options);});
    const fact=await obtenerFicha(body.facts[0].id,body.language,{recordId:body.facts[0].recordId});
    assert.equal(fact.recordId,body.facts[0].recordId);
    assert.equal(new URL(requested,base).searchParams.get('recordId'),body.facts[0].recordId);
  });
  test('última versión publicada y búsqueda exacta no muestran borradores',async()=>{
    await crearBorradorEscenario(pool,{...definition,version:2,title:'Segunda versión'},actor);
    assert.equal((await data()).scenarioVersion,'1');assert.equal((await get('/api/v1/scenarios/fixture?version=2')).status,404);
    await change(2,'published');assert.equal((await data()).scenarioVersion,'2');assert.equal((await data(1)).scenarioVersion,'1');
    const list=await (await get('/api/v1/scenarios')).json();assert.deepEqual(list.escenarios.map((s)=>s.scenarioVersion),['2','1']);
  });
  test('escenario publicado, reglas, membresías y bitácora quedan inmutables',async()=>{
    for(const sql of ["UPDATE juego.scenarios SET title='changed'","UPDATE juego.game_rule_sets SET definition='{}'",
      'DELETE FROM juego.scenario_records','DELETE FROM juego.scenario_facts','DELETE FROM juego.scenario_events','TRUNCATE juego.scenarios CASCADE']){
      await assert.rejects(pool.query(sql),/inmutable|TRUNCATE/);
    }
  });
  test('respaldo contiene el mismo JSON, fija versión y no degrada el alias',async()=>{
    const one=await exportarEscenario(pool,{scenarioId:'fixture',version:1,directory});assert.equal(one.latestPath,null);
    const two=await exportarEscenario(pool,{scenarioId:'fixture',version:2,directory});
    assert.deepEqual(JSON.parse(await readFile(two.versionedPath,'utf8')),await data(2));
    assert.deepEqual(JSON.parse(await readFile(two.latestPath,'utf8')),await data(2));
    await exportarEscenario(pool,{scenarioId:'fixture',version:1,directory});
    assert.equal(JSON.parse(await readFile(two.latestPath,'utf8')).scenarioVersion,'2');
    const text=await readFile(two.versionedPath,'utf8');await exportarEscenario(pool,{scenarioId:'fixture',version:2,directory});
    await writeFile(two.versionedPath,'{}');
    try{await assert.rejects(exportarEscenario(pool,{scenarioId:'fixture',version:2,directory}),/otro contenido/);}
    finally{await writeFile(two.versionedPath,text);}
  });
  test('capturas posteriores fuera del cierre no cambian la procedencia publicada',async()=>{
    const file=paquete.manifest.db_ready_line_counts['source_files.jsonl'];assert.equal(file,1);
    const {rows:[source]}=await pool.query('SELECT source_file_id FROM ciencia.source_files');
    await pool.query(`INSERT INTO ciencia.captures(capture_id,input_group,captured_at_utc,final_status) VALUES('later','A','2026-11-15T00:00:00Z','captured')`);
    await pool.query("INSERT INTO ciencia.capture_files VALUES('later',$1,'later')",[source.source_file_id]);
    assert.equal((await data(2)).retrievedAt,'2026-11-14T00:00:00.000Z');
  });
  test('cargarEscenario usa el respaldo de la versión solicitada ante caída de red',async(t)=>{
    const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{
      calls.push(String(url));if(String(url).startsWith('/api/'))throw new TypeError('offline');
      return new Response(await readFile(join(directory,'fixture','v1.json'),'utf8'),{headers:{'content-type':'application/json'}});
    });
    const result=await cargarEscenario('fixture',{version:1,releaseId});assert.equal(result.origen,'respaldo-local');assert.equal(result.escenario.scenarioVersion,'1');
    assert.equal(calls[1],'/escenarios/fixture/v1.json');
  });
  test('retirar escenario oculta esa versión y una respuesta 404 no usa el respaldo',async(t)=>{
    await change(2,'retired','Synthetic withdrawal');assert.equal((await data()).scenarioVersion,'1');
    await assert.rejects(exportarEscenario(pool,{scenarioId:'fixture',version:2,directory}));
    const native=globalThis.fetch;const calls=[];
    t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(String(url));return native(base+url,options);});
    await assert.rejects(cargarEscenario('fixture',{version:2}),(e)=>e.estado===404&&e.codigo==='escenario_no_encontrado');
    assert.equal(calls.length,1);
  });
  test('retirar ciencia oculta todos sus escenarios sin devolver datos parciales',async()=>{
    await retirarPublicacion(pool,{releaseId,actor,motivo:'Synthetic source withdrawal'});
    assert.equal((await get('/api/v1/scenarios/fixture?version=1')).status,404);
    assert.deepEqual(await (await get('/api/v1/scenarios')).json(),{escenarios:[]});
    await pool.query("INSERT INTO ciencia.fact_reviews(fact_record_id,decision,reviewer_ref) VALUES($1,'rejected','synthetic-human-fixture')",[fixtureId(4)]);
    await assert.rejects(change(1,'retired','Synthetic final withdrawal').then(()=>pool.query("UPDATE juego.scenarios SET publication_status='published' WHERE version=1")),/administrativa/);
  });
});
