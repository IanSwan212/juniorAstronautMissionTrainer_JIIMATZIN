import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarDesglose,cambioRecurso,costoCarta} from '../src/contenido/contenido.schema.js';
import {leerCsv} from '../src/contenido/contenido.importar.js';
import {presentarContenido} from '../src/contenido/contenido.view.js';
import {contratoEscenario} from '../src/escenarios/escenarios.contract.js';
import {validarEscenario} from '../../frontend/src/api/cargarEscenario.js';
import {contenidoPrueba} from '../test-support/contenido.js';
import {filaEscenario} from '../test-support/escenario.js';
import {presentarEscenario} from '../src/escenarios/escenarios.view.js';

test('valida el desglose y rechaza IDs duplicados, referencias huérfanas y metadatos desconocidos',()=>{
  assert.ok(validarDesglose(contenidoPrueba()));
  for(const mutate of [d=>d.personajes.push(d.personajes[0]),d=>d.soles[0].emergencia_sugerida='ausente',
    d=>d.minijuegos[0].dato='ausente',d=>d.finales[0].musica='ausente',d=>d.recursos[1].id='energia',d=>d.extra=true]) {
    const d=contenidoPrueba();mutate(d);assert.throws(()=>validarDesglose(d));
  }
});
test('normaliza expresiones permitidas sin ejecutar texto y conserva costes opcionales',()=>{
  assert.deepEqual(cambioRecurso('energia+1'),{recurso:'energia',cambio:1});
  assert.deepEqual(costoCarta('-1 blindaje'),{recurso:'blindaje',cambio:-1});assert.equal(costoCarta(null),null);
  for(const value of ['energia+99','energia=1','process.exit()','oxigeno--1'])assert.throws(()=>cambioRecurso(value));
  const d=contenidoPrueba();d.minijuegos[0].gana='oxigeno+1';assert.throws(()=>validarDesglose(d));
});
test('CSV admite BOM, comas, comillas y saltos internos, y rechaza filas malformadas',()=>{
  assert.deepEqual(leerCsv('\uFEFFid,texto\r\na,"línea, uno\n""dos"""\r\n'),[{id:'a',texto:'línea, uno\n"dos"'}]);
  for(const input of ['id,id\na,a','id,x\na','id,x\na,"sin cerrar','id,x\na,"hola"x'])assert.throws(()=>leerCsv(input));
});
test('el contrato y el adaptador aceptan el catálogo completo sin publicar resúmenes narrativos',()=>{
  const row=filaEscenario();row.gameplay={catalog_id:`cat_${'a'.repeat(64)}`,content_sha256:'a'.repeat(64),initial_resources:{energia:3,oxigeno:3,blindaje:3},document:contenidoPrueba(),
    bindings:[{narrative_id:'dato',record_id:row.facts[0].record_id,justification:'Referencia complementaria'}]};
  const response=presentarEscenario(row);contratoEscenario.parse(response);assert.equal(validarEscenario(response),response);
  const serialized=JSON.stringify(response);
  for(const privateText of ['RESUMEN SIN APROBAR','CONTEXTO PRIVADO','FUENTE NARRATIVA SIN REVISAR','AFIRMACION NARRATIVA SIN REVISAR'])assert.ok(!serialized.includes(privateText));
  assert.equal(response.gameplay.cartas_mejora[0].effectStatus,'design_pending');
  for(const mutate of [g=>g.personajes[0].jugable='yes',g=>g.initialResources.energia=0,g=>g.soles[0].emergencia_sugerida='ausente',
    g=>g.factBindings[0].recordId='9'.repeat(64),g=>g.datos_reales[0].resumen_verificado='sin aprobar',g=>g.minijuegos[0].gana='energia+1']) {
    const d=structuredClone(response);mutate(d.gameplay);assert.throws(()=>validarEscenario(d));
  }
});
