const { pool } = require('./db');
const { leerExtracto } = require('./amazon/extracto');

const CAMPOS = ['clave', 'fecha', 'id_pago', 'tipo', 'pedido', 'sku', 'descripcion', 'cantidad', 'ventas', 'impuestos',
  'tarifas_venta', 'tarifas_fba', 'tarifas_otras', 'otro', 'total', 'estado', 'categoria', 'raw', 'importacion_id'];

// Guarda las transacciones de un informe. Volver a subir el mismo informe no duplica nada:
// las filas existentes se actualizan (por ejemplo, de "Diferida" a "Liberada").
async function importarExtracto(buffer, nombreArchivo) {
  const transacciones = await leerExtracto(buffer, nombreArchivo);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: [imp] } = await cliente.query(
      'INSERT INTO importaciones (archivo, filas, nuevas) VALUES ($1, $2, 0) RETURNING id',
      [nombreArchivo, transacciones.length],
    );
    let nuevas = 0;
    for (const t of transacciones) {
      const valores = CAMPOS.map(c => (c === 'importacion_id' ? imp.id : c === 'raw' ? JSON.stringify(t.raw) : t[c]));
      const { rows } = await cliente.query(
        `INSERT INTO transacciones (${CAMPOS.join(', ')})
         VALUES (${CAMPOS.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (clave) DO UPDATE SET estado = EXCLUDED.estado, raw = EXCLUDED.raw
         RETURNING (xmax = 0) AS insertada`,
        valores,
      );
      if (rows[0].insertada) nuevas++;
      if (t.sku) {
        await cliente.query(
          'INSERT INTO productos (sku, nombre) VALUES ($1, $2) ON CONFLICT (sku) DO NOTHING',
          [t.sku, t.descripcion],
        );
      }
    }
    await cliente.query('UPDATE importaciones SET nuevas = $1 WHERE id = $2', [nuevas, imp.id]);
    await cliente.query('COMMIT');
    const fechas = transacciones.map(t => t.fecha.getTime());
    return {
      archivo: nombreArchivo, filas: transacciones.length, nuevas, actualizadas: transacciones.length - nuevas,
      desde: new Date(Math.min(...fechas)).toISOString(), hasta: new Date(Math.max(...fechas)).toISOString(),
    };
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

module.exports = { importarExtracto };
