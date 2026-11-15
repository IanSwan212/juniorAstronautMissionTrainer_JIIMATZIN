# Catálogos del juego e integración con escenarios

El backend importa el JSON combinado del desglose del equipo. Conserva personajes,
recursos, calendario, minijuegos, emergencias y opciones, cartas, finales, datos
narrativos, referencias de audio y definiciones de variables. No ejecuta texto
como código y no incorpora los archivos de imagen, audio o historia compilada.

El esquema `juego` tiene 19 tablas; ver [modelo y diccionario](13-modelo-juego.md).
El esquema `ciencia` conserva sus datos, evidencias y revisiones independientes.

## Validar e importar

Desde `desarrollo/backend`, obtener el SHA-256 del archivo recibido y conservarlo
con la entrega. `--sha256` exige esa huella explícita. El importador admite JSON
combinado y puede cotejar los siete CSV de la misma entrega:

```powershell
$archivo = 'ruta/al/base_de_datos_juego.json'
$huella = (Get-FileHash -LiteralPath $archivo -Algorithm SHA256).Hash.ToLower()
pnpm contenido -- validar --archivo $archivo --sha256 $huella --csv-directorio 'ruta/a/los/csv'
pnpm contenido -- importar --archivo $archivo --sha256 $huella --csv-directorio 'ruta/a/los/csv' --actor 'persona-operadora'
```

`validar` no conecta a PostgreSQL. `importar` carga y compara todas las
proyecciones en una transacción y sella la versión del catálogo. Al repetir
compara el contenido persistido sin insertar ni sobrescribir. El `catalogId`
deriva del contenido normalizado: dos entregas diferentes no se confunden aunque
declaren la misma etiqueta `version`. Las colecciones se presentan ordenadas por
identificador, y el calendario por sol; el documento recibido se conserva aparte.

Las claves y las referencias son obligatorias según el contrato
[`contenido-juego.schema.json`](../contrato/contenido-juego.schema.json).
Los costes deben pertenecer a los recursos declarados. `energia+1` y expresiones
equivalentes permitidas se convierten en `{recurso, cambio}` mediante un parser
restringido. No se usa `eval`. Se admiten costes sugeridos opcionales en cartas y
emergencias opcionales en el calendario.

El JSON combinado incluye información que no está en los CSV, como recursos,
audio y variables. Es el documento completo de entrada. El cotejo compara las
columnas presentes y avisa de columnas omitidas por el CSV. En la V2 compartida,
`finales.csv` omite `exito.sfx`; se conserva del JSON. Una discrepancia de valor,
identificador o número de filas aborta la carga.

## Preparar un escenario de diez soles

```powershell
pnpm escenarios -- preparar --catalogo 'cat_<SHA256>' --release 'rel_<id>' --id base-marte-uno --version 1 --salida 'mi-escenario.json' --vinculos 'mis-vinculos.json'
pnpm escenarios -- crear --definicion 'mi-escenario.json' --actor 'persona-editora'
```

`preparar` consulta una instantánea de solo lectura y requiere las 240 posiciones
REMS de los diez soles. Produce un JSON nuevo sin sobrescribir un archivo
existente. No inserta ni publica. Propone comenzar con los tres recursos en nivel
3 y conserva el calendario sugerido del catálogo. Esa elección figura como
suposición educativa; puede cambiarse explícitamente en `gameplay.initialResources`
antes de crear el borrador. Los efectos de cartas siguen como `design_pending`.

`crear` admite el catálogo mediante el campo opcional:

```json
{
  "gameplay": {
    "catalogId": "cat_<SHA256>",
    "initialResources": {"energia": 3, "oxigeno": 3, "blindaje": 3},
    "factBindings": [
      {"narrativeId": "apolo13", "recordId": "<SHA256 de ficha seleccionada>", "justification": "Referencia complementaria y límites de uso"}
    ]
  }
}
```

El archivo de vínculos es una lista como `factBindings`, no el objeto completo.
Hay un ejemplo en `backend/examples/vinculos-narrativos.example.json` para las
revisiones científicas del paquete importado. Las FK impiden vincular una entrada
o ficha que no pertenezca al catálogo/escenario fijados. Una versión de escenario
existente con otro catálogo, recursos o vínculos se rechaza.

## Respuesta pública y frontend

`GET /api/v1/scenarios/{id}` añade `gameplay` al contrato 2 cuando el escenario
tiene catálogo. Los escenarios anteriores mantienen su respuesta sin ese campo.
No hay endpoints HTTP de escritura ni un catálogo global ambiguo: la misión
entrega la versión exacta de personajes, actividades, calendario y reglas que usa.

`gameplay` incluye:

- Identidad del catálogo, versión de origen y `initialResources`.
- Recursos, personajes, diez soles y referencias a nudos de Ink.
- Minijuegos con cambios de recurso estructurados, emergencias y sus opciones.
- Cartas con coste estructurado, texto del efecto y `effectStatus: design_pending`.
- Finales, identificadores de audio y tipos de variables.
- Los 22 IDs narrativos con `reviewStatus: pending_human_review` y vínculos
  complementarios hacia las revisiones científicas aprobadas seleccionadas.

El booleano/fecha `verificado` recibido en el desglose no crea decisiones
científicas. Resúmenes, fuentes y líneas de escena de `datos_reales` se conservan
administrativamente; no se exponen como fichas aprobadas. Tampoco se expone el
campo narrativo `minijuegos.evento_real`. El frontend muestra las explicaciones
aprobadas de `facts` o consulta `/facts/{id}?recordId=...` para su detalle. Una
entrada sin vínculo permanece pendiente y no debe presentarse como verificada.

La exportación existente incluye exactamente este mismo DTO. El adaptador del
frontend valida el catálogo y sus referencias tanto desde API como desde respaldo,
rechazando cambios corruptos y texto narrativo privado introducido en la respuesta.
Las fórmulas de cartas sin definir siguen pendientes de diseño; el backend no las
deduce de frases como «más energía cada mañana». Las partidas y la ejecución de
las actividades corresponden al motor del juego y no son escrituras de esta API.

## Publicación y comprobaciones

El escenario permanece oculto mientras sea borrador o su publicación científica
no esté activa. Los comandos `escenarios publicar`, `retirar` y `exportar`
conservan sus condiciones anteriores. Publicar fija además el catálogo,
recursos y vínculos; retirar oculta la misión y conserva su historial.

Las pruebas de contenido incluyen rechazo de referencias huérfanas y expresiones,
CSV entrecomillado, importación repetible, identidad ante nuevas revisiones,
inmutabilidad, reversión Up/Down/Up, API → respaldo → adaptador y exclusión de
textos narrativos sin aprobar. Ejecutar `pnpm test` y `pnpm test:integracion`.
