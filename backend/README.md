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
│   ├── escenarios/       contenido de la misión; MVC + repositorio, CLI y exportación
│   ├── fichas/           fichas científicas y evidencias; MVC + repositorio
│   ├── fuentes/          procedencia y atribución; MVC + repositorio
│   ├── salud/            /health, /health/listo; MVC + repositorio
│   ├── importador/       verificación offline del ZIP y carga transaccional a ciencia
│   ├── publicaciones/    CLI administrativa de validación, publicación y retiro
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

`pnpm test` ejecuta 47 pruebas sin PostgreSQL: rutas, contratos, validación,
cabeceras, errores, DONKI con cliente simulado y el importador con paquetes ZIP
mínimos. Requiere Python 3; las suites de integración se omiten en esa ejecución.

`pnpm test:integracion` usa `DATABASE_URL` de `../.env` para crear una BD
temporal `jiimatzin_test_<uuid>` por suite, aplicar las cuatro migraciones desde cero y
ejecutar 37 pruebas de API, importación, publicación y escenarios con SQL real. Las BD se eliminan en `finally`, incluso
si falla una prueba; no se escriben fixtures en la BD de desarrollo. Requiere
PostgreSQL accesible y un rol con permiso `CREATEDB` (el rol local de Compose lo
tiene). Si el proceso se termina forzosamente puede quedar la BD temporal.
Con `DATASET_TEST_ARCHIVE` y `DATASET_TEST_SHA256` se añade la prueba de carga y
reimportación del paquete real completo, también en una BD temporal.

Fuentes y fichas leen `ciencia`. Las fichas requieren última revisión humana
aprobada, calidad aceptable y todas sus evidencias verificadas. `recordId` fija
la revisión de contenido; no se inventa una versión numérica. Los escenarios
usan `juego` y fijan miembros de `ciencia`; el adaptador consume `schemaVersion: "2"`. Detalle en
[04-api.md](../docs/04-api.md).

## Pendiente

Revisión humana de fichas, definición editorial de escenarios/reglas,
correspondencia con las etiquetas narrativas y despliegue. Ver [../docs/README.md](../docs/README.md).

## Importación

El comando `pnpm --filter @jiimatzin/backend importar -- --archivo <ZIP> --sha256 <hash>`
verifica el paquete y carga `ciencia` de forma idempotente. `--validar` verifica sin
conectar a PostgreSQL. Conserva estado `candidate` y no aprueba fichas ni crea
escenarios. Requisitos, transacciones y ejemplos en [05-importacion.md](../docs/05-importacion.md).

## Publicaciones

`pnpm --filter @jiimatzin/backend publicaciones -- validar|publicar|retirar ...`
administra una construcción. `validar` coteja la BD con el ZIP y registra
pendientes; `publicar` exige ese cotejo y aprobación humana vigente; `retirar`
conserva el contenido sellado. La migración incorpora bitácora, protección de
revisiones y límites de escritura; ver [12-publicacion.md](../docs/12-publicacion.md).

## Escenarios

`pnpm escenarios -- crear|publicar|retirar|exportar ...` prepara contenido desde
una definición JSON y exporta únicamente versiones disponibles. Cada escenario
fija publicación, reglas y registros; los datos de juego viven en `juego`.
La API los recupera en una sola instantánea. Definición, contrato, plantilla y
respaldo en [13-escenarios.md](../docs/13-escenarios.md).
