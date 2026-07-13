# Historial de versiones — Tap Control

Acá queda el registro de todos los cambios importantes del sistema, en orden, con la fecha en la que se subieron a GitHub Pages. El número de versión actual se ve al pie de la pantalla de inicio de la app.

---

## v2.1.2 — 13/07/2026
- En Back Office → Ventas, el botón "Cambiar a tarjeta/efectivo" se reemplaza por **"Modificar"**: abre una ventana donde se puede corregir tanto el método de pago (efectivo/tarjeta) como la moneda (Gs/R$) de un ticket ya cargado. Si se cambia la moneda, los precios se recalculan con el precio actual de cada producto en la nueva moneda.

## v2.1.1 — 12/07/2026
- Los gastos ahora pueden cargarse como "Mensual" (ej: alquiler, sueldos): se reparten en partes iguales entre los días del mes que cubren, en vez de pegar de golpe en un solo día. Esto deja la base lista para el gráfico de punto de equilibrio del Dashboard (Entrega 3).

## v2.1.0 — 12/07/2026
- **Entrega 2 de costos y márgenes:** nueva pestaña "Gastos" en Back Office. Cargá alquiler, luz, agua, condominio, sueldos y otros gastos, cada uno con su propia fecha, para poder compararlos mes a mes. Muestra el total del período y un resumen por categoría.

## v2.0.1 — 12/07/2026
- Ya no se asume que todo lo que es categoría "Chop" usa CO2 del tanque compartido: ahora es un tilde editable por producto (se sugiere destildado automáticamente para productos Heineken, pero se puede ajustar para cualquier producto). Esto también corrige el cálculo del costo estimado por vaso, que antes contaba de más.

## v2.0.0 — 12/07/2026
- **Entrega 1 de costos y márgenes:**
- Nueva pestaña "Insumos" en Back Office: cargá cosas como vasos o botellas, con su costo unitario, reutilizables entre productos.
- Nuevo botón 🔄 en la pantalla de venta (POS) para que el cajero registre un cambio de tanque de CO2, y equivalente en Back Office → Insumos para que el admin también lo pueda cargar.
- El costo del CO2 por vaso de chop se calcula solo, automáticamente, según cuántos chops se vendieron entre un cambio de tanque y el siguiente (promedio de los últimos 5 tramos).
- Cada producto ahora tiene "Costo del producto" y qué insumos usa (ej: 1 vaso). Back Office → Productos muestra el costo total y el margen estimado de cada uno.

## v1.9.2 — 12/07/2026
- Nuevo botón 🖨 en la pantalla de venta (POS) para que el cajero pueda reimprimir el comprobante de apertura en cualquier momento mientras su caja sigue abierta (antes solo se podía reimprimir el cierre).

## v1.9.1 — 12/07/2026
- El ticket de cierre de caja ahora incluye el detalle de cada movimiento (ingreso/retiro) del turno, con la hora exacta y la observación cargada. Si no hubo movimientos, esa sección no aparece.

## v1.9.0 — 12/07/2026
- Al abrir una caja, ahora se imprime automáticamente un comprobante con los montos de apertura (Gs y R$) cargados, para verificar en el momento que estén correctos. Si hay un error, se puede corregir después desde Back Office → Turnos.

## v1.8.3 — 12/07/2026
- El ticket de cierre de caja ahora también muestra los montos de Apertura (Gs y R$), alineados en columnas junto con el Contado.

## v1.8.2 — 12/07/2026
- Todas las ventanas emergentes (Cobrar venta, movimientos, formularios, etc.) ahora aparecen centradas en la pantalla, en vez de pegadas abajo.

## v1.8.1 — 12/07/2026
- Se corrige que la fecha y el número de ticket quedaban cortados al final del papel (se aumentó el avance de papel antes del corte).
- Más espacio entre el "Total" y la línea del método de pago, para que se lea mejor.

## v1.8.0 — 12/07/2026
- El ticket impreso ahora lleva el logo del negocio arriba (impreso como imagen real, no solo texto).
- Nuevo campo "Nombre del negocio" y "Dirección" en Back Office → Configuración, usados en el encabezado del ticket.
- Rediseño del formato del ticket: columnas alineadas (producto a la izquierda, precio a la derecha), estilo más prolijo.
- Corregido un símbolo (espacio especial de R$) que aparecía como "?" en los tickets impresos.
- Corregido el bloqueo de Chrome (Private Network Access / Local Network Access) que impedía que la app le hablara al servidor de impresión local.

## v1.7.0 — 10/07/2026
- La venta ahora se imprime automáticamente al confirmar el pago (ya no hace falta tocar "Imprimir" a mano).
- Se saca por completo el respaldo de impresión por Windows: si el servidor de impresión local no está disponible, la app avisa con un mensaje claro en vez de abrir el diálogo de Windows en silencio.
- El servidor de impresión local (`print-server.js`) ahora muestra en su ventana un registro (log) de cada ticket impreso, con hora.
- Título "✓ Venta realizada" más grande y destacado en la pantalla de confirmación de venta.

## v1.6.0 — 10/07/2026
- Se agrega este control de versiones: número de versión visible en la pantalla de inicio + este archivo de historial.

## v1.5.0 — 10/07/2026
- Servidor de impresión local (`print-bridge`): permite imprimir directo en la impresora de red, sin pasar por el cuadro de diálogo de Windows ni por los líos de tamaño de papel del driver. Si no está prendido, la app usa el método anterior como respaldo.

## v1.4.2 — 10/07/2026
- Ajuste de impresión térmica: se fija el tamaño de página a 80mm y se quita el encabezado con fecha/URL que agregaba Chrome arriba de cada ticket.

## v1.4.1 — 10/07/2026
- Íconos de la app (para instalar en el celular) rehechos con fondo transparente, para que no se vea un borde oscuro alrededor.

## v1.4.0 — 10/07/2026
- La app ahora se puede instalar como aplicación en el celular (PWA): ícono en la pantalla de inicio, se abre a pantalla completa sin barra del navegador.

## v1.3.0 — 09/07/2026
- Cierre de caja ciego: el cajero solo carga el efectivo contado, sin ver el detalle de ventas por método de pago ni el esperado.
- El administrador puede cerrar cajas abiertas desde el Back Office.
- Numeración consecutiva de tickets, sin importar qué cajero está vendiendo.
- Nueva pestaña "Ventas" en el Back Office: anular tickets por error y cambiar el método de pago de una venta ya cargada.

## v1.2.0 — 09/07/2026
- Las fotos de productos y el logo del negocio ahora aceptan JPG y PNG (antes solo JPG).
- Logo propio del negocio en la pantalla de inicio, reemplazando el ícono de chop.

## v1.1.0 — 08/07/2026
- Gerenciador de usuarios: contraseña de administrador para entrar al Back Office, y gestión de cajeros con PIN de 4 dígitos.
- Fotos de productos (formato JPG) en el catálogo.

## v1.0.0 — 08/07/2026
- Primera versión funcionando en GitHub Pages: ventas, productos, apertura/cierre de caja, movimientos de caja, reportes y turnos.
