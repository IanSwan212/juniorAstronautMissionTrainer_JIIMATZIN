-- Up Migration
CREATE TABLE juego.catalogos (
  catalog_id text PRIMARY KEY CHECK (catalog_id ~ '^cat_[0-9a-f]{64}$'),
  content_sha256 text NOT NULL UNIQUE CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_version text NOT NULL, document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_ref text NOT NULL CHECK(length(btrim(actor_ref)) BETWEEN 1 AND 200),
  database_actor text NOT NULL DEFAULT session_user, sealed boolean NOT NULL DEFAULT false
);
CREATE TABLE juego.recursos (
  catalog_id text REFERENCES juego.catalogos, id text, payload jsonb NOT NULL,
  PRIMARY KEY(catalog_id,id), CHECK(id IN ('energia','oxigeno','blindaje'))
);
CREATE TABLE juego.personajes (
  catalog_id text REFERENCES juego.catalogos, id text, nombre text NOT NULL, rol text NOT NULL,
  jugable boolean NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(catalog_id,id)
);
CREATE TABLE juego.datos_narrativos (
  catalog_id text REFERENCES juego.catalogos, id text, payload jsonb NOT NULL,
  PRIMARY KEY(catalog_id,id)
);
CREATE TABLE juego.minijuegos (
  catalog_id text REFERENCES juego.catalogos, id text, recurso text NOT NULL, dato_id text,
  gana integer NOT NULL CHECK(gana BETWEEN 1 AND 3), falla integer NOT NULL CHECK(falla BETWEEN -3 AND -1),
  payload jsonb NOT NULL, PRIMARY KEY(catalog_id,id),
  FOREIGN KEY(catalog_id,recurso) REFERENCES juego.recursos,
  FOREIGN KEY(catalog_id,dato_id) REFERENCES juego.datos_narrativos
);
CREATE TABLE juego.emergencias (
  catalog_id text REFERENCES juego.catalogos, id text, sol_sugerido integer CHECK(sol_sugerido BETWEEN 1 AND 10),
  dato_id text, payload jsonb NOT NULL, PRIMARY KEY(catalog_id,id),
  FOREIGN KEY(catalog_id,dato_id) REFERENCES juego.datos_narrativos
);
CREATE TABLE juego.opciones_emergencia (
  catalog_id text, emergencia_id text, position integer CHECK(position>=0), recurso text NOT NULL,
  cambio integer NOT NULL CHECK(cambio BETWEEN -3 AND -1), texto text NOT NULL,
  PRIMARY KEY(catalog_id,emergencia_id,position),
  FOREIGN KEY(catalog_id,emergencia_id) REFERENCES juego.emergencias,
  FOREIGN KEY(catalog_id,recurso) REFERENCES juego.recursos
);
CREATE TABLE juego.cartas_mejora (
  catalog_id text REFERENCES juego.catalogos, id text, dato_id text, costo_recurso text,
  costo_cambio integer CHECK(costo_cambio BETWEEN -3 AND -1), payload jsonb NOT NULL,
  PRIMARY KEY(catalog_id,id), CHECK((costo_recurso IS NULL)=(costo_cambio IS NULL)),
  FOREIGN KEY(catalog_id,dato_id) REFERENCES juego.datos_narrativos,
  FOREIGN KEY(catalog_id,costo_recurso) REFERENCES juego.recursos
);
CREATE TABLE juego.finales (
  catalog_id text REFERENCES juego.catalogos, id text, dato_id text, payload jsonb NOT NULL,
  PRIMARY KEY(catalog_id,id), FOREIGN KEY(catalog_id,dato_id) REFERENCES juego.datos_narrativos
);
CREATE TABLE juego.soles (
  catalog_id text REFERENCES juego.catalogos, sol integer CHECK(sol BETWEEN 1 AND 10),
  minijuego_id text, emergencia_id text, payload jsonb NOT NULL, PRIMARY KEY(catalog_id,sol),
  FOREIGN KEY(catalog_id,minijuego_id) REFERENCES juego.minijuegos,
  FOREIGN KEY(catalog_id,emergencia_id) REFERENCES juego.emergencias
);
CREATE TABLE juego.audio (
  catalog_id text REFERENCES juego.catalogos, tipo text CHECK(tipo IN ('musica','sfx')), etiqueta text,
  asset_id text NOT NULL, PRIMARY KEY(catalog_id,tipo,etiqueta)
);
CREATE TABLE juego.variables (
  catalog_id text REFERENCES juego.catalogos, nombre text, tipo text NOT NULL,
  PRIMARY KEY(catalog_id,nombre)
);
CREATE TABLE juego.scenario_content (
  scenario_id text, scenario_version integer, catalog_id text NOT NULL REFERENCES juego.catalogos,
  initial_resources jsonb NOT NULL CHECK(jsonb_typeof(initial_resources)='object'
    AND initial_resources ?& ARRAY['energia','oxigeno','blindaje']
    AND initial_resources - ARRAY['energia','oxigeno','blindaje'] = '{}'::jsonb
    AND initial_resources->'energia' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb)
    AND initial_resources->'oxigeno' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb)
    AND initial_resources->'blindaje' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb)),
  PRIMARY KEY(scenario_id,scenario_version), UNIQUE(scenario_id,scenario_version,catalog_id),
  FOREIGN KEY(scenario_id,scenario_version) REFERENCES juego.scenarios
);
CREATE TABLE juego.vinculos_datos (
  scenario_id text, scenario_version integer, catalog_id text, narrative_id text, record_id text,
  justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 1 AND 2000),
  PRIMARY KEY(scenario_id,scenario_version,narrative_id,record_id),
  FOREIGN KEY(scenario_id,scenario_version,catalog_id) REFERENCES juego.scenario_content(scenario_id,scenario_version,catalog_id),
  FOREIGN KEY(catalog_id,narrative_id) REFERENCES juego.datos_narrativos,
  FOREIGN KEY(scenario_id,scenario_version,record_id) REFERENCES juego.scenario_facts(scenario_id,scenario_version,record_id)
);

-- Reconstrucción desde los catálogos, nunca desde rutas locales ni desde ciencia.
CREATE FUNCTION juego.catalog_document(cid text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,juego AS $$
 SELECT jsonb_build_object('version',c.source_version,
   'recursos',(SELECT jsonb_agg(payload ORDER BY id) FROM juego.recursos WHERE catalog_id=cid),
   'personajes',(SELECT jsonb_agg(payload ORDER BY id) FROM juego.personajes WHERE catalog_id=cid),
   'soles',(SELECT jsonb_agg(payload ORDER BY sol) FROM juego.soles WHERE catalog_id=cid),
   'minijuegos',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM juego.minijuegos WHERE catalog_id=cid),'[]'),
   'emergencias',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM juego.emergencias WHERE catalog_id=cid),'[]'),
   'cartas_mejora',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM juego.cartas_mejora WHERE catalog_id=cid),'[]'),
   'finales',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM juego.finales WHERE catalog_id=cid),'[]'),
   'datos_reales',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM juego.datos_narrativos WHERE catalog_id=cid),'[]'),
   'audio',jsonb_build_object(
     'musica',COALESCE((SELECT jsonb_object_agg(etiqueta,asset_id) FROM juego.audio WHERE catalog_id=cid AND tipo='musica'),'{}'),
     'sfx',COALESCE((SELECT jsonb_object_agg(etiqueta,asset_id) FROM juego.audio WHERE catalog_id=cid AND tipo='sfx'),'{}')),
   'variables_del_juego',COALESCE((SELECT jsonb_object_agg(nombre,tipo) FROM juego.variables WHERE catalog_id=cid),'{}'))
 FROM juego.catalogos c WHERE c.catalog_id=cid
$$;

CREATE FUNCTION juego.guard_catalog() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego AS $$
DECLARE rowdata jsonb; cid text; i integer; is_sealed boolean;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Administración requiere READ COMMITTED'; END IF;
 IF TG_TABLE_NAME='catalogos' THEN
   IF TG_OP='INSERT' AND NOT NEW.sealed THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' AND NOT OLD.sealed AND NEW.sealed AND
     (to_jsonb(OLD)-'sealed')=(to_jsonb(NEW)-'sealed') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Catálogo inmutable; importar una versión nueva' USING ERRCODE='55000';
 END IF;
 FOR i IN 1..2 LOOP
   IF i=1 AND TG_OP<>'INSERT' THEN rowdata=to_jsonb(OLD);
   ELSIF i=2 AND TG_OP<>'DELETE' THEN rowdata=to_jsonb(NEW); ELSE CONTINUE; END IF;
   cid=rowdata->>'catalog_id';
   SELECT sealed INTO is_sealed FROM juego.catalogos WHERE catalog_id=cid FOR UPDATE;
   IF is_sealed THEN RAISE EXCEPTION 'Catálogo sellado inmutable' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION juego.guard_scenario_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,juego AS $$
DECLARE rowdata jsonb; i integer; s juego.scenarios;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Administración requiere READ COMMITTED'; END IF;
 FOR i IN 1..2 LOOP
   IF i=1 AND TG_OP<>'INSERT' THEN rowdata=to_jsonb(OLD);
   ELSIF i=2 AND TG_OP<>'DELETE' THEN rowdata=to_jsonb(NEW); ELSE CONTINUE; END IF;
   SELECT * INTO STRICT s FROM juego.scenarios WHERE scenario_id=rowdata->>'scenario_id'
     AND version=(rowdata->>'scenario_version')::int FOR UPDATE;
   IF s.publication_status<>'draft' THEN RAISE EXCEPTION 'Contenido de escenario inmutable' USING ERRCODE='55000'; END IF;
   IF NOT EXISTS(SELECT 1 FROM juego.catalogos WHERE catalog_id=rowdata->>'catalog_id' AND sealed) THEN RAISE EXCEPTION 'Catálogo no sellado'; END IF;
   IF s.language<>'es' THEN RAISE EXCEPTION 'El desglose está en español'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['catalogos','recursos','personajes','datos_narrativos','minijuegos','emergencias',
   'opciones_emergencia','cartas_mejora','finales','soles','audio','variables','scenario_content','vinculos_datos'] LOOP
   EXECUTE format('CREATE TRIGGER guard_content BEFORE INSERT OR UPDATE OR DELETE ON juego.%I FOR EACH ROW EXECUTE FUNCTION juego.%I()',
     t,CASE WHEN t IN ('scenario_content','vinculos_datos') THEN 'guard_scenario_content' ELSE 'guard_catalog' END);
   EXECUTE format('CREATE TRIGGER deny_truncate BEFORE TRUNCATE ON juego.%I FOR EACH STATEMENT EXECUTE FUNCTION ciencia.deny_truncate()',t);
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA juego FROM PUBLIC;

-- Down Migration
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM juego.scenario_content x JOIN juego.scenarios s
   ON s.scenario_id=x.scenario_id AND s.version=x.scenario_version WHERE s.published_at IS NOT NULL)
 THEN RAISE EXCEPTION 'No revertir contenido de escenarios publicados'; END IF;
END $$;
DROP TABLE juego.vinculos_datos,juego.scenario_content,juego.variables,juego.audio,juego.soles,juego.finales,
 juego.cartas_mejora,juego.opciones_emergencia,juego.emergencias,juego.minijuegos,juego.datos_narrativos,
 juego.personajes,juego.recursos,juego.catalogos;
DROP FUNCTION juego.guard_scenario_content(),juego.guard_catalog(),juego.catalog_document(text);
