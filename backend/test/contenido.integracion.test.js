import {describe,test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {contenidoPrueba} from '../test-support/contenido.js';
import {datosPrueba,crearPaquetePrueba,fixtureId} from '../test-support/paquete.js';
import {abrirPaquete} from '../src/importador/paquete.js';
import {importarPaquete} from '../src/importador/carga.js';
import {comprobarPublicacion} from '../src/publicaciones/publicaciones.model.js';
import {importarContenido,filasCatalogo} from '../src/contenido/contenido.importar.js';
import {crearBorradorEscenario,cambiarPublicacionEscenario} from '../src/escenarios/escenarios.admin.js';
import {exportarEscenario} from '../src/escenarios/escenarios.exportar.js';
import {validarEscenario} from '../../frontend/src/api/cargarEscenario.js';

process.env.DATABASE_URL??='postgresql://test:test@localhost:5432/test';process.env.NODE_ENV='test';
const {crearApp}=await import('../src/app.js');
describe('Catálogos del juego, relaciones y API de escenarios',{skip:!process.env.TEST_DATABASE_URL},()=>{
  let pool,fixture,paquete,catalog,definition,server,base,directory;
  const actor='test-editor',releaseId=`rel_${'1'.repeat(32)}`;
  const input=()=>({document:contenidoPrueba(),sourceSha256:'a'.repeat(64)});
  before(async()=>{
    const url=new URL(process.env.TEST_DATABASE_URL);assert.match(url.pathname,/^\/jiimatzin_test_[0-9a-f]{32}$/);
    pool=new pg.Pool({connectionString:url.href,max:4,connectionTimeoutMillis:5000});
    const migrations=new URL('../migrations/',import.meta.url);
    for(const name of (await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort())await pool.query((await readFile(new URL(name,migrations),'utf8')).split('-- Down Migration')[0]);
    const [up,down]=(await readFile(new URL('20261118000000_contenido-juego.sql',migrations),'utf8')).split('-- Down Migration');
    await pool.query(down);await pool.query(up);
    fixture=await crearPaquetePrueba(datosPrueba());paquete=await abrirPaquete(fixture.path,fixture.sha256);await importarPaquete(pool,paquete);
    directory=await mkdtemp(join(tmpdir(),'jiimatzin-content-'));
    server=crearApp({pool}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  });
  after(async()=>{
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await paquete?.cerrar();await fixture?.cerrar();if(directory)await rm(directory,{recursive:true,force:true});await pool?.end();
  });
  test('importación atómica, repetible y con nueva identidad aunque no cambie la etiqueta de versión',async()=>{
    catalog=await importarContenido(pool,input(),actor);assert.equal(catalog.created,true);assert.equal(catalog.counts.soles,10);
    assert.equal((await importarContenido(pool,input(),actor)).created,false);
    const other=input();other.document.personajes[0].nombre='Otra revisión';
    assert.notEqual((await importarContenido(pool,other,actor)).catalogId,catalog.catalogId);
    const bad=input();bad.document.soles[0].emergencia_sugerida='ausente';await assert.rejects(importarContenido(pool,bad,actor));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM juego.catalogos')).rows[0].n,2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.fact_reviews')).rows[0].n,0);
  });
  test('el catálogo sellado bloquea inserciones, modificaciones, borrados y TRUNCATE',async()=>{
    for(const table of Object.keys(filasCatalogo(contenidoPrueba()))) {
      await assert.rejects(pool.query(`DELETE FROM juego.${table} WHERE catalog_id=$1`,[catalog.catalogId]),/inmutable/);
      await assert.rejects(pool.query(`TRUNCATE juego.${table}`));
    }
    await assert.rejects(pool.query('UPDATE juego.catalogos SET sealed=false WHERE catalog_id=$1',[catalog.catalogId]),/inmutable/);
    await assert.rejects(pool.query(`INSERT INTO juego.personajes(catalog_id,id,nombre,rol,jugable,payload) VALUES($1,'intruso','X','X',true,'{}')`,[catalog.catalogId]),/inmutable/);
    await assert.rejects(pool.query(`UPDATE juego.minijuegos SET gana=2 WHERE catalog_id=$1`,[catalog.catalogId]),/inmutable/);
  });
  test('el escenario fija catálogo, recursos y vínculos explícitos; rechaza versiones y relaciones incompatibles',async()=>{
    definition={scenarioId:'content',version:1,releaseId,rulesVersion:'content-v1',rules:{mode:'educational'},language:'es',title:'Con catálogo',modelAssumptions:[],
      conditions:[{recordId:fixtureId(2),role:'environment',gameSol:1,gamePhase:null,justification:'Prueba'}],
      facts:[{recordId:fixtureId(4),gameSol:1,gamePhase:'night'}],
      gameplay:{catalogId:catalog.catalogId,initialResources:{energia:3,oxigeno:3,blindaje:3},factBindings:[{narrativeId:'dato',recordId:fixtureId(4),justification:'Referencia complementaria'}]}};
    assert.equal((await crearBorradorEscenario(pool,definition,actor)).created,true);
    assert.equal((await crearBorradorEscenario(pool,definition,actor)).created,false);
    const changed=structuredClone(definition);changed.gameplay.initialResources.energia=2;
    await assert.rejects(crearBorradorEscenario(pool,changed,actor),/otro catálogo/);
    for(const mutate of [d=>d.gameplay.catalogId=`cat_${'9'.repeat(64)}`,d=>d.gameplay.factBindings[0].narrativeId='ausente',
      d=>d.gameplay.factBindings[0].recordId=fixtureId(1),d=>d.gameplay.initialResources.energia=0,d=>d.language='en']) {
      const d=structuredClone(definition);d.scenarioId='invalid';mutate(d);await assert.rejects(crearBorradorEscenario(pool,d,actor));
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM juego.scenarios WHERE scenario_id='invalid'")).rows[0].n,0);
    }
    assert.equal((await fetch(base+'/api/v1/scenarios/content')).status,404);
  });
  test('API y respaldo entregan el contenido completo con referencias aprobadas y sin resúmenes narrativos pendientes',async()=>{
    await pool.query("INSERT INTO ciencia.fact_reviews(fact_record_id,decision,reviewer_ref) VALUES($1,'approved','synthetic-human-fixture')",[fixtureId(4)]);
    await comprobarPublicacion(pool,paquete,{releaseId,actor,publicar:true});
    await cambiarPublicacionEscenario(pool,{scenarioId:'content',version:1,actor,action:'published'});
    const response=await fetch(base+'/api/v1/scenarios/content?version=1');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const dto=validarEscenario(await response.json());assert.equal(dto.gameplay.catalogId,catalog.catalogId);
    assert.equal(dto.gameplay.soles.length,10);assert.equal(dto.gameplay.factBindings[0].factId,'fact_imported');
    assert.equal(dto.gameplay.cartas_mejora[0].effectStatus,'design_pending');
    for(const word of ['RESUMEN SIN APROBAR','CONTEXTO PRIVADO','AFIRMACION NARRATIVA SIN REVISAR','reviewer_ref','source_sha256'])assert.ok(!JSON.stringify(dto).includes(word));
    const exported=await exportarEscenario(pool,{scenarioId:'content',version:1,directory});
    assert.deepEqual(JSON.parse(await readFile(exported.versionedPath,'utf8')),dto);
  });
  test('publicación fija contenido y retiro oculta el escenario conservando sus catálogos',async()=>{
    for(const table of ['scenario_content','vinculos_datos'])await assert.rejects(pool.query(`DELETE FROM juego.${table} WHERE scenario_id='content'`),/inmutable/);
    await assert.rejects(pool.query((await readFile(new URL('../migrations/20261118000000_contenido-juego.sql',import.meta.url),'utf8')).split('-- Down Migration')[1]),/publicados/);
    await cambiarPublicacionEscenario(pool,{scenarioId:'content',version:1,actor,action:'retired',reason:'Prueba final'});
    assert.equal((await fetch(base+'/api/v1/scenarios/content')).status,404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM juego.catalogos WHERE sealed')).rows[0].n,2);
  });
});
