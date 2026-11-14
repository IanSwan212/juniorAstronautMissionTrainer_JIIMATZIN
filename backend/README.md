# Backend — API de contenido

Node.js (ESM) + Express 5 + PostgreSQL. **Solo lectura**: sirve escenarios, fichas y fuentes ya importados; no consulta NASA por jugador y no es el servidor autoritativo de partidas.

## Estructura

```
backend/
├── migrations/            SQL versionado (node-pg-migrate)
├── src/
│   ├── index.js           arranque y cierre ordenado
│   ├── app.js             fábrica de la app Express (recibe el pool)
│   ├── config/env.js      variables de entorno validadas con zod
│   ├── db/pool.js         pool de PostgreSQL
│   ├── routes/api.js      monta los módulos bajo /api/v1
│   ├── middleware/        errores y registro de peticiones
│   ├── modules/           un directorio por recurso
│   │   ├── salud/         /health, /health/listo
│   │   ├── escenarios/    routes → service → repository
│   │   ├── fichas/
│   │   └── fuentes/
│   └── importador/        comando administrativo de carga (esqueleto)
└── test/                  node:test, sin dependencias extra
```

Patrón por módulo: `*.routes.js` valida la entrada (zod) → `*.service.js` arma la respuesta del contrato → `*.repository.js` ejecuta SQL parametrizado. Para un recurso nuevo: crear su directorio y montarlo en [src/routes/api.js](src/routes/api.js).

## Variables de entorno

Se leen del `.env` de la raíz (ver [../.env.example](../.env.example)). `DATABASE_URL` es obligatoria y solo vive en el servidor.

## Pruebas

`pnpm test` usa un pool simulado: valida rutas, validación de entrada y formato de errores sin necesitar PostgreSQL. Las consultas SQL se comprobaron manualmente contra PostgreSQL 17 con filas de prueba; **falta automatizar pruebas de integración con BD**.

## Pendiente

Importador, política de calidad REMS, vista de fichas aprobadas, pruebas de integración, despliegue. Ver [../docs/README.md](../docs/README.md).
