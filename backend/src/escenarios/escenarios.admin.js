import { z } from 'zod';
import { canonical } from '../importador/validacion.js';
import { crearRepositorioEscenarios } from './escenarios.repository.js';
import { presentarEscenario } from './escenarios.view.js';
import { contratoEscenario } from './escenarios.contract.js';

const id=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const version=z.number().int().min(1).max(2147483647);
const recordId=z.string().regex(/^[0-9a-f]{64}$/);
const phase=z.enum(['morning','day','emergency','night']).nullable().default(null);
const sol=z.number().int().min(1).max(10);
const actorSchema=z.string().trim().min(1).max(200);
export const definicionEscenario=z.strictObject({
  scenarioId:id,version,releaseId:z.string().regex(/^rel_[0-9a-f]{32}$/),
  rulesVersion:z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,95}$/),rules:z.record(z.string(),z.json()),
  language:z.string().regex(/^[a-z]{2}$/),title:z.string().trim().min(1).max(200),
  modelAssumptions:z.array(z.string().min(1)).max(100).default([]),
  conditions:z.array(z.strictObject({recordId,role:z.enum(['environment','reference']),gameSol:sol,gamePhase:phase,
    justification:z.string().trim().min(1).max(2000)})).min(1).max(2000),
  facts:z.array(z.strictObject({recordId,gameSol:sol.nullable().default(null),gamePhase:phase})).max(100),
});

async function transaccion(pool, fn) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('SELECT pg_advisory_xact_lock(728319,1)');
    await client.query(`LOCK TABLE ciencia.dataset_releases,ciencia.fact_reviews,
      juego.game_rule_sets,juego.scenarios,juego.scenario_records,juego.scenario_facts,juego.scenario_events
      IN SHARE ROW EXCLUSIVE MODE`);
    const result=await fn(client);await client.query('COMMIT');return result;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}

export async function crearBorradorEscenario(pool,input,actor) {
  const d=definicionEscenario.parse(input);actor=actorSchema.parse(actor);
  if(new Set(d.facts.map((f)=>f.recordId)).size!==d.facts.length) throw new Error('Ficha duplicada en la selección');
  return transaccion(pool,async(client)=>{
    await client.query(`INSERT INTO juego.game_rule_sets(rules_version,definition) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING`,
      [d.rulesVersion,JSON.stringify(d.rules)]);
    const {rows:[rule]}=await client.query('SELECT definition FROM juego.game_rule_sets WHERE rules_version=$1',[d.rulesVersion]);
    if(canonical(rule.definition)!==canonical(d.rules)) throw new Error('La versión de reglas ya existe con otra definición');
    const {rows:[existing]}=await client.query('SELECT * FROM juego.scenarios WHERE scenario_id=$1 AND version=$2',[d.scenarioId,d.version]);
    if(existing) {
      const {rows:records}=await client.query(`SELECT record_id AS "recordId",role,game_sol AS "gameSol",game_phase AS "gamePhase",justification
        FROM juego.scenario_records WHERE scenario_id=$1 AND scenario_version=$2 ORDER BY position`,[d.scenarioId,d.version]);
      const {rows:facts}=await client.query(`SELECT record_id AS "recordId",game_sol AS "gameSol",game_phase AS "gamePhase"
        FROM juego.scenario_facts WHERE scenario_id=$1 AND scenario_version=$2 ORDER BY position`,[d.scenarioId,d.version]);
      if(existing.publication_status!=='draft' || existing.release_id!==d.releaseId || existing.rules_version!==d.rulesVersion
        || existing.language!==d.language || existing.title!==d.title || canonical(existing.model_assumptions)!==canonical(d.modelAssumptions)
        || canonical(records)!==canonical(d.conditions) || canonical(facts)!==canonical(d.facts)) throw new Error('La versión de escenario ya existe con otro contenido o está publicada');
      return {scenarioId:d.scenarioId,version:d.version,status:'draft',created:false};
    }
    await client.query(`INSERT INTO juego.scenarios(scenario_id,version,release_id,rules_version,language,title,model_assumptions)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[d.scenarioId,d.version,d.releaseId,d.rulesVersion,d.language,d.title,JSON.stringify(d.modelAssumptions)]);
    for(const [position,r] of d.conditions.entries()) await client.query(`INSERT INTO juego.scenario_records
      (scenario_id,scenario_version,release_id,position,record_id,role,game_sol,game_phase,justification)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[d.scenarioId,d.version,d.releaseId,position,r.recordId,r.role,r.gameSol,r.gamePhase,r.justification]);
    for(const [position,f] of d.facts.entries()) await client.query(`INSERT INTO juego.scenario_facts
      (scenario_id,scenario_version,release_id,position,record_id,game_sol,game_phase) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [d.scenarioId,d.version,d.releaseId,position,f.recordId,f.gameSol,f.gamePhase]);
    await client.query(`INSERT INTO juego.scenario_events(scenario_id,scenario_version,action,actor_ref) VALUES($1,$2,'created',$3)`,[d.scenarioId,d.version,actor]);
    return {scenarioId:d.scenarioId,version:d.version,status:'draft',created:true};
  });
}

export async function cambiarPublicacionEscenario(pool,options) {
  const o=z.strictObject({scenarioId:id,version,actor:actorSchema,action:z.enum(['published','retired']),
    reason:z.string().trim().min(1).max(2000).optional()}).parse(options);
  if(o.action==='retired' && !o.reason) throw new Error('El retiro requiere motivo');
  return transaccion(pool,async(client)=>{
    const {rows:[event]}=await client.query(`INSERT INTO juego.scenario_events(scenario_id,scenario_version,action,actor_ref,reason)
      VALUES($1,$2,$3,$4,$5) RETURNING event_id`,[o.scenarioId,o.version,o.action,o.actor,o.reason??null]);
    if(o.action==='published') contratoEscenario.parse(presentarEscenario(
      await crearRepositorioEscenarios(client).buscarPublicado(o.scenarioId,o.version)));
    return {scenarioId:o.scenarioId,version:o.version,status:o.action,eventId:event.event_id};
  });
}
