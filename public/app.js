const $ = s => document.querySelector(s);
const eur = n => (n == null ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));
const pct = n => (n == null ? '—' : (n * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %');
const signo = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opciones = {}) {
  const r = await fetch(url, opciones);
  if (r.status === 401) { location.href = '/login'; throw new Error('Sesión caducada'); }
  const datos = await r.json();
  if (!r.ok) throw new Error(datos.error || 'Error');
  return datos;
}

// Navegación
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('activo', x === b));
  document.querySelectorAll('main section').forEach(s => s.classList.toggle('activa', s.id === b.dataset.sec));
  if (b.dataset.sec === 'importar') cargarImportaciones();
  if (b.dataset.sec === 'costes') cargarProductos();
}));
$('#salir').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; });

// Periodo
const hoy = new Date();
const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
$('#mes').value = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`;
$('#anio').value = $('#cAnio').value = mesAnterior.getFullYear();
$('#trim').value = $('#cTrim').value = String(Math.floor(mesAnterior.getMonth() / 3) + 1);

$('#tipoPeriodo').addEventListener('change', () => {
  const t = $('#tipoPeriodo').value;
  $('#lMes').hidden = t !== 'mes';
  $('#lTrim').hidden = t !== 'trimestre';
  $('#lAnio').hidden = !(t === 'trimestre' || t === 'anio');
  $('#lDesde').hidden = $('#lHasta').hidden = t !== 'libre';
});

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rango() {
  const t = $('#tipoPeriodo').value;
  if (t === 'mes') {
    const [a, m] = $('#mes').value.split('-').map(Number);
    return [iso(new Date(a, m - 1, 1)), iso(new Date(a, m, 0))];
  }
  const a = Number($('#anio').value);
  if (t === 'trimestre') {
    const q = Number($('#trim').value);
    return [iso(new Date(a, (q - 1) * 3, 1)), iso(new Date(a, q * 3, 0))];
  }
  if (t === 'anio') return [`${a}-01-01`, `${a}-12-31`];
  return [$('#desde').value, $('#hasta').value];
}

function tabla(cabeceras, filas, total) {
  const th = cabeceras.map(c => `<th>${esc(c)}</th>`).join('');
  const tr = f => f.map(c => (typeof c === 'object' && c !== null ? `<td class="${c.cls || ''}">${c.html}</td>` : `<td>${esc(c)}</td>`)).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${filas.map(f => `<tr>${tr(f)}</tr>`).join('')}${total ? `<tr class="total">${tr(total)}</tr>` : ''}</tbody></table>`;
}
const imp = n => ({ html: eur(n === 0 ? 0 : n), cls: signo(n) });

async function calcular() {
  const [desde, hasta] = rango();
  if (!desde || !hasta) return;
  let d;
  try { d = await api(`/api/rentabilidad?desde=${desde}&hasta=${hasta}`); } catch (e) { alert(e.message); return; }
  const r = d.resumen;

  $('#avisoCostes').hidden = !d.skus_sin_coste.length;
  $('#avisoCostes').textContent = d.skus_sin_coste.length
    ? `Faltan costes de ${d.skus_sin_coste.length} producto(s): ${d.skus_sin_coste.join(', ')}. El beneficio no descuenta su coste hasta que los cargues en "Costes".` : '';

  const kpis = [
    ['Ventas netas', eur(r.ventas_netas)], ['Gastos de Amazon', eur(r.gastos_amazon)],
    ['Coste de producto', eur(r.coste_producto)], ['Beneficio', eur(r.beneficio)],
    ['Margen', pct(r.margen)], ['ROI', pct(r.roi)],
    ['Unidades', `${r.unidades}${r.unidades_reembolsadas ? ` (−${r.unidades_reembolsadas} reemb.)` : ''}`], ['Pedidos', r.pedidos],
  ];
  $('#kpis').innerHTML = d.transacciones
    ? kpis.map(([t, v]) => `<div class="kpi"><div class="t">${t}</div><div class="v">${esc(v)}</div></div>`).join('')
    : '<div class="aviso">No hay transacciones de Amazon en este periodo. Súbelas en "Importar Amazon".</div>';

  $('#pyg').innerHTML = tabla(['Concepto', 'Importe'], [
    ['Ventas (con IVA)', imp(r.ventas_brutas)],
    ['Reembolsos a clientes (con IVA)', imp(r.reembolsos_brutos)],
    ['IVA repercutido', imp(-r.iva_repercutido)],
    ['Ventas netas', imp(r.ventas_netas)],
    ['Comisiones de venta', imp(r.tarifas_venta)],
    ['Tarifas FBA por pedido', imp(r.tarifas_fba)],
    ['Otras tarifas por pedido', imp(r.tarifas_otras)],
    ['Publicidad', imp(r.publicidad)],
    ['Almacenamiento, retiradas y envíos a Amazon', imp(r.logistica)],
    ['Suscripción', imp(r.suscripcion)],
    ['Otros servicios', imp(r.servicio + r.otros)],
    ['Indemnizaciones y ajustes de Amazon', imp(r.ajustes)],
    ['Coste de producto', imp(-r.coste_producto || 0)],
  ], ['Beneficio', imp(r.beneficio)]) + `<p class="nota">Liquidado por Amazon en el periodo (sin transferencias): ${eur(r.liquidado_amazon)}. Debe coincidir con Ingresos + Costes del resumen mensual de Amazon.</p>`;

  $('#productos').innerHTML = tabla(
    ['SKU', 'Producto', 'Uds.', 'Reemb.', 'Ventas netas', 'Tarifas Amazon', 'Gastos cuenta', 'Coste', 'Beneficio', 'Margen'],
    d.productos.map(p => [
      p.sku + (p.sin_coste ? ' ⚠' : ''), { html: esc(p.nombre), cls: 'nombre' }, p.unidades, p.unidades_reembolsadas,
      imp(p.ventas_netas), imp(p.tarifas_amazon + p.otros_directos), imp(p.gastos_cuenta), imp(-p.coste_producto || 0),
      imp(p.beneficio), pct(p.margen),
    ]),
  );
  $('#meses').innerHTML = tabla(['Mes', 'Ventas netas', 'Beneficio', 'Margen'],
    d.meses.map(m => [m.mes, imp(m.ventas_netas), imp(m.beneficio), pct(m.margen)]));
}
$('#calcular').addEventListener('click', calcular);

// Importar
async function cargarImportaciones() {
  const d = await api('/api/amazon/importaciones');
  $('#mesesCargados').innerHTML = d.meses.length
    ? tabla(['Mes', 'Transacciones'], d.meses.map(m => [m.mes, m.transacciones]))
    : '<p class="nota">Aún no hay extractos cargados.</p>';
}
$('#fExtractos').addEventListener('submit', async e => {
  e.preventDefault();
  $('#mExtractos').textContent = 'Importando…';
  try {
    const d = await api('/api/amazon/extractos', { method: 'POST', body: new FormData(e.target) });
    $('#mExtractos').innerHTML = d.resultados.map(r =>
      `${esc(r.archivo)}: ${r.filas} transacciones (${r.nuevas} nuevas, ${r.actualizadas} ya estaban).`).join('<br>');
    e.target.reset();
    cargarImportaciones();
  } catch (err) { $('#mExtractos').innerHTML = `<span class="neg">${esc(err.message)}</span>`; }
});

// Costes
async function cargarProductos() {
  const d = await api('/api/productos');
  $('#tablaProductos').innerHTML = d.productos.length ? tabla(['SKU', 'Producto', 'Coste actual', 'Desde', 'Nuevo coste'],
    d.productos.map(p => [
      p.sku, { html: esc(p.nombre), cls: 'nombre' },
      p.coste_actual == null ? { html: '<span class="neg">Sin coste</span>' } : eur(p.coste_actual),
      p.desde === '2000-01-01' ? 'siempre' : (p.desde || '—'),
      { html: `<input type="text" inputmode="decimal" size="7" data-sku="${esc(p.sku)}" placeholder="0,00"> <button class="secundario" data-guardar="${esc(p.sku)}">Guardar</button>` },
    ])) : '<p class="nota">Los productos aparecen al importar el primer extracto de Amazon.</p>';
}
$('#tablaProductos').addEventListener('click', async e => {
  const sku = e.target.dataset.guardar;
  if (!sku) return;
  const input = [...document.querySelectorAll('#tablaProductos input')].find(i => i.dataset.sku === sku);
  try {
    await api(`/api/productos/${encodeURIComponent(sku)}/coste`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coste: input.value }),
    });
    cargarProductos();
  } catch (err) { alert(err.message); }
});
$('#fCostes').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const d = await api('/api/productos/costes', { method: 'POST', body: new FormData(e.target) });
    $('#mCostes').textContent = `${d.guardados} costes guardados.`;
    e.target.reset();
    cargarProductos();
  } catch (err) { $('#mCostes').innerHTML = `<span class="neg">${esc(err.message)}</span>`; }
});

// Contadora
$('#descargarExtracto').addEventListener('click', () => {
  location.href = `/api/contadora/extracto?anio=${$('#cAnio').value}&trimestre=${$('#cTrim').value}`;
});

calcular();
