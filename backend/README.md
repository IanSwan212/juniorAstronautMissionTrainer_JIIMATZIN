# Backend — API de contenido

Node.js (ESM) + Express 5 + PostgreSQL. **Solo lectura**: sirve escenarios, fichas y fuentes ya importados; no consulta NASA por jugador y no es el servidor autoritativo de partidas.

## Estructura

```
backend/
├── migrations/            SQL versionado (node-pg-migrate)
├── src/
│   ├── index.js           arranque y cierre ordenado
│   ├── app.js             fábrica de la app Express (recibe el pool)
│   ├── rutas.js           monta escenarios, fichas y fuentes bajo /api/v1
│   ├── escenarios/       contenido de la misión; MVC + repositorio
│   ├── fichas/           fichas científicas y evidencias; MVC + repositorio
│   ├── fuentes/          procedencia y atribución; MVC + repositorio
│   ├── salud/            /health, /health/listo; MVC + repositorio
│   ├── importador/       comando administrativo de carga (esqueleto)
│   ├── compartido/       errores de aplicación independientes de HTTP
│   └── infraestructura/
│       ├── config/env.js variables de entorno validadas con zod
│       ├── db/pool.js    pool de PostgreSQL
│       └── http/         middlewares de errores, registro, límites y caché
└── test/                  node:test, sin dependencias extra
```

**Screaming architecture:** las carpetas principales nombran las funcionalidades de JIIMATZIN. Cada funcionalidad contiene su propio MVC; la infraestructura transversal queda agrupada aparte.

| Archivo por funcionalidad | Responsabilidad |
| --- | --- |
| `*.routes.js` | Compone repositorio → modelo → controlador y asocia los handlers a las rutas |
| `*.controller.js` | Valida la entrada HTTP con zod, invoca el modelo y responde con la vista |
| `*.model.js` | Ejecuta los casos de uso y coordina los datos; recibe un repositorio, sin Express ni configuración de entorno |
| `*.repository.js` | Acceso a PostgreSQL con SQL parametrizado; es la persistencia del modelo |
| `*.view.js` | Funciones puras que proyectan el resultado al contrato JSON público |

La **vista es JSON**, porque este backend es una API de contenido; Phaser presenta la interfaz del juego. Los modelos notifican ausencias con `ErrorNoEncontrado` y el middleware HTTP las traduce a 404. Los errores de persistencia llegan al manejador como 500; salud los convierte en disponibilidad degradada (503).

Para una funcionalidad nueva: crear su carpeta junto a `escenarios/`, implementar sus archivos MVC y repositorio, y montarla en [src/rutas.js](src/rutas.js). Detalle y diagrama en [../docs/02-arquitectura.md](../docs/02-arquitectura.md).

## Variables de entorno

Se leen del `.env` de la raíz (ver [../.env.example](../.env.example)). `DATABASE_URL` es obligatoria y solo vive en el servidor.

## Pruebas

`pnpm test` usa un pool simulado: valida rutas, respuestas completas, parámetros SQL, validación de entrada, cabeceras y errores sin necesitar PostgreSQL. Las pruebas de regresión cubren observaciones faltantes, eventos, evidencias, versiones e idioma. La comprobación manual previa con PostgreSQL 17 está registrada en la documentación; **falta automatizar pruebas de integración con BD**.

## Pendiente

Importador, política de calidad REMS, vista de fichas aprobadas, pruebas de integración, despliegue. Ver [../docs/README.md](../docs/README.md).
