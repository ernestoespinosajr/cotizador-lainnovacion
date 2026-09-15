/**
 * Genera el PDF de la cotización, calcado de docs/referencias/modelo-cotizacion.pdf.
 *
 * El documento que ve el cliente lleva la marca **Innova Centro** (verde y
 * naranja), no la de La Innovación (negro y rojo) que usa la interfaz interna:
 * Innova Centro es la marca comercial e «LA INNOVACION SAS» la razón social, que
 * aparece junto al RNC.
 *
 * Todos los importes salen calculados por NAV. Acá no se recalcula nada excepto
 * el ITBIS por línea, que el modelo muestra en una columna propia y la respuesta
 * no trae por separado (es AmountIncludingVAT − Amount).
 */
import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { CotizacionNav } from './nav.ts'
import { nombreCompleto } from './producto.ts'

const VERDE = '#00993F'
const TINTA = '#111111'

/** Días de validez del precio, según el pie del modelo. */
const DIAS_VALIDEZ = 3

/**
 * Nombres de tienda por código de ubicación.
 *
 * NAV devuelve `LocationCode` ("03") pero no el nombre ("TIENDA CHARLES DE
 * GAULLE"), y no existe servicio que lo resuelva. Hasta que la pasarela devuelva
 * un `LocationName`, se imprime el código. Completar acá es un parche válido
 * mientras tanto.
 */
const UBICACIONES: Record<string, string> = {}

/** Igual que arriba: la respuesta trae el código del vendedor, no su nombre. */
const VENDEDORES: Record<string, string> = {}

const num = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (v: string | number) => num.format(Number(v) || 0)

function fechaCorta(iso: string) {
  if (!iso) return ''
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)}/${a}`
}

function sumarDias(iso: string, dias: number) {
  const f = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(f.getTime())) return ''
  f.setUTCDate(f.getUTCDate() + dias)
  return f.toISOString().slice(0, 10)
}

// ── Columnas de la tabla, en puntos. Suman el ancho útil de la página. ───────
const COLS = [
  { k: 'codigo', t: 'Codigo', w: 46, a: 'left' },
  { k: 'desc', t: 'Descripcion', w: 186, a: 'left' },
  { k: 'unid', t: 'Unid', w: 26, a: 'center' },
  { k: 'ctd', t: 'Ctd.', w: 32, a: 'right' },
  { k: 'precio', t: 'Precio\nS/Itbis', w: 54, a: 'right' },
  { k: 'desc_pct', t: '%\nDesc', w: 28, a: 'right' },
  { k: 'subtot', t: 'SubTot\nS/Itbis', w: 56, a: 'right' },
  { k: 'itbis', t: 'Itbis\nAplic.', w: 50, a: 'right' },
  { k: 'total', t: 'Total Itbis\nIncl.', w: 62, a: 'right' },
] as const

export type DatosPdf = {
  cotizacion: CotizacionNav
  /** Usuario del cotizador. El modelo lo imprime como COTIZADOR, aparte del vendedor. */
  cotizador: string
  observaciones?: string[]
}

export async function generarPdf(datos: DatosPdf): Promise<Buffer> {
  const { cotizacion: c, cotizador } = datos
  const M = 36
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: M, bottom: M, left: M, right: M } })
  const ancho = doc.page.width - M * 2

  const trozos: Buffer[] = []
  doc.on('data', (t: Buffer) => trozos.push(t))
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))))

  const totalLineas = c.Lineas.length
  let pagina = 1

  const encabezado = () => {
    let y = M

    // Logo de Innova Centro. Si falta el archivo, el documento sale igual.
    const logo = join(process.cwd(), 'public', 'logo-innovacentro.png')
    if (existsSync(logo)) {
      try {
        doc.image(logo, M, y, { fit: [74, 60] })
      } catch {
        /* un logo ilegible no debe impedir emitir la cotización */
      }
    }

    // Bloque de identificación del documento, arriba a la derecha.
    const xd = M + ancho - 230
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA)
    doc.text('COTIZACION', xd, y + 18, { width: 90 })
    doc.text('FECHA', xd, y + 30, { width: 90 })
    doc.text('PEDIDO:', xd, y + 42, { width: 90 })
    doc.text(c.QuoteNo, xd + 95, y + 18, { width: 135 })
    doc.font('Helvetica-Bold').text(fechaCorta(c.Header.DocumentDate), xd + 95, y + 30, { width: 135 })

    doc.font('Helvetica-Bold').fontSize(7.5)
    doc.text(
      `${c.Company.Name ?? ''} RNC: ${c.Company.VATRegistrationNo ?? ''}`,
      M + 40,
      y + 66,
      { width: 260 },
    )

    y += 82

    // Dos cajas: cliente a la izquierda, gestión de la cotización a la derecha.
    const wIzq = ancho * 0.5 - 6
    const wDer = ancho * 0.5 - 6
    const xDer = M + ancho - wDer
    const hCaja = 62

    doc.lineWidth(0.7).strokeColor(TINTA)
    doc.rect(M, y, wIzq, hCaja).stroke()
    doc.rect(xDer, y, wDer, hCaja).stroke()

    const fila = (x: number, yy: number, rot: string, val: string, w: number, negrita = false) => {
      doc.font('Helvetica').fontSize(7.5).fillColor(TINTA).text(rot, x + 5, yy, { width: 72 })
      doc
        .font(negrita ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(7.5)
        .text(val || '', x + 80, yy, { width: w - 85, ellipsis: true, lineBreak: false })
    }

    fila(M, y + 7, 'COD. CLIENTE:', c.Customer.No ?? '', wIzq)
    fila(M, y + 20, 'NOMBRE:', c.Customer.Name ?? '', wIzq)
    fila(M, y + 33, 'DIRECCION:', [c.Customer.Address, c.Customer.Address2].filter(Boolean).join(' '), wIzq)
    fila(M, y + 46, 'ATENCION:', c.Customer.Contact ?? '', wIzq)

    const vend = c.Header.SalespersonCode ?? ''
    const tienda = c.Header.LocationCode ?? ''
    fila(xDer, y + 5, 'COTIZADOR:', cotizador, wDer, true)
    fila(xDer, y + 17, 'VENDEDOR:', VENDEDORES[vend] ? `${VENDEDORES[vend]}   ${vend}` : vend, wDer)
    fila(xDer, y + 29, 'CONDICIONES:', c.Header.PaymentTermsCode ?? '', wDer)
    fila(xDer, y + 41, 'VENCIMIENTO:', fechaCorta(sumarDias(c.Header.DocumentDate, DIAS_VALIDEZ)), wDer)
    fila(xDer, y + 53, 'TIENDA:', UBICACIONES[tienda] ?? tienda, wDer)

    y += hCaja + 4
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(TINTA)
    doc.text(`TEL: ${c.Company.Phone ?? ''} (${c.Company.Name ?? ''})`, xDer, y, {
      width: wDer,
      align: 'right',
    })

    return y + 14
  }

  const cabeceraTabla = (y: number) => {
    doc.moveTo(M, y).lineTo(M + ancho, y).lineWidth(0.7).strokeColor(TINTA).stroke()
    let x = M
    doc.font('Helvetica').fontSize(7).fillColor(TINTA)
    for (const col of COLS) {
      doc.text(col.t, x + 2, y + 4, { width: col.w - 4, align: col.a === 'left' ? 'center' : col.a })
      x += col.w
    }
    const yy = y + 22
    doc.moveTo(M, yy).lineTo(M + ancho, yy).stroke()
    return yy + 3
  }

  let y = encabezado()
  y = cabeceraTabla(y)

  // Espacio que hay que dejar libre al pie para observaciones, totales y firma.
  const RESERVA = 150

  for (let i = 0; i < totalLineas; i++) {
    const l = c.Lineas[i]
    const itbisLinea = (Number(l.AmountIncludingVAT) || 0) - (Number(l.Amount) || 0)

    doc.font('Helvetica').fontSize(7)
    // Descripción 1 y 2 en un solo texto, igual que en pantalla (pedido de La
    // Innovación): impresa aparte, la segunda se leía como nota al pie.
    const nombre = nombreCompleto({ description: l.Description ?? '', description2: l.Description2 })
    const hDesc = doc.heightOfString(nombre, { width: COLS[1].w - 4 })
    const hFila = Math.max(11, hDesc) + 3

    // Salto de página: la cabecera de la tabla se repite para que las cien
    // líneas de un pedido largo sigan siendo legibles.
    if (y + hFila > doc.page.height - M - RESERVA) {
      pieDePagina(doc, M, ancho, pagina, false)
      doc.addPage()
      pagina++
      y = encabezado()
      y = cabeceraTabla(y)
    }

    const vals: Record<string, string> = {
      codigo: l.No ?? '',
      desc: nombre,
      unid: l.UnitOfMeasureCode ?? '',
      ctd: money(l.Quantity),
      precio: money(l.UnitPrice),
      // Un "0.00" en la columna de descuento se leía como si hubiera descuento;
      // se blanquea cuando de verdad no lo hay.
      desc_pct: Number(l.LineDiscountPct) > 0 ? money(l.LineDiscountPct) : '',
      subtot: money(l.LineAmount),
      itbis: money(itbisLinea),
      total: money(l.AmountIncludingVAT),
    }

    let x = M
    for (const col of COLS) {
      doc.font('Helvetica').fontSize(7).fillColor(TINTA)
      doc.text(vals[col.k], x + 2, y, { width: col.w - 4, align: col.a, lineBreak: col.k === 'desc' })
      x += col.w
    }

    y += hFila
  }

  // ── Observaciones y totales, solo en la última página ─────────────────────
  const yBloque = doc.page.height - M - 132
  const wObs = ancho * 0.62
  const wTot = ancho - wObs - 6
  const xTot = M + ancho - wTot

  doc.lineWidth(0.7).strokeColor(TINTA)
  doc.rect(M, yBloque, wObs, 56).stroke()
  doc.rect(xTot, yBloque, wTot, 56).stroke()

  doc.font('Helvetica').fontSize(7).fillColor(TINTA)
  doc.text('OBSERVACIONES', M + 4, yBloque + 4, { width: wObs - 8 })
  const obs = datos.observaciones ?? [
    `PRECIOS VALIDOS POR ${DIAS_VALIDEZ} DIAS`,
    'FAVOR DETALLAR EL NUMERO DE ESTA COTIZACION EN SU ORDEN DE COMPRA.',
  ]
  doc.fontSize(6.5)
  obs.forEach((o, i) => doc.text(o, M + 4, yBloque + 14 + i * 8, { width: wObs - 8 }))

  const t = c.Totals
  // `InvoiceDiscountAmount` es el descuento de cabecera y en la práctica llega
  // en cero: los descuentos se aplican por línea. Se suman los
  // `LineDiscountAmount` para que el pie muestre el ahorro real. Si el vendedor
  // eligió aplicar el descuento al precio (Use_Manual_Price), NAV devuelve
  // LineDiscountAmount=0 en cada línea y este total sale en cero, con lo cual
  // el renglón "Desc." queda oculto automáticamente.
  const descuentoTotal =
    (Number(t.InvoiceDiscountAmount) || 0) +
    c.Lineas.reduce((acc, l) => acc + (Number(l.LineDiscountAmount) || 0), 0)
  const totales: [string, string, boolean][] = [
    ['Sub-Total', money(t.TotalAmountExclVAT ?? t.SubTotal), false],
    ...((descuentoTotal > 0
      ? [['Desc.', money(descuentoTotal), false]]
      : []) as [string, string, boolean][]),
    ['ITBIS', money(t.VATAmount), false],
    ['TOTAL', money(t.TotalAmountInclVAT), true],
  ]
  totales.forEach(([rot, val, fuerte], i) => {
    const yy = yBloque + 6 + i * 12
    doc.font('Helvetica-Bold').fontSize(fuerte ? 8 : 7.5).fillColor(TINTA)
    doc.text(rot, xTot + 5, yy, { width: wTot * 0.45 })
    doc.text(val, xTot + wTot * 0.45, yy, { width: wTot * 0.55 - 8, align: 'right' })
  })

  pieDePagina(doc, M, ancho, pagina, true)

  doc.end()
  return listo
}

function pieDePagina(
  doc: PDFKit.PDFDocument,
  M: number,
  ancho: number,
  pagina: number,
  ultima: boolean,
) {
  const y = doc.page.height - M - 62

  if (ultima) {
    doc.font('Helvetica').fontSize(7.5).fillColor(TINTA)
    doc.text('ELABORADO POR:', M, y, { width: 90 })
    doc.moveTo(M + 92, y + 9).lineTo(M + 250, y + 9).lineWidth(0.7).strokeColor(TINTA).stroke()
    doc.fontSize(6.5).text('Representante de ventas.', M + 110, y + 12, { width: 140 })
  }

  doc.font('Helvetica').fontSize(7.5).fillColor(TINTA)
  doc.text(`Pagina    ${pagina}`, M + ancho - 90, y, { width: 90, align: 'right' })

  if (ultima) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TINTA)
    doc.text('-Solo recibimos cheques certificados a nombre de La Innovación S.R.L.', M, y + 30, {
      width: ancho,
      align: 'center',
    })
    doc.text('- No aceptamos transferencias bancarias.', M, y + 41, { width: ancho, align: 'center' })
  }
}
