# Diccionario de datos de ciencia

Generado desde las migraciones científicas y de publicación con `node scripts/documentar-bd.mjs`.

Este archivo describe el DDL versionado. No consulta la instancia local ni cuenta sus filas.

PK significa clave primaria; FK, clave foránea. Las declaraciones conservan tipos,
valores por defecto y restricciones SQL. Una columna de PK es obligatoria aunque
su declaración individual no incluya `NOT NULL`. Las FK usan la acción por defecto
`NO ACTION`; no hay borrado automático en cascada en este esquema.

El modelo se explica en [08](08-diseno-dataset-cientifico.md) y los controles
administrativos en [12-publicacion.md](12-publicacion.md). Los triggers, funciones
y permisos se consultan en `backend/migrations/20261116000000_publicaciones.sql`.

## Tablas

| Tabla | Propósito |
| --- | --- |
| [sources](#sources) | Instituciones y productos de origen. |
| [datasets](#datasets) | Colecciones de datos asociadas a una fuente. |
| [source_files](#source_files) | Identidad de archivos por contenido SHA-256, independiente de su ubicación. |
| [source_file_locations](#source_file_locations) | Ubicaciones de un mismo archivo, con raíz y miembro ZIP opcional. |
| [captures](#captures) | Recuperaciones de los proveedores, con parámetros públicos y estado HTTP. |
| [capture_files](#capture_files) | Archivos obtenidos en una captura y su papel en ella. |
| [quality_policies](#quality_policies) | Definiciones versionadas de selección y calidad del proyecto. |
| [processors](#processors) | Identidad y hashes del código y configuración de procesamiento. |
| [dataset_releases](#dataset_releases) | Construcciones concretas del paquete, manifiesto y estado de publicación. |
| [import_runs](#import_runs) | Ejecuciones de carga a PostgreSQL; distintas de las capturas del proveedor. |
| [processed_records](#processed_records) | Identidad común y sobre JSON completo de cada registro procesado. |
| [record_source_refs](#record_source_refs) | Procedencia de un registro: archivo y localizador de fila, campo o sección. |
| [release_members](#release_members) | Registros incluidos en cada publicación y su nivel de uso. |
| [observations](#observations) | Valores REMS seleccionados, tiempos marcianos, unidades e indicadores originales. |
| [environment_hours](#environment_hours) | Estadísticas por hora local marciana, conteos y cobertura de las muestras. |
| [lineage_members](#lineage_members) | Observaciones que participan en cada agregado horario, por variable. |
| [instrument_events](#instrument_events) | Anotaciones documentales del instrumento, identificadas por revisión de archivo. |
| [hour_event_annotations](#hour_event_annotations) | Anotaciones instrumentales asociadas a cada agregado horario. |
| [solar_events](#solar_events) | Eventos FLR históricos del catálogo DONKI; no son dosis recibidas en Marte. |
| [radiation_samples](#radiation_samples) | Tasas de dosis del anexo educativo ISS; conservan su convención temporal. |
| [studies](#studies) | Antecedentes bibliográficos por estudio y revisión de archivo. |
| [fact_cards](#fact_cards) | Texto científico, explicación infantil, adaptación al juego y limitaciones. |
| [fact_evidence](#fact_evidence) | Evidencias de una revisión concreta de ficha y su comprobación recibida. |
| [mechanics](#mechanics) | Identificadores educativos de mecánicas; no definen algoritmos de juego. |
| [fact_mechanics](#fact_mechanics) | Relación entre revisiones de fichas y mecánicas. |
| [fact_reviews](#fact_reviews) | Historial administrativo de revisión humana de una ficha. |
| [publication_events](#publication_events) | Bitácora de comprobación técnica, publicación y retiro; conserva operador, usuario de BD e informe. |
| [release_resources](#release_resources) | Cierre de las claves de metadatos incluidas en una publicación; protege sus revisiones compartidas. |

## sources

Instituciones y productos de origen.

| Columna | Declaración SQL |
| --- | --- |
| `source_id` | `text PRIMARY KEY` |
| `institution` | `text NOT NULL` |
| `product` | `text NOT NULL` |
| `url` | `text` |

## datasets

Colecciones de datos asociadas a una fuente.

| Columna | Declaración SQL |
| --- | --- |
| `dataset_id` | `text PRIMARY KEY` |
| `source_id` | `text NOT NULL REFERENCES ciencia.sources` |
| `product` | `text NOT NULL` |
| `platform` | `text` |
| `source_context` | `text NOT NULL` |

## source_files

Identidad de archivos por contenido SHA-256, independiente de su ubicación.

| Columna | Declaración SQL |
| --- | --- |
| `source_file_id` | `text PRIMARY KEY` |
| `sha256` | `text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$')` |
| `size_bytes` | `bigint NOT NULL CHECK (size_bytes >= 0)` |

Restricciones de tabla:

```sql
CHECK (source_file_id = 'sha256:' || sha256)
```

## source_file_locations

Ubicaciones de un mismo archivo, con raíz y miembro ZIP opcional.

| Columna | Declaración SQL |
| --- | --- |
| `location_id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `source_file_id` | `text NOT NULL REFERENCES ciencia.source_files` |
| `root_key` | `text NOT NULL` |
| `relative_path` | `text NOT NULL` |
| `archive_member` | `text` |

Restricciones de tabla:

```sql
UNIQUE NULLS NOT DISTINCT (source_file_id, root_key, relative_path, archive_member)
```

## captures

Recuperaciones de los proveedores, con parámetros públicos y estado HTTP.

| Columna | Declaración SQL |
| --- | --- |
| `capture_id` | `text PRIMARY KEY` |
| `input_group` | `text NOT NULL` |
| `endpoint` | `text` |
| `public_params` | `jsonb NOT NULL DEFAULT '{}'` |
| `captured_at_utc` | `timestamptz` |
| `http_status` | `integer CHECK (http_status BETWEEN 100 AND 599)` |
| `attempts` | `jsonb NOT NULL DEFAULT '[]'` |
| `final_status` | `text NOT NULL` |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` |

## capture_files

Archivos obtenidos en una captura y su papel en ella.

| Columna | Declaración SQL |
| --- | --- |
| `capture_id` | `text REFERENCES ciencia.captures` |
| `source_file_id` | `text REFERENCES ciencia.source_files` |
| `role` | `text NOT NULL` |

Restricciones de tabla:

```sql
PRIMARY KEY (capture_id, source_file_id, role)
```

## quality_policies

Definiciones versionadas de selección y calidad del proyecto.

| Columna | Declaración SQL |
| --- | --- |
| `policy_id` | `text PRIMARY KEY` |
| `definition` | `jsonb NOT NULL` |
| `status` | `text NOT NULL` |

## processors

Identidad y hashes del código y configuración de procesamiento.

| Columna | Declaración SQL |
| --- | --- |
| `processor_id` | `text PRIMARY KEY` |
| `schema_version` | `text NOT NULL` |
| `policy_id` | `text REFERENCES ciencia.quality_policies` |
| `code_and_config_sha256` | `jsonb NOT NULL` |

## dataset_releases

Construcciones concretas del paquete, manifiesto y estado de publicación.

| Columna | Declaración SQL |
| --- | --- |
| `release_id` | `text PRIMARY KEY` |
| `dataset_version` | `text NOT NULL` |
| `schema_version` | `text NOT NULL` |
| `processor_id` | `text NOT NULL REFERENCES ciencia.processors` |
| `manifest_sha256` | `text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$')` |
| `content_hash` | `text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$')` |
| `archive_sha256` | `text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$')` |
| `status` | `text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','importing','validated','published','retired'))` |
| `build_metadata` | `jsonb NOT NULL` |
| `manifest` | `jsonb NOT NULL` |
| `published_at` | `timestamptz` |

Restricciones de tabla:

```sql
CHECK (status <> 'published' OR published_at IS NOT NULL)
```

## import_runs

Ejecuciones de carga a PostgreSQL; distintas de las capturas del proveedor.

| Columna | Declaración SQL |
| --- | --- |
| `import_run_id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `release_id` | `text NOT NULL REFERENCES ciencia.dataset_releases` |
| `started_at` | `timestamptz NOT NULL DEFAULT now()` |
| `finished_at` | `timestamptz` |
| `status` | `text NOT NULL CHECK (status IN ('running','succeeded','failed'))` |
| `counts` | `jsonb NOT NULL DEFAULT '{}'` |
| `errors` | `jsonb NOT NULL DEFAULT '[]'` |

Restricciones de tabla:

```sql
CHECK (finished_at IS NULL OR finished_at >= started_at)
CHECK ((status = 'running') = (finished_at IS NULL))
```

## processed_records

Identidad común y sobre JSON completo de cada registro procesado.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text PRIMARY KEY` |
| `record_type` | `text NOT NULL CHECK (record_type IN ('observation','environment_hour','solar_event','radiation_sample','fact'))` |
| `dataset_id` | `text NOT NULL REFERENCES ciencia.datasets` |
| `processor_id` | `text NOT NULL REFERENCES ciencia.processors` |
| `selection_policy_id` | `text REFERENCES ciencia.quality_policies` |
| `schema_version` | `text NOT NULL` |
| `source_context` | `text NOT NULL` |
| `quality_status` | `text NOT NULL CHECK (quality_status IN ('accepted','not_applicable','rejected','unknown','quarantine'))` |
| `quality_reasons` | `jsonb NOT NULL CHECK (jsonb_typeof(quality_reasons) = 'array')` |
| `payload` | `jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')` |

Restricciones de tabla:

```sql
UNIQUE (record_id, record_type)
```

## record_source_refs

Procedencia de un registro: archivo y localizador de fila, campo o sección.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text REFERENCES ciencia.processed_records` |
| `ref_index` | `integer CHECK (ref_index >= 0)` |
| `source_file_id` | `text NOT NULL REFERENCES ciencia.source_files` |
| `locator` | `jsonb NOT NULL` |

Restricciones de tabla:

```sql
PRIMARY KEY (record_id, ref_index)
```

## release_members

Registros incluidos en cada publicación y su nivel de uso.

| Columna | Declaración SQL |
| --- | --- |
| `release_id` | `text REFERENCES ciencia.dataset_releases` |
| `record_id` | `text REFERENCES ciencia.processed_records` |
| `usage_tier` | `text NOT NULL CHECK (usage_tier IN ('runtime','educational','archive'))` |

Restricciones de tabla:

```sql
PRIMARY KEY (release_id, record_id)
```

## observations

Valores REMS seleccionados, tiempos marcianos, unidades e indicadores originales.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text PRIMARY KEY` |
| `record_type` | `text NOT NULL DEFAULT 'observation' CHECK (record_type = 'observation')` |
| `variable` | `text NOT NULL` |
| `value` | `double precision NOT NULL` |
| `unit` | `text NOT NULL` |
| `source_sol` | `integer NOT NULL CHECK (source_sol >= 0)` |
| `lmst` | `text NOT NULL` |
| `ltst` | `text` |
| `lmst_hour` | `smallint NOT NULL CHECK (lmst_hour BETWEEN 0 AND 23)` |
| `source_timestamp_seconds` | `bigint NOT NULL` |
| `time_basis` | `text NOT NULL` |
| `uncertainty` | `double precision` |
| `uncertainty_unit` | `text` |
| `flags_original` | `text NOT NULL` |
| `flags_normalized` | `text NOT NULL` |

Restricciones de tabla:

```sql
FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type)
CHECK ((variable = 'ambient_temperature' AND unit = 'K' AND value > 0) OR (variable = 'pressure' AND unit = 'Pa'))
CHECK (value > '-Infinity'::float8 AND value < 'Infinity'::float8 AND value <> -999)
CHECK ((uncertainty IS NULL AND uncertainty_unit IS NULL) OR (uncertainty IS NOT NULL AND uncertainty_unit IS NOT NULL AND variable = 'pressure' AND uncertainty_unit = 'Pa' AND uncertainty >= 0 AND uncertainty < 'Infinity'::float8))
```

## environment_hours

Estadísticas por hora local marciana, conteos y cobertura de las muestras.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text PRIMARY KEY` |
| `record_type` | `text NOT NULL DEFAULT 'environment_hour' CHECK (record_type = 'environment_hour')` |
| `source_sol` | `integer NOT NULL CHECK (source_sol >= 0)` |
| `mission_day` | `integer NOT NULL CHECK (mission_day > 0)` |
| `lmst_hour` | `smallint NOT NULL CHECK (lmst_hour BETWEEN 0 AND 23)` |
| `aggregation_rule` | `text NOT NULL` |
| `lineage_id` | `text NOT NULL` |
| `temperature_min_k` | `double precision` |
| `temperature_max_k` | `double precision` |
| `temperature_mean_k` | `double precision` |
| `pressure_min_pa` | `double precision` |
| `pressure_max_pa` | `double precision` |
| `pressure_mean_pa` | `double precision` |
| `temperature_raw_row_count` | `integer NOT NULL CHECK (temperature_raw_row_count >= 0)` |
| `temperature_present_value_count` | `integer NOT NULL` |
| `temperature_selected_count` | `integer NOT NULL CHECK (temperature_selected_count >= 0)` |
| `pressure_raw_row_count` | `integer NOT NULL CHECK (pressure_raw_row_count >= 0)` |
| `pressure_present_value_count` | `integer NOT NULL` |
| `pressure_selected_count` | `integer NOT NULL CHECK (pressure_selected_count >= 0)` |
| `temperature_first_lmst` | `text` |
| `temperature_last_lmst` | `text` |
| `temperature_coverage_label` | `text NOT NULL` |
| `pressure_first_lmst` | `text` |
| `pressure_last_lmst` | `text` |
| `pressure_coverage_label` | `text NOT NULL` |

Restricciones de tabla:

```sql
FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type)
CHECK (temperature_selected_count <= temperature_present_value_count AND temperature_present_value_count <= temperature_raw_row_count)
CHECK (pressure_selected_count <= pressure_present_value_count AND pressure_present_value_count <= pressure_raw_row_count)
CHECK ((temperature_selected_count = 0 AND num_nonnulls(temperature_min_k,temperature_max_k,temperature_mean_k) = 0) OR (temperature_selected_count > 0 AND num_nonnulls(temperature_min_k,temperature_max_k,temperature_mean_k) = 3 AND temperature_min_k > 0 AND temperature_min_k <= temperature_mean_k AND temperature_mean_k <= temperature_max_k AND temperature_max_k < 'Infinity'::float8))
CHECK ((pressure_selected_count = 0 AND num_nonnulls(pressure_min_pa,pressure_max_pa,pressure_mean_pa) = 0) OR (pressure_selected_count > 0 AND num_nonnulls(pressure_min_pa,pressure_max_pa,pressure_mean_pa) = 3 AND pressure_min_pa > '-Infinity'::float8 AND pressure_min_pa <= pressure_mean_pa AND pressure_mean_pa <= pressure_max_pa AND pressure_max_pa < 'Infinity'::float8))
```

## lineage_members

Observaciones que participan en cada agregado horario, por variable.

| Columna | Declaración SQL |
| --- | --- |
| `aggregate_record_id` | `text REFERENCES ciencia.environment_hours(record_id)` |
| `observation_record_id` | `text REFERENCES ciencia.observations(record_id)` |
| `role` | `text CHECK (role IN ('temperature','pressure'))` |

Restricciones de tabla:

```sql
PRIMARY KEY (aggregate_record_id, observation_record_id, role)
```

## instrument_events

Anotaciones documentales del instrumento, identificadas por revisión de archivo.

| Columna | Declaración SQL |
| --- | --- |
| `source_file_id` | `text REFERENCES ciencia.source_files` |
| `event_annotation_id` | `text NOT NULL` |
| `sol` | `integer NOT NULL` |
| `event_text` | `text NOT NULL` |
| `gts_cal` | `boolean NOT NULL` |
| `hs_defrost` | `boolean NOT NULL` |
| `hs_regen` | `boolean NOT NULL` |
| `ps_cal` | `boolean NOT NULL` |

Restricciones de tabla:

```sql
PRIMARY KEY (source_file_id, event_annotation_id)
```

## hour_event_annotations

Anotaciones instrumentales asociadas a cada agregado horario.

| Columna | Declaración SQL |
| --- | --- |
| `aggregate_record_id` | `text REFERENCES ciencia.environment_hours(record_id)` |
| `annotation_source_file_id` | `text NOT NULL` |
| `event_annotation_id` | `text NOT NULL` |

Restricciones de tabla:

```sql
FOREIGN KEY (annotation_source_file_id, event_annotation_id) REFERENCES ciencia.instrument_events(source_file_id, event_annotation_id)
PRIMARY KEY (aggregate_record_id, annotation_source_file_id, event_annotation_id)
```

## solar_events

Eventos FLR históricos del catálogo DONKI; no son dosis recibidas en Marte.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text PRIMARY KEY` |
| `record_type` | `text NOT NULL DEFAULT 'solar_event' CHECK (record_type = 'solar_event')` |
| `external_id` | `text NOT NULL` |
| `event_type` | `text NOT NULL CHECK (event_type = 'FLR')` |
| `class_type` | `text NOT NULL` |
| `begin_time` | `timestamptz NOT NULL` |
| `peak_time` | `timestamptz` |
| `end_time` | `timestamptz` |
| `catalog` | `text NOT NULL` |
| `active_region` | `integer` |
| `source_location` | `text` |
| `source_url` | `text` |
| `source_version` | `integer` |

Restricciones de tabla:

```sql
FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type)
CHECK (peak_time IS NULL OR peak_time >= begin_time)
CHECK (end_time IS NULL OR end_time >= begin_time)
CHECK (peak_time IS NULL OR end_time IS NULL OR peak_time <= end_time)
```

## radiation_samples

Tasas de dosis del anexo educativo ISS; conservan su convención temporal.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text PRIMARY KEY` |
| `record_type` | `text NOT NULL DEFAULT 'radiation_sample' CHECK (record_type = 'radiation_sample')` |
| `variable` | `text NOT NULL CHECK (variable = 'absorbed_dose_rate')` |
| `value` | `double precision NOT NULL CHECK (value >= 0 AND value < 'Infinity'::float8)` |
| `unit` | `text NOT NULL CHECK (unit = 'uGy/h')` |
| `spacecraft` | `text NOT NULL` |
| `instrument_id` | `text NOT NULL` |
| `timestamp_original` | `text NOT NULL` |
| `time_basis` | `text NOT NULL` |
| `observed_at_utc` | `timestamptz` |
| `seconds_since_previous` | `double precision CHECK (seconds_since_previous >= 0 AND seconds_since_previous < 'Infinity'::float8)` |

Restricciones de tabla:

```sql
FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type)
```

## studies

Antecedentes bibliográficos por estudio y revisión de archivo.

| Columna | Declaración SQL |
| --- | --- |
| `accession` | `text` |
| `source_file_id` | `text REFERENCES ciencia.source_files` |
| `title` | `text NOT NULL` |
| `description` | `text` |
| `publication_doi` | `text` |
| `project_identifier` | `text` |
| `experiment_platform` | `text` |
| `mission_start` | `date` |
| `mission_end` | `date` |
| `experiment_start` | `date` |
| `experiment_end` | `date` |
| `metadata` | `jsonb NOT NULL` |

Restricciones de tabla:

```sql
PRIMARY KEY (accession, source_file_id)
CHECK (mission_end >= mission_start)
CHECK (experiment_end >= experiment_start)
```

## fact_cards

Texto científico, explicación infantil, adaptación al juego y limitaciones.

| Columna | Declaración SQL |
| --- | --- |
| `record_id` | `text PRIMARY KEY` |
| `record_type` | `text NOT NULL DEFAULT 'fact' CHECK (record_type = 'fact')` |
| `fact_key` | `text NOT NULL` |
| `language` | `text NOT NULL CHECK (language ~ '^[a-z]{2}$')` |
| `title` | `text NOT NULL` |
| `scientific_statement` | `text NOT NULL` |
| `child_explanation` | `text NOT NULL` |
| `mission_context` | `text NOT NULL` |
| `game_adaptation` | `text NOT NULL` |
| `limitations` | `jsonb NOT NULL CHECK (jsonb_typeof(limitations) = 'array')` |

Restricciones de tabla:

```sql
FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type)
```

## fact_evidence

Evidencias de una revisión concreta de ficha y su comprobación recibida.

| Columna | Declaración SQL |
| --- | --- |
| `fact_record_id` | `text REFERENCES ciencia.fact_cards(record_id)` |
| `evidence_index` | `integer CHECK (evidence_index >= 0)` |
| `evidence_type` | `text NOT NULL` |
| `source_file_id` | `text NOT NULL REFERENCES ciencia.source_files` |
| `locator` | `jsonb NOT NULL` |
| `expected` | `jsonb NOT NULL` |
| `verified_against_preserved_source` | `boolean NOT NULL` |

Restricciones de tabla:

```sql
PRIMARY KEY (fact_record_id, evidence_index)
```

## mechanics

Identificadores educativos de mecánicas; no definen algoritmos de juego.

| Columna | Declaración SQL |
| --- | --- |
| `mechanic_id` | `text PRIMARY KEY` |
| `description` | `text NOT NULL` |
| `is_formula` | `boolean NOT NULL DEFAULT false` |
| `origin` | `text NOT NULL` |

## fact_mechanics

Relación entre revisiones de fichas y mecánicas.

| Columna | Declaración SQL |
| --- | --- |
| `fact_record_id` | `text REFERENCES ciencia.fact_cards(record_id)` |
| `mechanic_id` | `text REFERENCES ciencia.mechanics` |

Restricciones de tabla:

```sql
PRIMARY KEY (fact_record_id, mechanic_id)
```

## fact_reviews

Historial administrativo de revisión humana de una ficha.

| Columna | Declaración SQL |
| --- | --- |
| `review_id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `fact_record_id` | `text NOT NULL REFERENCES ciencia.fact_cards(record_id)` |
| `decision` | `text NOT NULL CHECK (decision IN ('approved','rejected','pending_human_review'))` |
| `reviewed_at` | `timestamptz NOT NULL DEFAULT now()` |
| `reviewer_ref` | `text NOT NULL` |
| `notes` | `text` |

Restricciones de tabla:

```sql
CONSTRAINT fact_reviews_reviewer_not_blank CHECK (length(btrim(reviewer_ref))>0)
```

## publication_events

Bitácora de comprobación técnica, publicación y retiro; conserva operador, usuario de BD e informe.

| Columna | Declaración SQL |
| --- | --- |
| `event_id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `release_id` | `text NOT NULL REFERENCES ciencia.dataset_releases` |
| `action` | `text NOT NULL CHECK (action IN ('checked','published','retired'))` |
| `actor_ref` | `text NOT NULL CHECK (length(btrim(actor_ref)) BETWEEN 1 AND 200)` |
| `database_actor` | `text NOT NULL DEFAULT session_user` |
| `occurred_at` | `timestamptz NOT NULL DEFAULT clock_timestamp()` |
| `transaction_id` | `bigint NOT NULL DEFAULT txid_current()` |
| `report` | `jsonb NOT NULL CHECK (jsonb_typeof(report)='object')` |
| `reason` | `text` |

## release_resources

Cierre de las claves de metadatos incluidas en una publicación; protege sus revisiones compartidas.

| Columna | Declaración SQL |
| --- | --- |
| `release_id` | `text REFERENCES ciencia.dataset_releases` |
| `table_name` | `text CHECK (table_name IN ('sources','datasets','source_files','source_file_locations','captures', 'capture_files','quality_policies','processors','studies','mechanics','instrument_events'))` |
| `resource_key` | `jsonb CHECK (jsonb_typeof(resource_key)='object')` |

Restricciones de tabla:

```sql
PRIMARY KEY (release_id,table_name,resource_key)
```
