# Frontend: el juego en Phaser

El juego de JIIMATZIN (rol 1, con lo que entregaron los roles 2 a 5). Es una base en Marte por salas, en perspectiva
isométrica: el jugador camina entre las salas, usa las estaciones, juega los minijuegos y vive diez soles con la
historia, las voces y la música del equipo. Se comunica con la API de contenido por HTTP y no accede a PostgreSQL.

Phaser 4.2.1 e inkjs 2.2.3 van incluidos en `public/lib/`. Es JavaScript con módulos ES y no usa empaquetador:
no hay que instalar nada para jugar.

## Ejecutar

```bash
pnpm dev:front                    # desde la raíz del repositorio
node frontend/scripts/servidor.mjs    # lo mismo, sin pnpm
```

Abrir <http://localhost:5173>. El servidor (`scripts/servidor.mjs`, sin dependencias):

- sirve `frontend/` y `public/` sin caché;
- reenvía `/api/...` y `/health` a la API de `pnpm dev:back`, igual que el proxy de `vite.config.example.js`.

Variables: `PUERTO` y `JIIMATZIN_API` (por defecto `http://localhost:3000`).

**Controles**

| Acción | Teclado | Táctil |
| --- | --- | --- |
| Moverse | WASD o flechas | arrastrar |
| Usar una estación | E o Espacio | tocar el aviso |
| Cerrar | Esc | — |
| Silenciar | M | — |

Otras teclas:
- **F2** muestra las colisiones; también con `?depurar` en la dirección.
- **F3** cambia la fase de luz, para probar.

## Estructura

```text
frontend/
├── index.html
├── public/                      se sirve tal cual en la raíz
│   ├── lib/                     phaser.min.js e ink.js
│   ├── assets/                  zonas (salas), minijuegos, interfaz, personajes, arte y audio
│   ├── historia/historia.json   historia de Ink compilada (rol 5)
│   ├── data/                    modelo del pronóstico solar de la IA
│   └── escenarios/              respaldo de la API (exportaciones del backend)
├── src/
│   ├── api/                     adaptador de la API (contrato 2)
│   ├── escenas/                 Arranque, Inicio, Seleccion, Base (mapa), Interfaz, Dialogo
│   ├── motor/                   eventos, sonido, luces, recursos y configuración
│   ├── mecanicas/               estado, ciclo de los 10 soles, consola, narrador de Ink y datos reales
│   ├── minijuegos/              paneles, filtro de CO₂ e invernadero (rol 2; el original está en minijuegos/original)
│   ├── compania/                el robot de la IA que acompaña al jugador
│   ├── ml/                      pronóstico de llamaradas solares en el navegador
│   └── main.js
├── historia/                    fuente de Ink y guía de la historia (rol 5)
├── herramientas/                generadores de arte y del modelo (Python): ver «Arte»
├── docs/                        acuerdos entre roles, estilo, objetos, accesibilidad, aprendizaje, uso de IA y créditos
└── scripts/servidor.mjs
```

Cómo se habla entre partes del juego (eventos del bus, estado, pantallas encima del mapa): [docs/acuerdos.md](docs/acuerdos.md).

## La API: datos reales

`src/mecanicas/datosReales.js` carga la misión `base-marte-uno` con el adaptador de `src/api`. El juego nunca llama
a `fetch` directamente. Si la API no responde, usa el respaldo de `public/escenarios/`. Si tampoco hay respaldo, el
juego sigue con su contenido propio. Con datos, el jugador ve:

- **Por la mañana**, la temperatura y la presión medidas en Marte para ese sol, dichas como medición histórica.
- **Debajo del sol**, en la interfaz: "Marte real: −66 °C · 735 Pa".
- **En cada fase**, las fichas «Dato real» que la misión coloca en ese sol y momento, con su fuente.
- **Tras un `# dato:<id>` de la historia**, la ficha aprobada que esté vinculada. Sin vínculo, no se presenta como
  verificada.

Uso directo del adaptador:

```js
import { cargarEscenario, obtenerFicha } from './api/index.js';

const { escenario, origen } = await cargarEscenario('mi-escenario', { version: 1 });
const esencial = escenario.facts[0];
if (esencial) {
  const ficha = await obtenerFicha(esencial.id, escenario.language, {
    recordId: esencial.recordId,
  });
  // Mostrar evidencia y límites de esa misma revisión.
}
```

- Se consume `schemaVersion: "2"`, que fija `releaseId`, `rulesVersion` y los `recordId`. El borrador anterior del
  esquema `public` se rechaza.
- Se carga antes de iniciar la misión y se conserva la misma versión durante la partida. `releaseId` puede pasarse
  como opción para comprobar también esa identidad cuando la partida ya la conoce.
- `role: "environment"` identifica datos históricos de Marte; `reference` conserva contexto solar o ISS.
- El adaptador no calcula emergencias ni reglas físicas.

Los JSON de `public/escenarios/` se generan con el comando de exportación del backend. No se incluyen borradores,
ZIP originales ni herramientas de importación. El contrato está en `contrato/scenario.schema.json`.

## Arte

Todo el arte del mapa y de los minijuegos se genera con código, en la línea de [docs/estilo-mapa.md](docs/estilo-mapa.md)
y [docs/biblia-objetos.md](docs/biblia-objetos.md). Los personajes son dibujos del equipo de arte.

```bash
python frontend/herramientas/pintar_zonas.py         # las 7 salas (≈ 3 min; caché en herramientas/.cache)
python frontend/herramientas/pintar_minijuegos.py    # arte de los minijuegos
python frontend/herramientas/pintar_interfaz.py      # piezas de la interfaz
```

Requieren Python 3.11 con Pillow y NumPy. Las propuestas y hojas de revisión se escriben en `docs-internos/`, que el
repositorio no versiona.

## Créditos y uso de IA

[CREDITOS.md](CREDITOS.md), [docs/creditos/](docs/creditos/) y [docs/uso-de-ia.md](docs/uso-de-ia.md).
