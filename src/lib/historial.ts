/**
 * Perfil de preferencias del cliente a partir de sus documentos anteriores.
 *
 * Lo que se mide y por qué está calibrado así:
 *
 * Sobre 6.317 líneas de 38 clientes, agrupando por tipo de producto, el 71% de
 * las familias repetidas tiene una marca dominante pero solo el 59% tiene una
 * variante exacta dominante. La diferencia no es ruido: un cliente que compra
 * EXTRACTOR AIRE KDK compra tres tamaños distintos según la obra, y uno que
 * compra ESCALERA CUPRUM compra tres alturas. La marca se repite; el modelo no.
 *
 * Por eso esto empuja el puntaje y nunca preselecciona. Preseleccionar la
 * variante exacta acertaría el 59% de las veces y el 41% restante metería un
 * tamaño equivocado que alguien tendría que cazar antes de emitir. El tope del
 * bono está por debajo del peso de `posicionNucleo`, igual que el de
 * disponibilidad: alcanza para ordenar entre productos del tipo correcto, no
 * para cambiar de tipo.
 *
 * La marca no se busca por posición. «La segunda palabra es la marca» falla en
 * cuanto aparece un tipo compuesto —EXTRACTOR AIRE KDK, AIRE ACONDICIONADO
 * MIDEA—, así que se usa el IDF del catálogo, que ya sabe que «AIRE» es común y
 * «KDK» es raro.
 */

import type { DocumentoHistorial } from './erp'
import { idf, normalizar, type Producto } from './buscar'
import { db } from './db'

/** Tope del empujón. Calibrado contra `bonoDisponibilidad`, que llega a 0,10. */
const TOPE_CODIGO = 0.1
const TOPE_AFINIDAD = 0.07

/** A los 18 meses un producto ya no dice nada del cliente de hoy. */
const VIDA_MS = 18 * 30 * 24 * 3600 * 1000

export type UsoProducto = { veces: number; ultima: string }

/**
 * Lo que el cliente repite dentro de un tipo de producto.
 *
 * «Ya cotizado 5 veces» no le dice al vendedor por qué salió ESTE y no otro de
 * la familia. El patrón sí: si de ocho abanicos ocho fueron KDK y cinco
 * blancos, eso es lo que hay que poner delante.
 */
export type PatronCliente = {
  /** Tipo de producto, tal como se muestra: «abanico», «extractor». */
  tipo: string
  /** Cuántas líneas de ese tipo tiene el cliente en su historial. */
  total: number
  /** Rasgos compartidos, del más repetido al menos. */
  rasgos: { termino: string; veces: number }[]
}

export type PerfilCliente = {
  /** Código de producto → cuántas veces se le cotizó y cuándo fue la última. */
  codigos: Map<string, UsoProducto>
  /**
   * Tipo de producto (primera palabra de la descripción, la convención del
   * catálogo) → los demás términos que el cliente usa dentro de ese tipo, con
   * su frecuencia. Es lo que captura la marca sin nombrarla.
   */
  terminosPorTipo: Map<string, Map<string, number>>
  /** Cuántas líneas tiene el cliente de cada tipo. Denominador del patrón. */
  lineasPorTipo: Map<string, number>
  documentos: number
  lineas: number
}

export const PERFIL_VACIO: PerfilCliente = {
  codigos: new Map(),
  terminosPorTipo: new Map(),
  lineasPorTipo: new Map(),
  documentos: 0,
  lineas: 0,
}

export function perfilVacio(p: PerfilCliente) {
  return p.lineas === 0
}

export function perfilDeHistorial(docs: DocumentoHistorial[]): PerfilCliente {
  const codigos = new Map<string, UsoProducto>()
  const terminosPorTipo = new Map<string, Map<string, number>>()
  const lineasPorTipo = new Map<string, number>()
  let lineas = 0

  for (const d of docs) {
    for (const l of d.lines ?? []) {
      // `type` 2 es artículo. Los demás son cargos, comentarios o cuentas
      // contables: no son nada que se pueda volver a cotizar.
      if (l.type !== 2 || !l.no) continue
      lineas++

      const previo = codigos.get(l.no)
      codigos.set(l.no, {
        veces: (previo?.veces ?? 0) + 1,
        ultima: previo && previo.ultima > d.orderDate ? previo.ultima : d.orderDate,
      })

      const palabras = normalizar(l.description).split(' ').filter(Boolean)
      const tipo = palabras[0]
      if (!tipo) continue
      lineasPorTipo.set(tipo, (lineasPorTipo.get(tipo) ?? 0) + 1)
      let bolsa = terminosPorTipo.get(tipo)
      if (!bolsa) terminosPorTipo.set(tipo, (bolsa = new Map()))
      // Únicos por línea: un término que aparece dos veces en una descripción no
      // vale por dos cotizaciones.
      for (const t of new Set(palabras.slice(1))) bolsa.set(t, (bolsa.get(t) ?? 0) + 1)
    }
  }

  return { codigos, terminosPorTipo, lineasPorTipo, documentos: docs.length, lineas }
}

/** 1 recién cotizado, cayendo a 0 a los 18 meses. Fecha ilegible cuenta como vieja. */
function frescura(fecha: string, ahora: number) {
  const t = Date.parse(fecha)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.min(1, 1 - (ahora - t) / VIDA_MS))
}

/**
 * Empujón para un producto según lo que el cliente ya ha cotizado.
 *
 * Dos señales que se suman:
 *
 *   · El mismo código, ponderado por repetición y por lo reciente que sea.
 *   · La afinidad de términos dentro del mismo tipo, pesada por IDF. Es la que
 *     recoge la marca: en «EXTRACTOR AIRE KDK» el término que decide es KDK,
 *     porque AIRE es común en el catálogo y apenas pesa.
 */
export function bonoDe(perfil: PerfilCliente, ahora = Date.now()) {
  if (perfilVacio(perfil)) return undefined

  return (p: Producto): number => {
    let bono = 0

    const uso = perfil.codigos.get(p.code)
    if (uso) {
      // log y no lineal: la diferencia entre una vez y tres importa mucho más
      // que entre diez y doce.
      const repeticion = Math.min(1, Math.log1p(uso.veces) / Math.log(5))
      bono += TOPE_CODIGO * repeticion * (0.4 + 0.6 * frescura(uso.ultima, ahora))
    }

    const palabras = normalizar(p.description).split(' ').filter(Boolean)
    const bolsa = perfil.terminosPorTipo.get(palabras[0] ?? '')
    if (bolsa) {
      let coincide = 0
      let total = 0
      for (const t of palabras.slice(1)) {
        const w = idf(t)
        total += w
        if (bolsa.has(t)) coincide += w
      }
      if (total > 0) bono += TOPE_AFINIDAD * (coincide / total)
    }

    return bono
  }
}

/** Lo que la interfaz necesita para explicar por qué un producto viene marcado. */
export function usoDe(perfil: PerfilCliente, code: string): UsoProducto | null {
  return perfil.codigos.get(code) ?? null
}

/**
 * Mínimo de repeticiones para llamarlo patrón. Con una sola coincidencia no hay
 * nada que contar: que el cliente pidiera algo blanco una vez no es preferencia.
 */
const MIN_VECES = 2
/** Y tiene que ser mayoría dentro del tipo, no una aparición suelta entre veinte. */
const MIN_PROPORCION = 0.4
/**
 * Tope de presencia del término DENTRO de su tipo en el catálogo.
 *
 * Separa lo que el cliente eligió de lo que viene con el tipo de producto. En
 * «EXTRACTOR AIRE KDK», `aire` está en el 56% de los extractores del catálogo
 * —es parte del nombre del tipo, no una decisión— mientras que `kdk` está en el
 * 8% y `platfond` en menos. Medido: abanico+kdk 3,6%, abanico+blanco 1,0%,
 * pintura+tropical 26%, extractor+aire 55,9%.
 *
 * Se probó antes un piso de IDF global y estaba mal planteado: descartaba
 * `blanco` (idf 3,10, en 3.020 productos del catálogo) cuando dentro de los
 * abanicos solo aparece en el 1% y es justo lo que distingue a este de los
 * demás. Lo que importa no es cuán raro es el término en el catálogo entero,
 * sino cuánto discrimina dentro de su familia.
 */
const MAX_PRESENCIA_EN_TIPO = 0.5

/**
 * Cuánto del tipo comparte ese término en el catálogo.
 *
 * Se cachea por par: la consulta recorre las 63.702 filas —`description` no
 * tiene índice por prefijo— y en una solicitud de cien líneas los mismos pares
 * se repiten muchas veces.
 */
const presenciaCache = new Map<string, number>()

function presenciaEnTipo(tipo: string, termino: string) {
  const clave = `${tipo}|${termino}`
  const cacheado = presenciaCache.get(clave)
  if (cacheado !== undefined) return cacheado

  const fila = db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lower(description) LIKE ? THEN 1 ELSE 0 END) AS con
         FROM productos
        WHERE lower(description) LIKE ?`,
    )
    .get(`% ${termino}%`, `${tipo} %`) as { total: number; con: number | null }

  const v = fila.total > 0 ? (fila.con ?? 0) / fila.total : 1
  presenciaCache.set(clave, v)
  return v
}

/**
 * El denominador común del cliente dentro del tipo de este producto.
 *
 * Devuelve null cuando no hay nada que contar, que es lo correcto: inventar un
 * patrón con dos líneas sueltas haría que el vendedor confíe en una regularidad
 * que no existe.
 */
export function patronDe(perfil: PerfilCliente, descripcion: string): PatronCliente | null {
  const palabras = normalizar(descripcion).split(' ').filter(Boolean)
  const tipo = palabras[0]
  if (!tipo) return null

  const total = perfil.lineasPorTipo.get(tipo) ?? 0
  const bolsa = perfil.terminosPorTipo.get(tipo)
  if (!bolsa || total < MIN_VECES) return null

  const rasgos = [...new Set(palabras.slice(1))]
    .map((termino) => ({ termino, veces: bolsa.get(termino) ?? 0 }))
    .filter((r) => r.veces >= MIN_VECES && r.veces / total >= MIN_PROPORCION)
    .filter((r) => presenciaEnTipo(tipo, r.termino) < MAX_PRESENCIA_EN_TIPO)
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 3)

  return rasgos.length > 0 ? { tipo, total, rasgos } : null
}
