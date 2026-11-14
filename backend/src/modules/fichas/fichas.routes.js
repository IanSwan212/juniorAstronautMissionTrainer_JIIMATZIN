import { Router } from 'express';
import { z } from 'zod';
import { ErrorHttp } from '../../middleware/errores.js';
import { crearRepositorioFichas } from './fichas.repository.js';

const parametros = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,95}$/, 'id de ficha inválido') });
const consulta = z.object({ lang: z.string().regex(/^[a-z]{2}$/, 'lang debe ser un código de 2 letras').default('es') });

export function crearRutasFichas(pool) {
  const repo = crearRepositorioFichas(pool);
  const router = Router();

  router.get('/:id', async (req, res) => {
    const { id } = parametros.parse(req.params);
    const { lang } = consulta.parse(req.query);

    const ficha = await repo.buscarAprobada(id, lang);
    if (!ficha) throw new ErrorHttp(404, 'ficha_no_encontrada', 'No existe una ficha aprobada con ese id/idioma');

    const evidencias = await repo.listarEvidencias(ficha.id);
    res.json({
      id: ficha.code,
      language: ficha.language,
      version: ficha.version,
      title: ficha.title,
      explanation: ficha.explanation,
      backedFact: ficha.backed_fact,
      missionContext: ficha.mission_context,
      gameAdaptation: ficha.game_adaptation,
      references: ficha.source_refs,
      evidence: evidencias.map((e) => ({
        claim: e.claim,
        locator: e.locator,
        studyAccession: e.accession,
        publicationDoi: e.publication_doi,
        dataDoi: e.data_doi,
        source: { id: e.source_code, name: e.source_name, url: e.source_url },
      })),
    });
  });

  return router;
}
