import { z } from 'zod';

export const identificador=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,95}$/);
export const catalogIdSchema=z.string().regex(/^cat_[0-9a-f]{64}$/);
const text=z.string().min(1).max(20000);
const texts=z.array(text).max(200);
const sol=z.number().int().min(1).max(10);
const dato=identificador.nullable();
const resource=z.enum(['energia','oxigeno','blindaje']);
export const recursosIniciales=z.strictObject({energia:z.number().int().min(1).max(3),
  oxigeno:z.number().int().min(1).max(3),blindaje:z.number().int().min(1).max(3)});
export const desgloseSchema=z.strictObject({
  version:text,
  recursos:z.array(z.strictObject({id:resource,niveles:z.strictObject({'0':text,'1':text,'2':text,'3':text})})).length(3),
  personajes:z.array(z.strictObject({id:identificador,nombre:text,rol:text,habilidades:texts,muletilla:text,expresiones:texts,jugable:z.boolean()})).min(1).max(100),
  soles:z.array(z.strictObject({sol,nudo_manana:text,nudo_dia:text,minijuego_sugerido:identificador.nullable(),
    emergencia_sugerida:identificador.nullable(),nudo_noche:text,en_modo_rapido:z.boolean(),nota:z.string().max(20000)})).length(10),
  minijuegos:z.array(z.strictObject({id:identificador,nombre:text,recurso:resource,nudos:texts,gana:text,falla:text,
    evento_real:text,dato,mecanica:text})).min(1).max(100),
  emergencias:z.array(z.strictObject({id:identificador,sol_sugerido:sol.nullable(),
    opciones:z.array(z.strictObject({opcion:text,costo:z.strictObject({recurso:resource,cambio:z.number().int().min(-3).max(-1)})})).min(1).max(20),
    nudo_dato:text.nullable(),dato})).max(100),
  cartas_mejora:z.array(z.strictObject({id:identificador,nombre:text,efecto_sugerido:text,dato,
    costo_sugerido:text.nullable().optional()})).max(100),
  finales:z.array(z.strictObject({id:identificador,nudo:text,condicion:text,musica:identificador,
    sfx:identificador.optional(),dato:dato.optional(),accion:z.enum(['creditos','reiniciar'])})).min(1).max(100),
  datos_reales:z.array(z.strictObject({id:identificador,lineas_de_la_escena:texts.nullable(),nudos_donde_aparece:texts,
    resumen_verificado:text,fuentes:texts,verificado:text})).max(1000),
  audio:z.strictObject({musica:z.record(identificador,text),sfx:z.record(identificador,text)}),
  variables_del_juego:z.record(identificador,text),
});

export function cambioRecurso(value) {
  const match=/^(energia|oxigeno|blindaje)([+-][1-3])$/.exec(value);
  if(!match)throw new Error(`Cambio de recurso inválido: ${value}`);
  return {recurso:match[1],cambio:Number(match[2])};
}
export function costoCarta(value) {
  if(value==null)return null;
  const match=/^(-[1-3]) (energia|oxigeno|blindaje)$/.exec(value);
  if(!match)throw new Error(`Costo sugerido inválido: ${value}`);
  return {recurso:match[2],cambio:Number(match[1])};
}

/** Comprueba identidad y relaciones antes de abrir una transacción de carga. */
export function validarDesglose(input) {
  const d=desgloseSchema.parse(input);
  const sets={};
  for(const name of ['recursos','personajes','soles','minijuegos','emergencias','cartas_mejora','finales','datos_reales']) {
    const ids=d[name].map(x=>x[name==='soles'?'sol':'id']);
    if(new Set(ids).size!==ids.length)throw new Error(`Identificador duplicado en ${name}`);
    sets[name]=new Set(ids);
  }
  if(!d.personajes.some(p=>p.jugable))throw new Error('Se requiere un personaje jugable');
  const ref=(table,id)=>{if(id!=null&&!sets[table].has(id))throw new Error(`Referencia inexistente: ${table}/${id}`);};
  for(const s of d.soles){ref('minijuegos',s.minijuego_sugerido);ref('emergencias',s.emergencia_sugerida);}
  for(const m of d.minijuegos){
    ref('recursos',m.recurso);ref('datos_reales',m.dato);
    for(const expression of [m.gana,m.falla])if(cambioRecurso(expression).recurso!==m.recurso)throw new Error(`Recurso incompatible en ${m.id}`);
    if(cambioRecurso(m.gana).cambio<=0||cambioRecurso(m.falla).cambio>=0)throw new Error(`Resultados incompatibles en ${m.id}`);
  }
  for(const e of d.emergencias){ref('datos_reales',e.dato);for(const o of e.opciones)ref('recursos',o.costo.recurso);}
  for(const c of d.cartas_mejora){ref('datos_reales',c.dato);const cost=costoCarta(c.costo_sugerido);if(cost)ref('recursos',cost.recurso);}
  for(const f of d.finales){
    ref('datos_reales',f.dato);
    if(!Object.hasOwn(d.audio.musica,f.musica))throw new Error(`Música inexistente en ${f.id}`);
    if(f.sfx&&!Object.hasOwn(d.audio.sfx,f.sfx))throw new Error(`SFX inexistente en ${f.id}`);
  }
  return d;
}

export const contenidoEscenarioSchema=z.strictObject({catalogId:catalogIdSchema,initialResources:recursosIniciales,
  factBindings:z.array(z.strictObject({narrativeId:identificador,recordId:z.string().regex(/^[0-9a-f]{64}$/),
    justification:z.string().trim().min(1).max(2000)})).max(1000).default([])});
