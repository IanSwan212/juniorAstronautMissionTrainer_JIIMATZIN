// Ciclo de juego (rol 2) sobre el mapa: une el estado, la historia (Ink + voces) y los minijuegos.
// Un sol, como en el prototipo de minijuegos (SolLoopScene) pero caminando por la base:
//   MAÑANA  -> nudo "manana" -> ir a la consola de Mando y repartir la energía
//   DÍA     -> nudo "dia" -> las 3 tareas en sus salas: paneles (Energía), filtro (Soporte vital), riego (Invernadero)
//              cada una: nudo mini_* (con el consejo del rol) -> minijuego -> nudo *_gana o *_falla
//   EMERGENCIA (la de cada sol, data/base_de_datos_juego.json) -> decisión con cuenta atrás y costo
//   NOCHE   -> consumo de energía -> ir a dormir al Refugio -> nudo noche_N -> carta de mejora -> siguiente sol
//   FIN     -> nudo fin_exito / fin_energia / fin_oxigeno / fin_blindaje -> reporte final -> volver a elegir
import { bus, EV, control } from '../motor/eventos.js';
import { sonido } from '../motor/sonido.js';
import { GameState } from './estado.js';
import { Narrador, ROL_DE, NOMBRE_DE } from './narrador.js';
import { datosReales } from './datosReales.js';

// Emergencia de cada sol (6_base_de_datos/soles.csv). Sol 1: tutorial sin emergencia; sol 10: a elección (una al azar)
const EMERGENCIA_DEL_SOL = [null, null, 'emergencia_calor', 'emergencia_fuga', 'emergencia_co2', 'emergencia_radiacion',
  'emergencia_polvo', 'emergencia_impacto', 'emergencia_comunicacion', 'emergencia_solar', '*'];
const TODAS = ['emergencia_solar', 'emergencia_polvo', 'emergencia_co2', 'emergencia_radiacion', 'emergencia_calor',
  'emergencia_fuga', 'emergencia_impacto', 'emergencia_comunicacion'];
const PUNTOS_POR_NIVEL = 20;          // un "nivel" de la historia (costo:energia-1) son 20 puntos de 100

// Estación del mapa -> minijuego
const TAREAS = {
  tarea_paneles: { clave: 'paneles', escena: 'PanelCleaningScene', nudo: 'mini_paneles' },
  tarea_filtro: { clave: 'co2', escena: 'CO2FilterScene', nudo: 'mini_filtro' },
  tarea_invernadero: { clave: 'invernadero', escena: 'GreenhouseScene', nudo: 'mini_riego' },
};
const ORDEN_TAREAS = ['tarea_paneles', 'tarea_filtro', 'tarea_invernadero'];

export const ciclo = {
  juego: null,
  narrador: null,
  enPartida: false,
  cola: Promise.resolve(),

  iniciar(juego) {
    this.juego = juego;
    bus.on(EV.INTERACTUAR, d => this.alInteractuar(d));
    // el último estado queda en el registro: el mapa y la interfaz lo leen al cambiar de sala
    bus.on(EV.ESTADO_CAMBIO, e => juego.registry.set('estado', e));
    datosReales.cargar();          // escenario con datos reales de la API del equipo (o su respaldo); no detiene nada
    datosReales.cargarSol();       // llamaradas reales de los últimos días (DONKI en vivo, por la API del equipo)
    window.addEventListener('keydown', ev => { if (ev.key === 'm' || ev.key === 'M') sonido.alternarSilencio(); });
  },

  // Se llama al terminar de cargar (Arranque): la historia y las voces ya están en caché
  prepararHistoria() {
    if (!this.narrador) this.narrador = new Narrador(this.juego);
  },

  // Abre una pantalla encima de todo (diálogo, consola o minijuego) sin parar el mapa
  abrir(clave, datos) {
    const sm = this.juego.scene;
    sm.start(clave, datos);
    sm.bringToTop(clave);
  },

  // Cuenta un nudo de la historia con la escena Dialogo. Devuelve una promesa con las etiquetas recogidas.
  narrar(nudo, opciones = {}) {
    const tarea = this.cola.then(() => new Promise(resolver => {
      this.prepararHistoria();
      this.narrador.variables({
        energia: GameState.nivel('energia'), oxigeno: GameState.nivel('oxigeno'), blindaje: GameState.nivel('blindaje'),
        sol: Math.min(GameState.sol, GameState.maxSoles),
      });
      this.abrir('Dialogo', { nudo, narrador: this.narrador, ...opciones, alTerminar: resolver });
    })).then(async tags => {
      // # dato:<id> de la historia: si el escenario lo vincula a una ficha aprobada, la IA la cuenta (Dato real)
      const fichas = [...new Set(tags.dato ?? [])].map(d => datosReales.fichaDeDato(d)).filter(Boolean);
      if (fichas.length) await this.mostrarLineas(fichas.flatMap(f => datosReales.lineasFicha(f)));
      return tags;
    });
    this.cola = tarea.catch(() => {});
    return tarea;
  },

  // Abre el diálogo con líneas sueltas sin pasar por la cola (para usar dentro de otra narración)
  mostrarLineas(lineas) {
    return new Promise(resolver => this.abrir('Dialogo', { lineas, alTerminar: resolver }));
  },

  // Fichas «Dato real» que el escenario coloca en este sol y fase
  async fichasDeFase(fase) {
    const fichas = datosReales.fichasDe(Math.min(GameState.sol, GameState.maxSoles), fase);
    if (fichas.length) await this.decir(fichas.flatMap(f => datosReales.lineasFicha(f)));
  },

  // Líneas sueltas sin Ink (avisos de la IA del mapa)
  decir(lineas) {
    const tarea = this.cola.then(() => new Promise(resolver => {
      this.abrir('Dialogo', { lineas: lineas.map(t => (typeof t === 'string' ? { quien: 'ia', texto: t } : t)), alTerminar: resolver });
    }));
    this.cola = tarea.catch(() => {});
    return tarea;
  },

  soltar() {                         // devuelve el control al jugador en el mapa
    control.modal = false;
    bus.emit(EV.CERRAR_PANEL);
  },

  objetivo(nombre) { this.juego.registry.set('objetivo', nombre); bus.emit(EV.OBJETIVO, nombre); },

  // --- Partida ---
  async nuevaPartida(escena, personaje, dificultad) {
    this.prepararHistoria();
    GameState.iniciarPartida(personaje, dificultad);
    this.narrador.variables({ jugador: NOMBRE_DE[personaje], rol: ROL_DE[personaje] });
    this.juego.registry.set('personaje', personaje);
    this.juego.registry.set('zona', 'pasillo');
    this.enPartida = true;
    escena.scene.start('Base');
    escena.scene.launch('Interfaz');
    await new Promise(r => setTimeout(r, 400));
    GameState.publicar();
    sonido.ambiente(true);
    await this.narrar('introduccion');
    await this.manana();
  },

  async manana() {
    GameState.fase = 'MAÑANA';
    GameState.publicar();
    sonido.musica('dia');
    sonido.efecto('sfx_puerta_presurizada', 0.6);
    await this.narrar('manana');
    const clima = datosReales.lineaClima(GameState.sol);          // medición real de Marte para este sol
    if (clima) await this.decir([{ quien: 'ia', cara: 'feliz', texto: clima }]);
    await this.fichasDeFase('manana');
    this.objetivo('consola');
    this.soltar();
  },

  siguienteTarea() { return ORDEN_TAREAS.find(n => !GameState.minijuegosHoy[TAREAS[n].clave]) ?? null; },

  // --- Lo que pasa al usar cada estación, según la fase ---
  async alInteractuar(d) {
    if (!this.enPartida) return;
    const fase = GameState.fase;
    const tarea = TAREAS[d.nombre];
    if (d.nombre === 'consola') {
      if (fase === 'MAÑANA') return this.abrirConsola();
      return this.avisar('La energía de hoy ya está repartida. La consola vuelve a abrirse mañana.');
    }
    if (tarea) {
      if (fase === 'MAÑANA') return this.avisar('Primero reparte la energía en la consola de Mando.');
      if (fase !== 'DIA') return this.avisar('Ahora no hay luz solar para trabajar aquí.');
      if (GameState.minijuegosHoy[tarea.clave]) return this.avisar('Esta tarea ya está hecha hoy. ¡Buen trabajo!');
      return this.jugarTarea(d.nombre);
    }
    if (d.nombre === 'refugio') {
      if (fase === 'NOCHE') return this.dormir();
      return this.avisar('El refugio tiene muros de agua contra la radiación. Aquí dormimos al caer la noche.');
    }
    if (d.nombre === 'antena') {                     // la antena trae las noticias reales del Sol (DONKI)
      await datosReales.cargarSol();
      await this.decir([...(datosReales.lineasSol() ?? []),
        'La antena habla con la Tierra. Cada mensaje tarda entre 4 y 24 minutos en llegar, según dónde estén los dos planetas.']);
      return this.soltar();
    }
    this.soltar();
  },

  async avisar(texto) {
    await this.decir([texto]);
    this.soltar();
  },

  abrirConsola() {
    control.modal = true;
    this.abrir('Consola', { modo: 'MAÑANA', alTerminar: () => this.empezarDia() });
  },

  async empezarDia() {
    GameState.fase = 'DIA';
    GameState.publicar();
    await this.narrar('dia');
    await this.fichasDeFase('dia');
    this.objetivo(this.siguienteTarea());
    this.soltar();
  },

  async jugarTarea(nombre) {
    const t = TAREAS[nombre];
    await this.narrar(t.nudo);
    control.modal = true;
    this.juego.registry.set('narrado', true);
    const resultado = await new Promise(resolver => {
      bus.once('minijuego-fin', resolver);
      this.abrir(t.escena);
    });
    GameState.publicar();
    await this.narrar(`${t.nudo}_${resultado.success ? 'gana' : 'falla'}`);
    if (this.revisarFin()) return;
    const siguiente = this.siguienteTarea();
    if (siguiente) { this.objetivo(siguiente); this.soltar(); return; }
    await this.emergencia();
  },

  async emergencia() {
    let nudo = EMERGENCIA_DEL_SOL[GameState.sol];
    if (nudo === '*') nudo = Phaser.Utils.Array.GetRandom(TODAS);
    if (nudo) {
      GameState.fase = 'EMERGENCIA';
      GameState.publicar();
      this.objetivo(null);
      sonido.efecto('ui_aviso_emergencia', 0.8);
      const tags = await this.narrar(nudo, { cuentaAtras: GameState.getParametrosDificultad().tiempoEmergencia });
      if (nudo === 'emergencia_solar' && datosReales.lineasSol()) await this.decir(datosReales.lineasSol());   // y lo real de esta semana
      await this.fichasDeFase('emergencia');
      for (const c of tags.costo ?? []) {              // costo:energia-1 -> -20 de energía
        const m = /^(energia|oxigeno|blindaje)([+-]\d+)$/.exec(c);
        if (m) GameState.modificarRecurso(m[1], Number(m[2]) * PUNTOS_POR_NIVEL);
      }
      GameState.publicar();
      if (this.revisarFin()) return;
    }
    await this.noche();
  },

  async noche() {
    GameState.fase = 'NOCHE';
    let consumo = GameState.getParametrosDificultad().consumoNocturno;
    if (GameState.mejoras.codigoHamilton) consumo = Math.max(4, Math.floor(consumo * 0.6));
    GameState.modificarRecurso('energia', -consumo);
    GameState.publicar();
    sonido.musica('noche');
    if (this.revisarFin()) return;
    await this.decir([`Cae la noche. Los sistemas gastan ${consumo} de energía. Ve al Refugio a descansar con el equipo.`]);
    this.objetivo('refugio');
    this.soltar();
  },

  async dormir() {
    this.objetivo(null);
    await this.narrar(`noche_${Math.min(GameState.sol, 10)}`);
    await this.fichasDeFase('noche');
    control.modal = true;
    await new Promise(resolver => this.abrir('Consola', { modo: 'MEJORA', alTerminar: resolver }));
    GameState.sol++;
    if (this.revisarFin()) return;
    GameState.prepararNuevoSol();
    await this.manana();
  },

  // ¿Se acabó la misión? Cuenta el final y muestra el reporte
  revisarFin() {
    const fin = GameState.verificarFinJuego();
    if (!fin.terminado) return false;
    this.final(fin.motivo);
    return true;
  },

  async final(motivo) {
    GameState.fase = 'FIN';
    this.objetivo(null);
    sonido.ambiente(false);
    const nudo = { VICTORIA: 'fin_exito', ENERGIA: 'fin_energia', OXIGENO: 'fin_oxigeno', BLINDAJE: 'fin_blindaje' }[motivo];
    await this.narrar(nudo);
    control.modal = true;
    await new Promise(resolver => this.abrir('Consola', { modo: 'FINAL', motivo, alTerminar: resolver }));
    this.enPartida = false;
    control.modal = false;
    control.bloqueado = false;
    for (const k of ['Base', 'Interfaz']) this.juego.scene.stop(k);
    this.juego.scene.start('Seleccion');
  },
};
