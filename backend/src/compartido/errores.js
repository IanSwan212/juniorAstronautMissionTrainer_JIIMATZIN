/** Error de aplicación independiente del transporte HTTP. */
export class ErrorNoEncontrado extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorNoEncontrado';
    this.codigo = codigo;
  }
}
