// Verifica el DDL en un esquema efímero y revierte toda la transacción.
// Ejecutar desde backend con --env-file=../.env.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const sql = await readFile(new URL('../migrations/20261115000000_dataset-cientifico.sql', import.meta.url), 'utf8');
const schema = `prueba_ciencia_${process.pid}_${Date.now()}`;
const [up, down] = sql.replaceAll(/\bciencia\b/g, schema).split('-- Down Migration');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
let checks = 0;
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(up);
  const result = await client.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1', [schema]);
  assert.equal(result.rows[0].n, 26);
  await client.query(`SET LOCAL search_path TO ${schema}, public`);
  await client.query("INSERT INTO sources VALUES ('s','institucion','producto',NULL)");
  await client.query("INSERT INTO datasets VALUES ('d','s','producto',NULL,'historical')");
  await client.query("INSERT INTO processors VALUES ('p','1',NULL,'{}')");
  await client.query(`INSERT INTO processed_records
    (record_id,record_type,dataset_id,processor_id,schema_version,source_context,quality_status,quality_reasons,payload)
    VALUES ('o','observation','d','p','1','historical','accepted','[]','{}'),
           ('h','environment_hour','d','p','1','historical','not_applicable','[]','{}')`);
  const observation = `INSERT INTO observations
    (record_id,variable,value,unit,source_sol,lmst,lmst_hour,source_timestamp_seconds,time_basis,flags_original,flags_normalized)
    VALUES ($1,$2,$3,$4,10,'00010M00:00:48.714',0,398334263,'mars_lmst','01','01')`;
  async function rejects(statement, params, code) {
    await client.query('SAVEPOINT invalid_input');
    let failure;
    try { await client.query(statement, params); } catch (e) { failure = e; }
    await client.query('ROLLBACK TO SAVEPOINT invalid_input');
    assert.equal(failure?.code, code);
    checks++;
  }
  await rejects(observation, ['o','ambient_temperature',-999,'K'], '23514');
  await rejects(observation, ['o','ambient_temperature',210,'Pa'], '23514');
  await rejects(observation, ['o','pressure',NaN,'Pa'], '23514');
  await rejects(observation, ['h','pressure',750,'Pa'], '23503');
  await client.query(observation, ['o','pressure',750,'Pa']);
  await rejects('INSERT INTO lineage_members VALUES ($1,$2,$3)', ['h','absent','pressure'], '23503');
  const hour = `INSERT INTO environment_hours
    (record_id,source_sol,mission_day,lmst_hour,aggregation_rule,lineage_id,
     temperature_raw_row_count,temperature_present_value_count,temperature_selected_count,
     pressure_raw_row_count,pressure_present_value_count,pressure_selected_count,
     temperature_coverage_label,pressure_coverage_label,temperature_mean_k)
    VALUES ('h',10,1,0,'hourly','lineage',0,0,0,0,0,0,'empty','empty',$1)`;
  await rejects(hour, [210], '23514');
  await client.query(hour, [null]);
  await client.query("INSERT INTO lineage_members VALUES ('h','o','pressure')");
  await rejects("INSERT INTO lineage_members VALUES ('h','o','pressure')", [], '23505');
  await client.query('SET LOCAL search_path TO public');
  await client.query(down);
  await client.query(up);
  console.log(JSON.stringify({ tables: 26, invalid_cases_rejected: checks, up_down_up: true, persisted: false }));
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
}
