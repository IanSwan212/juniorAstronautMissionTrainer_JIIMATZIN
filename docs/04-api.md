# API v1

Solo lectura (`GET`). No hay endpoints públicos de importación ni edición. Base: `/api/v1`. Contrato del escenario: [contrato/scenario.schema.json](../contrato/scenario.schema.json) (**borrador no aprobado**).

| Método y ruta | Respuesta | Estado |
| --- | --- | --- |
| `GET /health` | `{ "estado": "ok" }` | Implementado |
| `GET /health/listo` | `200` si hay BD, `503` si no | Implementado |
| `GET /api/v1/scenarios` | Escenarios publicados | Implementado |
| `GET /api/v1/scenarios/{id}?version={n}` | Escenario completo; sin `version`, la publicada más reciente | Implementado |
| `GET /api/v1/facts/{id}?lang=es` | Ficha aprobada con evidencias | Implementado |
| `GET /api/v1/sources/{id}` | Atribución y contexto público | Implementado |

Verificado con PostgreSQL 17 usando filas de prueba (ya eliminadas); no hay datos reales importados todavía.

## Escenario

```json
{
  "schemaVersion": "1",
  "scenarioId": "mars-demo",
  "scenarioVersion": "1",
  "rulesVersion": "educational-1",
  "language": "es",
  "dataMode": "historical",
  "sourceCoverage": { "start": null, "end": null },
  "retrievedAt": null,
  "conditions": [
    {
      "kind": "observation",
      "variable": "AMBIENT_TEMP",
      "value": null,
      "unit": "K",
      "evidenceId": "obs:1",
      "quality": "unreviewed",
      "context": null,
      "gameSol": 1,
      "gamePhase": "morning"
    }
  ],
  "factIds": [],
  "facts": [],
  "modelAssumptions": []
}
```

Ejemplo **ilustrativo**, no es un registro real. `value: null` significa faltante: nunca se envía −999 ni 0 inventado. Los límites físicos de seguridad no se inventan para completar el contrato.

## Errores

Todos los errores tienen la forma:

```json
{ "error": { "codigo": "escenario_no_encontrado", "mensaje": "…" } }
```

| Estado | `codigo` | Cuándo |
| --- | --- | --- |
| 400 | `consulta_invalida` | Parámetro mal formado (incluye `detalles` por campo) |
| 404 | `escenario_no_encontrado`, `ficha_no_encontrada`, `fuente_no_encontrada`, `ruta_no_encontrada` | No existe o no está publicado/aprobado |
| 503 | — (`/health/listo`) | Sin conexión a la BD |
| 500 | `error_interno` | Error no previsto; el detalle solo va al registro del servidor |
