-- Up Migration
-- El dueño de la BD es autoridad administrativa. La API usa permisos de lectura.
-- Los controles de contenido contra el ZIP se ejecutan en la CLI bajo bloqueos;
-- la BD exige su comprobante en la misma transacción para cambiar el estado.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ciencia.dataset_releases WHERE published_at IS NOT NULL OR status IN ('published','retired')) THEN
    RAISE EXCEPTION 'Existen publicaciones sin sello; revisarlas antes de aplicar esta migración';
  END IF;
END $$;

CREATE TABLE ciencia.publication_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id text NOT NULL REFERENCES ciencia.dataset_releases,
  action text NOT NULL CHECK (action IN ('checked','published','retired')),
  actor_ref text NOT NULL CHECK (length(btrim(actor_ref)) BETWEEN 1 AND 200),
  database_actor text NOT NULL DEFAULT session_user,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object'), reason text
);
CREATE INDEX publication_events_release_idx ON ciencia.publication_events(release_id,event_id DESC);
CREATE TABLE ciencia.release_resources (
  release_id text REFERENCES ciencia.dataset_releases,
  table_name text CHECK (table_name IN ('sources','datasets','source_files','source_file_locations','captures',
    'capture_files','quality_policies','processors','studies','mechanics','instrument_events')),
  resource_key jsonb CHECK (jsonb_typeof(resource_key)='object'),
  PRIMARY KEY (release_id,table_name,resource_key)
);
CREATE INDEX release_resources_lookup_idx ON ciencia.release_resources(table_name,resource_key);
CREATE INDEX fact_reviews_latest_idx ON ciencia.fact_reviews(fact_record_id,reviewed_at DESC,review_id DESC);
ALTER TABLE ciencia.fact_reviews ADD CONSTRAINT fact_reviews_reviewer_not_blank CHECK (length(btrim(reviewer_ref))>0);

CREATE FUNCTION ciencia.release_sealed(id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,ciencia AS $$
  SELECT EXISTS (SELECT 1 FROM ciencia.dataset_releases WHERE release_id=id AND published_at IS NOT NULL)
$$;
CREATE FUNCTION ciencia.record_sealed(id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,ciencia AS $$
  SELECT EXISTS (SELECT 1 FROM ciencia.release_members m JOIN ciencia.dataset_releases r USING(release_id)
    WHERE m.record_id=id AND r.published_at IS NOT NULL)
$$;

CREATE FUNCTION ciencia.guard_content() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ciencia AS $$
DECLARE data jsonb; key jsonb; field text; i integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Las escrituras científicas requieren READ COMMITTED' USING ERRCODE='55000'; END IF;
  FOR i IN 1..2 LOOP
    IF i=1 AND TG_OP<>'INSERT' THEN data=to_jsonb(OLD);
    ELSIF i=2 AND TG_OP<>'DELETE' THEN data=to_jsonb(NEW);
    ELSE CONTINUE; END IF;
    IF TG_ARGV[0]='record' THEN
      IF ciencia.record_sealed(data->>TG_ARGV[1]) THEN RAISE EXCEPTION 'Registro publicado inmutable: %',TG_TABLE_NAME USING ERRCODE='55000'; END IF;
    ELSIF TG_ARGV[0]='release' THEN
      IF ciencia.release_sealed(data->>'release_id') THEN RAISE EXCEPTION 'Membresía o recurso publicado inmutable' USING ERRCODE='55000'; END IF;
    ELSE
      key='{}'::jsonb;
      FOREACH field IN ARRAY string_to_array(TG_ARGV[1],',') LOOP key=key||jsonb_build_object(field,data->field); END LOOP;
      IF EXISTS (SELECT 1 FROM ciencia.release_resources x JOIN ciencia.dataset_releases r USING(release_id)
        WHERE x.table_name=TG_TABLE_NAME AND x.resource_key=key AND r.published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Metadato publicado inmutable: %',TG_TABLE_NAME USING ERRCODE='55000';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION ciencia.guard_release() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ciencia AS $$
DECLARE expected text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'La administración requiere READ COMMITTED' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'candidate' OR NEW.published_at IS NOT NULL THEN RAISE EXCEPTION 'Una construcción nueva debe ser candidate'; END IF;
  ELSIF TG_OP='DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'No se elimina una publicación sellada' USING ERRCODE='55000'; END IF;
  ELSE
    IF OLD.published_at IS NOT NULL AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
      RAISE EXCEPTION 'Contenido de publicación inmutable' USING ERRCODE='55000';
    END IF;
    IF NEW.status=OLD.status AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN RETURN NEW; END IF;
    IF OLD.status IN ('candidate','importing') AND NEW.status IN ('candidate','importing') AND NEW.published_at IS NULL THEN RETURN NEW; END IF;
    expected=CASE WHEN OLD.status='candidate' AND NEW.status='published' THEN 'published'
                  WHEN OLD.status='published' AND NEW.status='retired' THEN 'retired' END;
    IF expected IS NULL OR NOT EXISTS (SELECT 1 FROM ciencia.publication_events e
      WHERE e.release_id=OLD.release_id AND e.action=expected AND e.transaction_id=txid_current()
        AND (expected='retired' OR NEW.published_at=e.occurred_at)) THEN
      RAISE EXCEPTION 'La transición requiere el procedimiento administrativo de publicación' USING ERRCODE='55000';
    END IF;
    IF (to_jsonb(NEW)-ARRAY['status','published_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','published_at']) THEN
      RAISE EXCEPTION 'No cambiar contenido durante la publicación';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_release BEFORE INSERT OR UPDATE OR DELETE ON ciencia.dataset_releases
  FOR EACH ROW EXECUTE FUNCTION ciencia.guard_release();

CREATE FUNCTION ciencia.guard_review() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ciencia AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'La revisión requiere READ COMMITTED' USING ERRCODE='55000'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Las revisiones son un historial de solo anexado' USING ERRCODE='55000'; END IF;
  IF NEW.reviewed_at>clock_timestamp() THEN RAISE EXCEPTION 'No se registra una revisión futura'; END IF;
  IF NEW.decision<>'approved' AND EXISTS (
    SELECT 1 FROM ciencia.release_members m JOIN ciencia.dataset_releases r USING(release_id)
      WHERE m.record_id=NEW.fact_record_id AND r.status='published'
  ) THEN RAISE EXCEPTION 'Retirar las publicaciones activas antes de revocar su aprobación' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_review BEFORE INSERT OR UPDATE OR DELETE ON ciencia.fact_reviews
  FOR EACH ROW EXECUTE FUNCTION ciencia.guard_review();

CREATE FUNCTION ciencia.guard_import_audit() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ciencia AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'running' THEN RAISE EXCEPTION 'Un intento nuevo debe empezar running'; END IF;
  ELSE
    IF TG_OP='DELETE' OR OLD.status<>'running' THEN RAISE EXCEPTION 'Auditoría de importación inmutable' USING ERRCODE='55000'; END IF;
    IF ROW(NEW.import_run_id,NEW.release_id,NEW.started_at) IS DISTINCT FROM ROW(OLD.import_run_id,OLD.release_id,OLD.started_at) THEN
      RAISE EXCEPTION 'Identidad de intento inmutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_import_audit BEFORE INSERT OR UPDATE OR DELETE ON ciencia.import_runs
  FOR EACH ROW EXECUTE FUNCTION ciencia.guard_import_audit();

CREATE FUNCTION ciencia.guard_event() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ciencia AS $$
DECLARE r ciencia.dataset_releases; last_check jsonb; last_import text; resource record;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'La publicación requiere READ COMMITTED' USING ERRCODE='55000'; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Bitácora de publicación inmutable' USING ERRCODE='55000'; END IF;
  -- La CLI toma estos mismos bloqueos ANTES de validar. También se toman aquí
  -- para que ninguna transición pueda competir con DML/revisiones concurrentes.
  LOCK TABLE ciencia.dataset_releases,ciencia.release_members,ciencia.fact_reviews IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT r FROM ciencia.dataset_releases WHERE release_id=NEW.release_id FOR UPDATE;
  NEW.database_actor=session_user; NEW.occurred_at=clock_timestamp(); NEW.transaction_id=txid_current();
  IF NEW.action='checked' THEN
    IF NEW.report->>'validator_version' IS DISTINCT FROM 'publication-1'
      OR NEW.report->>'archive_sha256' IS DISTINCT FROM r.archive_sha256
      OR NEW.report->>'manifest_sha256' IS DISTINCT FROM r.manifest_sha256 THEN RAISE EXCEPTION 'Comprobante de validación incompatible'; END IF;
  ELSIF NEW.action='published' THEN
    IF r.status<>'candidate' THEN RAISE EXCEPTION 'Solo se publica una construcción candidate'; END IF;
    SELECT report INTO last_check FROM ciencia.publication_events
      WHERE release_id=r.release_id AND action='checked' AND transaction_id=txid_current() ORDER BY event_id DESC LIMIT 1;
    IF last_check IS NULL OR last_check->'ready_for_publication' IS DISTINCT FROM 'true'::jsonb
      OR last_check->'technical_ok' IS DISTINCT FROM 'true'::jsonb
      OR last_check->>'archive_sha256' IS DISTINCT FROM r.archive_sha256
      OR last_check->>'manifest_sha256' IS DISTINCT FROM r.manifest_sha256 THEN RAISE EXCEPTION 'Se requiere validación completa en la misma transacción'; END IF;
    SELECT status INTO last_import FROM ciencia.import_runs WHERE release_id=r.release_id ORDER BY import_run_id DESC LIMIT 1;
    IF last_import IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'El último intento de importación no terminó correctamente'; END IF;
    IF (SELECT count(*) FROM ciencia.release_members WHERE release_id=r.release_id)<>
       (r.manifest->'db_ready_line_counts'->>'release_members.jsonl')::bigint THEN RAISE EXCEPTION 'Conteo de membresías incompatible'; END IF;
    IF EXISTS (
      SELECT 1 FROM ciencia.release_members m JOIN ciencia.fact_cards f USING(record_id)
      LEFT JOIN LATERAL (SELECT decision FROM ciencia.fact_reviews WHERE fact_record_id=f.record_id ORDER BY reviewed_at DESC,review_id DESC LIMIT 1) review ON true
      WHERE m.release_id=r.release_id AND m.usage_tier IN ('runtime','educational')
        AND (review.decision IS DISTINCT FROM 'approved'
          OR NOT EXISTS (SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id)
          OR EXISTS (SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id AND NOT e.verified_against_preserved_source))
    ) THEN RAISE EXCEPTION 'Faltan aprobación humana vigente o evidencias verificadas'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ciencia.release_resources WHERE release_id=r.release_id) THEN RAISE EXCEPTION 'Falta el cierre de metadatos de publicación'; END IF;
    FOR resource IN SELECT * FROM jsonb_each_text(last_check->'resource_counts') LOOP
      IF (SELECT count(*) FROM ciencia.release_resources WHERE release_id=r.release_id AND table_name=resource.key)<>resource.value::bigint THEN
        RAISE EXCEPTION 'Cierre de metadatos incompatible: %',resource.key;
      END IF;
    END LOOP;
    NEW.report=last_check;
  ELSE
    IF r.status<>'published' OR length(btrim(COALESCE(NEW.reason,'')))=0 THEN RAISE EXCEPTION 'Retiro requiere publicación activa y motivo'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION ciencia.apply_event() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,ciencia AS $$
BEGIN
  IF NEW.action='published' THEN UPDATE ciencia.dataset_releases SET status='published',published_at=NEW.occurred_at WHERE release_id=NEW.release_id;
  ELSIF NEW.action='retired' THEN UPDATE ciencia.dataset_releases SET status='retired' WHERE release_id=NEW.release_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER guard_event BEFORE INSERT OR UPDATE OR DELETE ON ciencia.publication_events FOR EACH ROW EXECUTE FUNCTION ciencia.guard_event();
CREATE TRIGGER apply_event AFTER INSERT ON ciencia.publication_events FOR EACH ROW EXECUTE FUNCTION ciencia.apply_event();

CREATE FUNCTION ciencia.deny_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TRUNCATE no permitido en el esquema científico' USING ERRCODE='55000'; END $$;
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('processed_records','record','record_id'),('record_source_refs','record','record_id'),
    ('observations','record','record_id'),('environment_hours','record','record_id'),('solar_events','record','record_id'),
    ('radiation_samples','record','record_id'),('fact_cards','record','record_id'),
    ('fact_evidence','record','fact_record_id'),('fact_mechanics','record','fact_record_id'),
    ('lineage_members','record','aggregate_record_id'),('hour_event_annotations','record','aggregate_record_id'),
    ('release_members','release','release_id'),('release_resources','release','release_id'),
    ('sources','resource','source_id'),('datasets','resource','dataset_id'),('source_files','resource','source_file_id'),
    ('source_file_locations','resource','source_file_id,root_key,relative_path,archive_member'),
    ('captures','resource','capture_id'),('capture_files','resource','capture_id,source_file_id,role'),
    ('quality_policies','resource','policy_id'),('processors','resource','processor_id'),('studies','resource','accession,source_file_id'),
    ('mechanics','resource','mechanic_id'),('instrument_events','resource','source_file_id,event_annotation_id')
  ) AS v(tab,kind,fields) LOOP
    EXECUTE format('CREATE TRIGGER guard_content AFTER INSERT OR UPDATE OR DELETE ON ciencia.%I FOR EACH ROW EXECUTE FUNCTION ciencia.guard_content(%L,%L)',item.tab,item.kind,item.fields);
  END LOOP;
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='ciencia' LOOP
    EXECUTE format('CREATE TRIGGER deny_truncate BEFORE TRUNCATE ON ciencia.%I FOR EACH STATEMENT EXECUTE FUNCTION ciencia.deny_truncate()',item.tablename);
  END LOOP;
END $$;
-- Ningún rol hereda escritura administrativa a través del pseudo-rol PUBLIC.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA ciencia FROM PUBLIC;

-- Down Migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ciencia.dataset_releases WHERE published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'No se retiran protecciones mientras existan publicaciones selladas';
  END IF;
END $$;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='ciencia' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_content ON ciencia.%I',item.tablename);
    EXECUTE format('DROP TRIGGER IF EXISTS deny_truncate ON ciencia.%I',item.tablename);
  END LOOP;
END $$;
DROP TRIGGER guard_release ON ciencia.dataset_releases;
DROP TRIGGER guard_review ON ciencia.fact_reviews;
DROP TRIGGER guard_import_audit ON ciencia.import_runs;
DROP TRIGGER guard_event ON ciencia.publication_events;
DROP TRIGGER apply_event ON ciencia.publication_events;
DROP FUNCTION ciencia.guard_content(),ciencia.guard_release(),ciencia.guard_review(),ciencia.guard_import_audit(),
  ciencia.guard_event(),ciencia.apply_event(),ciencia.deny_truncate(),ciencia.record_sealed(text),ciencia.release_sealed(text);
ALTER TABLE ciencia.fact_reviews DROP CONSTRAINT fact_reviews_reviewer_not_blank;
DROP INDEX ciencia.fact_reviews_latest_idx;
DROP TABLE ciencia.release_resources,ciencia.publication_events;
