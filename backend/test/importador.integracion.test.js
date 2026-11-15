import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { abrirPaquete } from '../src/importador/paquete.js';
import { importarPaquete } from '../src/importador/carga.js';
import { crearPaquetePrueba, datosPrueba, fixtureId } from '../test-support/paquete.js';

describe('Importador con PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, () => {
  let pool;
  let fixture;
  let paquete;
  before(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.match(url.pathname, /^\/jiimatzin_test_[0-9a-f]{32}$/);
    pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    for (const name of ['20261114000000_esquema-inicial.sql', '20261115000000_dataset-cientifico.sql','20261116000000_publicaciones.sql','20261117000000_escenarios-cientificos.sql']) {
      await pool.query((await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).split('-- Down Migration')[0]);
    }
    fixture = await crearPaquetePrueba();
    paquete = await abrirPaquete(fixture.path, fixture.sha256);
  });
  after(async () => { await paquete?.cerrar(); await fixture?.cerrar(); await pool?.end(); });

  test('carga candidato completo, conserva faltantes y no aprueba fichas', async () => {
    const result = await importarPaquete(pool, paquete);
    assert.equal(result.record_count, 4);
    assert.equal(result.inserted.processed_records, 4);
    assert.equal((await pool.query('SELECT status FROM ciencia.dataset_releases')).rows[0].status, 'candidate');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.fact_reviews')).rows[0].n, 0);
    const empty = (await pool.query('SELECT * FROM ciencia.environment_hours WHERE lmst_hour=1')).rows[0];
    assert.equal(empty.temperature_mean_k, null);
    assert.equal(empty.pressure_mean_pa, null);
    assert.equal((await pool.query("SELECT expected='null'::jsonb AS json_null FROM ciencia.fact_evidence")).rows[0].json_null, true);
  });

  test('repetir la carga no duplica ni modifica revisiones', async () => {
    const result = await importarPaquete(pool, paquete);
    assert.ok(Object.values(result.inserted).every((n) => n === 0));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.processed_records')).rows[0].n, 4);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ciencia.import_runs WHERE status='succeeded'")).rows[0].n, 2);
  });

  test('mismo record_id con contenido distinto aborta, revierte y registra fallo', async () => {
    const spec = datosPrueba(`rel_${'2'.repeat(32)}`);
    spec.rows['fact_cards.jsonl'][0].data.child_explanation = 'Intento de sobrescritura';
    const f = await crearPaquetePrueba(spec);
    let p;
    try {
      p = await abrirPaquete(f.path, f.sha256);
      await assert.rejects(importarPaquete(pool, p), /Conflicto de contenido/);
      assert.equal((await pool.query('SELECT child_explanation FROM ciencia.fact_cards WHERE record_id=$1', [fixtureId(4)])).rows[0].child_explanation, 'Explicación');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.release_members WHERE release_id=$1', [spec.release_id])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT status FROM ciencia.import_runs WHERE release_id=$1', [spec.release_id])).rows[0].status, 'failed');
    } finally { await p?.cerrar(); await f.cerrar(); }
  });

  test('conteos de linaje incompatibles revierten el lote completo', async () => {
    const spec = datosPrueba(`rel_${'3'.repeat(32)}`);
    spec.rows['lineage_members.jsonl'] = [];
    const f = await crearPaquetePrueba(spec);
    let p;
    try {
      p = await abrirPaquete(f.path, f.sha256);
      await assert.rejects(importarPaquete(pool, p), /Observación sin un único agregado/);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM ciencia.release_members WHERE release_id=$1', [spec.release_id])).rows[0].n, 0);
      assert.equal((await pool.query('SELECT status FROM ciencia.import_runs WHERE release_id=$1', [spec.release_id])).rows[0].status, 'failed');
    } finally { await p?.cerrar(); await f.cerrar(); }
  });

  test('no permite reimportar una publicación fuera de candidate', async () => {
    await pool.query("UPDATE ciencia.dataset_releases SET status='importing' WHERE release_id=$1", [paquete.manifest.release_id]);
    try { await assert.rejects(importarPaquete(pool, paquete), /Solo se permite/); }
    finally { await pool.query("UPDATE ciencia.dataset_releases SET status='candidate' WHERE release_id=$1", [paquete.manifest.release_id]); }
  });

  test('paquete completo real: conteos de publicación e idempotencia', { skip: !process.env.DATASET_TEST_ARCHIVE }, async () => {
    const p = await abrirPaquete(process.env.DATASET_TEST_ARCHIVE, process.env.DATASET_TEST_SHA256);
    try {
      const first = await importarPaquete(pool, p, { progreso: (message) => console.log(message) });
      assert.equal(first.record_count, 263782);
      assert.deepEqual(first.observation_variables, { ambient_temperature: 122578, pressure: 140780 });
      assert.equal(first.inserted.environment_hours, 240);
      assert.equal(first.inserted.solar_events, 93);
      assert.equal(first.inserted.radiation_samples, 84);
      assert.equal(first.inserted.fact_cards, 7);
      const second = await importarPaquete(pool, p, { progreso: (message) => console.log(`Reimportación: ${message}`) });
      assert.ok(Object.values(second.inserted).every((n) => n === 0));
    } finally { await p.cerrar(); }
  });
});
