/**
 * Cliente de la pasarela NAV (SoapProxyNav).
 *
 * No es un API REST: es un proxy .NET que envuelve el codeunit
 * `RetailWebServices` de NAV. Cada servicio se identifica por un `Request_ID`
 * dentro de un XML que viaja como cadena en el JSON.
 *
 *     Cotizador → SoapProxyNav → NAV SOAP → WebRequest(pxmlRequest, pxmlResponse)
 *
 * Solo existen dos servicios; se sondearon otros diez (consulta de ítem, precios,
 * antigüedad de deuda, sustitutos, consulta de cotización) y todos devuelven
 * "Unknown Request_ID".
 *
 *   LI_QUERY_CUSTOMER → balance, límite de crédito, bloqueo, condiciones de pago
 *   LI_CREATE_QUOTE   → crea la cotización y devuelve precios reales, ITBIS y totales
 *
 * `LI_CREATE_QUOTE` es a la vez el motor de precios y la persistencia: NAV aplica
 * el grupo de precio del cliente. Por eso el precio del espejo local es solo
 * referencia — para el ítem 001010 el espejo dice 5.995,00 y NAV devuelve
 * 5.000,00 al cliente 004789 y 4.152,54 al 018667.
 */

const url = () => process.env.NAV_PROXY_URL ?? ''

export type ClienteNav = {
  No: string
  Name: string
  Name2: string
  Address: string
  Address2: string
  PostCode: string
  City: string
  County: string
  CountryRegionCode: string
  Phone: string
  Email: string
  Contact: string
  VATRegistrationNo: string
  CurrencyCode: string
  PaymentTermsCode: string
  PaymentMethodCode: string
  SalespersonCode: string
  LocationCode: string
  CustomerPriceGroup: string
  CustomerDiscGroup: string
  PricesIncludingVAT: string
  /** Cadena con decimales, no número. */
  CreditLimit: string
  Balance: string
  /** Vacío, o `Ship` | `Invoice` | `All`. Con `Invoice` o `All` NAV rechaza cotizar. */
  Blocked: string
}

export type LineaNav = {
  Index: string
  LineNo: string
  No: string
  Description: string
  Description2: string
  LocationCode: string
  UnitOfMeasureCode: string
  UnitOfMeasure: string
  Quantity: string
  UnitPrice: string
  LineDiscountPct: string
  LineDiscountAmount: string
  LineAmount: string
  Amount: string
  AmountIncludingVAT: string
  VATPct: string
  VATIdentifier: string
}

export type CotizacionNav = {
  QuoteNo: string
  Header: {
    DocumentNo: string
    ExternalDocumentNo: string
    DocumentDate: string
    PaymentTermsCode: string
    PaymentMethodCode: string
    ShipmentDate: string
    /** Código, no nombre: NAV no devuelve el nombre del vendedor. */
    SalespersonCode: string
    /** Código, no nombre: tampoco devuelve el nombre de la tienda. */
    LocationCode: string
    PricesIncludingVAT: string
  }
  Customer: Record<string, string>
  ShipTo: Record<string, string>
  BillTo: Record<string, string>
  Company: Record<string, string>
  Lineas: LineaNav[]
  Totals: {
    LineCount: string
    SubTotal: string
    InvoiceDiscountAmount: string
    TotalAmountExclVAT: string
    VATAmount: string
    TotalAmountInclVAT: string
  }
}

/**
 * Error del lado de NAV, con su código de respuesta.
 *
 * Los campos se declaran aparte y no como parámetros del constructor: el
 * stripping de tipos de Node no soporta parameter properties, y estos módulos
 * también se ejecutan fuera del bundler (ver scripts/sync-catalogo.ts).
 */
export class ErrorNav extends Error {
  codigo: string | null
  requestId: string | null
  /** Texto crudo de NAV, para diagnóstico. */
  detalle: string | null

  constructor(
    mensaje: string,
    codigo: string | null = null,
    requestId: string | null = null,
    detalle: string | null = null,
  ) {
    super(mensaje)
    this.name = 'ErrorNav'
    this.codigo = codigo
    this.requestId = requestId
    this.detalle = detalle
  }

  /**
   * ¿NAV rechazó la operación, o falló la comunicación?
   *
   * Importa para saber si la cotización pudo quedar creada: un rechazo de NAV
   * llega con código y significa que no se creó nada. Un fallo de red no lleva
   * código y sí deja la duda.
   */
  get rechazoDelErp() {
    return this.codigo !== null
  }
}

/**
 * Traduce los errores de NAV a algo que un vendedor pueda accionar.
 *
 * El caso que más confunde es el del diálogo de confirmación: cuando una
 * validación del ERP pregunta «¿desea proceder?», por servicios web no hay nadie
 * que responda y NAV devuelve un párrafo en inglés sobre «client callbacks». El
 * mensaje útil está adentro, en español, y es el que se rescata.
 */
function traducirNav(texto: string): string {
  const callback = texto.match(/confirmation dialog box:\s*(.+?)\s*\(Table/i)
  if (callback) {
    const pregunta = callback[1].replace(/,?\s*¿?desea proceder\??$/i, '').trim()
    return (
      `El ERP no puede emitir esta cotización sin una confirmación manual: «${pregunta}». ` +
      'Por servicios web no hay forma de responder esa pregunta, así que hay que ' +
      'liberar al cliente en el ERP o emitir la cotización desde el propio Dynamics.'
    )
  }

  const itemBloqueado = texto.match(/Blocked must be equal to 'No'.*?Item: No\.=([A-Za-z0-9\-]+)/i)
  if (itemBloqueado) {
    return `El producto ${itemBloqueado[1]} está bloqueado en el ERP y no se puede cotizar. Hay que quitarlo o reemplazarlo.`
  }

  const clienteBloqueado = texto.match(/Customer (\S+) is blocked with type (\w+)/i)
  if (clienteBloqueado) {
    return `El cliente ${clienteBloqueado[1]} está bloqueado para ${clienteBloqueado[2] === 'Invoice' ? 'facturación' : clienteBloqueado[2]}. Hay que liberarlo en el ERP antes de cotizarle.`
  }

  return texto
}

function escapar(v: string | number) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * XML→JSON colapsa un nodo repetido único en objeto en vez de arreglo, así que
 * una cotización de una sola línea llega como objeto y una de dos como arreglo.
 * Es la fuente de fallos más fácil de pasar por alto de toda la integración.
 */
function comoArreglo<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

async function llamar(xml: string): Promise<Record<string, any>> {
  if (!url()) {
    throw new ErrorNav(
      'Falta configurar NAV_PROXY_URL. Es la dirección de la pasarela SoapProxyNav.',
    )
  }

  let res: Response
  try {
    res = await fetch(`${url()}/retail-services/WebRequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'WebRequest',
        parameters: { pxmlRequest: xml, pxmlResponse: '' },
      }),
      // Una cotización de 40 líneas tarda unos 4,5 s; el margen cubre las de 100.
      signal: AbortSignal.timeout(120_000),
      cache: 'no-store',
    })
  } catch (e) {
    throw new ErrorNav(
      `No se pudo contactar la pasarela NAV en ${url()}. ` +
        `Verificá que SoapProxyNav esté corriendo. (${e instanceof Error ? e.message : e})`,
    )
  }

  if (!res.ok) {
    throw new ErrorNav(`La pasarela NAV respondió ${res.status}: ${await res.text()}`)
  }

  const sobre = (await res.json()) as { success?: boolean; data?: { pxmlResponse?: any } }
  const r = sobre?.data?.pxmlResponse

  if (!r || typeof r !== 'object') {
    throw new ErrorNav('La pasarela NAV devolvió una respuesta vacía o ilegible.')
  }

  // NAV informa los errores dentro del cuerpo, con HTTP 200 y success:true.
  if (r.Response_Code || r.Response_Text) {
    const crudo = String(r.Response_Text ?? 'NAV rechazó la solicitud sin explicar el motivo.')
    throw new ErrorNav(
      traducirNav(crudo),
      // Sin código explícito igual se marca como rechazo: NAV respondió, así que
      // no hay duda sobre si el documento quedó creado.
      r.Response_Code ? String(r.Response_Code) : 'sin-codigo',
      r.Request_ID ? String(r.Request_ID) : null,
      crudo,
    )
  }

  return r
}

export async function consultarCliente(no: string): Promise<ClienteNav> {
  const r = await llamar(
    `<Request><Request_ID>LI_QUERY_CUSTOMER</Request_ID><Request_Body>` +
      `<Customer_No>${escapar(no)}</Customer_No>` +
      `</Request_Body></Request>`,
  )
  if (!r.Customer) throw new ErrorNav(`NAV no devolvió datos del cliente ${no}.`)
  return r.Customer as ClienteNav
}

export type LineaPedida = { code: string; cantidad: number }

/**
 * Crea la cotización en NAV y devuelve el documento valorado.
 *
 * `Salesperson_Code` se envía vacío a propósito: así NAV asigna el vendedor de la
 * cuenta, que es el que el PDF imprime como VENDEDOR. Enviar el código del
 * cotizador ahí lo sobreescribiría y el cliente dejaría de ver a su ejecutivo
 * (verificado con el cliente 022373 del modelo de PDF, cuyo vendedor 162
 * coincide con el impreso).
 *
 * `referencia` va al `External_Document_No` y debe ser única: repetirla hace que
 * NAV rechace con «El Nro documento se encuentra en otro pedido».
 */
export async function crearCotizacion(datos: {
  clienteNo: string
  referencia: string
  ubicacion?: string
  lineas: LineaPedida[]
}): Promise<CotizacionNav> {
  if (datos.lineas.length === 0) {
    throw new ErrorNav('No se puede crear una cotización sin líneas.')
  }

  const lineas = datos.lineas
    .map(
      (l) =>
        `<Line><Item_No>${escapar(l.code)}</Item_No>` +
        `<Quantity>${escapar(l.cantidad)}</Quantity></Line>`,
    )
    .join('')

  const r = await llamar(
    `<Request><Request_ID>LI_CREATE_QUOTE</Request_ID><Request_Body>` +
      `<Customer_No>${escapar(datos.clienteNo)}</Customer_No>` +
      `<External_Document_No>${escapar(datos.referencia)}</External_Document_No>` +
      `<Location_Code>${escapar(datos.ubicacion ?? '')}</Location_Code>` +
      `<Salesperson_Code></Salesperson_Code>` +
      `<Lines>${lineas}</Lines>` +
      `</Request_Body></Request>`,
  )

  if (!r.QuoteNo) throw new ErrorNav('NAV no devolvió número de cotización.')

  return {
    QuoteNo: String(r.QuoteNo),
    Header: r.Header ?? {},
    Customer: r.Customer ?? {},
    ShipTo: r.ShipTo ?? {},
    BillTo: r.BillTo ?? {},
    Company: r.Company ?? {},
    Lineas: comoArreglo<LineaNav>(r.Lines?.Line),
    Totals: r.Totals ?? {},
  } as CotizacionNav
}

/**
 * Referencia única para el `External_Document_No`.
 *
 * Lleva la fecha para que sea rastreable a ojo desde NAV, y una cola aleatoria
 * porque un choque no se puede reintentar: NAV rechaza el duplicado y no existe
 * servicio para consultar la cotización que ya quedó creada.
 */
export function nuevaReferencia(fecha = new Date()) {
  const f = fecha.toISOString().slice(2, 10).replace(/-/g, '')
  const cola = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `COT-${f}-${cola}`
}

/** Crédito disponible y estado, derivados de la consulta de cliente. */
export function situacion(c: ClienteNav) {
  const limite = Number(c.CreditLimit) || 0
  const balance = Number(c.Balance) || 0
  const bloqueo = (c.Blocked ?? '').trim()
  return {
    limite,
    balance,
    // Balance negativo en NAV es saldo a favor del cliente.
    disponible: limite > 0 ? limite - Math.max(0, balance) : null,
    debe: balance > 0,
    bloqueo,
    // Con `Invoice` o `All` NAV rechaza crear la cotización; `Ship` la permite.
    impideCotizar: bloqueo === 'Invoice' || bloqueo === 'All',
  }
}
