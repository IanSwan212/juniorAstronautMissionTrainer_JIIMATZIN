const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.length>0;
const texts=x=>Array.isArray(x)&&x.every(text);
const id=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9_-]{0,95}$/.test(x);
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const keys=(x,required,optional=[])=>object(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
const level=x=>Number.isInteger(x)&&x>=1&&x<=3;
const sol=x=>Number.isInteger(x)&&x>=1&&x<=10;
const resource=x=>['energia','oxigeno','blindaje'].includes(x);
const delta=x=>keys(x,['recurso','cambio'])&&resource(x.recurso)&&Number.isInteger(x.cambio)&&x.cambio!==0&&Math.abs(x.cambio)<=3;
const rows=(x,max,check,key='id')=>Array.isArray(x)&&x.length<=max&&x.every(check)&&new Set(x.map(v=>v[key])).size===x.length;

/** Valida también respaldos locales; no ejecuta expresiones ni textos del catálogo. */
export function validarGameplay(g,facts) {
  if(!keys(g,['catalogId','contentHash','sourceVersion','rulesStatus','initialResources','recursos','personajes','soles','minijuegos',
    'emergencias','cartas_mejora','finales','audio','variables_del_juego','datos_reales','factBindings'])
    ||g.catalogId!==`cat_${g.contentHash}`||!hash(g.contentHash)||!text(g.sourceVersion)||g.rulesStatus!=='team_proposal'
    ||!keys(g.initialResources,['energia','oxigeno','blindaje'])||!Object.values(g.initialResources).every(level))return false;
  if(!rows(g.recursos,3,r=>keys(r,['id','niveles'])&&resource(r.id)&&keys(r.niveles,['0','1','2','3'])&&Object.values(r.niveles).every(text))||g.recursos.length!==3)return false;
  if(!rows(g.personajes,100,p=>keys(p,['id','nombre','rol','habilidades','muletilla','expresiones','jugable'])&&id(p.id)&&text(p.nombre)&&text(p.rol)
    &&texts(p.habilidades)&&text(p.muletilla)&&texts(p.expresiones)&&typeof p.jugable==='boolean')||!g.personajes.some(p=>p.jugable))return false;
  if(!rows(g.datos_reales,1000,d=>keys(d,['id','reviewStatus'])&&id(d.id)&&d.reviewStatus==='pending_human_review'))return false;
  const dato=x=>x==null||g.datos_reales.some(d=>d.id===x);
  if(!rows(g.minijuegos,100,m=>keys(m,['id','nombre','recurso','nudos','gana','falla','dato','mecanica'])&&id(m.id)&&text(m.nombre)&&resource(m.recurso)
    &&texts(m.nudos)&&delta(m.gana)&&delta(m.falla)&&m.gana.cambio>0&&m.falla.cambio<0&&m.gana.recurso===m.recurso&&m.falla.recurso===m.recurso
    &&dato(m.dato)&&text(m.mecanica))||!g.minijuegos.length)return false;
  if(!rows(g.emergencias,100,e=>keys(e,['id','sol_sugerido','opciones','nudo_dato','dato'])&&id(e.id)&&(e.sol_sugerido===null||sol(e.sol_sugerido))
    &&Array.isArray(e.opciones)&&e.opciones.length>0&&e.opciones.length<=20&&e.opciones.every(o=>keys(o,['opcion','costo'])&&text(o.opcion)&&delta(o.costo)&&o.costo.cambio<0)
    &&(e.nudo_dato===null||text(e.nudo_dato))&&dato(e.dato)))return false;
  if(!rows(g.soles,10,s=>keys(s,['sol','nudo_manana','nudo_dia','minijuego_sugerido','emergencia_sugerida','nudo_noche','en_modo_rapido','nota'])
    &&sol(s.sol)&&text(s.nudo_manana)&&text(s.nudo_dia)&&text(s.nudo_noche)&&typeof s.en_modo_rapido==='boolean'&&typeof s.nota==='string'
    &&(s.minijuego_sugerido===null||g.minijuegos.some(m=>m.id===s.minijuego_sugerido))
    &&(s.emergencia_sugerida===null||g.emergencias.some(e=>e.id===s.emergencia_sugerida)),'sol')||g.soles.length!==10)return false;
  if(!rows(g.cartas_mejora,100,c=>keys(c,['id','nombre','efecto_sugerido','dato','costo','effectStatus'],['costo_sugerido'])&&id(c.id)&&text(c.nombre)&&text(c.efecto_sugerido)
    &&dato(c.dato)&&(c.costo===null||delta(c.costo)&&c.costo.cambio<0)&&c.effectStatus==='design_pending'&&(c.costo_sugerido==null||text(c.costo_sugerido))))return false;
  if(!keys(g.audio,['musica','sfx'])||!['musica','sfx'].every(k=>object(g.audio[k])&&Object.entries(g.audio[k]).every(([k,v])=>id(k)&&text(v))))return false;
  if(!rows(g.finales,100,f=>keys(f,['id','nudo','condicion','musica','accion'],['sfx','dato'])&&id(f.id)&&text(f.nudo)&&text(f.condicion)
    &&Object.hasOwn(g.audio.musica,f.musica)&&(!f.sfx||Object.hasOwn(g.audio.sfx,f.sfx))&&dato(f.dato)&&['creditos','reiniciar'].includes(f.accion))||!g.finales.length)return false;
  if(!object(g.variables_del_juego)||!Object.entries(g.variables_del_juego).every(([k,v])=>id(k)&&text(v)))return false;
  return Array.isArray(g.factBindings)&&g.factBindings.length<=1000&&g.factBindings.every(b=>keys(b,['narrativeId','recordId','factId','relation','justification'])
    &&g.datos_reales.some(d=>d.id===b.narrativeId)&&hash(b.recordId)&&facts.some(f=>f.id===b.factId&&f.recordId===b.recordId)
    &&b.relation==='supporting_reference'&&text(b.justification))
    &&new Set(g.factBindings.map(b=>b.narrativeId+':'+b.recordId)).size===g.factBindings.length;
}
