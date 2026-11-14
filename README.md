# JIIMATZIN — Junior Astronaut Mission Trainer

Juego web 2D para niños de 7 a 12 años: administrar una base en Marte durante diez soles. Este repositorio contiene la **API de contenido** (backend) y el espacio para el **frontend** (Phaser).

> Estado: escafolde. El backend arranca, migra la BD y sirve escenarios/fichas/fuentes vacíos; el importador de datos y el frontend están pendientes.

## Estructura

```
desarrollo/
├── backend/        API Node.js + Express + PostgreSQL (ver backend/README.md)
├── frontend/       Phaser y adaptador de API (ver frontend/README.md)
├── contrato/       JSON Schema del escenario: lo comparten back y front
├── docs/           Documentación con diagramas Mermaid (empezar por docs/README.md)
├── scripts/        Utilidades del repo (validación de commits)
├── docker-compose.yml   PostgreSQL local
└── CONTRIBUTING.md      Convención de commits y ramas
```

## Puesta en marcha

Requisitos: Node ≥ 22.9, pnpm (`corepack enable`) y Docker (o un PostgreSQL local; ver abajo).

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm migrar
pnpm dev:back
```

Comprobar: <http://localhost:3000/health> y <http://localhost:3000/api/v1/scenarios>.

| Comando | Qué hace |
| --- | --- |
| `pnpm dev:back` | API con recarga automática (puerto 3000) |
| `pnpm db:up` / `db:down` | Inicia / detiene PostgreSQL en Docker (puerto local 5433) |
| `pnpm migrar` / `migrar:revertir` | Aplica / revierte migraciones |
| `pnpm test` | Pruebas del backend |

## Documentación

Índice y decisiones en [docs/README.md](docs/README.md). Convención de commits en [CONTRIBUTING.md](CONTRIBUTING.md).

Los documentos de contexto del equipo (01 a 05) viven fuera de este repositorio y son la fuente de las decisiones; las propuestas allí marcadas siguen sujetas a acuerdo del equipo.

## Gestor de paquetes y PostgreSQL

- **Solo pnpm.** Con npm o yarn la instalación se aborta (`scripts/solo-pnpm.mjs`).
- **PostgreSQL: Docker es el camino común del equipo.** `docker-compose.yml` fija la misma versión (17) para todos; quien clone el repo ejecuta `pnpm db:up && pnpm migrar` y obtiene el mismo esquema.
- **Tu PostgreSQL local también sirve** para trabajar: apunta `DATABASE_URL` en `.env` a tu instancia (por ejemplo `postgresql://usuario:clave@localhost:5432/jiimatzin`), omite `pnpm db:up` y ejecuta `pnpm migrar`. No subas tu `.env`.
- **Qué hace recuperable la BD:** las migraciones (esquema) y el importador con los originales verificados por SHA-256 (datos). El volumen de Docker no se versiona. Para compartir un estado exacto: `pg_dump` aparte, nunca dentro del repo.
