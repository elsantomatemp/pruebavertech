const test = require('node:test');
const assert = require('node:assert');
const { leerExtracto, numero, fecha, categoria, COLUMNAS } = require('../src/amazon/extracto');
const { costeEn } = require('../src/rentabilidad');
const { fechaCoste } = require('../src/costes');

test('importes con formato español', () => {
  assert.strictEqual(numero('1.178,35'), 1178.35);
  assert.strictEqual(numero('-5,78'), -5.78);
  assert.strictEqual(numero('0'), 0);
  assert.strictEqual(numero(''), 0);
  assert.strictEqual(numero(12.5), 12.5);
  assert.throws(() => numero('abc'));
});

test('fechas de Amazon en español', () => {
  assert.strictEqual(fecha('1 jul 2026 5:10:16 UTC').toISOString(), '2026-07-01T05:10:16.000Z');
  assert.strictEqual(fecha('8 sept 2026 21:58:55 UTC').toISOString(), '2026-09-08T21:58:55.000Z');
  assert.strictEqual(fecha('8 sep 2026 21:58:55 GMT+2').toISOString(), '2026-09-08T19:58:55.000Z');
  assert.throws(() => fecha('2026-07-01'));
});

test('categorías de transacción', () => {
  assert.strictEqual(categoria('Pedido', ''), 'venta');
  assert.strictEqual(categoria('Reembolso', ''), 'reembolso');
  assert.strictEqual(categoria('Transferir', 'A la cuenta acabada en 123'), 'transferencia');
  assert.strictEqual(categoria('Saldo descubierto', ''), 'transferencia');
  assert.strictEqual(categoria('Tarifa de prestación de servicio', 'Gastos de publicidad'), 'publicidad');
  assert.strictEqual(categoria('Tarifa de prestación de servicio', 'Suscripción'), 'suscripcion');
  assert.strictEqual(categoria('Tarifas de inventario de Logística de Amazon', 'x'), 'logistica');
  assert.strictEqual(categoria('Ajuste', 'Reembolso de inventario'), 'ajuste');
});

function csv(filas) {
  const linea = f => f.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  return Buffer.from([
    '"Incluye transacciones del Marketplace de Amazon, Logística de Amazon y Amazon Webstore"',
    '"Todos los importes en EUR, a menos que se especifique lo contrario"',
    linea(COLUMNAS),
    ...filas.map(linea),
  ].join('\n'));
}
function fila(valores) {
  return COLUMNAS.map(c => valores[c] ?? (c.match(/ventas|impuesto|abonos|devoluciones|tarifas|otro|total/) ? '0' : ''));
}

test('lee el CSV de Amazon y distingue líneas idénticas', async () => {
  const pedido = fila({
    'fecha y hora': '1 jul 2026 5:10:16 UTC', 'identificador de pago': '1', tipo: 'Pedido',
    'número de pedido': '403-0000000-0000001', sku: 'SKU-A', cantidad: '1', 'ventas de productos': '18,50',
    'abonos de envío': '1,00', 'tarifas de venta': '-1,82', 'tarifas de Logística de Amazon': '-5,78',
    'tarifas de otras transacciones': '-0,06', total: '11,84', 'Estado de la transacción': 'Liberada',
  });
  const t = await leerExtracto(csv([pedido, pedido]), 'julio.csv');
  assert.strictEqual(t.length, 2);
  assert.notStrictEqual(t[0].clave, t[1].clave);
  assert.strictEqual(t[0].ventas, 19.5);
  assert.strictEqual(t[0].categoria, 'venta');
  assert.strictEqual(t[0].raw['ventas de productos'], 18.5);
  // Volver a leer el mismo archivo produce las mismas claves (no se duplica al reimportar).
  const otra = await leerExtracto(csv([pedido, pedido]), 'julio.csv');
  assert.deepStrictEqual(otra.map(x => x.clave), t.map(x => x.clave));
});

test('rechaza archivos que no son extractos de Amazon', async () => {
  await assert.rejects(leerExtracto(Buffer.from('a,b\n1,2'), 'otro.csv'));
});

test('coste vigente en cada fecha', () => {
  const h = [{ desde: '2000-01-01', coste: 4 }, { desde: '2026-08-15', coste: 5 }];
  assert.strictEqual(costeEn(h, '2026-08-14'), 4);
  assert.strictEqual(costeEn(h, '2026-08-15'), 5);
  assert.strictEqual(costeEn([], '2026-08-15'), null);
});

test('fechas de costes', () => {
  assert.strictEqual(fechaCoste(''), '2000-01-01');
  assert.strictEqual(fechaCoste('2026-07-01'), '2026-07-01');
  assert.strictEqual(fechaCoste('1/7/2026'), '2026-07-01');
  assert.throws(() => fechaCoste('julio'));
});
