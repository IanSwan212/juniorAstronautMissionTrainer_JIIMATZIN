# Importación del paquete científico ajustado

El importador administrativo está implementado en `backend/src/importador/`.
Lee el ZIP estandarizado v1.0.0, verifica su integridad y carga `ciencia`.
No ejecuta el pipeline incluido, no consulta proveedores externos, no escribe en
`public`, no publica construcciones ni registra aprobaciones humanas.

## Requisitos y ejecución

Node según `package.json`, Python 3 disponible como `python` y las migraciones
del proyecto aplicadas. `PYTHON` puede indicar otra ruta al ejecutable. No se añadieron nuevas
dependencias npm. Para cargar se requieren `DATABASE_URL` y, si corresponde,
`DATABASE_SSL`; se leen de `desarrollo/.env`. El modo de validación no necesita BD.

Desde `desarrollo`, en PowerShell:

```powershell
$paquete = (Resolve-Path '../JIIMATZIN_Dataset_v1.0.0_ajustado (2).zip').Path
$huella = '3fe144ab34f0f11a8e3c4eccf701d6c8567a365d12a0bf5f9114991e70c28f67'
pnpm --filter @jiimatzin/backend importar -- --archivo "$paquete" --sha256 $huella --validar
pnpm --filter @jiimatzin/backend importar -- --archivo "$paquete" --sha256 $huella
```

El SHA-256 esperado es obligatorio y debe proceder de un registro externo al ZIP.
Para este archivo es la huella auditada en [08](08-diseno-dataset-cientifico.md).
No uses la huella de otro ZIP con nombre parecido. Las rutas relativas pasadas
al comando se resuelven desde `backend`; el ejemplo evita esa ambigüedad.

El comando escribe progreso en stderr y el resultado JSON en stdout. Un fallo
produce salida distinta de cero. `--ayuda` muestra las opciones.

## Verificación previa

1. Verifica SHA-256 del ZIP, miembros duplicados, rutas relativas, enlaces,
   cifrado y un límite de 2 GiB descomprimidos.
2. Recalcula el inventario `checksums.sha256` (198 entradas en el paquete real),
   exige cobertura del manifiesto, coteja `manifest.files`, las huellas del
   procesador y `content_hash_reproducible`.
3. Comprueba los 20 JSONL y sus conteos. Rechaza JSON con claves repetidas,
   números no finitos y líneas vacías. Solo prepara esos JSONL en un directorio
   temporal propio; se elimina al terminar, incluso ante un fallo normal.
4. Exige los seis contratos JSON versionados del formato recibido. Los registros
   se validan con Zod usando copias en `src/importador/schemas`, sin ejecutar
   validadores suministrados por el paquete.
5. Comprueba identidad del procesador, política, tipos, procedencia, membresías,
   idiomas y referencias de fichas. Valida unidades, flags exigidos por la política,
   LMST, día ficticio, cobertura, faltantes y secuencia temporal solar.

`--validar` comprueba integridad, contratos, relaciones resueltas en memoria y
proyecciones. Las FK, los conflictos con filas existentes y el contraste de
estadísticas con el linaje se comprueban durante la carga SQL.

La verificación de integridad no certifica la autenticidad de NASA ni vuelve a
extraer datos de los proveedores. Las ubicaciones originales A/B se conservan
como referencias relativas; su resolución y respaldo siguen siendo operativos.

## Mapeo

| Entrada | Tratamiento |
| --- | --- |
| `sources`, `datasets` | Conserva IDs del paquete, institución, producto y contexto |
| `source_files.locations` | Separa identidad por hash de ubicaciones relativas A/B |
| `captures` | Conserva parámetros públicos, intentos y metadatos; ausencia de fecha → NULL; `Z` y `+00:00` se interpretan como UTC |
| Sobres científicos | Conserva el sobre completo en `processed_records.payload`; proyecta datos tipados y procedencia |
| Observaciones REMS | Solo seleccionadas; conserva flags; no convierte −999 en cero ni inventa mediciones faltantes |
| Agregados horarios | Conserva estadísticas nulas cuando no hay muestras; valida conteos, mínimos, máximos, media y cobertura contra el linaje |
| DONKI FLR | Mantiene contexto solar; no lo convierte en dosis marciana |
| RadLab ISS | Mantiene `timestamp_original`; `observed_at_utc` sigue NULL |
| OSDR | Fechas de misión MM/DD/AAAA se proyectan a DATE; fechas experimentales ausentes quedan NULL; originales permanecen en metadata |
| Fichas | Conserva límites, referencias y mecánicas; no crea filas de `fact_reviews` |
| Anotaciones instrumentales | Resuelve archivo por ID de anotación inequívoco; exige correspondencia con sol/hora |

El catálogo de fichas reúne contextos de distintas misiones. El contexto específico
del registro no se sustituye por el contexto general de su dataset.

El contraste de medias admite error numérico relativo `1e-10` (con escala mínima
1), para diferencias de acumulación de punto flotante entre Python y PostgreSQL.
No es un margen de incertidumbre física. Mínimos y máximos deben coincidir.

## Transacciones e idempotencia

Un bloqueo asesor serializa las importaciones. Primero se registran de forma
transaccional política, procesador y publicación `candidate`. Después se abre
un `import_run` real y una transacción para todo el contenido del paquete.

Las tablas temporales tipadas se llenan por lotes de 1000 filas y rechazan claves
duplicadas. Las inserciones usan `ON CONFLICT DO NOTHING`, seguido de comparación
de **todas** las columnas proyectadas con los datos existentes. Un ID con contenido
distinto aborta: no se sobrescriben revisiones ni se completan silenciosamente.
Una segunda carga idéntica inserta cero filas de contenido y añade su propio
registro de auditoría.

Cada sentencia de la transacción de contenido tiene un límite de 120 segundos;
el comando completo puede tardar más. Los controles del linaje comparan total
y cardinalidad de observaciones para evitar recorridos cuadráticos.

Solo se permite cargar publicaciones en estado `candidate`. No modifica
publicaciones `validated`, `published`, `retired` o `importing`.

Si falla el contenido, toda esa transacción se revierte y el intento queda
`failed`. Política, procesador y publicación candidata pueden permanecer como
metadatos del intento. Los fallos anteriores al registro de publicación/intento
se reportan por CLI, sin crear un `import_run` con una FK inexistente.
Una interrupción forzosa puede dejar un intento `running` y temporales del sistema;
no se reclasifica automáticamente sin comprobar si el proceso sigue activo.

Importar no completa los [controles de publicación](08-diseno-dataset-cientifico.md#condiciones-antes-de-importar-y-publicar).
Las fichas importadas seguirán devolviendo 404 en la API hasta su revisión humana.

## Pruebas

- `pnpm test`: pruebas sin PostgreSQL, incluidos ZIP inválidos, contratos,
  unidades, tiempos, membresías y conservación de faltantes. Requiere Python 3.
- `pnpm test:integracion`: BD temporal nueva por suite, migraciones desde cero,
  carga mínima, repetición sin duplicados, conflicto de contenido, reversión de
  linaje y rechazo de estados ajenos a `candidate`. Las bases se eliminan al terminar.
- Prueba completa opcional: define `DATASET_TEST_ARCHIVE` (ruta absoluta) y
  `DATASET_TEST_SHA256` antes de `pnpm test:integracion`. Carga y repite el ZIP
  real en la BD temporal; comprueba 263 782 registros y los conteos por subtipo.

Las reglas exploratorias antiguas M01–M06 (29 CME, FLR 404, RadLab 500 y 70 hashes)
no se aplican a este paquete ajustado. Sus errores originales permanecen como
capturas o contenido de archivo, sin convertirse en mediciones seleccionadas.

## Estado comprobado en desarrollo

El 14 de noviembre de 2026 se cargó
`rel_40afe5ce9bfa07d6bf26fa729478db67` en PostgreSQL local. El intento
`import_run_id=1` terminó `succeeded`; la publicación permanece `candidate`.

| Contenido persistido | Cantidad |
| --- | ---: |
| Observaciones REMS | 263 358 (122 578 temperatura, 140 780 presión) |
| Horas | 240 |
| Eventos FLR | 93 |
| Muestras ISS | 84 |
| Fichas | 7 |
| Total de registros procesados / membresías | 263 782 / 263 782 |
| Referencias de procedencia | 263 795 |
| Evidencias de fichas | 20 |
| Revisiones humanas | 0 |

Se comprobaron 31 horas sin temperatura, 34 sin presión y 31 vacías en ambas,
sin rellenar valores. La API respondió 200 en `/health/listo` y en la fuente
`nasa_pds_nmsu_rems`; la ficha `fact_apollo13_mailbox_co2` respondió 404 por no
tener aprobación humana, como corresponde.

En el cierre inicial de la importación pasaron 41 pruebas sin BD y 13 de integración con PostgreSQL, incluida la carga
completa y una segunda carga que insertó cero filas de contenido. Se verificó
que no quedaron bases `jiimatzin_test_*`. Esta comprobación describe el estado
local observado; no sustituye la revisión ni el cierre de publicación pendientes.
