import { z } from 'zod';
import { desgloseSchema,catalogIdSchema,recursosIniciales,cambioRecurso,costoCarta } from './contenido.schema.js';

const delta=z.strictObject({recurso:z.enum(['energia','oxigeno','blindaje']),cambio:z.number().int().min(-3).max(3)});
export const gameplaySchema=z.strictObject({
  catalogId:catalogIdSchema,contentHash:z.string().regex(/^[0-9a-f]{64}$/),sourceVersion:z.string(),
  rulesStatus:z.literal('team_proposal'),initialResources:recursosIniciales,
  recursos:desgloseSchema.shape.recursos,personajes:desgloseSchema.shape.personajes,soles:desgloseSchema.shape.soles,
  minijuegos:z.array(desgloseSchema.shape.minijuegos.element.omit({evento_real:true,gana:true,falla:true}).extend({gana:delta,falla:delta})),
  emergencias:desgloseSchema.shape.emergencias,
  cartas_mejora:z.array(desgloseSchema.shape.cartas_mejora.element.extend({costo:delta.nullable(),effectStatus:z.literal('design_pending')})),
  finales:desgloseSchema.shape.finales,audio:desgloseSchema.shape.audio,variables_del_juego:desgloseSchema.shape.variables_del_juego,
  datos_reales:z.array(z.strictObject({id:z.string(),reviewStatus:z.literal('pending_human_review')})),
  factBindings:z.array(z.strictObject({narrativeId:z.string(),recordId:z.string().regex(/^[0-9a-f]{64}$/),
    factId:z.string(),relation:z.literal('supporting_reference'),justification:z.string()})),
});

/** Los resúmenes, diálogos y fuentes narrativos no heredan la aprobación científica. */
export function presentarContenido(content,facts) {
  const d=content.document;
  return gameplaySchema.parse({catalogId:content.catalog_id,contentHash:content.content_sha256,sourceVersion:d.version,
    rulesStatus:'team_proposal',initialResources:content.initial_resources,
    recursos:d.recursos,personajes:d.personajes,soles:d.soles,
    minijuegos:d.minijuegos.map(({evento_real,gana,falla,...m})=>({...m,gana:cambioRecurso(gana),falla:cambioRecurso(falla)})),
    emergencias:d.emergencias,
    cartas_mejora:d.cartas_mejora.map(c=>({...c,costo:costoCarta(c.costo_sugerido),effectStatus:'design_pending'})),
    finales:d.finales,audio:d.audio,variables_del_juego:d.variables_del_juego,
    datos_reales:d.datos_reales.map(x=>({id:x.id,reviewStatus:'pending_human_review'})),
    factBindings:content.bindings.map(b=>({narrativeId:b.narrative_id,recordId:b.record_id,
      factId:facts.find(f=>f.record_id===b.record_id).fact_key,relation:'supporting_reference',justification:b.justification})),
  });
}
