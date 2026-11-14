# Frontend — Phaser

Carpeta reservada para el juego (rol 1). Está separada del backend: se comunica **solo por HTTP** con la API y nunca toca la BD.

## Dónde colocar los archivos

```
frontend/
├── index.html            (cuando se agregue Vite)
├── public/
│   └── escenarios/       exportación estática de respaldo: <id>.json (mismo contrato que la API)
├── src/
│   ├── api/              ← ya existe: único punto de contacto con el backend
│   ├── escenas/          escenas de Phaser
│   ├── minijuegos/
│   └── main.js
└── vite.config.js        (partir de vite.config.example.js)
```

## Cómo acceder al backend

El juego importa de `src/api` y **nunca llama a `fetch` directamente**:

```js
import { cargarEscenario, obtenerFicha } from './api/index.js';

const { escenario, origen } = await cargarEscenario('mars-demo'); // origen: 'api' | 'respaldo-local'
const ficha = await obtenerFicha('algun-id', 'es');                // etiqueta dato:<id> de Ink
```

- Carga el escenario completo **antes** de iniciar la misión y consérvalo (versión incluida) hasta que termine.
- Si la API falla, `cargarEscenario` cae a `public/escenarios/<id>.json`; muestra el origen en la UI.
- Se valida el contrato mínimo; una respuesta 200 con HTML se trata como error.

## Conexión en desarrollo

1. Instalar Vite en este workspace: `pnpm add -D vite --filter @jiimatzin/frontend` (y Phaser: `pnpm add phaser --filter @jiimatzin/frontend`).
2. Copiar `vite.config.example.js` a `vite.config.js` y poner `"dev": "vite"` en `package.json`.
3. `pnpm dev:back` y `pnpm dev:front` desde la raíz. El proxy reenvía `/api` a `localhost:3000`: sin CORS ni puertos fijos en el código.

## Producción

Si el front está en GitHub Pages y la API en otro host: definir `VITE_API_URL` con la URL pública de la API y añadir el origen del front a `CORS_ORIGINS` del backend. Ver [../docs/02-arquitectura.md](../docs/02-arquitectura.md).

> `src/api/` es un punto de partida del rol 3 para acelerar la integración; el rol 1 puede adaptarlo al motor.
