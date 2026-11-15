import { ErrorFuenteExterna } from '../compartido/errores.js';
import { leerFlr, crearSobre, sha256 } from './donki.normalizador.js';

const MAX_ENTRADAS = 50; // acota la memoria: las ventanas las elige el cliente
const MAX_OBSOLETA_S = 3600; // tras una falla de NASA se sirve la última copia buena hasta 1 h, marcada

/**
 * Orquesta cliente + normalizador con caché en memoria:
 *  - TTL corto (DONKI es casi en tiempo real) y una sola petición en vuelo por ventana.
 *  - Si NASA falla y hay copia previa reciente, se devuelve marcada `stale`; si no, se propaga el error.
 */
export function crearModeloDonki({ cliente, ttlS, ahora = () => new Date() }) {
  const cache = new Map(); // clave → { capturadoEn:Date, carga }
  const enVuelo = new Map(); // clave → Promise<carga>

  async function capturar(ventana) {
    const { url, httpStatus, texto } = await cliente.obtenerFlr(ventana);
    const capturadoEn = ahora();
    const vacio = texto.trim() === '';
    let lista;
    try {
      lista = vacio ? [] : JSON.parse(texto);
    } catch {
      throw new ErrorFuenteExterna('fuente_respuesta_invalida', 'DONKI devolvió una respuesta que no es JSON', { estado: 502 });
    }
    let leido;
    try {
      leido = leerFlr(lista);
    } catch {
      throw new ErrorFuenteExterna('fuente_respuesta_invalida', 'DONKI devolvió un JSON con forma inesperada', { estado: 502 });
    }
    const sourceFileId = `sha256:${sha256(Buffer.from(texto, 'utf8'))}`;
    return {
      capturadoEn,
      carga: {
        ventana,
        url,
        httpStatus,
        sourceFileId,
        cuerpoVacio: vacio,
        entradas: lista.length,
        eventos: leido.aceptados.map(({ evento, indice }) => crearSobre({ evento, indice, sourceFileId })),
        decisiones: leido.decisiones,
      },
    };
  }

  function recordar(clave, entrada) {
    cache.delete(clave);
    cache.set(clave, entrada);
    while (cache.size > MAX_ENTRADAS) cache.delete(cache.keys().next().value);
  }

  return {
    /** @returns {{ carga:object, capturadoEn:Date, cache:'miss'|'hit'|'stale', edadS:number }} */
    async obtener(ventana) {
      const clave = `${ventana.start}|${ventana.end}`;
      const previa = cache.get(clave);
      const edad = (e) => Math.max(0, Math.round((ahora() - e.capturadoEn) / 1000));

      if (previa && edad(previa) < ttlS) return { ...previa, cache: 'hit', edadS: edad(previa) };

      let pendiente = enVuelo.get(clave);
      if (!pendiente) {
        pendiente = capturar(ventana).finally(() => enVuelo.delete(clave));
        enVuelo.set(clave, pendiente);
      }
      try {
        const nueva = await pendiente;
        recordar(clave, nueva);
        return { ...nueva, cache: 'miss', edadS: 0 };
      } catch (err) {
        if (previa && edad(previa) <= MAX_OBSOLETA_S) return { ...previa, cache: 'stale', edadS: edad(previa) };
        throw err;
      }
    },
  };
}
