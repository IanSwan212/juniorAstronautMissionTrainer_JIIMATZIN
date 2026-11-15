export function presentarSalud() {
  return { estado: 'ok' };
}

export function presentarDisponibilidad(disponible) {
  return disponible ? { estado: 'ok', bd: 'ok' } : { estado: 'degradado', bd: 'error' };
}
