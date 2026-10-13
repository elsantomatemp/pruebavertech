# Vertech Gestión

Sistema de gestión de Vertech (VERTIMIS SL): ventas de Amazon.es (FBA), rentabilidad real de la cuenta,
facturación y archivos para la contadora.

## Fase 1 (esta versión)

- **Importar Amazon**: sube el informe "Transacciones" de Seller Central
  (Pagos → Informes → Informes por rango de fechas) en CSV, o un Excel con una hoja por mes.
  Volver a subir un archivo no duplica nada.
- **Costes**: coste unitario sin IVA por SKU, a mano o con un CSV/Excel (`sku`, `coste`, `desde` opcional).
  Cada cambio guarda histórico, así los meses pasados conservan su coste.
- **Rentabilidad**: por mes, trimestre, año o periodo libre. Cuenta de resultados sin IVA, detalle por
  producto y evolución mensual.
- **Contadora**: descarga del extracto trimestral de Amazon en Excel (una hoja por mes).

### Cómo se calcula la rentabilidad

- Los meses se cuentan en hora de Madrid, como los informes de Amazon.
- Amazon no recauda IVA en las ventas de amazon.es de Vertech: los precios llevan el IVA incluido
  (`IVA_VENTAS`, 21 % por defecto) y las tarifas de Amazon también (`IVA_TARIFAS`). Todo se muestra sin IVA.
- Las indemnizaciones de inventario no llevan IVA. Las transferencias al banco se excluyen.
- Una unidad reembolsada se considera devuelta al stock (no suma coste de producto).
- Los gastos sin SKU (publicidad, suscripción, almacenamiento) se reparten entre productos según sus ventas netas.
- "Liquidado por Amazon" debe coincidir con Ingresos + Costes del resumen mensual en PDF de Amazon.

## Próximas fases

1. Conexión directa con Amazon (SP-API y Ads API) para no tener que subir informes.
2. Facturación automática de pedidos de Amazon con VeriFactu y subida de facturas a Amazon.
3. Facturación manual a clientes mayoristas.
4. ZIP mensual de facturas y paquete trimestral completo para la contadora.

## Despliegue en Railway

1. En el proyecto de Railway: **+ New → GitHub Repo** con este repositorio, y **+ New → Database → PostgreSQL**.
2. En las variables del servicio: `DATABASE_URL` (referencia a la del PostgreSQL), `NODE_ENV=production`,
   `SESSION_SECRET` (24+ caracteres al azar) y `APP_PASSWORD` (contraseña del panel).
3. Railway ejecuta `npm start`. Las tablas se crean solas al arrancar.

## Desarrollo

```
npm install
cp .env.example .env   # y rellenar DATABASE_URL, SESSION_SECRET, APP_PASSWORD
npm start
npm test
```
