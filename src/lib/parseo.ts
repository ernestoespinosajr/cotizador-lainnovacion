/**
 * Convierte lo que llega —texto de correo/WhatsApp o un Excel adjunto— en
 * líneas de solicitud.
 *
 * Cada línea guarda de dónde salió (`origen`) desde el primer momento. Es
 * deliberado: si más adelante hay que devolverle al cliente su propio Excel con
 * las columnas de precio llenas, hace falta saber a qué hoja y a qué fila
 * pertenece cada línea, y eso no se puede reconstruir después.
 *
 * Este módulo es determinista y no depende del modelo. `ia.ts` lo mejora cuando
 * hay clave de API, pero sin ella el cotizador sigue funcionando.
 */

export type Origen =
  | { tipo: 'texto'; linea: number }
  | { tipo: 'excel'; hoja: string; fila: number; columna?: string }
  /**
   * Agregada por el cotizador durante la conversación, no por la solicitud.
   * Se distingue del resto porque no tiene fila de origen: si algún día hay que
   * devolverle al cliente su propio Excel con los precios, estas líneas se
   * anexan al final en vez de rellenar una fila que nunca existió.
   */
  | { tipo: 'manual' }

export type LineaSolicitud = {
  id: string
  /** Lo que pidió el cliente, tal cual, sin la cantidad. */
  texto: string
  /**
   * El mismo pedido con la ortografía corregida y el término que usa el
   * catálogo, para buscar. Lo produce el modelo; sin IA queda igual a `texto`.
   *
   * Existe porque las dos cosas sirven para fines distintos: `texto` es el
   * registro de lo que pidió el cliente y se le muestra al vendedor, mientras
   * `busqueda` es lo que entra al índice. Escrito "nebera", el registro debe
   * decir nebera y la búsqueda tiene que decir nevera.
   */
  busqueda?: string
  cantidad: number
  unidad: string | null
  /** Código que puso el cliente, si venía en una columna aparte. */
  codigoCliente: string | null
  origen: Origen
}

let contador = 0
const nuevoId = () => `l${++contador}_${Date.now().toString(36)}`

const RUIDO =
  /^(buenos? d[ií]as|buenas tardes|buenas noches|hola|saludos|gracias|estimados?|se[nñ]ores?|atte|cordialmente|favor cotizar|favor de cotizar|quedo atento|necesito cotizar|solicito cotizaci[oó]n)/i

/**
 * Cantidad al principio (`10 UND ABANICO`, `2x nevera`) o al final
 * (`ABANICO KDK ... 10`). El resto de la línea es la descripción.
 */
function extraerCantidad(linea: string): { cantidad: number; unidad: string | null; texto: string } {
  const inicio = linea.match(/^\s*(\d+(?:[.,]\d+)?)\s*(x|und|uds?|pzas?|piezas?|unidades?|ea|pcs)?\s*[-.:)]?\s+(.+)$/i)
  if (inicio) {
    return {
      cantidad: Number(inicio[1].replace(',', '.')),
      unidad: inicio[2]?.toUpperCase() ?? null,
      texto: inicio[3].trim(),
    }
  }

  const fin = linea.match(/^(.+?)[\s-]+(\d+(?:[.,]\d+)?)\s*(und|uds?|pzas?|piezas?|unidades?|ea|pcs)?\s*$/i)
  if (fin && fin[1].trim().length > 3) {
    return {
      cantidad: Number(fin[2].replace(',', '.')),
      unidad: fin[3]?.toUpperCase() ?? null,
      texto: fin[1].trim(),
    }
  }

  return { cantidad: 1, unidad: null, texto: linea.trim() }
}

/** Parseo determinista de texto libre: una línea del mensaje, una solicitud. */
export function parsearTexto(texto: string): LineaSolicitud[] {
  const salida: LineaSolicitud[] = []

  texto.split(/\r?\n/).forEach((cruda, i) => {
    // Se limpian viñetas y numeraciones de lista antes de mirar la cantidad,
    // si no `1. NEVERA` se leería como una cantidad de 1.
    const linea = cruda.replace(/^\s*[-*•·]\s*/, '').replace(/^\s*\d+[.)]\s+/, '').trim()
    if (linea.length < 3) return
    if (RUIDO.test(linea)) return

    const { cantidad, unidad, texto: desc } = extraerCantidad(linea)
    if (desc.length < 3) return

    salida.push({
      id: nuevoId(),
      texto: desc,
      cantidad: cantidad > 0 ? cantidad : 1,
      unidad,
      codigoCliente: null,
      origen: { tipo: 'texto', linea: i + 1 },
    })
  })

  return salida
}

// ── Excel ───────────────────────────────────────────────────────────────────

const ENC_DESC = /(descrip|producto|art[ií]culo|articulo|detalle|concepto|item|nombre)/i
const ENC_CANT = /(cantidad|cant\b|qty|unidades|uds)/i
const ENC_COD = /(c[oó]digo|codigo|code|sku|referencia|ref\b|parte|part)/i

/** Texto de pie de tabla: notas, totales y cortesías, no productos. */
const NOTA =
  /(favor|gracias|nota|observaci|total|subtotal|itbis|impuesto|descuento|entrega|condicion|atte|saludos|firma|validez|precio[s]? sujeto)/i

/**
 * Lee la primera hoja con datos y detecta qué columna es cuál.
 *
 * Los Excel de los clientes no tienen forma fija: el encabezado puede estar en
 * la fila 5, sobran filas de logo y notas, y los nombres de columna varían. Se
 * busca la primera fila que parezca encabezado; si no aparece ninguna, se cae a
 * la columna de texto más larga como descripción.
 */
export async function parsearExcel(buffer: ArrayBuffer): Promise<LineaSolicitud[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  const salida: LineaSolicitud[] = []

  for (const hoja of wb.worksheets) {
    const filas: { fila: number; celdas: string[] }[] = []
    hoja.eachRow({ includeEmpty: false }, (row, n) => {
      const celdas: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        celdas[col - 1] = String(cell.text ?? '').trim()
      })
      filas.push({ fila: n, celdas })
    })
    if (filas.length === 0) continue

    // Fila de encabezado: la primera que nombre una descripción o un código.
    let idxEnc = -1
    let colDesc = -1
    let colCant = -1
    let colCod = -1

    for (let i = 0; i < Math.min(filas.length, 25); i++) {
      const c = filas[i].celdas
      const d = c.findIndex((v) => v && ENC_DESC.test(v))
      const q = c.findIndex((v) => v && ENC_CANT.test(v))
      const k = c.findIndex((v) => v && ENC_COD.test(v))
      if (d >= 0 || (k >= 0 && q >= 0)) {
        idxEnc = i
        colDesc = d
        colCant = q
        colCod = k
        break
      }
    }

    if (colDesc < 0) {
      // Sin encabezado reconocible: la columna con el texto más largo en
      // promedio es casi siempre la descripción.
      const anchos: number[] = []
      for (const f of filas) {
        f.celdas.forEach((v, i) => {
          if (v && !/^\d+([.,]\d+)?$/.test(v)) anchos[i] = (anchos[i] ?? 0) + v.length
        })
      }
      colDesc = anchos.reduce((mejor, v, i) => (v > (anchos[mejor] ?? 0) ? i : mejor), 0)
    }

    for (let i = idxEnc + 1; i < filas.length; i++) {
      const { fila, celdas } = filas[i]
      const desc = (celdas[colDesc] ?? '').trim()
      const codigo = colCod >= 0 ? (celdas[colCod] ?? '').trim() : ''

      // Una fila con código y sin descripción sigue siendo un pedido válido:
      // el cliente que conoce el código no escribe el nombre.
      if (desc.length < 3 && !codigo) continue
      if (ENC_DESC.test(desc) && desc.length < 20) continue // encabezado repetido

      const cantCruda = colCant >= 0 ? (celdas[colCant] ?? '').replace(',', '.') : ''
      const cantidad = Number(cantCruda)
      const hayCantidad = Number.isFinite(cantidad) && cantidad > 0

      // Las notas al pie ("Favor incluir ITBIS", "Gracias", totales) viven en la
      // misma columna que las descripciones. Se descartan cuando además les
      // falta la cantidad, que es lo que distingue una nota de un pedido.
      if (!hayCantidad && !codigo && NOTA.test(desc)) continue

      salida.push({
        id: nuevoId(),
        texto: desc || codigo,
        cantidad: hayCantidad ? cantidad : 1,
        unidad: null,
        codigoCliente: codigo || null,
        origen: {
          tipo: 'excel',
          hoja: hoja.name,
          fila,
          columna: colDesc >= 0 ? String(colDesc + 1) : undefined,
        },
      })
    }

    // Con una hoja que ya dio líneas alcanza; el resto suelen ser anexos.
    if (salida.length > 0) break
  }

  return salida
}
