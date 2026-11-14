// Punto de entrada único: el juego importa desde '@/api' (o '../api') y nunca llama a fetch directamente.
export { cargarEscenario, validarEscenario } from './cargarEscenario.js';
export { apiGet, ErrorApi } from './cliente.js';
export { API_BASE } from './config.js';

import { apiGet } from './cliente.js';
export const obtenerFicha = (id, lang = 'es') => apiGet(`/facts/${encodeURIComponent(id)}`, { lang });
export const obtenerFuente = (id) => apiGet(`/sources/${encodeURIComponent(id)}`);
