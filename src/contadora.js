// Archivos para la contadora. Por ahora: el extracto trimestral de Amazon en Excel,
// con una hoja por mes y las mismas columnas que el informe "Transacciones mensuales".
const ExcelJS = require('exceljs');
const { pool } = require('./db');
const { COLUMNAS, COLUMNAS_IMPORTE } = require('./amazon/extracto');

const MES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MES_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function mesesTrimestre(anio, trimestre) {
  const primero = (trimestre - 1) * 3;
  return [0, 1, 2].map(i => ({ anio, mes: primero + i + 1 }));
}

async function extractoTrimestral(anio, trimestre) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vertech Gestión';
  for (const { mes } of mesesTrimestre(anio, trimestre)) {
    const { rows } = await pool.query(
      `SELECT raw FROM transacciones
        WHERE to_char(fecha AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') = $1
        ORDER BY fecha, clave`,
      [`${anio}-${String(mes).padStart(2, '0')}`],
    );
    const ws = wb.addWorksheet(`${anio}${MES_EN[mes - 1]}MonthlyTransaction`);
    ws.addRow(['Incluye transacciones del Marketplace de Amazon, Logística de Amazon y Amazon Webstore']);
    ws.addRow(['Todos los importes en EUR, a menos que se especifique lo contrario']);
    ws.addRow([]);
    const cab = ws.addRow(COLUMNAS);
    cab.font = { bold: true };
    for (const { raw } of rows) ws.addRow(COLUMNAS.map(c => (COLUMNAS_IMPORTE.has(c) ? Number(raw[c] ?? 0) : raw[c] ?? '')));
    COLUMNAS.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c === 'descripción' ? 50 : Math.max(12, Math.min(c.length + 2, 28));
      if (COLUMNAS_IMPORTE.has(c)) col.numFmt = '#,##0.00';
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }
  const meses = mesesTrimestre(anio, trimestre).map(m => MES_ES[m.mes - 1]).join('_');
  return { nombre: `Extracto_Amazon_${meses}_${anio}.xlsx`, buffer: await wb.xlsx.writeBuffer() };
}

module.exports = { extractoTrimestral, mesesTrimestre };
