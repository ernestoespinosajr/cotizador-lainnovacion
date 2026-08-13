# Solicitud de endpoints — Cotizador La Innovación

**Para:** equipo backend de GestionIncidencias
**Asunto:** endpoints necesarios para el cotizador asistido
**Fecha:** 13 de agosto de 2026
**Instancia evaluada:** `http://168.228.232.202:443` (pruebas)

---

## 1. Contexto

La Innovación recibe solicitudes de cotización por correo y WhatsApp, en texto libre, y también
como archivos Excel adjuntos. **Los listados llegan a tener hasta 100 productos.** El cotizador
que se está construyendo debe:

1. Recibir ese texto tal cual llega y extraer las líneas solicitadas.
2. Identificar al cliente y mostrar su situación actual, incluyendo si tiene pagos pendientes.
3. Proponer los productos pedidos, alternativas parecidas, y explicar los que no están disponibles.
4. Con los productos seleccionados, generar la cotización formal.

Se evaluó la API existente contra la instancia de pruebas. **Los pasos 1 y 3 son construibles
hoy. El paso 2 queda a medias y el paso 4 no tiene contraparte en el backend.** Este documento
detalla exactamente qué falta.

Mientras tanto, el cotizador marcará como *«próximamente»* las funciones que dependen de lo
solicitado aquí.

---

## 2. Lo que se verificó

Se sondeó la superficie completa de la API. Estas son las únicas rutas que devuelven JSON; el
resto de rutas probadas (`/api/cotizaciones`, `/api/precios`, `/api/ventas`,
`/api/catalogos/clientes/:no`, entre otras) caen al HTML del SPA, es decir, no existen.

| Endpoint | Latencia medida | Volumen |
|---|---|---|
| `POST /api/auth/login` | 0.15 s | JWT, expira a los 7 días |
| `GET /api/auth/me` | rápido | — |
| `GET /api/users` | rápido | — |
| `GET /api/health` | rápido | — |
| `GET /api/catalogos/clientes` | **0.09 – 0.29 s** | 12.317 registros |
| `GET /api/catalogos/productos` | **8.9 – 26.3 s** | 63.702 registros |

### Mediciones de `/api/catalogos/productos`

| Petición | Tiempo | Respuesta |
|---|---|---|
| `?page=1&pageSize=25` (con COUNT) | 15.0 s | 7.9 KB |
| `?page=1&pageSize=25&total=false` | 13.9 s | 7.9 KB |
| `?search=nevera&conStock=true&total=false` | 8.9 s | 8.3 KB |
| `?search=8887549496851` (código de barras) | **10.3 s** | **394 bytes** |
| `?pageSize=5000&page=1&total=false` | 12.2 s | 1.58 MB |
| `?search=abanico&conStock=true&pageSize=3` | 26.3 s | 1.2 KB |

El dato revelador es la búsqueda por código de barras: **394 bytes de respuesta en 10.3
segundos**. El coste no son las filas devueltas, es el escaneo completo de la vista. Ningún
filtro reduce el tiempo.

### Mediciones de `/api/catalogos/clientes`

Instantáneo. 5.000 filas (1.24 MB) en 0.29 s. Sobre esa muestra —los primeros 5.000 registros
ordenados por `No_`, no una muestra aleatoria—:

- Con RNC: 4.961 / 5.000
- Con algún teléfono: 4.956 / 5.000
- Con algún correo: 3.044 / 5.000
- `blocked`: `0` → 2.028 · `1` → 1 · `2` → 2.424 · `3` → 547

---

## 3. Endpoints solicitados

Ordenados por prioridad. Los tres primeros son bloqueantes.

---

### 3.1 · Estado de cuenta del cliente — **BLOQUEANTE**

> Cubre el paso 2. Hoy el único indicador de situación del cliente es el campo `blocked`, que
> es el enum de NAV (`0` sin bloqueo, `1` envío, `2` facturación, `3` todo). Eso es un semáforo,
> no un estado de cuenta: no dice cuánto debe, desde cuándo, ni cuánto crédito le queda. El
> cotizador no puede advertirle al vendedor «este cliente tiene RD$43.200 vencidos a 73 días»
> con lo que hay hoy.

**`GET /api/catalogos/clientes/:no/estado-cuenta`**

```json
{
  "no": "018667",
  "name": "INNOVACION MARMOLITE Y GRANITO IMG, SRL",
  "moneda": "DOP",
  "balance": 125430.50,
  "balanceVencido": 43200.00,
  "limiteCredito": 200000.00,
  "creditoDisponible": 74569.50,
  "condicionPago": "30 DIAS",
  "blocked": 0,
  "antiguedad": {
    "corriente": 82230.50,
    "d1_30": 0,
    "d31_60": 0,
    "d61_90": 43200.00,
    "d90plus": 0
  },
  "documentosAbiertos": [
    {
      "tipo": "Factura",
      "documento": "FAC-00123",
      "fecha": "2026-05-02",
      "vencimiento": "2026-06-01",
      "montoOriginal": 50000.00,
      "saldo": 43200.00,
      "diasVencido": 73
    }
  ]
}
```

**Origen en NAV:** `Cust. Ledger Entry` + `Detailed Cust. Ledg. Entry` (el saldo real sale de
las entradas detalladas, no del campo `Remaining Amount` del encabezado), más
`Customer.[Credit Limit (LCY)]` y `Customer.[Payment Terms Code]`.

**Además, en el listado existente:** un parámetro opcional `incluirSaldo=true` en
`GET /api/catalogos/clientes` que añada solo `balance` y `balanceVencido` a cada fila. Esto
permite mostrar la bandera de mora directamente en los resultados de búsqueda, sin una llamada
por cliente.

---

### 3.2 · Crear cotización — **BLOQUEANTE**

> Cubre el paso 4, que hoy no existe en absoluto. Ningún endpoint de la API escribe nada.

**`POST /api/cotizaciones`**

```json
{
  "clienteNo": "018667",
  "contacto": "REYNALDO JIMENEZ",
  "correo": "innovacionmarmolite@gmail.com",
  "vendedor": "r.delacruz@lainnovacion.com.do",
  "validaHasta": "2026-09-15",
  "moneda": "DOP",
  "notas": "Cliente solicita entrega en obra.",
  "lineas": [
    {
      "code": "001002",
      "cantidad": 10,
      "precioUnitario": 5995.00,
      "descuentoPct": 5,
      "ubicacion": "01",
      "comentario": ""
    }
  ]
}
```

Respuesta esperada: el número de cotización asignado, los totales calculados por el sistema
(subtotal, descuento, ITBIS, total) y, por línea, el precio aplicado y la disponibilidad
confirmada al momento de crearla.

**Sobre el tamaño:** una cotización puede traer hasta 100 líneas —es habitual que los clientes
envíen listados largos por correo o en Excel—, así que el endpoint debe aceptarlas en una sola
petición y no por lotes.

**Origen en NAV:** `Sales Header` con `Document Type = Quote`, más `Sales Line`.

**Complementos necesarios:**

| Endpoint | Uso |
|---|---|
| `GET /api/cotizaciones?clienteNo=&desde=&hasta=` | Listado e historial |
| `GET /api/cotizaciones/:numero` | Detalle, para reabrir y editar |
| `GET /api/cotizaciones/:numero/pdf` | Documento formal para enviar al cliente |
| `POST /api/cotizaciones/:numero/enviar` | Envío por correo (opcional) |

Si generar el PDF desde el ERP resulta costoso, el cotizador puede producirlo por su cuenta;
en ese caso basta con que el `POST` persista y devuelva el número oficial.

---

### 3.3 · Precio y disponibilidad aplicables al cliente — **BLOQUEANTE**

> Sin esto la cotización sale con el precio de lista genérico, sin ITBIS y sin los descuentos
> que le corresponden al cliente. Es decir, sale mal.

**`POST /api/catalogos/productos/cotizar`**

```json
{
  "clienteNo": "018667",
  "items": [
    { "code": "001002", "cantidad": 10 },
    { "code": "001010", "cantidad": 3 }
  ]
}
```

Por cada ítem debe devolver: el precio unitario que le aplica a ese cliente (lista de precios y
descuentos por línea/grupo/cantidad), el porcentaje e importe de ITBIS, y la existencia actual
desglosada por ubicación.

**Origen en NAV:** `Sales Price`, `Sales Line Discount`, `Customer.[Customer Price Group]` /
`[Customer Disc. Group]`, y `Item.[VAT Prod. Posting Group]`.

Este endpoint se llama con las líneas ya seleccionadas, así que debe ser rápido y **debe
aceptar lotes grandes**: llegan solicitudes por correo y en archivos Excel de hasta 100
productos, y en esos casos se pediría el precio de las 100 líneas de una sola vez. Conviene
dimensionarlo para unos 200 ítems por llamada. No sirve si hereda los 10 segundos del endpoint
de productos, ni si obliga a una llamada por producto.

---

### 3.4 · Sustitutos y equivalencias

> Cubre la parte del paso 3 que explica *«esto no está disponible, pero tengo esto otro»*.

**`GET /api/catalogos/productos/:code/sustitutos`**

El catálogo actual ya expone un `itemStatus` con el valor **`Sustituto`** —valor que, dicho sea
de paso, no aparece en la documentación de Postman, que solo menciona `Activo`, `Descatalogado`
y `Bloqueado`—. Pero no hay ningún campo que enlace un producto descatalogado con el que lo
reemplaza, así que la información está incompleta: se sabe que un artículo *es* sustituto de
algo, pero no de qué.

**Origen en NAV:** tabla `Item Substitution`.

---

### 3.5 · Referencias cruzadas y códigos alternos

**`GET /api/catalogos/productos/:code/referencias`** o, mejor, un campo `referencias[]` en el
catálogo.

Los clientes piden por el código del fabricante, por un código de barras secundario o por el
nombre con el que ellos lo conocen. Hoy la búsqueda solo cubre `ItemNo`, `ItemDescription` y un
único `Barcode`. Exponer las referencias cruzadas mejora directamente la tasa de acierto al
interpretar el texto del correo.

**Origen en NAV:** `Item Reference` (o `Item Cross Reference` en versiones anteriores).

---

### 3.6 · Nombres de la taxonomía

**`GET /api/catalogos/taxonomia`**

El catálogo devuelve `divisionCode`, `categoryCode` y `groupCode` como códigos crudos
(`VDOM`, `VDOM01`, `VDOM0105`) sin su descripción. Se necesitan los nombres legibles para dos
cosas: mostrarle al vendedor en qué familia está el producto, y agrupar por categoría al
proponer alternativas.

---

## 4. Mejoras a los endpoints existentes

### 4.1 · Rendimiento de `/api/catalogos/productos`

Entre 9 y 26 segundos por petición, sin importar los filtros. Una búsqueda por código de barras
que devuelve 394 bytes tarda 10.3 segundos. Es inviable para una búsqueda interactiva.

El cotizador va a resolver esto por su cuenta manteniendo un espejo local del catálogo (13
páginas de 5.000, unos 3 minutos y ~20 MB por sincronización completa), así que **no es
bloqueante**. Pero conviene que el equipo lo sepa: cualquier otro consumidor de ese endpoint
va a sufrir lo mismo. La causa parece ser el escaneo de la vista del ERP; un índice o una vista
materializada resolvería el problema de raíz.

### 4.2 · Marca de tiempo por registro

Un campo `modifiedAt` (o equivalente) en productos y clientes, con la posibilidad de filtrar
por `modificadoDesde=`, permitiría sincronizar incrementalmente en vez de bajar los 20 MB
completos cada vez. Con el endpoint actual, cada sincronización es un volcado total.

### 4.3 · Aclaraciones sobre los datos

- **`unitPrice`**: ¿incluye ITBIS o es el precio antes de impuestos? ¿Siempre en DOP, o hay
  productos en otra moneda?
- **`unitPrice` vacío**: 86 de los primeros 5.000 productos no traen precio. ¿Es un dato
  faltante o significa algo (por ejemplo, precio bajo pedido)?
- **`itemStatus`**: documentar el valor `Sustituto`.
- **`clasificacion`** (`A`, `B`, …): ¿qué criterio representa? Podría servir para priorizar
  sugerencias.

---

## 5. Resumen

| # | Endpoint | Paso que habilita | Prioridad |
|---|---|---|---|
| 3.1 | Estado de cuenta del cliente | 2 — situación del cliente | **Bloqueante** |
| 3.2 | `POST` de cotización + detalle/listado/PDF | 4 — generar la cotización | **Bloqueante** |
| 3.3 | Precio y disponibilidad por cliente | 4 — que el precio sea correcto | **Bloqueante** |
| 3.4 | Sustitutos | 3 — explicar lo no disponible | Alta |
| 3.5 | Referencias cruzadas | 1 y 3 — acierto al interpretar el texto | Media |
| 3.6 | Nombres de taxonomía | 3 — agrupar y presentar | Media |
| 4.1 | Rendimiento de productos | — (mitigado con espejo local) | Informativa |
| 4.2 | Marca de tiempo por registro | — (eficiencia de sincronización) | Media |

Con 3.1, 3.2 y 3.3 el cotizador queda completo de punta a punta. Sin ellos, llega hasta la
selección de productos y ahí se detiene.
