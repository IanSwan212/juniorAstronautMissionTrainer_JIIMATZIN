import { definicionEscenario } from '../escenarios/escenarios.admin.js';
import { catalogIdSchema,recursosIniciales } from './contenido.schema.js';

/** Prepara contenido editorial; crear/publicar siguen siendo operaciones separadas. */
export async function prepararEscenario(pool,{catalogId,releaseId,scenarioId,version=1,
  initialResources={energia:3,oxigeno:3,blindaje:3},factBindings=[]}) {
  catalogId=catalogIdSchema.parse(catalogId);initialResources=recursosIniciales.parse(initialResources);
  if(!/^rel_[0-9a-f]{32}$/.test(releaseId??''))throw new Error('Release inválido');
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows:[catalog]}=await client.query('SELECT source_version FROM juego.catalogos WHERE catalog_id=$1 AND sealed',[catalogId]);
    if(!catalog)throw new Error('Catálogo no encontrado');
    const {rows:hours}=await client.query(`SELECT h.record_id,h.mission_day,h.lmst_hour FROM ciencia.environment_hours h
      JOIN ciencia.release_members m USING(record_id) WHERE m.release_id=$1 ORDER BY h.mission_day,h.lmst_hour`,[releaseId]);
    if(hours.length!==240||new Set(hours.map(h=>`${h.mission_day}:${h.lmst_hour}`)).size!==240
      ||hours.some(h=>h.mission_day<1||h.mission_day>10||h.lmst_hour<0||h.lmst_hour>23))throw new Error('El escenario de diez soles requiere las 240 posiciones REMS');
    const {rows:facts}=await client.query(`SELECT f.record_id FROM ciencia.fact_cards f JOIN ciencia.release_members m USING(record_id)
      WHERE m.release_id=$1 AND f.language='es' ORDER BY f.fact_key`,[releaseId]);
    const definition=definicionEscenario.parse({scenarioId,version,releaseId,
      rulesVersion:`${scenarioId}-v${version}`,language:'es',title:'Base Marte Uno: misión de diez soles',
      rules:{mode:'educational',resources:{minimum:0,maximum:3,onZero:'restart'},calendar:'catalog_suggested',
        cardEffects:'design_pending',narrativeEngine:'inkjs',initialResourcesOrigin:'propuesta: tres niveles al inicio'},
      modelAssumptions:[
        'Los niveles y costes son reglas educativas del equipo, no magnitudes físicas.',
        'Se propone comenzar con energía, oxígeno y blindaje en nivel 3; los valores se fijan explícitamente en gameplay.initialResources.',
        'Los soles 10–19 de Curiosity se presentan como soles ficticios 1–10; las horas vacías conservan NULL.',
        'Se conserva el calendario sugerido del catálogo; los efectos de cartas descritos en texto no se calculan automáticamente.',
        'Las referencias científicas complementan las entradas narrativas; no aprueban sus textos originales ni convierten retirada de CO2 en producción de oxígeno.',
      ],
      conditions:hours.map(h=>({recordId:h.record_id,role:'environment',gameSol:h.mission_day,gamePhase:null,
        justification:`Perfil histórico REMS, hora LMST ${h.lmst_hour}; se conserva la cobertura original, incluidos huecos.`})),
      facts:facts.map(f=>({recordId:f.record_id,gameSol:null,gamePhase:null})),
      gameplay:{catalogId,initialResources,factBindings},
    });
    await client.query('COMMIT');return definition;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
