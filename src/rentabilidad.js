// Rentabilidad real de la cuenta de Amazon a partir de las transacciones importadas
// y de los costes unitarios (sin IVA) que sube Vertech.
//
// Criterios:
// - Los meses se cuentan en hora de Madrid, igual que los informes de Amazon.
// - Amazon no recauda IVA en las ventas de amazon.es de Vertech: los importes de venta llevan el IVA
//   incluido (IVA_VENTAS) y las tarifas de Amazon también (IVA_TARIFAS). Todo se muestra sin IVA.
// - Los ajustes (indemnizaciones de inventario) no llevan IVA.
// - Las transferencias al banco no son ni ingreso ni gasto y se excluyen.
// - Una unidad reembolsada se considera devuelta al stock: no cuenta como coste de producto.
// - Los gastos sin SKU (publicidad, suscripción, almacenamiento...) se reparten entre productos
//   en proporción a sus ventas netas.
const { pool } = require('./db');

const ZONA = 'Europe/Madrid';
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const tipoIva = nombre => {
  const v = Number(process.env[nombre] ?? 21);
  return Number.isFinite(v) && v >= 0 ? v / 100 : 0.21;
};

function costeEn(historial, fecha) {
  // historial ordenado por fecha ascendente; devuelve el último coste vigente en esa fecha.
  let coste = null;
  for (const c of historial) {
    if (c.desde <= fecha) coste = c.coste;
    else break;
  }
  return coste;
}

function nuevoProducto(sku, nombre) {
  return {
    sku, nombre, unidades: 0, unidades_reembolsadas: 0, ventas_netas: 0, tarifas_amazon: 0,
    otros_directos: 0, gastos_cuenta: 0, coste_producto: 0, beneficio: 0, margen: null, sin_coste: false,
  };
}

// desde/hasta: 'AAAA-MM-DD' (hasta incluido), en hora de Madrid.
async function calcular(desde, hasta) {
  const ivaV = tipoIva('IVA_VENTAS');
  const ivaT = tipoIva('IVA_TARIFAS');

  const { rows: tx } = await pool.query(
    `SELECT t.*, to_char(t.fecha AT TIME ZONE $3, 'YYYY-MM') AS mes,
            to_char(t.fecha AT TIME ZONE $3, 'YYYY-MM-DD') AS dia
       FROM transacciones t
      WHERE t.fecha >= ($1::date)::timestamp AT TIME ZONE $3
        AND t.fecha <  ($2::date + 1)::timestamp AT TIME ZONE $3
        AND t.categoria <> 'transferencia'
      ORDER BY t.fecha`,
    [desde, hasta, ZONA],
  );
  const { rows: costes } = await pool.query(
    `SELECT sku, coste, to_char(desde, 'YYYY-MM-DD') AS desde FROM costes ORDER BY sku, desde`,
  );
  const { rows: productos } = await pool.query('SELECT sku, nombre FROM productos');
  const historial = {};
  for (const c of costes) (historial[c.sku] ||= []).push(c);
  const nombres = Object.fromEntries(productos.map(p => [p.sku, p.nombre]));

  const resumen = {
    pedidos: new Set(), unidades: 0, unidades_reembolsadas: 0,
    ventas_brutas: 0, reembolsos_brutos: 0, ventas_netas: 0, iva_repercutido: 0,
    tarifas_venta: 0, tarifas_fba: 0, tarifas_otras: 0,
    publicidad: 0, suscripcion: 0, logistica: 0, servicio: 0, otros: 0, ajustes: 0,
    coste_producto: 0, liquidado_amazon: 0,
  };
  const porSku = {};
  const porMes = {};
  const sinCoste = new Set();
  let gastosSinSku = 0;

  for (const t of tx) {
    const ventasNetas = t.ventas / (1 + ivaV);
    const tarifasBrutas = t.total - t.ventas - t.impuestos;
    const tarifasNetas = t.categoria === 'ajuste' ? tarifasBrutas : tarifasBrutas / (1 + ivaT);
    const factorT = t.categoria === 'ajuste' ? 1 : 1 / (1 + ivaT);

    resumen.liquidado_amazon += t.total;
    resumen.ventas_netas += ventasNetas;
    resumen.iva_repercutido += t.ventas - ventasNetas;

    let costeProducto = 0;
    if (t.categoria === 'venta') {
      resumen.pedidos.add(t.pedido);
      resumen.unidades += t.cantidad;
      resumen.ventas_brutas += t.ventas;
      resumen.tarifas_venta += t.tarifas_venta * factorT;
      resumen.tarifas_fba += t.tarifas_fba * factorT;
      resumen.tarifas_otras += (t.tarifas_otras + t.otro) * factorT;
      const coste = t.sku ? costeEn(historial[t.sku] || [], t.dia) : null;
      if (coste === null) sinCoste.add(t.sku);
      else costeProducto = coste * t.cantidad;
    } else if (t.categoria === 'reembolso') {
      resumen.unidades_reembolsadas += t.cantidad;
      resumen.reembolsos_brutos += t.ventas;
      resumen.tarifas_venta += t.tarifas_venta * factorT;
      resumen.tarifas_fba += t.tarifas_fba * factorT;
      resumen.tarifas_otras += (t.tarifas_otras + t.otro) * factorT;
    } else if (t.categoria === 'ajuste') {
      resumen.ajustes += tarifasNetas;
    } else {
      resumen[t.categoria] += tarifasNetas;
    }
    resumen.coste_producto += costeProducto;

    const mes = (porMes[t.mes] ||= { mes: t.mes, ventas_netas: 0, gastos: 0, coste_producto: 0 });
    mes.ventas_netas += ventasNetas;
    mes.gastos += tarifasNetas;
    mes.coste_producto += costeProducto;

    if (t.sku) {
      const p = (porSku[t.sku] ||= nuevoProducto(t.sku, nombres[t.sku] || t.descripcion));
      p.ventas_netas += ventasNetas;
      p.coste_producto += costeProducto;
      if (t.categoria === 'venta') p.unidades += t.cantidad;
      if (t.categoria === 'reembolso') p.unidades_reembolsadas += t.cantidad;
      if (t.categoria === 'venta' || t.categoria === 'reembolso') p.tarifas_amazon += tarifasNetas;
      else p.otros_directos += tarifasNetas;
    } else {
      gastosSinSku += tarifasNetas;
    }
  }

  const productosLista = Object.values(porSku);
  const totalVentasSku = productosLista.reduce((s, p) => s + Math.max(p.ventas_netas, 0), 0);
  for (const p of productosLista) {
    p.gastos_cuenta = totalVentasSku > 0 ? gastosSinSku * Math.max(p.ventas_netas, 0) / totalVentasSku : 0;
    p.beneficio = p.ventas_netas + p.tarifas_amazon + p.otros_directos + p.gastos_cuenta - p.coste_producto;
    p.margen = p.ventas_netas > 0 ? p.beneficio / p.ventas_netas : null;
    p.sin_coste = sinCoste.has(p.sku);
    for (const k of ['ventas_netas', 'tarifas_amazon', 'otros_directos', 'gastos_cuenta', 'coste_producto', 'beneficio']) p[k] = r2(p[k]);
  }
  productosLista.sort((a, b) => b.ventas_netas - a.ventas_netas);

  const gastosAmazon = resumen.tarifas_venta + resumen.tarifas_fba + resumen.tarifas_otras
    + resumen.publicidad + resumen.suscripcion + resumen.logistica + resumen.servicio + resumen.otros;
  const beneficio = resumen.ventas_netas + gastosAmazon + resumen.ajustes - resumen.coste_producto;
  const salida = { ...resumen, pedidos: resumen.pedidos.size };
  for (const k of Object.keys(salida)) if (typeof salida[k] === 'number' && !k.startsWith('unidades') && k !== 'pedidos') salida[k] = r2(salida[k]);
  salida.gastos_amazon = r2(gastosAmazon);
  salida.beneficio = r2(beneficio);
  salida.margen = resumen.ventas_netas > 0 ? beneficio / resumen.ventas_netas : null;
  salida.roi = resumen.coste_producto > 0 ? beneficio / resumen.coste_producto : null;

  const meses = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)).map(m => {
    const b = m.ventas_netas + m.gastos - m.coste_producto;
    return { mes: m.mes, ventas_netas: r2(m.ventas_netas), beneficio: r2(b), margen: m.ventas_netas > 0 ? b / m.ventas_netas : null };
  });

  return {
    desde, hasta, iva_ventas: ivaV, iva_tarifas: ivaT,
    resumen: salida, productos: productosLista, meses,
    skus_sin_coste: [...sinCoste].filter(Boolean).sort(),
    transacciones: tx.length,
  };
}

module.exports = { calcular, costeEn };
