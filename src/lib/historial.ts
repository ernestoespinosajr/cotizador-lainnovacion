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

/** Tope del empujón. Calibrado contra `bonoDisponibilidad`, que llega a 0,10. */
const TOPE_CODIGO = 0.1
const TOPE_AFINIDAD = 0.07

/** A los 18 meses un producto ya no dice nada del cliente de hoy. */
const VIDA_MS = 18 * 30 * 24 * 3600 * 1000

export type UsoProducto = { veces: number; ultima: string }

export type PerfilCliente = {
  /** Código de producto → cuántas veces se le cotizó y cuándo fue la última. */
  codigos: Map<string, UsoProducto>
  /**
   * Tipo de producto (primera palabra de la descripción, la convención del
   * catálogo) → los demás términos que el cliente usa dentro de ese tipo, con
   * su frecuencia. Es lo que captura la marca sin nombrarla.
   */
  terminosPorTipo: Map<string, Map<string, number>>
  documentos: number
  lineas: number
}

export const PERFIL_VACIO: PerfilCliente = {
  codigos: new Map(),
  terminosPorTipo: new Map(),
  documentos: 0,
  lineas: 0,
}

export function perfilVacio(p: PerfilCliente) {
  return p.lineas === 0
}

export function perfilDeHistorial(docs: DocumentoHistorial[]): PerfilCliente {
  const codigos = new Map<string, UsoProducto>()
  const terminosPorTipo = new Map<string, Map<string, number>>()
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
      let bolsa = terminosPorTipo.get(tipo)
      if (!bolsa) terminosPorTipo.set(tipo, (bolsa = new Map()))
      for (const t of palabras.slice(1)) bolsa.set(t, (bolsa.get(t) ?? 0) + 1)
    }
  }

  return { codigos, terminosPorTipo, documentos: docs.length, lineas }
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
