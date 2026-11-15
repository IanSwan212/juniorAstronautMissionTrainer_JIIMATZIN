export function contenidoPrueba() {
  return {version:'fixture-1',recursos:['energia','oxigeno','blindaje'].map(id=>({id,niveles:{0:'agotado',1:'bajo',2:'medio',3:'alto'}})),
    personajes:[{id:'piloto',nombre:'Piloto',rol:'Prueba',habilidades:[],muletilla:'Vamos',expresiones:['neutral'],jugable:true}],
    soles:Array.from({length:10},(_,i)=>({sol:i+1,nudo_manana:'manana',nudo_dia:'dia',nudo_noche:`noche_${i+1}`,
      minijuego_sugerido:'paneles',emergencia_sugerida:i===1?'polvo':null,en_modo_rapido:i%2===0,nota:''})),
    minijuegos:[{id:'paneles',nombre:'Paneles',recurso:'energia',nudos:['paneles'],gana:'energia+1',falla:'energia-1',
      evento_real:'AFIRMACION NARRATIVA SIN REVISAR',dato:'dato',mecanica:'Limpiar'}],
    emergencias:[{id:'polvo',sol_sugerido:2,opciones:[{opcion:'Cerrar',costo:{recurso:'energia',cambio:-1}}],nudo_dato:null,dato:null}],
    cartas_mejora:[{id:'paneles_plus',nombre:'Paneles Plus',efecto_sugerido:'Más energía',costo_sugerido:'-1 blindaje',dato:'dato'}],
    finales:[{id:'exito',nudo:'fin',condicion:'Terminar',musica:'exito',sfx:'celebracion',accion:'creditos'}],
    datos_reales:[{id:'dato',lineas_de_la_escena:['CONTEXTO PRIVADO'],nudos_donde_aparece:['paneles'],
      resumen_verificado:'RESUMEN SIN APROBAR',fuentes:['FUENTE NARRATIVA SIN REVISAR'],verificado:'fecha declarada'}],
    audio:{musica:{exito:'musica_exito'},sfx:{celebracion:'sfx_celebracion'}},variables_del_juego:{energia:'0-3',sol:'1-10'}};
}
