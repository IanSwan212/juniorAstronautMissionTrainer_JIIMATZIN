// Lo que le falta grabar al rol 5, en español y en inglés, con el formato de su lineas.json (8_casting_voces):
// { id, escena, personaje, cara, texto, texto_tts }. Lo leen tal cual sus scripts generar_voz.py y organiza.py.
//   1. IA del juego (avisos, guía, repaso, noticias del Sol): lineas_ia.json (enumerar.mjs), español e inglés
//   2. Historia de Ink en inglés: las 127 líneas de WEN, JUD y ATL de lineas_es_en.json (las de la IA van en el 1)
//   3. Narración sin personaje (prólogo, cartas, introducción, final): docs/voces-pendientes.md + historia_en.js
// Uso: node faltantes.mjs   (desde frontend/herramientas/voz_ia) -> para_rol5/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const FRONT = path.resolve(AQUI, '../..');
const SAL = path.join(AQUI, 'para_rol5');
mkdirSync(SAL, { recursive: true });
const leer = r => JSON.parse(readFileSync(path.join(FRONT, r), 'utf8'));

const UNI = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'];
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const tts = (t, en) => t.replace(/P\.I\.E\.D\.R\.A/g, 'Piedra').replace(/CO₂/g, en ? 'carbon dioxide' : 'dióxido de carbono')
  .replace(/\{jugador\}/g, en ? 'astronaut' : 'astronauta').replace(/\b(\d{1,2})\b/g, (_, n) => (en ? ONES : UNI)[+n] ?? n);

const es = [], en = [];

// 1. IA del juego
for (const l of JSON.parse(readFileSync(path.join(AQUI, 'lineas_ia.json'), 'utf8'))) {
  if (l.id.startsWith('en_') && /^[a-z_]+_\d+$/.test(l.id) === false) { /* todas valen */ }
  const x = { id: `ia_juego_${l.id}`, escena: 'ia_juego', personaje: 'IA', cara: l.cara ?? 'neutral', texto: l.texto, texto_tts: l.texto_tts };
  (l.idioma === 'es' ? es : en).push(x);
}
// (las de historia.ink en inglés que trae lineas_ia.json se sustituyen por el bloque 2, con sus ids del rol 5)
const enSinInk = en.filter(x => true);

// 2. Historia de Ink en inglés (mismos ids que los MP3 en español)
const audios = leer('public/assets/audio/voces/audios.json');
const caras = JSON.parse(readFileSync(path.join(AQUI, 'caras_ia.json'), 'utf8'));
const NOMBRES = { '{WEN}': 'Wenceslao', '{JUD}': 'Judith', '{ATL}': 'Atlas', '{IA}': 'P.I.E.D.R.A' };
const ink = [];
for (const x of leer('public/assets/audio/voces/lineas_es_en.json')) {
  if (x.personaje === 'IA') continue;           // las de P.I.E.D.R.A ya van en el bloque 1, como las busca el juego
  const texto = x.texto_en.replace(/\{(WEN|JUD|ATL|IA)\}/g, m => NOMBRES[m]);
  ink.push({ id: x.id, escena: audios[x.id]?.escena ?? x.id.replace(/_\d+$/, ''), personaje: x.personaje,
    cara: caras[x.id] ?? 'neutral', texto, texto_tts: tts(texto, true) });
}

// 3. Narración sin personaje
const { HISTORIA_EN } = await import(pathToFileURL(path.join(FRONT, 'src/textos/historia_en.js')).href);
const enDe = new Map(HISTORIA_EN);
const md = readFileSync(path.join(FRONT, 'docs/voces-pendientes.md'), 'utf8').split('## 2.')[0];
const narr = [...md.matchAll(/^\| `([a-z_]+)` \| (.+) \|$/gm)].map(([, nudo, t]) => [nudo, t.trim()]);
const cuenta = {};
for (const [nudo, t] of narr) {
  const n = (cuenta[nudo] = (cuenta[nudo] ?? 0) + 1);
  const id = `narracion_${nudo}_${String(n).padStart(2, '0')}`;
  es.push({ id, escena: nudo, personaje: 'NARRADOR', cara: 'sereno', texto: t, texto_tts: tts(t, false) });
  const tEn = enDe.get(t);
  if (tEn) en.push({ id, escena: nudo, personaje: 'NARRADOR', cara: 'sereno', texto: tEn, texto_tts: tts(tEn, true) });
  else console.warn('narración sin inglés:', t.slice(0, 60));
}

// Las líneas de IA de Ink en inglés ya vienen en el bloque 2: se quitan del bloque 1 para no grabarlas dos veces
const textosInk = new Set(ink.map(x => x.texto));
const enFinal = [...enSinInk, ...ink,
  ...en.filter(x => x.personaje === 'NARRADOR')];
const uniq = l => [...new Map(l.map(x => [x.id, x])).values()];
const esF = uniq(es), enF = uniq(enFinal);
writeFileSync(path.join(SAL, 'lineas_faltan_es.json'), JSON.stringify(esF, null, 1));
writeFileSync(path.join(SAL, 'lineas_faltan_en.json'), JSON.stringify(enF, null, 1));
const csv = l => ['idioma,id,personaje,escena,texto', ...l.map(x => [x.idioma, x.id, x.personaje, x.escena, `"${x.texto.replace(/"/g, '""')}"`].join(','))].join('\n');
writeFileSync(path.join(SAL, 'lineas_faltan.csv'), '﻿' + csv([...esF.map(x => ({ ...x, idioma: 'es' })), ...enF.map(x => ({ ...x, idioma: 'en' }))]));

const por = l => l.reduce((a, x) => { const k = x.escena === 'ia_juego' ? 'IA (juego)' : x.personaje === 'NARRADOR' ? 'Narración' : `${x.personaje} (historia)`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
console.log('ESPAÑOL', esF.length, por(esF));
console.log('INGLÉS ', enF.length, por(enF));
