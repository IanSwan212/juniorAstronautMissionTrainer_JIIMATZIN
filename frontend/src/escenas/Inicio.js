// Pantalla de inicio. El botón es el primer gesto del jugador:
// los navegadores no dejan sonar audio hasta entonces.
import { ciclo } from '../mecanicas/ciclo.js';
import { sonido } from '../motor/sonido.js';
import { cargas } from '../motor/cargas.js';

export default class Inicio extends Phaser.Scene {
  constructor() { super('Inicio'); }

  create() {
    const fuente = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    this.titulo = this.add.text(0, 0, 'Misión Marte', { fontFamily: fuente, fontSize: '40px', fontStyle: 'bold', color: '#f1e3d3' }).setOrigin(0.5);
    this.sub = this.add.text(0, 0, 'Base Marte Uno · 10 soles de entrenamiento', { fontFamily: fuente, fontSize: '16px', color: '#c9a99a' }).setOrigin(0.5);
    this.boton = this.add.rectangle(0, 0, 240, 56, 0xd9653b).setInteractive({ useHandCursor: true });
    this.textoBoton = this.add.text(0, 0, 'Comenzar misión', { fontFamily: fuente, fontSize: '20px', fontStyle: 'bold', color: '#1a1110' }).setOrigin(0.5);
    this.ayuda = this.add.text(0, 0, 'Enter o toca el botón', { fontFamily: fuente, fontSize: '13px', color: '#8f7a70' }).setOrigin(0.5);

    this.boton.on('pointerover', () => this.boton.setFillStyle(0xf07a4e));
    this.boton.on('pointerout', () => this.boton.setFillStyle(0xd9653b));
    this.boton.on('pointerup', () => this.comenzar());
    this.input.keyboard.once('keydown-ENTER', () => this.comenzar());

    this.colocar(this.scale.width, this.scale.height);
    const alRedimensionar = s => this.colocar(s.width, s.height);
    this.scale.on('resize', alRedimensionar);
    this.events.once('shutdown', () => this.scale.off('resize', alRedimensionar));
  }

  colocar(w, h) {
    this.titulo.setPosition(w / 2, h / 2 - 90);
    this.sub.setPosition(w / 2, h / 2 - 50);
    this.boton.setPosition(w / 2, h / 2 + 20);
    this.textoBoton.setPosition(w / 2, h / 2 + 20);
    this.ayuda.setPosition(w / 2, h / 2 + 68);
  }

  comenzar() {
    if (this.empezado) return;
    this.empezado = true;
    sonido.musica('inicio');
    // prólogo de la historia (se puede saltar) y después elegir personaje
    ciclo.narrar('prologo', { fondo: true })
      .then(() => cargas.asegurar('personajes'))
      .then(() => this.scene.start('Seleccion'));
  }
}
