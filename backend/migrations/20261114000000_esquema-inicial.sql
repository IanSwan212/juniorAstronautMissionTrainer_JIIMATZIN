-- Up Migration
-- Esquema propuesto en 04_Backend_BD_Contrato.md §5. Borrador sujeto a aprobación del equipo.
-- Regla: ON DELETE RESTRICT por defecto; una revisión usada por un escenario publicado no se borra.

CREATE TABLE sources (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                text NOT NULL UNIQUE,              -- slug público: donki, rems, osdr...
  name                text NOT NULL,
  provider            text NOT NULL,
  url                 text,
  access_type         text NOT NULL CHECK (access_type IN ('api', 'download', 'manual', 'editorial')),
  attribution         text,
  challenge_resource  boolean NOT NULL DEFAULT false,    -- ¿figura en los recursos del challenge?
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE datasets (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    integer NOT NULL REFERENCES sources(id),
  external_id  text NOT NULL,
  product      text NOT NULL,
  platform     text,
  instrument   text,
  location     text,
  units        jsonb NOT NULL DEFAULT '{}'::jsonb,
  context      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id, product)
);

CREATE TABLE import_runs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id       integer NOT NULL REFERENCES datasets(id),
  query            text,                                  -- consulta SIN secretos (nunca api_key)
  captured_at      timestamptz NOT NULL,                  -- captura UTC
  status           text NOT NULL CHECK (status IN ('succeeded', 'partial', 'failed')),
  http_status      integer,
  records_read     integer,
  records_loaded   integer,
  error_detail     text,                                  -- 404/500/403: intento fallido, no dato científico
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_files (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_run_id  bigint NOT NULL REFERENCES import_runs(id),
  uri            text NOT NULL,                           -- ruta relativa a muestras/ o URI
  sha256         char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes     bigint NOT NULL,
  mime_type      text,
  version        text,
  kind           text NOT NULL CHECK (kind IN ('original', 'documentation', 'derived', 'error_response')),
  UNIQUE (uri, sha256)                                    -- reimportar la misma captura no duplica
);

CREATE TABLE external_records (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id      integer NOT NULL REFERENCES datasets(id),
  source_file_id  bigint NOT NULL REFERENCES source_files(id),
  external_id     text NOT NULL,                          -- p. ej. activityID de DONKI
  revision        text NOT NULL DEFAULT '1',
  record_type     text NOT NULL,                          -- CME, flare_class...
  occurred_at     timestamptz,                            -- fecha del FENÓMENO (≠ captura)
  payload         jsonb NOT NULL,
  UNIQUE (dataset_id, external_id, revision)
);
CREATE INDEX external_records_lookup_idx ON external_records (dataset_id, external_id, revision);

CREATE TABLE observations (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id      integer NOT NULL REFERENCES datasets(id),
  source_file_id  bigint NOT NULL REFERENCES source_files(id),
  record_index    integer NOT NULL,
  observed_at     timestamptz,
  mission_sol     integer,                                -- sol de la misión real (Curiosity), no del juego
  variable        text NOT NULL,
  raw_value       text,                                   -- valor original tal cual (incl. -999)
  value           double precision,                       -- valor transformado; NULL si faltante
  unit            text,
  flags           jsonb NOT NULL DEFAULT '{}'::jsonb,     -- banderas originales de calidad
  quality_status  text NOT NULL DEFAULT 'unreviewed'
                  CHECK (quality_status IN ('unreviewed', 'accepted', 'excluded_unreliable', 'missing')),
  CHECK (observed_at IS NOT NULL OR mission_sol IS NOT NULL),
  UNIQUE (source_file_id, record_index, variable)
);
CREATE INDEX observations_series_idx ON observations (dataset_id, variable, observed_at);
CREATE INDEX observations_sol_idx    ON observations (dataset_id, variable, mission_sol);

CREATE TABLE studies (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id          integer NOT NULL REFERENCES datasets(id),
  accession           text NOT NULL UNIQUE,               -- OSD-268...
  title               text NOT NULL,
  data_doi            text,
  publication_doi     text,
  mission_start       date,                               -- transporte (p. ej. SpaceX-3)
  mission_end         date,
  experiment_start    date,                               -- experimento: campo separado, NULL si no establecido
  experiment_end      date,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE fact_cards (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code             text NOT NULL,                         -- id de la etiqueta dato:<id> de Ink
  language         text NOT NULL CHECK (language ~ '^[a-z]{2}$'),
  version          integer NOT NULL DEFAULT 1,
  title            text NOT NULL,
  explanation      text NOT NULL,                         -- explicación infantil (redacción editorial)
  backed_fact      text,                                  -- hecho respaldado por la fuente
  mission_context  text,
  game_adaptation  text,
  source_refs      jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status    text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'in_review', 'approved')),
  UNIQUE (code, language, version)
);

CREATE TABLE fact_evidence (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fact_id             integer NOT NULL REFERENCES fact_cards(id) ON DELETE CASCADE,
  study_id            integer REFERENCES studies(id),
  external_record_id  bigint  REFERENCES external_records(id),
  source_file_id      bigint  REFERENCES source_files(id),
  locator             text NOT NULL,                      -- página/sección/tabla de respaldo
  claim               text NOT NULL,                      -- afirmación respaldada
  -- Exactamente una referencia: nada de combinaciones ambiguas.
  CHECK (num_nonnulls(study_id, external_record_id, source_file_id) = 1)
);

CREATE TABLE scenarios (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                text NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  rules_version       text NOT NULL,
  language            text NOT NULL CHECK (language ~ '^[a-z]{2}$'),
  publication_status  text NOT NULL DEFAULT 'draft'
                      CHECK (publication_status IN ('draft', 'review', 'published', 'retired')),
  config              jsonb NOT NULL DEFAULT '{}'::jsonb, -- dataMode, sourceCoverage, retrievedAt, modelAssumptions
  published_at        timestamptz,
  UNIQUE (code, version),
  CHECK (publication_status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE scenario_records (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id         integer NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  observation_id      bigint REFERENCES observations(id),
  external_record_id  bigint REFERENCES external_records(id),
  game_sol            integer,                            -- sol del JUEGO (1-10), no de la misión real
  game_phase          text CHECK (game_phase IN ('morning', 'day', 'emergency', 'night')),
  justification       text NOT NULL,                      -- por qué se eligió este registro
  CHECK (num_nonnulls(observation_id, external_record_id) = 1)
);
CREATE INDEX scenario_records_scenario_idx ON scenario_records (scenario_id, game_sol);

CREATE TABLE scenario_facts (
  scenario_id  integer NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  fact_id      integer NOT NULL REFERENCES fact_cards(id), -- fija la versión de la ficha en el escenario
  game_sol     integer,
  game_phase   text CHECK (game_phase IN ('morning', 'day', 'emergency', 'night')),
  PRIMARY KEY (scenario_id, fact_id)
);

-- Down Migration
DROP TABLE IF EXISTS scenario_facts;
DROP TABLE IF EXISTS scenario_records;
DROP TABLE IF EXISTS scenarios;
DROP TABLE IF EXISTS fact_evidence;
DROP TABLE IF EXISTS fact_cards;
DROP TABLE IF EXISTS studies;
DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS external_records;
DROP TABLE IF EXISTS source_files;
DROP TABLE IF EXISTS import_runs;
DROP TABLE IF EXISTS datasets;
DROP TABLE IF EXISTS sources;
