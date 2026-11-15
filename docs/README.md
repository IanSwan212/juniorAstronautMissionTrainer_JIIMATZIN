# Documentación técnica

Se actualiza junto con el código (un commit `docs(...)` por cambio relevante). Los diagramas usan Mermaid: en VS Code se ven con la vista previa de Markdown.

| Documento | Contenido |
| --- | --- |
| [01-stack-backend.md](01-stack-backend.md) | Decisión de stack, alternativas, decisiones abiertas |
| [02-arquitectura.md](02-arquitectura.md) | Screaming architecture + MVC, componentes, flujo de carga, despliegue |
| [03-modelo-datos.md](03-modelo-datos.md) | Diagrama entidad-relación y reglas de datos |
| [04-api.md](04-api.md) | Endpoints, errores y ejemplos |
| [05-importacion.md](05-importacion.md) | Flujo del importador y política de calidad |
| [06-produccion.md](06-produccion.md) | Variables de entorno, despliegue y lista de comprobación |
| [07-guia-desarrollo.md](07-guia-desarrollo.md) | Orden de trabajo: primero BD, después endpoints |
| [08-diseno-dataset-cientifico.md](08-diseno-dataset-cientifico.md) | Modelo del ZIP estandarizado, mapeo, conteos y requisitos de publicación |
| [09-acceso-postgresql-local.md](09-acceso-postgresql-local.md) | Conexión con pgAdmin y psql, migraciones y consultas |
| [10-diccionario-bd.md](10-diccionario-bd.md) | Propósito, columnas, tipos, PK, FK y restricciones de las 28 tablas de ciencia |
| [11-diagrama-er.md](11-diagrama-er.md) | Diagrama completo de ciencia con sus 32 FK y fuente Mermaid |
| [12-publicacion.md](12-publicacion.md) | CLI de validación/publicación/retiro, revisión humana, bitácora y protección del contenido |
| [13-escenarios.md](13-escenarios.md) | Modelo juego, escenarios fijados a ciencia, contrato 2 y respaldo del frontend |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Commits, ramas y flujo |

## Registro de avance

El dataset ajustado tiene migraciones aplicadas a PostgreSQL local con 28 tablas
en `ciencia`, verificación de 198 hashes y conteos JSONL y prueba de reversión en
esquema aislado. El importador está implementado: valida el ZIP sin ejecutar su
pipeline, carga en una transacción y permite repetir sin duplicados ni sobrescrituras.
Las construcciones se mantienen `candidate` mientras falte revisión humana.
Los controles de publicación y protección están implementados; ver [12](12-publicacion.md).
El estado de cada carga se consulta en `ciencia.import_runs`.
El paquete `rel_40afe5ce9bfa07d6bf26fa729478db67` ya está cargado en desarrollo:
263 782 registros, intento `1` exitoso y estado `candidate`. Se comprobaron los
conteos persistidos, los huecos horarios y las respuestas HTTP de salud, fuente
y ficha pendiente. No hay revisiones humanas registradas.
La validación administrativa contra el ZIP real también pasó (`checked` ID 1,
`technical_ok=true`); sigue sin estar listo para publicar por las siete fichas
pendientes. Ver [12](12-publicacion.md).

La API ya inició su adaptación: `/sources/{id}` y `/facts/{id}` consultan
`ciencia`, con contratos específicos y revisión humana efectiva de fichas.
Escenarios usa `juego`, con FK a publicaciones y membresías de `ciencia`.
Los endpoints y el adaptador usan el borrador 2 del contrato; el catálogo de
`public` se conserva separado. El respaldo exporta versiones publicadas.
Verificado con 47 pruebas sin BD y 37 pruebas contra PostgreSQL en bases
temporales migradas desde cero y eliminadas al terminar (`pnpm test:integracion`).
En el cierre anterior del importador también pasó la prueba opcional del paquete
real completo, con repetición que inserta cero filas. Todas las bases temporales
se eliminaron. Ver [05](05-importacion.md) y [12](12-publicacion.md).

| Fecha | Qué | Estado |
| --- | --- | --- |
| 2026-11-14 | Escafolde del backend, esquema inicial, adaptador de API del front, convención de commits | Hecho; verificado con `pnpm test` y PostgreSQL 17 local |
| 2026-11-14 | Backend organizado por funcionalidades con MVC y vistas JSON | Hecho; 25 pruebas pasan con pool simulado, incluidos contratos completos y errores; sin nueva comprobación contra BD real |
| 2026-11-14 | Importador del paquete ajustado con contratos, integridad, política, linaje, idempotencia y auditoría | Implementado y cargado en desarrollo como candidato; intento 1 exitoso, 263 782 registros; [05](05-importacion.md) |
| — | Ubicación estable y respaldo de originales A/B; revisión editorial humana | Pendiente |
| — | Contrato de escenario/ficha aprobado con roles 1 y 2 | Pendiente |
| 2026-11-14 | Fuentes y fichas adaptadas a ciencia; pruebas de integración con BD temporal | Hecho; contratos y transición en [04-api.md](04-api.md) |
| 2026-11-14 | Validación/publicación/retiro, bitácora y protección de registros y metadatos | Implementado y probado; migración aplicada; [12](12-publicacion.md) |
| 2026-11-14 | Escenarios vinculados a ciencia, reglas fijadas, contrato 2 y exportación para frontend | Implementado y probado con datos sintéticos; migración aplicada; [13](13-escenarios.md) |
| — | Definición editorial del primer escenario, revisión de fichas y despliegue | Pendiente |

## Cómo mantener esta documentación

- Cambias una ruta → actualiza `04-api.md` y el contrato de su recurso en `contrato/`.
- Cambias una migración → actualiza el diagrama de `03-modelo-datos.md`.
- Tomas una decisión de stack → regístrala en `01-stack-backend.md`.
- Distingue siempre **hecho comprobado**, **decisión del equipo** y **propuesta**, como en los documentos de contexto.
