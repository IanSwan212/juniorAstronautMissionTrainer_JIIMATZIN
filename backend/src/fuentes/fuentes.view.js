export function presentarFuente(fuente) {
  return {
    id: fuente.source_id,
    institution: fuente.institution,
    product: fuente.product,
    url: fuente.url,
  };
}
