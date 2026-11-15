import { apiGet, obtenerJson, ErrorApi } from './cliente.js';

const hash=(s)=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const object=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const strings=(v)=>Array.isArray(v)&&v.every((s)=>typeof s==='string');
const phase=(v)=>[null,'morning','day','emergency','night'].includes(v);
const sol=(v)=>Number.isInteger(v)&&v>=1&&v<=10;
const time=(v)=>v===null||(typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v)));
const json=(v)=>v===null||typeof v==='string'||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))
  ||(Array.isArray(v)&&v.every(json))||(object(v)&&Object.values(v).every(json));

function condition(c) {
  if(!object(c)||!['observation','environment_hour','solar_event','radiation_sample'].includes(c.kind)||!hash(c.recordId)
    ||!['environment','reference'].includes(c.role)||!sol(c.gameSol)||!phase(c.gamePhase)||typeof c.justification!=='string'
    ||typeof c.context!=='string'||typeof c.dataset!=='string'||!['runtime','educational'].includes(c.usageTier)
    ||!['accepted','not_applicable'].includes(c.quality)||!strings(c.qualityReasons)||typeof c.variable!=='string'
    ||!(c.value===null||(typeof c.value==='number'&&Number.isFinite(c.value)))||!(c.unit===null||typeof c.unit==='string')
    ||!object(c.data)||!object(c.provenance)||!hash(c.provenance.processorId)
    ||!(c.provenance.selectionPolicyId===null||typeof c.provenance.selectionPolicyId==='string')
    ||!(c.provenance.lineageId===null||hash(c.provenance.lineageId))
    ||!Array.isArray(c.provenance.sourceRefs)||!c.provenance.sourceRefs.length
    ||!c.provenance.sourceRefs.every((r)=>object(r)&&typeof r.sourceFileId==='string'&&/^sha256:[0-9a-f]{64}$/.test(r.sourceFileId)&&object(r.locator)))return false;
  if(c.role==='environment'&&(!['observation','environment_hour'].includes(c.kind)||c.context!=='mars_historical_observation'||c.usageTier!=='runtime'))return false;
  if(c.kind==='environment_hour')return c.value===null&&c.unit===null&&c.variable==='environment_hour'&&['temperature','pressure'].every((key)=>{
    const d=c.data[key];return object(d)&&Number.isInteger(d.count)&&d.count>=0
      &&(d.count>0?[d.min,d.max,d.sample_mean].every(Number.isFinite):[d.min,d.max,d.sample_mean].every((v)=>v===null));
  });
  if(['observation','radiation_sample'].includes(c.kind))return typeof c.value==='number'&&Number.isFinite(c.value)
    &&c.value===c.data.value&&c.unit===c.data.unit&&c.variable===c.data.variable;
  return true;
}

/** Verifica identidad, revisiones y campos públicos; no calcula reglas físicas. */
export function validarEscenario(e, expected={}) {
  const ok=object(e)&&json(e)&&e.schemaVersion==='2'&&typeof e.scenarioId==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(e.scenarioId)
    &&typeof e.scenarioVersion==='string'&&/^[1-9][0-9]*$/.test(e.scenarioVersion)
    &&typeof e.title==='string'&&typeof e.language==='string'&&/^[a-z]{2}$/.test(e.language)
    &&typeof e.releaseId==='string'&&/^rel_[0-9a-f]{32}$/.test(e.releaseId)
    &&typeof e.datasetVersion==='string'&&typeof e.datasetSchemaVersion==='string'
    &&typeof e.rulesVersion==='string'&&object(e.rules)&&e.dataMode==='historical'
    &&object(e.sourceCoverage)&&time(e.sourceCoverage.start)&&time(e.sourceCoverage.end)&&time(e.retrievedAt)
    &&(e.marsCoverage===null||(object(e.marsCoverage)&&e.marsCoverage.timeBasis==='mars_lmst'
      &&Number.isInteger(e.marsCoverage.startSol)&&Number.isInteger(e.marsCoverage.endSol)
      &&e.marsCoverage.startSol>=0&&e.marsCoverage.endSol>=e.marsCoverage.startSol))
    &&Array.isArray(e.conditions)&&e.conditions.length>0&&e.conditions.length<=2000&&e.conditions.every(condition)
    &&strings(e.factIds)&&new Set(e.factIds).size===e.factIds.length&&Array.isArray(e.facts)&&e.facts.length<=100&&e.facts.length===e.factIds.length
    &&e.facts.every((f,i)=>object(f)&&f.id===e.factIds[i]&&hash(f.recordId)&&f.language===e.language
      &&typeof f.title==='string'&&typeof f.explanation==='string'&&typeof f.gameAdaptation==='string'
      &&strings(f.limitations)&&typeof f.sourceContext==='string'&&object(f.appearsAt)
      &&(f.appearsAt.gameSol===null||sol(f.appearsAt.gameSol))&&phase(f.appearsAt.gamePhase))
    &&strings(e.modelAssumptions)&&e.modelAssumptions.length<=100
    &&(expected.scenarioId===undefined||e.scenarioId===expected.scenarioId)
    &&(expected.version===undefined||e.scenarioVersion===String(expected.version))
    &&(expected.releaseId===undefined||e.releaseId===expected.releaseId);
  if(!ok)throw new ErrorApi('El escenario recibido no cumple el contrato o la versión solicitada',{codigo:'esquema_invalido'});
  return e;
}

function disponibleParaRespaldo(error) {
  return error instanceof ErrorApi&&(error.codigo==='error_red'||error.codigo==='respuesta_invalida'
    ||error.estado>=500||error.estado===429||(error.estado===404&&error.codigo==='error_http'));
}

/** Una respuesta 400/404 explícita de la API no se sustituye con contenido retirado. */
export async function cargarEscenario(id,{version,releaseId,timeoutMs,respaldoUrl}={}) {
  if(typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)||version!==undefined&&(!/^[1-9][0-9]*$/.test(String(version))||Number(version)>2147483647)
    ||releaseId!==undefined&&!/^rel_[0-9a-f]{32}$/.test(releaseId))throw new ErrorApi('Identidad de escenario inválida',{estado:400,codigo:'consulta_invalida'});
  const expected={scenarioId:id,version,releaseId};
  respaldoUrl??=version===undefined?`/escenarios/${id}.json`:`/escenarios/${id}/v${version}.json`;
  try {
    const data=await apiGet(`/scenarios/${encodeURIComponent(id)}`,{version},{timeoutMs});
    return {escenario:validarEscenario(data,expected),origen:'api'};
  } catch(errorApi) {
    if(!disponibleParaRespaldo(errorApi))throw errorApi;
    try {
      const backup=await obtenerJson(respaldoUrl,{timeoutMs});
      return {escenario:validarEscenario(backup,expected),origen:'respaldo-local',motivo:errorApi};
    } catch {throw errorApi;}
  }
}
