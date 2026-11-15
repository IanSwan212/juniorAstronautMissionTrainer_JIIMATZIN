import { API_BASE, TIEMPO_MAX_MS } from './config.js';

export class ErrorApi extends Error {
  constructor(mensaje, { estado = null, codigo = 'error_red', causa } = {}) {
    super(mensaje, { cause: causa });
    this.estado = estado;
    this.codigo = codigo;
  }
}

/** GET JSON con tiempo máximo. Una respuesta 200 que no sea JSON (p. ej. HTML) se trata como error. */
export async function obtenerJson(url, { timeoutMs = TIEMPO_MAX_MS } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (causa) {
    throw new ErrorApi('No se pudo contactar con el servidor', { codigo: 'error_red', causa });
  }
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw new ErrorApi(cuerpo?.error?.mensaje ?? `HTTP ${res.status}`, {
      estado: res.status,
      codigo: cuerpo?.error?.codigo ?? 'error_http',
    });
  }
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new ErrorApi('La respuesta no es JSON', { estado: res.status, codigo: 'respuesta_invalida' });
  }
  try { return await res.json(); }
  catch (causa) { throw new ErrorApi('La respuesta no contiene JSON válido', { estado: res.status, codigo: 'respuesta_invalida', causa }); }
}

/** Llama a la API del juego: apiGet('/scenarios', { version: 1 }) */
export function apiGet(ruta, consulta = {}, opciones) {
  const qs = new URLSearchParams(
    Object.entries(consulta).filter(([, v]) => v !== undefined && v !== null),
  ).toString();
  return obtenerJson(`${API_BASE}${ruta}${qs ? `?${qs}` : ''}`, opciones);
}
