// Lectura del informe "Transacciones mensuales" de Seller Central (Pagos > Informes por rango de fechas),
// tanto el CSV que descarga Amazon como un Excel con una hoja por mes (como el que prepara Vertech).
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');

// Columnas del informe en español (amazon.es), en el orden en que Amazon las publica.
const COLUMNAS = [
  'fecha y hora', 'identificador de pago', 'tipo', 'número de pedido', 'sku', 'descripción', 'cantidad',
  'web de Amazon', 'gestión logística', 'ciudad de procedencia del pedido',
  'comunidad autónoma de procedencia del pedido', 'código postal de procedencia del pedido',
  'Formulario de recaudación de impuestos', 'ventas de productos', 'impuesto de ventas de productos',
  'abonos de envío', 'impuestos por abonos de envío', 'abonos de envoltorio para regalo',
  'impuestos por abonos de envoltorio para regalo', 'devoluciones promocionales',
  'impuestos de descuentos por promociones', 'impuesto retenido en el sitio web', 'tarifas de venta',
  'tarifas de Logística de Amazon', 'tarifas de otras transacciones', 'otro', 'total',
  'Estado de la transacción', 'Fecha de liberación de la transacción',
];
const COLUMNAS_IMPORTE = new Set(COLUMNAS.slice(13, 27));
const COLUMNAS_VENTA = ['ventas de productos', 'abonos de envío', 'abonos de envoltorio para regalo', 'devoluciones promocionales'];
const COLUMNAS_IMPUESTO = [
  'impuesto de ventas de productos', 'impuestos por abonos de envío',
  'impuestos por abonos de envoltorio para regalo', 'impuestos de descuentos por promociones',
  'impuesto retenido en el sitio web',
];

const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8, oct: 9, nov: 10, dic: 11 };

const normalizar = s => String(s ?? '').trim().toLowerCase();

// "1.178,35" → 1178.35 ; "-5,78" → -5.78 ; "18.50" → 18.5
function numero(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/\s|€/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`Importe no válido: "${v}"`);
  return n;
}

// "1 jul 2026 5:10:16 UTC" / "8 sept 2026 21:58:55 GMT+2" → Date
function fecha(v) {
  if (v instanceof Date) return v;
  const m = String(v ?? '').trim().match(/^(\d{1,2}) ([a-zé]+)\.? (\d{4}) (\d{1,2}):(\d{2}):(\d{2})(?: (UTC|GMT)([+-]\d{1,2})?)?$/i);
  if (!m) throw new Error(`Fecha no válida: "${v}"`);
  const mes = MESES[m[2].toLowerCase()];
  if (mes === undefined) throw new Error(`Mes no reconocido en la fecha: "${v}"`);
  const desfase = m[8] ? Number(m[8]) : 0;
  return new Date(Date.UTC(+m[3], mes, +m[1], +m[4] - desfase, +m[5], +m[6]));
}

function categoria(tipo, descripcion) {
  const t = normalizar(tipo), d = normalizar(descripcion);
  if (t === 'pedido') return 'venta';
  if (t === 'reembolso') return 'reembolso';
  if (t.startsWith('transfer') || t === 'saldo descubierto') return 'transferencia';
  if (t === 'tarifa de prestación de servicio') {
    if (d.includes('publicidad')) return 'publicidad';
    if (d.includes('suscripci')) return 'suscripcion';
    return 'servicio';
  }
  if (t.includes('logística de amazon')) return 'logistica';
  if (t === 'ajuste') return 'ajuste';
  return 'otros';
}

function valorCelda(c) {
  const v = c.value;
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if ('result' in v) return v.result ?? '';
    if (v.text) return v.text;
  }
  return v;
}

// Devuelve una lista de tablas (una por hoja, o una para el CSV), cada una como lista de filas.
async function leerTablas(buffer, nombreArchivo) {
  if (/\.xlsx$/i.test(nombreArchivo)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb.worksheets.map(ws => {
      const filas = [];
      ws.eachRow({ includeEmpty: false }, fila => {
        const valores = [];
        for (let i = 1; i <= ws.columnCount; i++) valores.push(valorCelda(fila.getCell(i)));
        filas.push(valores);
      });
      return { nombre: ws.name, filas };
    });
  }
  let texto = buffer.toString('utf8').replace(/^﻿/, '');
  const separador = (texto.split('\n').find(l => normalizar(l).includes('fecha y hora')) || '').includes(';') ? ';' : ',';
  const filas = parse(texto, { delimiter: separador, relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
  return [{ nombre: nombreArchivo, filas }];
}

function parsearTabla({ nombre, filas }) {
  const iCabecera = filas.findIndex(f => {
    const n = f.map(normalizar);
    return n.includes('fecha y hora') && n.includes('tipo') && n.includes('total');
  });
  if (iCabecera < 0) return [];
  const cabecera = filas[iCabecera].map(normalizar);
  const idx = {};
  for (const col of COLUMNAS) idx[col] = cabecera.indexOf(normalizar(col));
  const faltan = ['fecha y hora', 'tipo', 'total'].filter(c => idx[c] < 0);
  if (faltan.length) throw new Error(`En "${nombre}" faltan columnas: ${faltan.join(', ')}`);

  const vistos = new Map();
  const salida = [];
  for (const f of filas.slice(iCabecera + 1)) {
    const get = col => (idx[col] >= 0 ? f[idx[col]] : '');
    if (!String(get('fecha y hora')).trim()) continue;
    const raw = {};
    for (const col of COLUMNAS) {
      const v = get(col);
      raw[col] = COLUMNAS_IMPORTE.has(col) ? numero(v) : (v instanceof Date ? v.toISOString() : String(v ?? '').trim());
    }
    const t = {
      fecha: fecha(get('fecha y hora')),
      id_pago: raw['identificador de pago'] || null,
      tipo: raw['tipo'],
      pedido: raw['número de pedido'] || null,
      sku: raw['sku'] || null,
      descripcion: raw['descripción'] || null,
      cantidad: Math.round(numero(raw['cantidad'])),
      ventas: COLUMNAS_VENTA.reduce((s, c) => s + raw[c], 0),
      impuestos: COLUMNAS_IMPUESTO.reduce((s, c) => s + raw[c], 0),
      tarifas_venta: raw['tarifas de venta'],
      tarifas_fba: raw['tarifas de Logística de Amazon'],
      tarifas_otras: raw['tarifas de otras transacciones'],
      otro: raw['otro'],
      total: raw['total'],
      estado: raw['Estado de la transacción'] || null,
      categoria: categoria(raw['tipo'], raw['descripción']),
      raw,
    };
    // La misma transacción puede venir en varias descargas: la clave no depende del archivo ni del estado.
    // Si dentro de un mismo informe hay dos líneas idénticas, el contador las distingue.
    const base = crypto.createHash('sha1')
      .update([t.fecha.toISOString(), t.id_pago, t.tipo, t.pedido, t.sku, t.descripcion, t.cantidad, t.total].join('|'))
      .digest('hex');
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    t.clave = `${base}#${n}`;
    salida.push(t);
  }
  return salida;
}

async function leerExtracto(buffer, nombreArchivo) {
  const tablas = await leerTablas(buffer, nombreArchivo);
  const transacciones = tablas.flatMap(parsearTabla);
  if (!transacciones.length) {
    throw new Error('No se encontró ninguna tabla de "Transacciones mensuales" de Amazon en el archivo.');
  }
  return transacciones;
}

module.exports = { leerExtracto, numero, fecha, categoria, COLUMNAS, COLUMNAS_IMPORTE };
