import { presentarSalud, presentarDisponibilidad } from './salud.view.js';

export function crearControladorSalud(modelo) {
  return {
    obtener(_req, res) {
      res.json(presentarSalud());
    },
    async listo(_req, res) {
      const disponible = await modelo.comprobarDisponibilidad();
      res.status(disponible ? 200 : 503).json(presentarDisponibilidad(disponible));
    },
  };
}
