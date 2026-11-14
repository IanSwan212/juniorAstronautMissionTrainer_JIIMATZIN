// Comando administrativo de carga (no hay endpoints públicos de importación).
// ESTADO: esqueleto. Aún no importa nada. Pasos previstos en docs/05-importacion.md.

const pasos = [
  '1. Verificar SHA-256 del ZIP y de las 70 huellas de checksums.sha256',
  '2. Registrar fuente, dataset, import_run y source_files (con hash)',
  '3. Cargar a estado de preparación, una transacción por lote',
  '4. Validar esquema, unidades, fechas, duplicados y claves',
  '5. Guardar valores originales y transformados por separado (−999 → faltante)',
  '6. Marcar los 120 casos REMS con fiabilidad 0 y revisar los demás flags',
  '7. Reejecutar sin duplicar (claves idempotentes por captura/revisión)',
];

console.error('El importador todavía no está implementado.\nPasos previstos:\n' + pasos.map((p) => '  ' + p).join('\n'));
process.exit(1);
