// Única fuente de la URL de la API. Vite inyecta import.meta.env; fuera de Vite se usa el valor por defecto.
export const API_BASE = (import.meta.env?.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');
export const TIEMPO_MAX_MS = 8000;
