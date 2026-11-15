-- Up Migration
-- El juego fija contenido científico mediante membresías, sin alterar ciencia ni public.
CREATE SCHEMA juego;
CREATE TABLE juego.game_rule_sets (
  rules_version text PRIMARY KEY CHECK (rules_version ~ '^[a-z0-9][a-z0-9_.-]{0,95}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
  published_at timestamptz
);
CREATE TABLE juego.scenarios (
  scenario_id text, version integer CHECK (version>0),
  release_id text NOT NULL REFERENCES ciencia.dataset_releases,
  rules_version text NOT NULL REFERENCES juego.game_rule_sets,
  language text NOT NULL CHECK (language ~ '^[a-z]{2}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  model_assumptions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(model_assumptions)='array'),
  publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','published','retired')),
  published_at timestamptz,
  PRIMARY KEY (scenario_id,version), UNIQUE (scenario_id,version,release_id),
  CHECK (scenario_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CHECK ((publication_status='draft')=(published_at IS NULL))
);
CREATE TABLE juego.scenario_records (
  scenario_id text, scenario_version integer, release_id text NOT NULL, position integer CHECK (position>=0),
  record_id text NOT NULL, role text NOT NULL CHECK (role IN ('environment','reference')),
  game_sol integer NOT NULL CHECK (game_sol BETWEEN 1 AND 10),
  game_phase text CHECK (game_phase IN ('morning','day','emergency','night')),
  justification text NOT NULL CHECK (length(btrim(justification)) BETWEEN 1 AND 2000),
  PRIMARY KEY (scenario_id,scenario_version,position),
  FOREIGN KEY (scenario_id,scenario_version,release_id) REFERENCES juego.scenarios(scenario_id,version,release_id),
  FOREIGN KEY (release_id,record_id) REFERENCES ciencia.release_members
);
CREATE TABLE juego.scenario_facts (
  scenario_id text, scenario_version integer, release_id text NOT NULL, position integer CHECK (position>=0),
  record_id text NOT NULL REFERENCES ciencia.fact_cards,
  game_sol integer CHECK (game_sol BETWEEN 1 AND 10),
  game_phase text CHECK (game_phase IN ('morning','day','emergency','night')),
  PRIMARY KEY (scenario_id,scenario_version,position), UNIQUE (scenario_id,scenario_version,record_id),
  FOREIGN KEY (scenario_id,scenario_version,release_id) REFERENCES juego.scenarios(scenario_id,version,release_id),
  FOREIGN KEY (release_id,record_id) REFERENCES ciencia.release_members
);
CREATE TABLE juego.scenario_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scenario_id text NOT NULL, scenario_version integer NOT NULL,
  FOREIGN KEY (scenario_id,scenario_version) REFERENCES juego.scenarios(scenario_id,version),
  action text NOT NULL CHECK (action IN ('created','published','retired')),
  actor_ref text NOT NULL CHECK (length(btrim(actor_ref)) BETWEEN 1 AND 200),
  database_actor text NOT NULL DEFAULT session_user,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), transaction_id bigint NOT NULL DEFAULT txid_current(),
  reason text
);

-- Un componente no elegible oculta el escenario completo, no una respuesta parcial.
CREATE VIEW juego.available_scenarios AS
SELECT s.* FROM juego.scenarios s
JOIN ciencia.dataset_releases r ON r.release_id=s.release_id
JOIN juego.game_rule_sets g USING(rules_version)
WHERE s.publication_status='published' AND s.published_at IS NOT NULL
  AND r.status='published' AND r.published_at IS NOT NULL AND g.published_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM ciencia.publication_events e WHERE e.release_id=r.release_id AND e.action='published')
  AND EXISTS (SELECT 1 FROM juego.scenario_records x WHERE x.scenario_id=s.scenario_id AND x.scenario_version=s.version)
  AND NOT EXISTS (
    SELECT 1 FROM juego.scenario_records x JOIN ciencia.processed_records p USING(record_id)
    JOIN ciencia.release_members m ON m.release_id=x.release_id AND m.record_id=x.record_id
    WHERE x.scenario_id=s.scenario_id AND x.scenario_version=s.version
      AND (p.record_type='fact' OR p.quality_status NOT IN ('accepted','not_applicable') OR m.usage_tier='archive'
        OR (x.role='environment' AND (p.record_type NOT IN ('observation','environment_hour')
          OR p.source_context<>'mars_historical_observation' OR m.usage_tier<>'runtime')))
  )
  AND NOT EXISTS (
    SELECT 1 FROM juego.scenario_facts x JOIN ciencia.fact_cards f USING(record_id)
    JOIN ciencia.processed_records p USING(record_id)
    JOIN ciencia.release_members m ON m.release_id=x.release_id AND m.record_id=x.record_id
    LEFT JOIN LATERAL (SELECT decision FROM ciencia.fact_reviews WHERE fact_record_id=f.record_id
      ORDER BY reviewed_at DESC,review_id DESC LIMIT 1) review ON true
    WHERE x.scenario_id=s.scenario_id AND x.scenario_version=s.version
      AND (f.language<>s.language OR review.decision IS DISTINCT FROM 'approved' OR m.usage_tier='archive'
        OR p.quality_status NOT IN ('accepted','not_applicable')
        OR NOT EXISTS (SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id)
        OR EXISTS (SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id AND NOT e.verified_against_preserved_source))
  );

CREATE FUNCTION juego.guard_rules() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego,ciencia AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Administración requiere READ COMMITTED'; END IF;
  IF TG_OP='INSERT' AND NEW.published_at IS NOT NULL THEN RAISE EXCEPTION 'Una regla nueva empieza sin publicar'; END IF;
  IF TG_OP<>'INSERT' AND OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'Versión de reglas inmutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND NEW.published_at IS NOT NULL THEN
    IF (to_jsonb(NEW)-'published_at') IS DISTINCT FROM (to_jsonb(OLD)-'published_at') OR NOT EXISTS (
      SELECT 1 FROM juego.scenario_events e JOIN juego.scenarios s ON s.scenario_id=e.scenario_id AND s.version=e.scenario_version
      WHERE s.rules_version=OLD.rules_version AND e.action='published' AND e.transaction_id=txid_current()
    ) THEN RAISE EXCEPTION 'Las reglas se fijan al publicar el escenario'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_rules BEFORE INSERT OR UPDATE OR DELETE ON juego.game_rule_sets FOR EACH ROW EXECUTE FUNCTION juego.guard_rules();

CREATE FUNCTION juego.guard_scenario() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego,ciencia AS $$
DECLARE expected text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Administración requiere READ COMMITTED'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.publication_status<>'draft' OR NEW.published_at IS NOT NULL THEN RAISE EXCEPTION 'Un escenario nuevo debe ser draft'; END IF;
  ELSIF TG_OP='DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'Escenario publicado inmutable' USING ERRCODE='55000'; END IF;
  ELSE
    IF OLD.published_at IS NOT NULL AND (to_jsonb(NEW)-'publication_status') IS DISTINCT FROM (to_jsonb(OLD)-'publication_status') THEN
      RAISE EXCEPTION 'Escenario publicado inmutable' USING ERRCODE='55000';
    END IF;
    IF NEW.publication_status=OLD.publication_status AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN RETURN NEW; END IF;
    expected=CASE WHEN OLD.publication_status='draft' AND NEW.publication_status='published' THEN 'published'
      WHEN OLD.publication_status='published' AND NEW.publication_status='retired' THEN 'retired' END;
    IF expected IS NULL OR NOT EXISTS (SELECT 1 FROM juego.scenario_events e WHERE e.scenario_id=OLD.scenario_id
      AND e.scenario_version=OLD.version AND e.action=expected AND e.transaction_id=txid_current()
      AND (expected='retired' OR e.occurred_at=NEW.published_at)) THEN RAISE EXCEPTION 'Se requiere publicación administrativa'; END IF;
    IF (to_jsonb(NEW)-ARRAY['publication_status','published_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['publication_status','published_at']) THEN
      RAISE EXCEPTION 'No modificar contenido durante la publicación';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_scenario BEFORE INSERT OR UPDATE OR DELETE ON juego.scenarios FOR EACH ROW EXECUTE FUNCTION juego.guard_scenario();

CREATE FUNCTION juego.guard_selection() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego,ciencia AS $$
DECLARE data jsonb; i integer; status text; rtype text; quality text; context text; tier text; lang text; scenario_lang text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Administración requiere READ COMMITTED'; END IF;
  FOR i IN 1..2 LOOP
    IF i=1 AND TG_OP<>'INSERT' THEN data=to_jsonb(OLD);
    ELSIF i=2 AND TG_OP<>'DELETE' THEN data=to_jsonb(NEW);
    ELSE CONTINUE; END IF;
    SELECT publication_status,language INTO status,scenario_lang FROM juego.scenarios
      WHERE scenario_id=data->>'scenario_id' AND version=(data->>'scenario_version')::int;
    IF status<>'draft' THEN RAISE EXCEPTION 'Selección de escenario inmutable' USING ERRCODE='55000'; END IF;
    IF i=2 THEN
      SELECT p.record_type,p.quality_status,p.source_context,m.usage_tier INTO rtype,quality,context,tier
        FROM ciencia.processed_records p JOIN ciencia.release_members m USING(record_id)
        WHERE p.record_id=data->>'record_id' AND m.release_id=data->>'release_id';
      IF quality NOT IN ('accepted','not_applicable') OR tier='archive' THEN RAISE EXCEPTION 'Registro no elegible para el juego'; END IF;
      IF TG_TABLE_NAME='scenario_records' THEN
        IF rtype='fact' THEN RAISE EXCEPTION 'Las fichas van en scenario_facts'; END IF;
        IF data->>'role'='environment' AND (rtype NOT IN ('observation','environment_hour') OR context<>'mars_historical_observation' OR tier<>'runtime') THEN
          RAISE EXCEPTION 'El ambiente requiere mediciones o agregados históricos de Marte';
        END IF;
      ELSE
        SELECT language INTO lang FROM ciencia.fact_cards WHERE record_id=data->>'record_id';
        IF lang IS DISTINCT FROM scenario_lang THEN RAISE EXCEPTION 'Idioma de ficha incompatible'; END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER guard_selection AFTER INSERT OR UPDATE OR DELETE ON juego.scenario_records FOR EACH ROW EXECUTE FUNCTION juego.guard_selection();
CREATE TRIGGER guard_selection AFTER INSERT OR UPDATE OR DELETE ON juego.scenario_facts FOR EACH ROW EXECUTE FUNCTION juego.guard_selection();

CREATE FUNCTION juego.guard_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego,ciencia AS $$
DECLARE s juego.scenarios; r ciencia.dataset_releases;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Bitácora de escenarios inmutable' USING ERRCODE='55000'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Administración requiere READ COMMITTED'; END IF;
  LOCK TABLE juego.game_rule_sets,juego.scenarios,juego.scenario_records,juego.scenario_facts,
    ciencia.dataset_releases,ciencia.fact_reviews IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT s FROM juego.scenarios WHERE scenario_id=NEW.scenario_id AND version=NEW.scenario_version;
  NEW.database_actor=session_user; NEW.occurred_at=clock_timestamp(); NEW.transaction_id=txid_current();
  IF NEW.action='created' THEN
    IF s.publication_status<>'draft' THEN RAISE EXCEPTION 'Creación requiere borrador'; END IF;
  ELSIF NEW.action='published' THEN
    IF s.publication_status<>'draft' THEN RAISE EXCEPTION 'Solo se publica un borrador'; END IF;
    SELECT * INTO STRICT r FROM ciencia.dataset_releases WHERE release_id=s.release_id;
    IF r.status<>'published' OR r.published_at IS NULL OR NOT EXISTS (SELECT 1 FROM ciencia.publication_events WHERE release_id=r.release_id AND action='published') THEN
      RAISE EXCEPTION 'Se requiere una publicación científica activa';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM juego.scenario_records WHERE scenario_id=s.scenario_id AND scenario_version=s.version) THEN RAISE EXCEPTION 'Escenario sin condiciones'; END IF;
    IF EXISTS (SELECT 1 FROM juego.scenario_facts x JOIN ciencia.fact_cards f USING(record_id)
      LEFT JOIN LATERAL (SELECT decision FROM ciencia.fact_reviews WHERE fact_record_id=f.record_id ORDER BY reviewed_at DESC,review_id DESC LIMIT 1) review ON true
      WHERE x.scenario_id=s.scenario_id AND x.scenario_version=s.version
        AND (f.language<>s.language OR review.decision IS DISTINCT FROM 'approved'
          OR NOT EXISTS (SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id)
          OR EXISTS (SELECT 1 FROM ciencia.fact_evidence e WHERE e.fact_record_id=f.record_id AND NOT e.verified_against_preserved_source))) THEN
      RAISE EXCEPTION 'Fichas del escenario sin aprobación o evidencia válida';
    END IF;
  ELSE
    IF s.publication_status<>'published' OR length(btrim(COALESCE(NEW.reason,'')))=0 THEN RAISE EXCEPTION 'Retiro requiere escenario publicado y motivo'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION juego.apply_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego,ciencia AS $$
BEGIN
  IF NEW.action='published' THEN
    UPDATE juego.game_rule_sets SET published_at=NEW.occurred_at WHERE rules_version=(
      SELECT rules_version FROM juego.scenarios WHERE scenario_id=NEW.scenario_id AND version=NEW.scenario_version) AND published_at IS NULL;
    UPDATE juego.scenarios SET publication_status='published',published_at=NEW.occurred_at WHERE scenario_id=NEW.scenario_id AND version=NEW.scenario_version;
    IF NOT EXISTS (SELECT 1 FROM juego.available_scenarios WHERE scenario_id=NEW.scenario_id AND version=NEW.scenario_version) THEN RAISE EXCEPTION 'Escenario incompleto o no elegible'; END IF;
  ELSIF NEW.action='retired' THEN
    UPDATE juego.scenarios SET publication_status='retired' WHERE scenario_id=NEW.scenario_id AND version=NEW.scenario_version;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER guard_event BEFORE INSERT OR UPDATE OR DELETE ON juego.scenario_events FOR EACH ROW EXECUTE FUNCTION juego.guard_event();
CREATE TRIGGER apply_event AFTER INSERT ON juego.scenario_events FOR EACH ROW EXECUTE FUNCTION juego.apply_event();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['game_rule_sets','scenarios','scenario_records','scenario_facts','scenario_events'] LOOP
    EXECUTE format('CREATE TRIGGER deny_truncate BEFORE TRUNCATE ON juego.%I FOR EACH STATEMENT EXECUTE FUNCTION ciencia.deny_truncate()',t);
  END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA juego FROM PUBLIC;

-- Down Migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM juego.scenarios WHERE published_at IS NOT NULL) THEN RAISE EXCEPTION 'No revertir escenarios publicados'; END IF;
END $$;
DROP VIEW juego.available_scenarios;
DROP TABLE juego.scenario_events,juego.scenario_facts,juego.scenario_records,juego.scenarios,juego.game_rule_sets;
DROP FUNCTION juego.guard_rules(),juego.guard_scenario(),juego.guard_selection(),juego.guard_event(),juego.apply_event();
DROP SCHEMA juego;
