import { apiGet, obtenerJson, ErrorApi } from './cliente.js';

const SCHEMA_VERSION = '1';

/** Comprobación mínima del contrato (ver contrato/scenario.schema.json). */
export function validarEscenario(e) {
  const ok =
    e && typeof e === 'object' &&
    e.schemaVersion === SCHEMA_VERSION &&
    typeof e.scenarioId === 'string' &&
    typeof e.scenarioVersion === 'string' &&
    typeof e.rulesVersion === 'string' &&
    Array.isArray(e.conditions) &&
    Array.isArray(e.factIds);
  if (!ok) throw new ErrorApi('El escenario recibido no cumple el contrato', { codigo: 'esquema_invalido' });
  return e;
}

/**
 * Carga un escenario completo antes de iniciar la misión.
 * Si la API falla, usa la exportación local identificada (public/escenarios/<id>.json).
 * Devuelve { escenario, origen: 'api' | 'respaldo-local', motivo? } para que la UI lo muestre.
 * Durante una misión activa NO se debe volver a llamar: la partida conserva su escenario y versión.
 */
export async function cargarEscenario(id, { version, timeoutMs, respaldoUrl = `/escenarios/${id}.json` } = {}) {
  try {
    const datos = await apiGet(`/scenarios/${encodeURIComponent(id)}`, { version }, { timeoutMs });
    return { escenario: validarEscenario(datos), origen: 'api' };
  } catch (errorApi) {
    try {
      const respaldo = await obtenerJson(respaldoUrl, { timeoutMs });
      return { escenario: validarEscenario(respaldo), origen: 'respaldo-local', motivo: errorApi };
    } catch {
      throw errorApi; // sin API ni respaldo: la UI muestra el error original
    }
  }
}
