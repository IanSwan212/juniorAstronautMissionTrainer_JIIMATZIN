# Frontend — Phaser

Carpeta reservada para el juego (rol 1). Se comunica por HTTP con la API y no
accede a PostgreSQL. El servidor visual del juego todavía debe integrarse.

## Archivos

```text
frontend/
├── public/
│   └── escenarios/
│       ├── <id>.json             alias de la última versión exportada
│       └── <id>/v<version>.json  respaldo de una revisión exacta
├── src/
│   ├── api/                     adaptador ya implementado
│   ├── escenas/                 escenas de Phaser, cuando se integren
│   ├── minijuegos/
│   └── main.js
└── vite.config.example.js
```

Los JSON se generan con el comando administrativo de exportación; no se incluyen
borradores, ZIP originales ni herramientas de importación en el frontend.
El contrato está en `contrato/scenario.schema.json`.

## Uso del adaptador

El juego importa desde `src/api`:

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

- Se consume `schemaVersion: "2"`, que fija `releaseId`, `rulesVersion` y los
  `recordId`. El borrador anterior del esquema `public` se rechaza.
- Se carga antes de iniciar la misión y se conserva la misma versión durante
  la partida. `releaseId` puede pasarse como opción para comprobar también esa
  identidad cuando la partida ya la conoce.
- `role: "environment"` identifica datos históricos de Marte; `reference` conserva
  contexto solar o ISS. El adaptador no calcula emergencias ni reglas físicas.
- LMST y soles fuente se mantienen separados de UTC y del sol del juego. Los
  agregados horarios vacíos conservan estadísticas NULL; no rellenarlos con cero.
- Ante indisponibilidad, se intenta el respaldo de la revisión solicitada. Una
  respuesta explícita 400/404 de la API no se sustituye por un respaldo retirado.
  Un hosting estático sin API que devuelve HTML 404 puede cargar los JSON locales.
- Se comprueban estructura, identidad y versión tanto de API como del respaldo.
  El resultado indica `origen: "api" | "respaldo-local"`; la UI debe mostrarlo.

Un archivo local ya distribuido no conoce retiros posteriores mientras esté sin
conexión. Al retirar contenido, actualizar también los artefactos del despliegue.

## Desarrollo y producción

Cuando el escenario tiene `gameplay`, incluye sus personajes, recursos iniciales,
calendario, minijuegos, emergencias, cartas, finales y referencias de audio/Ink.
El adaptador valida ese catálogo tanto en API como en respaldo. Los cambios de
recurso ya están estructurados; los efectos de cartas `design_pending` requieren
reglas de diseño antes de ejecutarse. Los IDs narrativos pendientes no tienen
texto aprobado: mostrar las fichas científicas vinculadas de `facts`, conservando
sus límites. Ver [contrato de contenido](../docs/12-contenido-juego.md).

Para integrar el servidor visual: instalar Vite/Phaser en este workspace, partir
de `vite.config.example.js` y definir el script `dev`. El proxy envía `/api` al
backend; las URLs no deben fijarse en escenas de Phaser.

Si el frontend está en otro host, configurar `VITE_API_URL` y el origen exacto en
`CORS_ORIGINS`. El backend y el proceso administrativo son entregas separadas del
contenido estático del jugador.
