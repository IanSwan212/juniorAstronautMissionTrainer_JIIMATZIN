// Narrador: corre historia/historia.json (Ink, del rol 5) con inkjs (lib/ink.js) y le pone a cada línea
// su voz (assets/audio/voces/audios.json), su retrato y su expresión. Lo usa la escena Dialogo.
// Etiquetas de Ink que entiende: hab, cara, musica, sfx, dato, costo, efecto, instruccion, titulo, carta, habilidades.

export const PERSONAS = {
  ia: { nombre: 'IA', color: 0x5ec8f2, retrato: null },
  wen: { nombre: 'Wenceslao', color: 0xf07a3a, retrato: 'retrato_wenceslao' },
  jud: { nombre: 'Judith', color: 0x7cf0a0, retrato: 'retrato_judith' },
  atl: { nombre: 'Atlas', color: 0xffc83d, retrato: 'retrato_atlas' },
};
export const ROL_DE = { wenceslao: 'wen', judith: 'jud', atlas: 'atl' };
export const NOMBRE_DE = { wenceslao: 'Wenceslao', judith: 'Judith', atlas: 'Atlas' };

// Para encontrar la voz de una línea: sin acentos ni signos, como pide 2_voz_dialogos/LEEME.md
const normalizar = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

export class Narrador {
  constructor(juego) {
    const json = juego.cache.json.get('historia');
    this.story = json && window.inkjs ? new window.inkjs.Story(json) : null;
    if (!this.story) console.warn('[historia] Falta historia/historia.json o lib/ink.js: los diálogos no saldrán.');
    this.voces = new Map();
    for (const [id, v] of Object.entries(juego.cache.json.get('voces') ?? {})) {
      this.voces.set(normalizar(v.texto.replaceAll('{jugador}', 'jugadorx')), [id, `assets/audio/voces/${v.ruta}`, v.escena]);
    }
    this.jugador = 'Astronauta';
  }

  // Variables que escribe el juego: jugador, rol, energia, oxigeno, blindaje, sol
  variables(valores) {
    if (!this.story) return;
    for (const [k, v] of Object.entries(valores)) {
      try { this.story.variablesState[k] = v; } catch (e) { console.warn('[historia] variable', k, e.message); }
    }
    if (valores.jugador) this.jugador = valores.jugador;
  }

  empezar(nudo) {
    if (!this.story) return false;
    try { this.story.ChoosePathString(nudo); return true; } catch (e) { console.warn('[historia] no existe el nudo', nudo); return false; }
  }

  // Siguiente paso del nudo: una línea, unas opciones o null al terminar
  paso() {
    const s = this.story;
    if (!s) return null;
    while (s.canContinue) {
      const texto = s.Continue().trim();
      const tags = this.leerTags(s.currentTags ?? []);
      if (!texto) { if (Object.keys(tags).length) return { tipo: 'tags', tags }; continue; }
      return this.linea(texto, tags);
    }
    if (s.currentChoices.length) return { tipo: 'opciones', opciones: s.currentChoices.map(c => c.text) };
    return null;
  }

  elegir(i) { this.story?.ChooseChoiceIndex(i); }

  leerTags(lista) {
    const t = {};
    for (const crudo of lista) {
      const tag = crudo.trim();
      const i = tag.indexOf(':');
      if (i < 0) t[tag] = true;
      else (t[tag.slice(0, i)] ??= []).push(tag.slice(i + 1).trim());
    }
    return t;
  }

  linea(texto, tags) {
    const quien = tags.hab?.[0] ?? null;
    let dicho = texto;
    if (quien && PERSONAS[quien]) {                       // "Wenceslao: Si algo se rompe..." -> quita el nombre
      const pref = `${PERSONAS[quien].nombre}:`;
      if (dicho.startsWith(pref)) dicho = dicho.slice(pref.length).trim();
    }
    const clave = normalizar(this.jugador ? dicho.replaceAll(this.jugador, 'jugadorx') : dicho);
    const voz = this.voces.get(clave) ?? null;
    return { tipo: 'linea', quien, texto: dicho, cara: tags.cara?.[0] ?? null, voz, tags };
  }

  // Lee un nudo entero sin mostrarlo (para las cartas de personaje: título, habilidades y texto)
  leerEntero(nudo) {
    if (!this.empezar(nudo)) return null;
    const res = { lineas: [], tags: {} };
    for (let p = this.paso(); p && p.tipo !== 'opciones'; p = this.paso()) {
      for (const [k, v] of Object.entries(p.tags ?? {})) res.tags[k] = v;
      if (p.tipo === 'linea') res.lineas.push(p.texto);
    }
    return res;
  }
}
