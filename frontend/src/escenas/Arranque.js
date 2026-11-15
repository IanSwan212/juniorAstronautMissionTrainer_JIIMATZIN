// Carga todos los archivos de recursos.js con una barra de progreso.
import { IMAGENES, MAPAS, AUDIO, DATOS, HOJAS } from '../motor/recursos.js';
import { ciclo } from '../mecanicas/ciclo.js';

export default class Arranque extends Phaser.Scene {
  constructor() { super('Arranque'); }

  preload() {
    const { width: w, height: h } = this.scale;
    const marco = this.add.rectangle(w / 2, h / 2, 260, 14).setStrokeStyle(2, 0xd9a441);
    const barra = this.add.rectangle(w / 2 - 128, h / 2, 0, 10, 0xd9a441).setOrigin(0, 0.5);
    this.add.text(w / 2, h / 2 - 28, 'Preparando la misión…', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#f1e3d3' }).setOrigin(0.5);
    this.load.on('progress', p => { barra.width = 256 * p; });
    this.load.on('loaderror', f => console.warn(`[recursos] No se pudo cargar "${f.key}" (${f.src}). El juego sigue sin él.`));

    // Al llegar zonas.json, se añaden a la carga las imágenes de cada sala
    this.load.on('filecomplete-json-zonas', (clave, tipo, datos) => {
      for (const z of Object.values(datos.zonas)) {
        this.load.image(`zona_${z.id}_fondo`, z.fondo);
        this.load.image(`zona_${z.id}_frente`, z.frente);
        for (const p of z.props) {
          this.load.image(p.clave, p.archivo);
          if (p.anim) this.load.spritesheet(p.animClave, p.anim, { frameWidth: p.fw, frameHeight: p.fh });   // protagonistas animados
        }
      }
    });
    for (const [k, ruta] of Object.entries(IMAGENES)) this.load.image(k, ruta);
    for (const [k, ruta] of Object.entries(MAPAS)) this.load.tilemapTiledJSON(k, ruta);
    for (const [k, rutas] of Object.entries(AUDIO)) this.load.audio(k, rutas);
    for (const [k, ruta] of Object.entries(DATOS)) this.load.json(k, ruta);
    for (const [k, [ruta, w, h]] of Object.entries(HOJAS)) this.load.spritesheet(k, ruta, { frameWidth: w, frameHeight: h });
    marco.setDepth(1);
  }

  create() {
    ciclo.prepararHistoria();
    this.scene.start('Inicio');
  }
}
