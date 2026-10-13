// Costes unitarios sin IVA por SKU, con histórico. Se suben a mano o con un CSV/Excel de dos o tres
// columnas: sku, coste y (opcional) desde, en formato AAAA-MM-DD o DD/MM/AAAA.
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const { pool } = require('./db');
const { numero } = require('./amazon/extracto');

function fechaCoste(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (!s) return '2000-01-01'; // sin fecha: vale para todo el histórico
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error(`Fecha no válida: "${s}" (usa AAAA-MM-DD o DD/MM/AAAA)`);
}

async function leerFilasCostes(buffer, nombreArchivo) {
  let filas;
  if (/\.xlsx$/i.test(nombreArchivo)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    filas = [];
    wb.worksheets[0].eachRow(f => filas.push(f.values.slice(1).map(v => (v && v.result !== undefined ? v.result : v))));
  } else {
    const texto = buffer.toString('utf8').replace(/^﻿/, '');
    const sep = texto.split('\n')[0].includes(';') ? ';' : ',';
    filas = parse(texto, { delimiter: sep, relax_column_count: true, skip_empty_lines: true });
  }
  const cab = (filas[0] || []).map(c => String(c ?? '').trim().toLowerCase());
  const iSku = cab.indexOf('sku');
  const iCoste = cab.findIndex(c => c.startsWith('coste') || c.startsWith('costo'));
  const iDesde = cab.findIndex(c => c === 'desde' || c === 'fecha');
  if (iSku < 0 || iCoste < 0) throw new Error('El archivo necesita las columnas "sku" y "coste" (y opcionalmente "desde").');
  return filas.slice(1)
    .filter(f => String(f[iSku] ?? '').trim())
    .map(f => ({ sku: String(f[iSku]).trim(), coste: numero(f[iCoste]), desde: fechaCoste(iDesde >= 0 ? f[iDesde] : '') }));
}

async function guardarCoste(db, { sku, coste, desde }) {
  if (!sku) throw new Error('Falta el SKU');
  if (!(coste >= 0)) throw new Error(`Coste no válido para ${sku}`);
  await db.query('INSERT INTO productos (sku) VALUES ($1) ON CONFLICT (sku) DO NOTHING', [sku]);
  await db.query(
    `INSERT INTO costes (sku, coste, desde) VALUES ($1, $2, $3)
     ON CONFLICT (sku, desde) DO UPDATE SET coste = EXCLUDED.coste, creado = now()`,
    [sku, coste, desde],
  );
}

async function importarCostes(buffer, nombreArchivo) {
  const filas = await leerFilasCostes(buffer, nombreArchivo);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    for (const f of filas) await guardarCoste(cliente, f);
    await cliente.query('COMMIT');
    return { guardados: filas.length };
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

async function listarProductos() {
  const { rows } = await pool.query(
    `SELECT p.sku, p.nombre,
            c.coste AS coste_actual, to_char(c.desde, 'YYYY-MM-DD') AS desde,
            COALESCE((SELECT json_agg(json_build_object('coste', h.coste, 'desde', to_char(h.desde, 'YYYY-MM-DD')) ORDER BY h.desde DESC)
                        FROM costes h WHERE h.sku = p.sku), '[]') AS historial
       FROM productos p
       LEFT JOIN LATERAL (SELECT coste, desde FROM costes WHERE sku = p.sku AND desde <= CURRENT_DATE
                           ORDER BY desde DESC LIMIT 1) c ON true
      ORDER BY p.sku`,
  );
  return rows;
}

module.exports = { importarCostes, guardarCoste, listarProductos, fechaCoste, leerFilasCostes };
