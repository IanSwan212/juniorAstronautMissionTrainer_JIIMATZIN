-- Up Migration
-- Modelo del paquete ajustado; public conserva el contrato de la API anterior.
CREATE SCHEMA ciencia;

CREATE TABLE ciencia.sources (
  source_id text PRIMARY KEY, institution text NOT NULL, product text NOT NULL, url text
);
CREATE TABLE ciencia.datasets (
  dataset_id text PRIMARY KEY, source_id text NOT NULL REFERENCES ciencia.sources,
  product text NOT NULL, platform text, source_context text NOT NULL
);
CREATE TABLE ciencia.source_files (
  source_file_id text PRIMARY KEY,
  sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  CHECK (source_file_id = 'sha256:' || sha256)
);
CREATE TABLE ciencia.source_file_locations (
  location_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_file_id text NOT NULL REFERENCES ciencia.source_files,
  root_key text NOT NULL, relative_path text NOT NULL, archive_member text,
  UNIQUE NULLS NOT DISTINCT (source_file_id, root_key, relative_path, archive_member)
);
CREATE TABLE ciencia.captures (
  capture_id text PRIMARY KEY, input_group text NOT NULL, endpoint text,
  public_params jsonb NOT NULL DEFAULT '{}', captured_at_utc timestamptz,
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  attempts jsonb NOT NULL DEFAULT '[]', final_status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE ciencia.capture_files (
  capture_id text REFERENCES ciencia.captures,
  source_file_id text REFERENCES ciencia.source_files, role text NOT NULL,
  PRIMARY KEY (capture_id, source_file_id, role)
);
CREATE TABLE ciencia.quality_policies (
  policy_id text PRIMARY KEY, definition jsonb NOT NULL, status text NOT NULL
);
CREATE TABLE ciencia.processors (
  processor_id text PRIMARY KEY, schema_version text NOT NULL,
  policy_id text REFERENCES ciencia.quality_policies,
  code_and_config_sha256 jsonb NOT NULL
);
CREATE TABLE ciencia.dataset_releases (
  release_id text PRIMARY KEY, dataset_version text NOT NULL, schema_version text NOT NULL,
  processor_id text NOT NULL REFERENCES ciencia.processors,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','importing','validated','published','retired')),
  build_metadata jsonb NOT NULL, manifest jsonb NOT NULL, published_at timestamptz,
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE TABLE ciencia.import_runs (
  import_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id text NOT NULL REFERENCES ciencia.dataset_releases,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  counts jsonb NOT NULL DEFAULT '{}', errors jsonb NOT NULL DEFAULT '[]',
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE TABLE ciencia.processed_records (
  record_id text PRIMARY KEY, record_type text NOT NULL
    CHECK (record_type IN ('observation','environment_hour','solar_event','radiation_sample','fact')),
  dataset_id text NOT NULL REFERENCES ciencia.datasets,
  processor_id text NOT NULL REFERENCES ciencia.processors,
  selection_policy_id text REFERENCES ciencia.quality_policies,
  schema_version text NOT NULL, source_context text NOT NULL,
  quality_status text NOT NULL CHECK (quality_status IN ('accepted','not_applicable','rejected','unknown','quarantine')),
  quality_reasons jsonb NOT NULL CHECK (jsonb_typeof(quality_reasons) = 'array'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (record_id, record_type)
);
CREATE TABLE ciencia.record_source_refs (
  record_id text REFERENCES ciencia.processed_records,
  ref_index integer CHECK (ref_index >= 0),
  source_file_id text NOT NULL REFERENCES ciencia.source_files, locator jsonb NOT NULL,
  PRIMARY KEY (record_id, ref_index)
);
CREATE TABLE ciencia.release_members (
  release_id text REFERENCES ciencia.dataset_releases,
  record_id text REFERENCES ciencia.processed_records,
  usage_tier text NOT NULL CHECK (usage_tier IN ('runtime','educational','archive')),
  PRIMARY KEY (release_id, record_id)
);
CREATE INDEX release_members_record_idx ON ciencia.release_members(record_id);

-- El discriminador constante con FK compuesta impide un subtipo equivocado.
CREATE TABLE ciencia.observations (
  record_id text PRIMARY KEY,
  record_type text NOT NULL DEFAULT 'observation' CHECK (record_type = 'observation'),
  FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type),
  variable text NOT NULL, value double precision NOT NULL,
  unit text NOT NULL, source_sol integer NOT NULL CHECK (source_sol >= 0),
  lmst text NOT NULL, ltst text, lmst_hour smallint NOT NULL CHECK (lmst_hour BETWEEN 0 AND 23),
  source_timestamp_seconds bigint NOT NULL, time_basis text NOT NULL,
  uncertainty double precision, uncertainty_unit text,
  flags_original text NOT NULL, flags_normalized text NOT NULL,
  CHECK ((variable = 'ambient_temperature' AND unit = 'K' AND value > 0)
      OR (variable = 'pressure' AND unit = 'Pa')),
  CHECK (value > '-Infinity'::float8 AND value < 'Infinity'::float8 AND value <> -999),
  CHECK ((uncertainty IS NULL AND uncertainty_unit IS NULL)
      OR (uncertainty IS NOT NULL AND uncertainty_unit IS NOT NULL AND variable = 'pressure'
          AND uncertainty_unit = 'Pa' AND uncertainty >= 0 AND uncertainty < 'Infinity'::float8))
);
CREATE INDEX observations_series_idx ON ciencia.observations(variable, source_sol, lmst);

CREATE TABLE ciencia.environment_hours (
  record_id text PRIMARY KEY,
  record_type text NOT NULL DEFAULT 'environment_hour' CHECK (record_type = 'environment_hour'),
  FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type),
  source_sol integer NOT NULL CHECK (source_sol >= 0),
  mission_day integer NOT NULL CHECK (mission_day > 0),
  lmst_hour smallint NOT NULL CHECK (lmst_hour BETWEEN 0 AND 23),
  aggregation_rule text NOT NULL, lineage_id text NOT NULL,
  temperature_min_k double precision, temperature_max_k double precision, temperature_mean_k double precision,
  pressure_min_pa double precision, pressure_max_pa double precision, pressure_mean_pa double precision,
  temperature_raw_row_count integer NOT NULL CHECK (temperature_raw_row_count >= 0),
  temperature_present_value_count integer NOT NULL,
  temperature_selected_count integer NOT NULL CHECK (temperature_selected_count >= 0),
  pressure_raw_row_count integer NOT NULL CHECK (pressure_raw_row_count >= 0),
  pressure_present_value_count integer NOT NULL,
  pressure_selected_count integer NOT NULL CHECK (pressure_selected_count >= 0),
  temperature_first_lmst text, temperature_last_lmst text, temperature_coverage_label text NOT NULL,
  pressure_first_lmst text, pressure_last_lmst text, pressure_coverage_label text NOT NULL,
  CHECK (temperature_selected_count <= temperature_present_value_count AND temperature_present_value_count <= temperature_raw_row_count),
  CHECK (pressure_selected_count <= pressure_present_value_count AND pressure_present_value_count <= pressure_raw_row_count),
  CHECK ((temperature_selected_count = 0 AND num_nonnulls(temperature_min_k,temperature_max_k,temperature_mean_k) = 0)
      OR (temperature_selected_count > 0 AND num_nonnulls(temperature_min_k,temperature_max_k,temperature_mean_k) = 3
          AND temperature_min_k > 0 AND temperature_min_k <= temperature_mean_k
          AND temperature_mean_k <= temperature_max_k AND temperature_max_k < 'Infinity'::float8)),
  CHECK ((pressure_selected_count = 0 AND num_nonnulls(pressure_min_pa,pressure_max_pa,pressure_mean_pa) = 0)
      OR (pressure_selected_count > 0 AND num_nonnulls(pressure_min_pa,pressure_max_pa,pressure_mean_pa) = 3
          AND pressure_min_pa > '-Infinity'::float8 AND pressure_min_pa <= pressure_mean_pa
          AND pressure_mean_pa <= pressure_max_pa AND pressure_max_pa < 'Infinity'::float8))
);
CREATE INDEX environment_hours_day_idx ON ciencia.environment_hours(mission_day, lmst_hour);
CREATE TABLE ciencia.lineage_members (
  aggregate_record_id text REFERENCES ciencia.environment_hours(record_id),
  observation_record_id text REFERENCES ciencia.observations(record_id),
  role text CHECK (role IN ('temperature','pressure')),
  PRIMARY KEY (aggregate_record_id, observation_record_id, role)
);
CREATE INDEX lineage_members_observation_idx ON ciencia.lineage_members(observation_record_id);
CREATE TABLE ciencia.instrument_events (
  source_file_id text REFERENCES ciencia.source_files,
  event_annotation_id text NOT NULL, sol integer NOT NULL,
  event_text text NOT NULL, gts_cal boolean NOT NULL, hs_defrost boolean NOT NULL,
  hs_regen boolean NOT NULL, ps_cal boolean NOT NULL,
  PRIMARY KEY (source_file_id, event_annotation_id)
);
CREATE TABLE ciencia.hour_event_annotations (
  aggregate_record_id text REFERENCES ciencia.environment_hours(record_id),
  annotation_source_file_id text NOT NULL, event_annotation_id text NOT NULL,
  FOREIGN KEY (annotation_source_file_id, event_annotation_id)
    REFERENCES ciencia.instrument_events(source_file_id, event_annotation_id),
  PRIMARY KEY (aggregate_record_id, annotation_source_file_id, event_annotation_id)
);
CREATE TABLE ciencia.solar_events (
  record_id text PRIMARY KEY,
  record_type text NOT NULL DEFAULT 'solar_event' CHECK (record_type = 'solar_event'),
  FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type),
  external_id text NOT NULL, event_type text NOT NULL CHECK (event_type = 'FLR'),
  class_type text NOT NULL, begin_time timestamptz NOT NULL, peak_time timestamptz, end_time timestamptz,
  catalog text NOT NULL, active_region integer, source_location text, source_url text, source_version integer,
  CHECK (peak_time IS NULL OR peak_time >= begin_time),
  CHECK (end_time IS NULL OR end_time >= begin_time),
  CHECK (peak_time IS NULL OR end_time IS NULL OR peak_time <= end_time)
);
CREATE INDEX solar_events_external_idx ON ciencia.solar_events(external_id);
CREATE TABLE ciencia.radiation_samples (
  record_id text PRIMARY KEY,
  record_type text NOT NULL DEFAULT 'radiation_sample' CHECK (record_type = 'radiation_sample'),
  FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type),
  variable text NOT NULL CHECK (variable = 'absorbed_dose_rate'),
  value double precision NOT NULL CHECK (value >= 0 AND value < 'Infinity'::float8),
  unit text NOT NULL CHECK (unit = 'uGy/h'), spacecraft text NOT NULL, instrument_id text NOT NULL,
  timestamp_original text NOT NULL, time_basis text NOT NULL, observed_at_utc timestamptz,
  seconds_since_previous double precision CHECK (seconds_since_previous >= 0 AND seconds_since_previous < 'Infinity'::float8)
);
CREATE TABLE ciencia.studies (
  accession text, source_file_id text REFERENCES ciencia.source_files,
  title text NOT NULL, description text, publication_doi text, project_identifier text,
  experiment_platform text, mission_start date, mission_end date,
  experiment_start date, experiment_end date, metadata jsonb NOT NULL,
  PRIMARY KEY (accession, source_file_id),
  CHECK (mission_end >= mission_start), CHECK (experiment_end >= experiment_start)
);
CREATE TABLE ciencia.fact_cards (
  record_id text PRIMARY KEY,
  record_type text NOT NULL DEFAULT 'fact' CHECK (record_type = 'fact'),
  FOREIGN KEY (record_id, record_type) REFERENCES ciencia.processed_records(record_id, record_type),
  fact_key text NOT NULL, language text NOT NULL CHECK (language ~ '^[a-z]{2}$'),
  title text NOT NULL, scientific_statement text NOT NULL, child_explanation text NOT NULL,
  mission_context text NOT NULL, game_adaptation text NOT NULL,
  limitations jsonb NOT NULL CHECK (jsonb_typeof(limitations) = 'array')
);
CREATE INDEX fact_cards_lookup_idx ON ciencia.fact_cards(fact_key, language);
CREATE TABLE ciencia.fact_evidence (
  fact_record_id text REFERENCES ciencia.fact_cards(record_id),
  evidence_index integer CHECK (evidence_index >= 0), evidence_type text NOT NULL,
  source_file_id text NOT NULL REFERENCES ciencia.source_files, locator jsonb NOT NULL,
  expected jsonb NOT NULL, verified_against_preserved_source boolean NOT NULL,
  PRIMARY KEY (fact_record_id, evidence_index)
);
CREATE TABLE ciencia.mechanics (
  mechanic_id text PRIMARY KEY, description text NOT NULL,
  is_formula boolean NOT NULL DEFAULT false, origin text NOT NULL
);
CREATE TABLE ciencia.fact_mechanics (
  fact_record_id text REFERENCES ciencia.fact_cards(record_id),
  mechanic_id text REFERENCES ciencia.mechanics, PRIMARY KEY (fact_record_id, mechanic_id)
);
CREATE INDEX fact_mechanics_lookup_idx ON ciencia.fact_mechanics(mechanic_id, fact_record_id);
CREATE TABLE ciencia.fact_reviews (
  review_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fact_record_id text NOT NULL REFERENCES ciencia.fact_cards(record_id),
  decision text NOT NULL CHECK (decision IN ('approved','rejected','pending_human_review')),
  reviewed_at timestamptz NOT NULL DEFAULT now(), reviewer_ref text NOT NULL, notes text
);

-- Down Migration
-- Orden explícito: no usar CASCADE que pueda borrar dependencias ajenas.
DROP TABLE ciencia.fact_reviews, ciencia.fact_mechanics, ciencia.mechanics,
  ciencia.fact_evidence, ciencia.fact_cards, ciencia.studies, ciencia.radiation_samples,
  ciencia.solar_events, ciencia.hour_event_annotations, ciencia.instrument_events,
  ciencia.lineage_members, ciencia.environment_hours, ciencia.observations,
  ciencia.release_members, ciencia.record_source_refs, ciencia.processed_records,
  ciencia.import_runs, ciencia.dataset_releases, ciencia.processors,
  ciencia.quality_policies, ciencia.capture_files, ciencia.captures,
  ciencia.source_file_locations, ciencia.source_files, ciencia.datasets, ciencia.sources;
DROP SCHEMA ciencia;
