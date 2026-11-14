# Documentación técnica

Se actualiza junto con el código (un commit `docs(...)` por cambio relevante). Los diagramas usan Mermaid: en VS Code se ven con la vista previa de Markdown.

| Documento | Contenido |
| --- | --- |
| [01-stack-backend.md](01-stack-backend.md) | Decisión de stack, alternativas, decisiones abiertas |
| [02-arquitectura.md](02-arquitectura.md) | Componentes, flujo de carga, despliegue |
| [03-modelo-datos.md](03-modelo-datos.md) | Diagrama entidad-relación y reglas de datos |
| [04-api.md](04-api.md) | Endpoints, errores y ejemplos |
| [05-importacion.md](05-importacion.md) | Flujo del importador y política de calidad |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Commits, ramas y flujo |

## Registro de avance

| Fecha | Qué | Estado |
| --- | --- | --- |
| 2026-11-14 | Escafolde del backend, esquema inicial, adaptador de API del front, convención de commits | Hecho; verificado con `pnpm test` y PostgreSQL 17 local |
| — | Importador (REMS, DONKI, NOAA, OSDR) | Pendiente |
| — | Política de calidad REMS y clasificación de textos interpretativos | Pendiente (decisión del equipo) |
| — | Contrato de escenario/ficha aprobado con roles 1 y 2 | Pendiente |
| — | Pruebas de integración con BD y despliegue | Pendiente |

## Cómo mantener esta documentación

- Cambias una ruta → actualiza `04-api.md` y `contrato/scenario.schema.json`.
- Cambias una migración → actualiza el diagrama de `03-modelo-datos.md`.
- Tomas una decisión de stack → regístrala en `01-stack-backend.md`.
- Distingue siempre **hecho comprobado**, **decisión del equipo** y **propuesta**, como en los documentos de contexto.
