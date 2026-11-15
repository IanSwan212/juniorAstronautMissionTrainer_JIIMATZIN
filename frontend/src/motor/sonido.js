// Sonido del juego (entrega del rol 5, docs/entrega_rol5_LEEME.md): música por fase, efectos, ambiente real
// de Marte y voces de los diálogos. Si falta un archivo, sigue sin sonido (nunca detiene el juego).
// Volúmenes: música 40-50 %, voz 90 %, efectos por encima de la música.

import { cargas } from './cargas.js';

const VOL_MUSICA = 0.42;
const VOL_MUSICA_HABLANDO = 0.16;     // la música baja mientras alguien habla
const VOL_AMBIENTE = 0.22;

// Etiquetas de historia.ink -> clave de audio
const MUSICA = { inicio: 'musica_dia', dia: 'musica_dia', emergencia: 'musica_emergencia', noche: 'musica_noche',
  exito: 'musica_exito', fracaso: 'musica_fracaso' };
const SFX = { alarma: 'sfx_alarma', apagon: 'sfx_apagon', celebracion: 'sfx_celebracion', viento_marte: 'sfx_viento_marte_real_loop',
  remolino: 'sfx_remolino_corto', primer_audio: 'sfx_primer_audio_marte' };

export const sonido = {
  juego: null,
  musicaClave: null,
  musicaObj: null,
  ambienteObj: null,
  vozObj: null,
  silencio: false,

  iniciar(juego) {
    this.juego = juego;
    try { this.silencio = localStorage.getItem('silencio') === '1'; } catch { /* sin almacenamiento */ }
    juego.sound.mute = this.silencio;
  },

  alternarSilencio() {
    this.silencio = !this.silencio;
    this.juego.sound.mute = this.silencio;
    try { localStorage.setItem('silencio', this.silencio ? '1' : '0'); } catch { /* sin almacenamiento */ }
    return this.silencio;
  },

  existe(clave) { return !!this.juego?.cache.audio.exists(clave); },

  // Cambia la música con un fundido corto. nombre: etiqueta de Ink (dia, noche, emergencia, exito, fracaso, inicio)
  musica(nombre) {
    const clave = MUSICA[nombre] ?? nombre;
    if (!this.juego || clave === this.musicaClave) return;
    this.musicaPedida = clave;
    if (!this.existe(clave)) {                       // se baja al pedirla; si mientras tanto se pidió otra, no suena
      cargas.asegurar(`musica:${clave}`).then(() => { if (this.musicaPedida === clave) this.musica(clave); });
      return;
    }
    const sm = this.juego.sound;
    const vieja = this.musicaObj, claveVieja = this.musicaClave;
    if (vieja) {
      this.fundir(vieja, 0, 700, () => {
        vieja.destroy();
        // un tema decodificado ocupa decenas de MB: se libera, salvo el del día, que suena cada sol
        if (claveVieja && claveVieja !== 'musica_dia' && claveVieja !== this.musicaClave) cargas.liberar(`musica:${claveVieja}`);
      });
    }
    const bucle = clave !== 'musica_exito' && clave !== 'musica_fracaso';
    this.musicaObj = sm.add(clave, { loop: bucle, volume: 0 });
    this.musicaObj.play();
    this.musicaClave = clave;
    this.fundir(this.musicaObj, this.vozObj?.isPlaying ? VOL_MUSICA_HABLANDO : VOL_MUSICA, 900);
  },

  // Efecto suelto. clave: archivo (ui_clic_boton...) o etiqueta de Ink (alarma, apagon...)
  efecto(clave, volumen = 0.8) {
    const k = SFX[clave] ?? clave;
    if (!this.existe(k)) return null;
    return this.juego.sound.play(k, { volume: volumen }) || null;
  },

  // Viento real de Marte (Perseverance) de fondo en el mapa
  ambiente(encendido) {
    if (!this.existe('sfx_viento_marte_real_loop')) return;
    if (encendido && !this.ambienteObj) {
      this.ambienteObj = this.juego.sound.add('sfx_viento_marte_real_loop', { loop: true, volume: 0 });
      this.ambienteObj.play();
      this.fundir(this.ambienteObj, VOL_AMBIENTE, 1500);
    } else if (!encendido && this.ambienteObj) {
      const a = this.ambienteObj;
      this.ambienteObj = null;
      this.fundir(a, 0, 600, () => a.destroy());
    }
  },

  // Dice una línea con su voz. Carga el MP3 la primera vez. Devuelve una promesa que se cumple al terminar.
  decir(id, ruta) {
    this.callar();
    if (!id || !ruta || !this.juego) return Promise.resolve();
    const escena = this.juego.scene.getScenes(true).at(-1);
    return new Promise(resolver => {
      const sonar = () => {
        if (!this.existe(id)) { console.warn('sin voz:', id); resolver(); return; }
        const v = this.juego.sound.add(id, { volume: 0.9 });
        this.vozObj = v;
        if (this.musicaObj) this.fundir(this.musicaObj, VOL_MUSICA_HABLANDO, 250);
        v.once('complete', () => { this.alCallar(v); resolver(); });
        v.once('stop', () => { this.alCallar(v); resolver(); });
        v.play();
      };
      if (this.existe(id)) { sonar(); return; }
      escena.load.audio(id, ruta);
      escena.load.once(`filecomplete-audio-${id}`, sonar);
      escena.load.once('loaderror', f => { if (f.key === id) { console.warn('sin voz:', id); resolver(); } });
      escena.load.start();
    });
  },

  // Precarga las voces de una lista de ids (para que no haya espera al hablar)
  precargar(lista) {
    const escena = this.juego?.scene.getScenes(true).at(-1);
    if (!escena) return;
    let n = 0;
    for (const [id, ruta] of lista) if (!this.existe(id)) { escena.load.audio(id, ruta); n++; }
    if (n) escena.load.start();
  },

  callar() {
    if (this.vozObj) { const v = this.vozObj; this.vozObj = null; v.stop(); }
  },

  // Al terminar una línea, su voz se libera (cada voz decodificada ocupa 1 o 2 MB y casi nunca se repite)
  alCallar(v) {
    if (this.vozObj === v) this.vozObj = null;
    if (this.musicaObj && !this.vozObj) this.fundir(this.musicaObj, VOL_MUSICA, 500);
    const clave = v.key;
    setTimeout(() => { v.destroy(); this.juego.cache.audio.remove(clave); }, 0);
  },

  // Fundido de volumen sin depender de una escena concreta
  fundir(snd, destino, ms, alTerminar) {
    const inicio = snd.volume, t0 = performance.now();
    const paso = () => {
      if (!snd || snd.pendingRemove) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      try { snd.setVolume(inicio + (destino - inicio) * k); } catch { return; }
      if (k < 1) requestAnimationFrame(paso); else alTerminar?.();
    };
    requestAnimationFrame(paso);
  },
};
