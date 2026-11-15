import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { filaEscenario } from '../test-support/escenario.js';
import { presentarEscenario } from '../src/escenarios/escenarios.view.js';
import { validarEscenario,cargarEscenario } from '../../frontend/src/api/cargarEscenario.js';

const schema=z.fromJSONSchema(JSON.parse(await readFile(new URL('../../contrato/scenario.schema.json',import.meta.url),'utf8')));
const dto=()=>presentarEscenario(filaEscenario());
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('contrato público y adaptador coinciden; identidades, nulos y valores corruptos se rechazan',()=>{
  const valid=dto();schema.parse(valid);assert.equal(validarEscenario(valid,{scenarioId:'mars-demo',version:2}),valid);
  const mutations=[(e)=>e.schemaVersion='1',(e)=>e.scenarioId=2,(e)=>e.releaseId=[e.releaseId],(e)=>e.language=['es'],
    (e)=>e.conditions[1].data.temperature.sample_mean=0,(e)=>e.facts[0].recordId='wrong',
    (e)=>e.conditions[0].value=0,(e)=>e.conditions[0].provenance.sourceRefs[0].sourceFileId=['sha256:'+'b'.repeat(64)]];
  for(const mutate of mutations){const e=structuredClone(valid);mutate(e);assert.throws(()=>validarEscenario(e),(err)=>err.codigo==='esquema_invalido');}
  assert.throws(()=>validarEscenario(valid,{releaseId:'rel_'+'2'.repeat(32)}));
});
test('API con versión o identidad equivocada no se sustituye por un respaldo',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response({...dto(),scenarioVersion:'1'});});
  await assert.rejects(cargarEscenario('mars-demo',{version:2}),(e)=>e.codigo==='esquema_invalido');assert.equal(calls,1);
});
test('una caída de red no permite cargar un respaldo de otra versión',async(t)=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));
    if(calls.length===1)throw new TypeError('offline');return response({...dto(),scenarioVersion:'1'});});
  await assert.rejects(cargarEscenario('mars-demo',{version:2}));assert.equal(calls[1],'/escenarios/mars-demo/v2.json');
});
test('404/400 explícitos de la API no sirven contenido retirado del respaldo',async(t)=>{
  for(const status of [400,404]){
    let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return response({error:{codigo:status===404?'escenario_no_encontrado':'consulta_invalida'}},status);});
    await assert.rejects(cargarEscenario('mars-demo',{version:2}),(e)=>e.estado===status);assert.equal(calls,1);mock.mock.restore();
  }
});
test('servidor estático sin API puede usar alias y JSON inválido puede usar respaldo',async(t)=>{
  for(const status of [404,200]){
    const calls=[];const mock=t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));
      if(calls.length===1)return new Response(status===404?'<html>not found</html>':'{bad json',
        {status,headers:{'content-type':status===404?'text/html':'application/json'}});
      return response(dto());});
    const r=await cargarEscenario('mars-demo');assert.equal(r.origen,'respaldo-local');assert.equal(calls[1],'/escenarios/mars-demo.json');mock.mock.restore();
  }
});
test('entradas inválidas se rechazan antes de pedir datos',async(t)=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response(dto());});
  for(const [id,opts] of [['../escape',{}],[2,{}],['mars-demo',{version:0}],['mars-demo',{version:'1e2'}],['mars-demo',{releaseId:'bad'}]]){
    await assert.rejects(cargarEscenario(id,opts),(e)=>e.codigo==='consulta_invalida');
  }
  assert.equal(calls,0);
});
