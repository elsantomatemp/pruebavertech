require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const multer = require('multer');
const { pool, migrar } = require('./db');
const { importarExtracto } = require('./importar');
const { importarCostes, guardarCoste, listarProductos, fechaCoste } = require('./costes');
const { calcular } = require('./rentabilidad');
const { extractoTrimestral } = require('./contadora');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. En Railway: + New → Database → PostgreSQL y enlazar la variable al servicio.');
  process.exit(1);
}
const SESSION_SECRET = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 24
  ? process.env.SESSION_SECRET
  : (console.warn('ATENCIÓN: falta SESSION_SECRET (24+ caracteres). Se usa una clave temporal.'), crypto.randomBytes(48).toString('hex'));
if (!process.env.APP_PASSWORD) console.warn('ATENCIÓN: falta APP_PASSWORD; nadie podrá entrar al panel hasta que se cargue.');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function igualSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

app.post('/api/login', (req, res) => {
  const ok = process.env.APP_PASSWORD && igualSeguro(req.body?.password ?? '', process.env.APP_PASSWORD);
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar sesión' });
    req.session.usuario = 'admin';
    res.json({ ok: true });
  });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/salud', (req, res) => res.json({ ok: true }));

// Todo lo demás requiere sesión.
app.use((req, res, next) => {
  if (req.session.usuario) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión caducada' });
  if (req.path === '/' || req.path.endsWith('.html')) return res.redirect('/login');
  next();
});
app.use(express.static(path.join(__dirname, '../public')));

const envolver = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(e);
  res.status(e.status || 400).json({ error: e.message });
});
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

app.post('/api/amazon/extractos', subida.array('archivos', 24), envolver(async (req, res) => {
  if (!req.files?.length) throw new Error('No se ha recibido ningún archivo');
  const resultados = [];
  for (const f of req.files) resultados.push(await importarExtracto(f.buffer, f.originalname));
  res.json({ resultados });
}));

app.get('/api/amazon/importaciones', envolver(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM importaciones ORDER BY creado DESC LIMIT 50');
  const { rows: meses } = await pool.query(
    `SELECT to_char(fecha AT TIME ZONE 'Europe/Madrid', 'YYYY-MM') AS mes, count(*)::int AS transacciones
       FROM transacciones GROUP BY 1 ORDER BY 1 DESC`,
  );
  res.json({ importaciones: rows, meses });
}));

app.get('/api/productos', envolver(async (req, res) => res.json({ productos: await listarProductos() })));

app.post('/api/productos/:sku/coste', envolver(async (req, res) => {
  const sku = req.params.sku;
  const coste = Number(String(req.body?.coste ?? '').replace(',', '.'));
  let desde = req.body?.desde ? fechaCoste(req.body.desde) : null;
  if (!desde) {
    // Primer coste de un producto: vale para todo lo ya vendido. Si ya tenía, el nuevo rige desde hoy.
    const { rows } = await pool.query('SELECT 1 FROM costes WHERE sku = $1 LIMIT 1', [sku]);
    desde = rows.length ? new Date().toISOString().slice(0, 10) : '2000-01-01';
  }
  await guardarCoste(pool, { sku, coste, desde });
  res.json({ ok: true });
}));

app.post('/api/productos/costes', subida.single('archivo'), envolver(async (req, res) => {
  if (!req.file) throw new Error('No se ha recibido ningún archivo');
  res.json(await importarCostes(req.file.buffer, req.file.originalname));
}));

app.get('/api/rentabilidad', envolver(async (req, res) => {
  const { desde, hasta } = req.query;
  if (!FECHA.test(desde || '') || !FECHA.test(hasta || '')) throw new Error('Indica desde y hasta en formato AAAA-MM-DD');
  res.json(await calcular(desde, hasta));
}));

app.get('/api/contadora/extracto', envolver(async (req, res) => {
  const anio = Number(req.query.anio), trimestre = Number(req.query.trimestre);
  if (!(anio >= 2000 && anio <= 2100) || ![1, 2, 3, 4].includes(trimestre)) throw new Error('Año o trimestre no válido');
  const { nombre, buffer } = await extractoTrimestral(anio, trimestre);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(Buffer.from(buffer));
}));

const PORT = process.env.PORT || 3000;
migrar()
  .then(() => app.listen(PORT, () => console.log(`Vertech Gestión escuchando en el puerto ${PORT}`)))
  .catch(e => { console.error('No se pudo preparar la base de datos', e); process.exit(1); });

module.exports = app;
