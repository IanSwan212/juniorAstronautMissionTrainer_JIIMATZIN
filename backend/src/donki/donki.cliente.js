import { ErrorFuenteExterna } from '../compartido/errores.js';

/**
 * Cliente de la API oficial DONKI (NASA CCMC). Criterios heredados de la extracción:
 *  - Servidor y ruta oficiales `/get/FLR` (el endpoint antiguo de api.nasa.gov devolvía 404); sin credencial.
 *  - Parámetros fijos usados en la limpieza: catalog=M2M_CATALOG, class=ALL, version=Latest.
 *  - Ante 404 NO se prueban rutas alternativas y ante 429 NO se reintenta: se informa y se espera.
 *  - Un solo intento por consulta; la caché del modelo evita repetir peticiones a NASA.
 */
export const PARAMETROS_FLR = Object.freeze({ catalog: 'M2M_CATALOG', class: 'ALL', version: 'Latest' });

export function crearClienteDonki({ baseUrl, timeoutMs, fetchFn = globalThis.fetch }) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    baseUrl: base,
    /** @returns {{ url:string, httpStatus:number, texto:string }} cuerpo sin interpretar (se hashea tal cual) */
    async obtenerFlr({ start, end }) {
      const url = new URL(`${base}/get/FLR`);
      url.searchParams.set('startDate', start);
      url.searchParams.set('endDate', end);
      for (const [k, v] of Object.entries(PARAMETROS_FLR)) url.searchParams.set(k, v);

      let respuesta;
      try {
        respuesta = await fetchFn(url, {
          headers: { accept: 'application/json', 'user-agent': 'jiimatzin-backend' },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new ErrorFuenteExterna('fuente_sin_respuesta', 'DONKI no respondió a tiempo', { estado: 504 });
        }
        throw new ErrorFuenteExterna('fuente_no_disponible', 'No se pudo contactar con DONKI', { estado: 502 });
      }

      if (respuesta.status === 429) {
        const espera = Number.parseInt(respuesta.headers.get('retry-after') ?? '', 10);
        throw new ErrorFuenteExterna('fuente_limitada', 'DONKI limitó las peticiones; intenta más tarde', {
          estado: 503,
          reintentarEnS: Number.isFinite(espera) && espera > 0 ? espera : 60,
        });
      }
      if (!respuesta.ok) {
        throw new ErrorFuenteExterna('fuente_error', `DONKI respondió con HTTP ${respuesta.status}`, { estado: 502 });
      }
      return { url: url.toString(), httpStatus: respuesta.status, texto: await respuesta.text() };
    },
  };
}
