const pg = require('pg');

// NUMERIC llega como texto por defecto; lo pasamos a número (importes de euros, sin riesgo de precisión).
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const MIGRACIONES = [
  `CREATE TABLE IF NOT EXISTS productos (
     sku TEXT PRIMARY KEY,
     nombre TEXT,
     creado TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Coste unitario sin IVA. Cada cambio es una fila nueva con su fecha de inicio,
  // para que los meses pasados se sigan calculando con el coste que tenían.
  `CREATE TABLE IF NOT EXISTS costes (
     id SERIAL PRIMARY KEY,
     sku TEXT NOT NULL REFERENCES productos(sku) ON DELETE CASCADE,
     coste NUMERIC(12,4) NOT NULL CHECK (coste >= 0),
     desde DATE NOT NULL,
     creado TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (sku, desde)
   )`,
  `CREATE TABLE IF NOT EXISTS importaciones (
     id SERIAL PRIMARY KEY,
     archivo TEXT NOT NULL,
     filas INTEGER NOT NULL,
     nuevas INTEGER NOT NULL,
     creado TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Una fila por línea del informe "Transacciones mensuales" de Amazon.
  // raw guarda la fila original completa para poder rehacer el Excel de la contadora.
  `CREATE TABLE IF NOT EXISTS transacciones (
     clave TEXT PRIMARY KEY,
     fecha TIMESTAMPTZ NOT NULL,
     id_pago TEXT,
     tipo TEXT NOT NULL,
     pedido TEXT,
     sku TEXT,
     descripcion TEXT,
     cantidad INTEGER NOT NULL DEFAULT 0,
     ventas NUMERIC(12,2) NOT NULL DEFAULT 0,
     impuestos NUMERIC(12,2) NOT NULL DEFAULT 0,
     tarifas_venta NUMERIC(12,2) NOT NULL DEFAULT 0,
     tarifas_fba NUMERIC(12,2) NOT NULL DEFAULT 0,
     tarifas_otras NUMERIC(12,2) NOT NULL DEFAULT 0,
     otro NUMERIC(12,2) NOT NULL DEFAULT 0,
     total NUMERIC(12,2) NOT NULL DEFAULT 0,
     estado TEXT,
     categoria TEXT NOT NULL,
     raw JSONB NOT NULL,
     importacion_id INTEGER REFERENCES importaciones(id) ON DELETE SET NULL
   )`,
  `CREATE INDEX IF NOT EXISTS transacciones_fecha ON transacciones (fecha)`,
  `CREATE INDEX IF NOT EXISTS transacciones_sku ON transacciones (sku)`,
];

async function migrar() {
  for (const sql of MIGRACIONES) await pool.query(sql);
}

module.exports = { pool, migrar };
