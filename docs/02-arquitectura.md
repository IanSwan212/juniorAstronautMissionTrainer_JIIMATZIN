# Arquitectura

## Componentes y responsabilidades

```mermaid
flowchart TD
    subgraph Datos["Datos (fuera del repo)"]
        Z[ZIP de muestras M01-M06<br/>SHA-256 verificado]
    end
    subgraph Back["backend/"]
        IMP[importador]
        API[API Express]
    end
    DB[(PostgreSQL)]
    subgraph Front["frontend/"]
        AD[src/api<br/>adaptador]
        PH[Phaser: escenas y mecánicas]
        RES[public/escenarios<br/>respaldo estático]
    end
    C[contrato/<br/>scenario.schema.json]

    Z --> IMP --> DB
    DB --> API
    API -- JSON --> AD --> PH
    RES -. si la API falla .-> AD
    C -. define .-> API
    C -. define .-> AD
```

| Componente | Responsable propuesto (doc 04) |
| --- | --- |
| Importación, BD, endpoints de contenido | Rol 3 |
| Adaptador HTTP y carga en Phaser | Rol 1 |
| Reglas, efectos y balance | Rol 2 |
| Texto de historia y etiquetas | Rol 5, con revisión científica del rol 3 |

Principios: el frontend **nunca** se conecta a la BD; el backend **no** consulta NASA por jugador; la lógica de recursos del juego queda en el módulo de mecánicas, no en la API.

## Carga de un escenario

```mermaid
sequenceDiagram
    participant J as Phaser
    participant A as src/api/cargarEscenario
    participant S as API Express
    participant B as PostgreSQL
    J->>A: cargarEscenario("mars-demo")
    A->>S: GET /api/v1/scenarios/mars-demo
    alt API disponible
        S->>B: escenario + condiciones + fichas
        B-->>S: filas
        S-->>A: 200 JSON (contrato v1)
        A->>A: validarEscenario()
        A-->>J: { escenario, origen: "api" }
    else error, tiempo agotado o respuesta no válida
        A->>A: GET /escenarios/mars-demo.json (respaldo)
        A-->>J: { escenario, origen: "respaldo-local" }
    end
    Note over J: La misión conserva escenario y versión hasta terminar
```

## Estructura interna del backend

```mermaid
flowchart LR
    R[routes<br/>valida con zod] --> SV[service<br/>arma el contrato] --> RP[repository<br/>SQL parametrizado] --> PG[(PostgreSQL)]
    R -. errores .-> M[middleware/errores]
```

## Conexión front ↔ back

| Entorno | Cómo se conectan |
| --- | --- |
| Desarrollo | Vite (5173) con proxy `/api` → `localhost:3000`; sin CORS |
| Producción, mismo dominio | Proxy inverso: `/api` hacia la API |
| Producción, dominios distintos | `VITE_API_URL` apunta a la API y `CORS_ORIGINS` incluye el origen del front |

## Despliegue (sin confirmar)

```mermaid
flowchart LR
    GH[GitHub Pages<br/>build de Phaser] -- HTTPS --> API[Hosting con servidor Node]
    API --> PG[(PostgreSQL gestionado)]
```

GitHub Pages solo sirve estáticos: los endpoints dinámicos necesitan un host con ejecución de servidor y acceso a PostgreSQL. Ningún proveedor está elegido. Requisitos: `DATABASE_URL` solo en servidor, lista de orígenes CORS, copias de seguridad.
