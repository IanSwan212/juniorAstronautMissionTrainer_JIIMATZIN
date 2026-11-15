// Diálogos de la historia (Ink) encima de todo: retrato, nombre, texto que se escribe solo y la voz de cada línea.
// Se abre con ciclo.narrar(nudo) o con escena.scene.launch('Dialogo', { nudo | lineas, alTerminar, ... }).
// Tocar, clic, E, Espacio o Enter: termina de escribir la línea o pasa a la siguiente. "Saltar" salta el nudo
// (salvo las decisiones, que siempre se eligen). Las decisiones de emergencia tienen cuenta atrás.
import { bus, EV, control } from '../motor/eventos.js';
import { sonido } from '../motor/sonido.js';
import { PERSONAS } from '../mecanicas/narrador.js';

const FUENTE = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const TINTA = 0x141026, PANEL = 0x1d1840, LUZ = '#f1ecff';
const CARA_IA = { neutral: 0, feliz: 1, procesando: 2 };

export default class Dialogo extends Phaser.Scene {
  constructor() { super('Dialogo'); }

  init(datos) {
    this.datos = datos ?? {};
    this.narrador = datos.narrador ?? null;
    this.lineasSueltas = datos.lineas ? [...datos.lineas] : null;    // líneas sin Ink: [{ quien, texto }]
    this.tagsJuntadas = {};
    this.terminado = false;
    // la escena se reutiliza en cada diálogo: lo creado a demanda en el anterior ya no existe
    this.etiqueta = null;
    this.modoNarracion = false;
    this.colorActual = null;
    this.botones = null;
  }

  create() {
    control.bloqueado = true;
    control.modal = true;
    const { width: w, height: h } = this.scale;
    this.velo = this.add.rectangle(0, 0, w, h, 0x07051a, this.datos.fondo ? 0.92 : 0.35).setOrigin(0);
    this.panel = this.add.graphics();
    this.retrato = this.add.image(0, 0, '__DEFAULT').setOrigin(0.5, 1).setVisible(false);
    this.robot = this.add.sprite(0, 0, 'robot_ia', 0).setOrigin(0.5, 1).setVisible(false);
    this.nombre = this.add.text(0, 0, '', { fontFamily: FUENTE, fontSize: '18px', fontStyle: 'bold', color: '#141026' }).setOrigin(0, 0.5);
    this.texto = this.add.text(0, 0, '', { fontFamily: FUENTE, fontSize: '19px', color: LUZ, lineSpacing: 6 });
    this.titulo = this.add.text(0, 0, '', { fontFamily: FUENTE, fontSize: '34px', fontStyle: 'bold', color: '#ffe3b0', align: 'center' })
      .setOrigin(0.5).setAlpha(0);
    this.sigue = this.add.text(0, 0, '▶', { fontFamily: FUENTE, fontSize: '18px', color: '#ffc83d' }).setOrigin(1, 1);
    this.tweens.add({ targets: this.sigue, alpha: 0.25, duration: 520, yoyo: true, repeat: -1 });
    this.saltar = this.add.text(0, 0, 'Saltar ⏭', { fontFamily: FUENTE, fontSize: '16px', color: '#cfc6ff', backgroundColor: '#2a2358',
      padding: { x: 12, y: 8 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.saltar.on('pointerup', e => { e?.event?.stopPropagation?.(); this.saltarNudo(); });
    this.botones = [];
    this.reloj = this.add.text(0, 0, '', { fontFamily: FUENTE, fontSize: '22px', fontStyle: 'bold', color: '#ffc83d' }).setOrigin(0.5);

    this.input.on('pointerup', (p, sobre) => { if (!sobre.length) this.avanzar(); });
    const teclas = this.input.keyboard.addKeys('E,SPACE,ENTER');
    for (const k of Object.values(teclas)) k.on('down', () => this.avanzar());
    const alRedim = () => this.colocar();
    this.scale.on('resize', alRedim);
    this.events.once('shutdown', () => this.scale.off('resize', alRedim));

    if (this.datos.nudo && !(this.narrador?.empezar(this.datos.nudo))) { this.cerrar(); return; }
    this.colocar();
    this.siguiente();
  }

  // --- Composición: panel abajo, retrato a la izquierda asomando por encima ---
  colocar() {
    const { width: w, height: h } = this.scale;
    const e = Phaser.Math.Clamp(Math.min(w / 900, h / 640), 0.62, 1.25);
    this.e = e;
    this.velo.setSize(w, h);
    const ancho = Math.min(w - 24, 920 * e), alto = 150 * e;
    const x0 = (w - ancho) / 2, y0 = h - alto - 14 * e;
    this.caja = { x0, y0, ancho, alto };
    const g = this.panel.clear();
    if (this.modoNarracion) {
      g.fillStyle(0x000000, 0.55).fillRect(0, h * 0.62, w, h * 0.38);
    } else {
      g.fillStyle(TINTA, 1).fillRoundedRect(x0 - 4, y0 - 4, ancho + 8, alto + 8, 18);
      g.fillStyle(PANEL, 1).fillRoundedRect(x0, y0, ancho, alto, 14);
      g.lineStyle(2, this.colorActual ?? 0xb0acf4, 0.9).strokeRoundedRect(x0 + 6, y0 + 6, ancho - 12, alto - 12, 10);
    }
    const conRetrato = this.retrato.visible || this.robot.visible;
    const izq = conRetrato && !this.modoNarracion ? Math.min(210 * e, ancho * 0.3) : 26 * e;
    const tam = Math.max(16, Math.round(19 * e));
    this.texto.setFontSize(tam).setWordWrapWidth(ancho - izq - 40 * e);
    if (this.modoNarracion) {
      this.texto.setOrigin(0.5, 0).setAlign('center').setWordWrapWidth(Math.min(w - 40, 760 * e)).setPosition(w / 2, h * 0.66);
    } else {
      this.texto.setOrigin(0, 0).setAlign('left').setPosition(x0 + izq, y0 + 44 * e);
    }
    this.nombre.setFontSize(Math.max(16, Math.round(17 * e))).setPosition(x0 + izq + 12 * e, y0 + 4 * e);
    this.dibujarEtiqueta();
    // el retrato asoma por encima del panel, sin pisar el nombre ni el texto
    const lado = Math.min(h * 0.4, izq + 26 * e);
    if (this.retrato.visible) {
      this.retrato.setDisplaySize(lado, lado).setPosition(x0 + lado / 2 - 10 * e, y0 + alto - 8 * e);
    }
    this.robot.setScale(1.5 * e).setPosition(x0 + izq / 2, y0 + alto * 0.72);
    this.sigue.setPosition(x0 + ancho - 18 * e, y0 + alto - 12 * e).setFontSize(Math.round(18 * e));
    // "Saltar", encima del panel a la derecha (arriba quedan el tablero y el sol de la interfaz)
    if (this.modoNarracion) this.saltar.setOrigin(1, 0).setPosition(w - 12, 12);
    else this.saltar.setOrigin(1, 1).setPosition(x0 + ancho, y0 - 10 * e);
    this.saltar.setFontSize(Math.max(16, Math.round(16 * e)));
    this.titulo.setPosition(w / 2, h * (this.modoNarracion ? 0.36 : 0.2)).setFontSize(Math.round(38 * e));
    this.reloj.setPosition(w / 2, (this.botones.length ? this.botones[0].y - 46 * e : h / 2)).setFontSize(Math.round(22 * e));
    this.colocarBotones();
  }

  dibujarEtiqueta() {
    if (!this.etiqueta) this.etiqueta = this.add.graphics().setDepth(2);
    this.etiqueta.clear();
    this.nombre.setDepth(3);
    if (!this.nombre.text || this.modoNarracion) return;
    const b = this.nombre.getBounds();
    this.etiqueta.fillStyle(TINTA, 1).fillRoundedRect(b.x - 12, b.y - 6, b.width + 24, b.height + 12, 10);
    this.etiqueta.fillStyle(this.colorActual ?? 0xb0acf4, 1).fillRoundedRect(b.x - 9, b.y - 3, b.width + 18, b.height + 6, 8);
    this.children.bringToTop(this.nombre);
  }

  // --- Avance ---
  siguiente() {
    if (this.terminado) return;
    const p = this.lineasSueltas ? this.lineaSuelta() : this.narrador?.paso();
    if (!p) { this.cerrar(); return; }
    if (p.tipo === 'tags') { this.aplicarTags(p.tags); this.siguiente(); return; }
    if (p.tipo === 'opciones') { this.mostrarOpciones(p.opciones); return; }
    this.aplicarTags(p.tags ?? {});
    if (p.tags?.titulo) this.mostrarTitulo(p.tags.titulo[0]);
    this.mostrarLinea(p);
  }

  lineaSuelta() {
    const l = this.lineasSueltas.shift();
    return l ? { tipo: 'linea', quien: l.quien ?? 'ia', texto: l.texto, cara: l.cara ?? null, voz: null, tags: {} } : null;
  }

  mostrarLinea(p) {
    const persona = p.quien ? PERSONAS[p.quien] : null;
    this.modoNarracion = !persona;
    this.colorActual = persona?.color ?? 0xb0acf4;
    this.nombre.setText(persona ? persona.nombre.toUpperCase() : '');
    this.retrato.setVisible(false);
    this.robot.setVisible(false);
    if (persona?.retrato && this.textures.exists(persona.retrato)) this.retrato.setTexture(persona.retrato).setVisible(true);
    else if (p.quien === 'ia') this.robot.setFrame(CARA_IA[p.cara] ?? 0).setVisible(true);
    this.colocar();
    // aparece el retrato con un saltito
    for (const r of [this.retrato, this.robot]) {
      if (!r.visible) continue;
      const y = r.y;
      r.setY(y + 14).setAlpha(0.4);
      this.tweens.add({ targets: r, y, alpha: 1, duration: 200, ease: 'Back.out' });
    }
    // texto que se escribe solo (unas 45 letras por segundo)
    this.completo = p.texto;
    this.escribiendo = true;
    this.texto.setText('');
    let n = 0;
    this.tEscribir?.remove();
    this.tEscribir = this.time.addEvent({ delay: 22, loop: true, callback: () => {
      n += 1;
      this.texto.setText(this.completo.slice(0, n));
      if (n >= this.completo.length) { this.escribiendo = false; this.tEscribir.remove(); }
    } });
    this.sigue.setVisible(true);
    sonido.decir(p.voz?.[0], p.voz?.[1]);
    window.__robot?.ocultarBurbuja?.();          // la burbuja del robot no se encima con el diálogo
  }

  avanzar() {
    if (this.terminado || !this.botones || this.botones.length) return;
    if (this.escribiendo) { this.tEscribir?.remove(); this.escribiendo = false; this.texto.setText(this.completo); return; }
    sonido.callar();
    this.siguiente();
  }

  saltarNudo() {
    if (!this.botones || this.botones.length) return;   // una decisión no se salta (ni antes de abrirse)
    sonido.callar();
    this.tEscribir?.remove();
    for (let i = 0; i < 400; i++) {                  // recoge las etiquetas (costos, datos) hasta una decisión o el final
      const p = this.lineasSueltas ? this.lineaSuelta() : this.narrador?.paso();
      if (!p) { this.cerrar(); return; }
      if (p.tipo === 'opciones') { this.mostrarOpciones(p.opciones); return; }
      this.aplicarTags(p.tags ?? {}, true);
    }
    this.cerrar();
  }

  mostrarTitulo(t) {
    this.titulo.setText(t).setAlpha(0).setScale(1.15);
    this.tweens.add({ targets: this.titulo, alpha: 1, scale: 1, duration: 500, ease: 'Back.out' });
    this.tweens.add({ targets: this.titulo, alpha: 0, delay: 2600, duration: 700 });
  }

  // --- Decisiones (emergencias): botones grandes, con cuenta atrás si se pide ---
  mostrarOpciones(opciones) {
    this.sigue.setVisible(false);
    const { width: w } = this.scale;
    this.botones = opciones.map((t, i) => {
      const c = this.add.container(w / 2, 0);
      const fondo = this.add.rectangle(0, 0, 10, 10, 0x2a2358).setStrokeStyle(3, 0xffc83d).setInteractive({ useHandCursor: true });
      const txt = this.add.text(0, 0, t, { fontFamily: FUENTE, fontSize: '18px', fontStyle: 'bold', color: '#fff6dc', align: 'center' }).setOrigin(0.5);
      c.add([fondo, txt]);
      c.fondo = fondo; c.txt = txt;
      fondo.on('pointerover', () => fondo.setFillStyle(0x3d3380));
      fondo.on('pointerout', () => fondo.setFillStyle(0x2a2358));
      fondo.on('pointerup', () => this.elegir(i));
      return c;
    });
    this.teclasOpcion = this.input.keyboard.on('keydown', ev => {
      const n = parseInt(ev.key, 10);
      if (n >= 1 && n <= this.botones.length) this.elegir(n - 1);
    });
    if (this.datos.cuentaAtras) {
      let quedan = this.datos.cuentaAtras;
      this.reloj.setText(`⏳ ${quedan} s`).setVisible(true);
      this.tReloj = this.time.addEvent({ delay: 1000, loop: true, callback: () => {
        quedan -= 1;
        this.reloj.setText(`⏳ ${quedan} s`);
        sonido.efecto('ui_tictac', 0.5);
        if (quedan <= 0) this.elegir(this.botones.length - 1);   // si no decide, pasa lo arriesgado
      } });
    }
    this.colocar();
  }

  colocarBotones() {
    if (!this.botones.length) return;
    const { width: w, height: h } = this.scale;
    const e = this.e ?? 1, ancho = Math.min(w - 32, 640 * e);
    const base = this.caja.y0 - 20 * e - this.botones.length * 70 * e;
    this.botones.forEach((c, i) => {
      c.txt.setFontSize(Math.max(16, Math.round(18 * e))).setWordWrapWidth(ancho - 30);
      c.fondo.setSize(ancho, Math.max(56 * e, c.txt.height + 22));
      c.fondo.input?.hitArea.setSize(ancho, c.fondo.height);
      c.setPosition(w / 2, Math.max(h * 0.18, base) + i * 70 * e + 30 * e);
    });
    this.reloj.setPosition(w / 2, this.botones[0].y - 48 * e);
  }

  elegir(i) {
    if (!this.botones.length) return;
    this.tReloj?.remove();
    this.reloj.setVisible(false);
    this.input.keyboard.off('keydown');
    for (const c of this.botones) c.destroy();
    this.botones = [];
    sonido.efecto('ui_clic_boton', 0.7);
    this.narrador?.elegir(i);
    this.siguiente();
  }

  // --- Etiquetas: música, efectos, fichas de datos, costos y efectos de recursos ---
  aplicarTags(t, callado = false) {
    for (const [k, v] of Object.entries(t)) {
      if (Array.isArray(v)) (this.tagsJuntadas[k] ??= []).push(...v);
      else this.tagsJuntadas[k] = v;
    }
    if (!callado) {
      if (t.musica) sonido.musica(t.musica.at(-1));
      for (const s of t.sfx ?? []) sonido.efecto(s, 0.7);
    } else if (t.musica) sonido.musica(t.musica.at(-1));
    for (const d of t.dato ?? []) bus.emit(EV.DATO, d);
  }

  cerrar() {
    if (this.terminado) return;
    this.terminado = true;
    sonido.callar();
    control.modal = false;
    const fin = this.datos.alTerminar;
    const tags = this.tagsJuntadas;
    this.scene.stop();
    fin?.(tags);
  }
}
