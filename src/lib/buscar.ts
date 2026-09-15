/**
 * Recuperación de candidatos y clasificación por confianza.
 *
 * El triaje es lo que hace manejable un pedido de 100 líneas: el cotizador no
 * puede revisar 100 productos × 3 variantes. La búsqueda resuelve sola lo que
 * es inequívoco y solo reclama atención sobre lo dudoso.
 *
 *   exacto   → código, código de barras o descripción idéntica
 *   probable → un candidato claramente por delante del resto
 *   ambiguo  → varios candidatos parecidos entre sí, decide una persona
 *   sin_match→ no hay nada razonable que ofrecer
 *
 * Las variantes se calculan siempre, pero la interfaz solo las despliega si se
 * piden. Ver components/PanelVariantes.tsx.
 */
import { db } from './db.ts'
import { alfabetico, cotizable, nombreCompleto } from './producto.ts'

export type Producto = {
  code: string
  description: string
  description2: string
  divisionCode: string
  categoryCode: string
  groupCode: string
  barcode: string
  unitMeasure: string
  itemStatus: string
  clasificacion: string
  unitPrice: number | null
  unitCost: number | null
  priceDetalle: number | null
  pricePcomercial: number | null
  priceMayor: number | null
  inventory: number
  locationCount: number
  inventory01: number
  inventory02: number
  inventory03: number
  inventory04: number
  inventory05: number
  inventory11: number
  inventory12: number
  inventory15: number
}

export type Confianza = 'exacto' | 'probable' | 'ambiguo' | 'sin_match'

export { alfabetico, cotizable, nombreCompleto }

// Solo el tipo: no crea dependencia en tiempo de ejecución con `historial.ts`,
// que sí importa funciones de este módulo.
import type { PatronCliente, UsoProducto } from './historial'

export type Candidato = Producto & {
  /** 0..1 — porción del pedido, pesada por rareza, que aparece en el producto. */
  cobertura: number
  /** 0..1 — si coincidió con el término más discriminante del pedido. */
  relevancia: number
  /** 0..1 — parecido semántico con el pedido. 0 si no hay índice de vectores. */
  similitud: number
  puntaje: number
  motivo: string
  /**
   * Cuántas veces se le cotizó este producto exacto a este cliente y cuándo fue
   * la última. Lo rellena la ruta, no la búsqueda: el historial vive fuera del
   * espejo local. Ausente cuando el cliente no tiene historial.
   */
  uso?: UsoProducto
  /** Lo que el cliente repite dentro de este tipo de producto. */
  patron?: PatronCliente
}

export type Resolucion = {
  confianza: Confianza
  elegido: Candidato | null
  variantes: Candidato[]
  /** Explicación corta para el cotizador cuando no hay match o hay duda. */
  nota: string | null
}

const VACIAS = new Set([
  'de','del','la','el','los','las','un','una','unos','unas','para','con','y','o','al','en',
  'por','su','sus','se','es','favor','tipo','marca','modelo','color','unidad','unidades',
  'und','uds','pza','pzas','pieza','piezas','cant','cantidad','item','articulo','producto',
  'necesito','quiero','cotizar','cotizacion','precio','disponible','ea','pcs',
])

export function normalizar(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pasa a singular.
 *
 * Los clientes escriben en plural ("12 abanicos de techo", "3 neveras") y el
 * ERP guarda en singular ("ABANICO KDK…"). Sin esto, `abanicos` no coincide con
 * `ABANICO` ni siquiera por prefijo —el prefijo va hacia adelante—, la regla del
 * sustantivo inicial no se aplica y el pedido termina resuelto con un TORNILLO
 * que sí menciona la marca.
 *
 * Los umbrales de longitud evitan destrozar palabras que terminan en s sin ser
 * plurales: `gas`, `inox`, `mes`.
 */
export function singular(t: string) {
  if (t.length >= 6 && t.endsWith('es')) return t.slice(0, -2)
  if (t.length >= 5 && t.endsWith('s')) return t.slice(0, -1)
  return t
}

/**
 * Formas a probar de un término: la escrita y sus dos singulares posibles.
 *
 * El español no permite deducir el singular de un plural en `-es` sin saber la
 * palabra: «extractores» pierde las dos letras y «grandes» solo la `s`. Adivinar
 * una sola forma producía tokens inventados como `grand`, que además son raros y
 * por lo tanto el IDF los premiaba: "zafacones grandes" devolvía una ESPONJA
 * AUTO GRAND PRIX. Se prueban las tres y gana la que exista en el catálogo.
 */
export function variantes(t: string): string[] {
  const v = new Set([t])
  if (t.length >= 5 && t.endsWith('s')) v.add(t.slice(0, -1))
  if (t.length >= 6 && t.endsWith('es')) v.add(t.slice(0, -2))
  return [...v].filter((x) => x.length >= 3)
}

export function terminos(s: string) {
  return normalizar(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !VACIAS.has(t))
}

/**
 * FTS5 con OR de prefijos. El OR es intencional: exigir todos los términos
 * (AND) deja fuera los casos que más importan, donde el cliente escribe una
 * palabra que el ERP no usa. bm25 se encarga de premiar a los que coinciden en
 * más términos.
 */
function consultaFts(ts: string[]) {
  return ts
    .flatMap((t) => (t.length >= 3 ? variantes(t).map((v) => `"${v}"*`) : [`"${t}"`]))
    .join(' OR ')
}

/**
 * Ajuste por disponibilidad. Desempata ENTRE productos del tipo correcto; nunca
 * tanto como para cambiar de tipo.
 *
 * El límite es deliberado y está calibrado por debajo del peso de
 * `posicionNucleo`. Con un rango mayor pasaba esto: las 152 lavadoras del
 * catálogo están bloqueadas y sin existencia, así que un BALANCIN COFLEX con
 * 1.201 unidades le ganaba a todas y "lavadora carga frontal" devolvía un
 * repuesto de grifería. Vale preferir lo vendible entre dos neveras; no vale
 * ofrecer otra cosa porque la categoría pedida esté agotada. Que no haya
 * lavadoras es justamente lo que el vendedor necesita saber.
 */
function bonoDisponibilidad(p: Producto) {
  let b = 0
  if (p.inventory > 0) b += 0.06
  else b -= 0.03
  if (p.itemStatus === 'Activo') b += 0.04
  else if (p.itemStatus === 'Sustituto') b += 0.02
  else if (p.itemStatus === 'Descatalogado') b -= 0.03
  else if (p.itemStatus === 'Bloqueado') b -= 0.06
  if (p.unitPrice == null || p.unitPrice === 0) b -= 0.02
  return b
}

/**
 * Peso de cada término según lo raro que sea en el catálogo (IDF).
 *
 * Sin esto, en "estufa 4 hornillas" los tres términos valen igual y un
 * "TORNILLO ESTUFA ESTRIA" —que solo coincide en la palabra más común— le gana
 * a una estufa real. "nevera" aparece en cientos de productos y "dos" en miles:
 * el peso tiene que reflejar esa diferencia.
 */
const idfCache = new Map<string, number>()

export function idf(termino: string) {
  const cacheado = idfCache.get(termino)
  if (cacheado !== undefined) return cacheado

  const d = db()
  const n = (d.prepare('SELECT COUNT(*) n FROM productos').get() as { n: number }).n || 1
  const fila = d.prepare('SELECT doc FROM productos_vocab WHERE term = ?').get(termino) as
    | { doc: number }
    | undefined

  // Un término que no está en el vocabulario entró por prefijo; se le da el
  // peso de algo poco frecuente, que es lo que suele ser.
  const doc = fila?.doc ?? 1
  const v = Math.log(1 + n / Math.max(1, doc))
  idfCache.set(termino, v)
  return v
}

/**
 * Peso de cada término del pedido.
 *
 * Al IDF se le suma una regularidad del español que en estos pedidos se cumple
 * casi siempre: el tipo de producto va primero y los modificadores después.
 * "nevera dos puertas", "estufa 4 hornillas", "lavadora carga frontal",
 * "abanico de techo kdk" — en los cuatro, la primera palabra es la que define
 * qué es la cosa.
 *
 * Sin este sesgo el IDF solo premia lo raro, y como "frontal" aparece en menos
 * productos que "lavadora", un BALANCIN que coincide en "frontal" le ganaba a
 * la lavadora. Lo raro no es lo mismo que lo importante.
 */
const PESO_NUCLEO = 2.5

function pesos(ts: string[]) {
  // Se toma el IDF más bajo de las variantes: es el de la forma que realmente
  // existe en el catálogo. Con la más alta, un stem inventado y por eso rarísimo
  // se llevaría todo el peso.
  return ts.map((t, i) => Math.min(...variantes(t).map(idf)) * (i === 0 ? PESO_NUCLEO : 1))
}

function textoDe(p: Producto) {
  return normalizar(`${p.code} ${p.description} ${p.description2} ${p.barcode}`)
}

/** Un término cuenta como presente si aparece cualquiera de sus variantes. */
function aparece(t: string, texto: string) {
  return variantes(t).some((v) => texto.includes(v))
}

function cobertura(ts: string[], ws: number[], p: Producto) {
  if (ts.length === 0) return 0
  const texto = textoDe(p)
  let hallado = 0
  let total = 0
  ts.forEach((t, i) => {
    total += ws[i]
    if (aparece(t, texto)) hallado += ws[i]
  })
  return total > 0 ? hallado / total : 0
}

/**
 * ¿La descripción del ERP EMPIEZA por el núcleo del pedido?
 *
 * El catálogo sigue una convención firme: la primera palabra de la descripción
 * es el tipo de producto. ABANICO KDK…, NEVERA WHIRLPOOL…, TELEVISOR DAIWA…,
 * TORNILLO ESTUFA…, PALOMETA AIRE ACONDICIONADO…
 *
 * Esa regularidad resuelve el problema que ninguna otra señal resolvía: un
 * NIPLE KDK cuya segunda descripción dice "abanico techo" coincide en todas las
 * palabras del pedido, porque es un repuesto PARA abanicos. Buscando por
 * palabras, "es un X" y "es una pieza de X" son indistinguibles; por la palabra
 * inicial, no.
 */
function posicionNucleo(ts: string[], p: Producto) {
  const nucleo = ts[0]
  if (!nucleo) return 0
  const palabras = normalizar(p.description).split(' ')
  // Prefijo en cualquier dirección y contra todas las variantes del núcleo:
  // cubre el plural sin depender de acertar el stem.
  const cabeza = palabras[0] ?? ''
  const vs = variantes(nucleo)
  if (vs.some((v) => cabeza === v || cabeza.startsWith(v))) return 1
  if (cabeza.length >= 4 && vs.some((v) => v.startsWith(cabeza))) return 1
  // Segunda posición: suele ser un compuesto legítimo ("AIRE ACONDICIONADO"),
  // pero también el patrón "PIEZA + producto". Cuenta, con la mitad del peso.
  if (vs.includes(palabras[1] ?? '')) return 0.35
  return 0
}

/**
 * ¿Coincidió con el término que más pesa del pedido — normalmente el núcleo?
 *
 * Separa "no encontré nada" de "encontré algo discutible". En "nevera dos
 * puertas", una NEVERA que solo coincide en `nevera` es un candidato legítimo
 * aunque le falten dos de tres palabras; un ESTANTE DE BAÑO que no coincide en
 * ninguna palabra de peso, no.
 */
function relevancia(ts: string[], ws: number[], p: Producto) {
  if (ts.length === 0) return 0
  const texto = textoDe(p)
  const maxQuery = Math.max(...ws)
  const maxHallado = Math.max(0, ...ws.filter((_, i) => aparece(ts[i], texto)))
  return maxQuery > 0 ? maxHallado / maxQuery : 0
}

/**
 * Trae filas del índice para una consulta FTS, con su bm25 normalizado dentro
 * del propio lote. Se normaliza por lote y no globalmente porque los bm25 de dos
 * consultas distintas no son comparables entre sí.
 */
function lote(consulta: string, limite: number, soloVendibles = false) {
  const filas = db()
    .prepare(
      `SELECT p.*, bm25(productos_fts) AS rank
         FROM productos_fts f
         JOIN productos p ON p.code = f.code
        WHERE productos_fts MATCH ?
          ${soloVendibles ? "AND p.itemStatus = 'Activo' AND p.inventory > 0" : ''}
        ORDER BY rank
        LIMIT ?`,
    )
    .all(consulta, limite) as (Producto & { rank: number })[]

  if (filas.length === 0) return []
  const brutos = filas.map((f) => -f.rank)
  const mejor = Math.max(...brutos)
  const peor = Math.min(...brutos)
  const rango = mejor - peor || 1
  return filas.map((p) => ({ p, bm25: (-p.rank - peor) / rango }))
}

/**
 * Recupera candidatos del espejo local. Milisegundos, no segundos.
 *
 * Se consulta el índice dos veces y se unen los resultados:
 *
 *   1. Todos los términos con OR — buena cobertura, incluso cuando el cliente
 *      usa una palabra que el ERP no tiene.
 *   2. Solo el núcleo del pedido — garantiza que entren productos de ese tipo.
 * Si se pasan `vecinos` —los productos más parecidos según el índice semántico—
 * se suman al pozo y su similitud entra al puntaje. Eso es lo que rescata los
 * casos que ninguna palabra alcanza: «hornillas» contra QUEMADORES, «blanca»
 * contra BLANCO, o una PLANCHA DE ROPA distinguida de una PLANCHA DE CORCHO.
 *
 * Se probó una tercera consulta de texto, filtrando a `Activo` con existencia, y se descartó: el
 * filtro obliga a SQLite a recorrer todas las coincidencias del índice antes de
 * recortar —2.468 para "pintura"—, lo que llevó la consulta de 91 ms a 10,5 s
 * sin mejorar el resultado. El sesgo por disponibilidad tiene que vivir en el
 * puntaje, no en la recuperación.
 *
 * La segunda consulta sí es necesaria, y se agregó después de medir:
 *
 * Con una sola consulta OR y un límite duro, bm25 premia lo raro y lo corto, así
 * que en "pintura blanca" los documentos que solo coinciden en `blanca`
 * —canastas, luces de navidad, lanilla— desplazaban a las 2.468 pinturas del
 * catálogo: entraba UNA, y bloqueada.
 *
 */
export function candidatos(
  texto: string,
  limite = 40,
  vecinos: { code: string; similitud: number }[] = [],
  bono?: (p: Producto) => number,
  /**
   * Fiel a las medidas y marcas del texto. Se apaga cuando el texto no lo
   * escribió el cliente sino que es la descripción de un producto ya resuelto
   * por código: ahí las variantes pueden ser de otra marca o medida.
   */
  estricto = true,
): Candidato[] {
  const r = estricto ? restriccionesDe(texto) : SIN_RESTRICCIONES
  if (r.numeros.length === 0 && r.marcas.length === 0) {
    return recuperar(texto, limite, vecinos, bono)
  }
  // El filtro descarta, así que se recupera un pozo más hondo: con 40, en
  // «tv 55 pulgadas samsung» los televisores Samsung de 55" podían quedar
  // fuera del corte y la lista salir vacía aunque el catálogo los tenga.
  return recuperar(texto, Math.max(limite, 150), vecinos, bono)
    .filter((p) => cumple(p, r))
    .slice(0, limite)
}

function recuperar(
  texto: string,
  limite: number,
  vecinos: { code: string; similitud: number }[],
  bono?: (p: Producto) => number,
): Candidato[] {
  const ts = terminos(texto)
  if (ts.length === 0 && vecinos.length === 0) return []

  const porCodigo = new Map<string, { p: Producto; bm25: number }>()
  const agregar = (filas: { p: Producto; bm25: number }[]) => {
    for (const f of filas) {
      const previo = porCodigo.get(f.p.code)
      // Si aparece en los dos lotes, se le deja el mejor bm25 de ambos.
      if (!previo || f.bm25 > previo.bm25) porCodigo.set(f.p.code, f)
    }
  }

  if (ts.length > 0) {
    agregar(lote(consultaFts(ts), limite * 3))
    if (ts.length > 1) agregar(lote(consultaFts([ts[0]]), limite * 2))
  }

  // Los vecinos semánticos entran al pozo aunque no compartan ni una palabra:
  // ese es exactamente el caso que vienen a resolver. Con bm25 en 0, se sostienen
  // por su similitud.
  const sim = new Map(vecinos.map((v) => [v.code, v.similitud]))
  if (sim.size > 0) {
    const faltantes = [...sim.keys()].filter((c) => !porCodigo.has(c))
    if (faltantes.length > 0) {
      const marcas = faltantes.map(() => '?').join(',')
      const filas = db()
        .prepare(`SELECT * FROM productos WHERE code IN (${marcas})`)
        .all(...faltantes) as Producto[]
      for (const p of filas) porCodigo.set(p.code, { p, bm25: 0 })
    }
  }

  if (porCodigo.size === 0) return []

  const ws = pesos(ts)
  const hayVectores = sim.size > 0

  const scored = [...porCodigo.values()].map(({ p, bm25 }) => {
    const cob = cobertura(ts, ws, p)
    const sm = sim.get(p.code) ?? 0
    // Con índice semántico los pesos de texto se ceden en parte a la similitud.
    // Sin él, el reparto queda como estaba y nada cambia.
    const base = hayVectores
      ? 0.22 * bm25 + 0.20 * cob + 0.24 * posicionNucleo(ts, p) + 0.34 * sm + bonoDisponibilidad(p)
      : 0.34 * bm25 + 0.28 * cob + 0.30 * posicionNucleo(ts, p) + bonoDisponibilidad(p)

    // El historial del cliente entra como los demás desempates: sumado al final
    // y acotado. No participa en la recuperación ni puede rescatar un producto
    // que el texto no trajo, así que nunca cambia QUÉ se ofrece, solo el orden.
    const hist = bono ? bono(p) : 0
    const puntaje = base + hist

    return {
      ...p,
      cobertura: cob,
      relevancia: relevancia(ts, ws, p),
      similitud: sm,
      puntaje,
      motivo:
        cob >= 0.99
          ? 'Coincide con todo lo pedido'
          : sm >= 0.55 && cob < 0.5
            ? 'Se parece a lo pedido, aunque el catálogo lo nombre distinto'
            : `Coincide con ${Math.round(cob * 100)}% de lo pedido`,
    }
  })

  // Se compara con cuatro decimales y se desempata por código. La similitud
  // viene del vector de la consulta, que la API no devuelve idéntico entre
  // llamadas: en los últimos decimales bastaba para intercambiar dos candidatos
  // casi empatados y que la misma solicitud saliera en otro orden.
  const r4 = (n: number) => Math.round(n * 1e4)
  scored.sort((a, b) => r4(b.puntaje) - r4(a.puntaje) || a.code.localeCompare(b.code))
  return scored.slice(0, limite)
}

// ── Fidelidad al texto ──────────────────────────────────────────────────────
//
// Requerimiento de La Innovación tras el piloto: si piden «compresor de 18»,
// solo compresores de 18; si mencionan una marca, solo esa marca. La búsqueda
// por parecido traía lo más cercano aunque no coincidiera —«tv 55 pulgadas
// samsung» ofrecía Daiwa, Aiwa y Chiq—, y eso obligaba a revisar a mano.
//
// Lo que se exige es lo que el cliente fija de forma inequívoca: las medidas
// (números) y la marca. Los adjetivos no: «zafacón grande» no puede exigir la
// palabra GRANDE, que el catálogo casi nunca escribe.

export type Restricciones = { numeros: string[]; marcas: string[] }

const SIN_RESTRICCIONES: Restricciones = { numeros: [], marcas: [] }

/**
 * Palabras y medidas de un texto, listas para comparar.
 *
 * Las medidas son números sueltos, con la unidad pegada como mucho: 18', 55",
 * 8GL, 4Q, 12,000BTU (que queda en 12000). Un número metido dentro de un código
 * de modelo no cuenta: el 18 de FAIE18A2 no dice nada del tamaño, y contarlo
 * colaba aires acondicionados entre las neveras de 18 pies.
 */
function piezas(s: string) {
  const salida: string[] = []
  const tokens = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
    .split(/[^a-z0-9./]+/)
  for (const bruto of tokens) {
    const t = bruto.replace(/^[./]+|[./]+$/g, '')
    if (!t) continue
    const medida = t.match(/^(\d+(?:[./]\d+)?)[a-z]*$/)
    salida.push(medida ? medida[1] : t)
  }
  return salida
}

const esNumero = (t: string) => /^\d+([./]\d+)?$/.test(t)

/**
 * Qué palabras del catálogo funcionan como marca.
 *
 * El catálogo no tiene un campo de marca, pero sí una convención: la marca va
 * en la descripción principal, justo después del tipo (NEVERA SAMSUNG…,
 * TELEVISOR DAIWA…), y casi nunca en la segunda descripción. Los adjetivos se
 * comportan al revés: BLANCO aparece 2.337 veces en la segunda y 688 en la
 * primera. Con esa proporción SAMSUNG, DAIWA, CHIQ, LG o KDK quedan como marca
 * y BLANCA, INOX, TECHO, GRANDE o LED no, sin mantener una lista a mano.
 *
 * Se cuela algún tipo de producto (NEVERA, ESTUFA), y no hace daño: el producto
 * correcto lo contiene. Por eso además nunca se exige la primera palabra del
 * pedido, que es el tipo y puede estar escrita distinto (TV frente a TELEVISOR).
 */
let marcasCache: { total: number; es: (t: string) => boolean } | null = null

function esMarca(t: string) {
  const total = (db().prepare('SELECT COUNT(*) n FROM productos').get() as { n: number }).n
  if (!marcasCache || marcasCache.total !== total) {
    const tras = new Map<string, number>()
    const en1 = new Map<string, number>()
    const en2 = new Map<string, number>()
    const sumar = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
    const filas = db().prepare('SELECT description, description2 FROM productos').all() as {
      description: string
      description2: string
    }[]
    for (const f of filas) {
      const w = normalizar(f.description).split(' ')
      new Set(w.slice(1, 4)).forEach((x) => sumar(tras, x))
      new Set(w).forEach((x) => sumar(en1, x))
      new Set(normalizar(f.description2).split(' ')).forEach((x) => sumar(en2, x))
    }
    marcasCache = {
      total,
      es: (x) => (tras.get(x) ?? 0) >= 2 && (en2.get(x) ?? 0) <= 0.1 * (en1.get(x) ?? 0),
    }
  }
  return marcasCache.es(t)
}

export function restriccionesDe(texto: string): Restricciones {
  // Códigos de artículo (6 dígitos con cero delante) y de barras no son
  // medidas: se resuelven por su propio camino.
  const numeros = piezas(texto).filter(
    (t) => esNumero(t) && !(t.length >= 5 && t.startsWith('0')) && t.length < 7,
  )
  const marcas = terminos(texto)
    .slice(1)
    .filter((t) => /^[a-z]+$/.test(t) && esMarca(t))
  return { numeros: [...new Set(numeros)], marcas: [...new Set(marcas)] }
}

export function cumple(p: Producto, r: Restricciones) {
  const ps = new Set(piezas(`${p.description} ${p.description2}`))
  return r.numeros.every((n) => ps.has(n)) && r.marcas.every((m) => ps.has(m))
}

/** «SAMSUNG y 55» — para decirle al vendedor qué se exigió. */
export function describirRestricciones(r: Restricciones) {
  const partes = [...r.marcas.map((m) => m.toUpperCase()), ...r.numeros]
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/** Búsqueda manual desde el panel de variantes. */
export function buscarLibre(
  texto: string,
  limite = 30,
  vecinos: { code: string; similitud: number }[] = [],
  bono?: (p: Producto) => number,
) {
  const t = texto.trim()
  if (!t) return []
  const lista = candidatos(t, limite, vecinos, bono)
  const arriba: Candidato[] = []
  const vistos = new Set<string>()

  const exacto = porCodigoOBarras(t)
  if (exacto) {
    arriba.push({ ...exacto, cobertura: 1, relevancia: 1, similitud: 1, puntaje: 1, motivo: 'Código exacto' })
    vistos.add(exacto.code)
  }
  // Aunque el texto entero no sea un código, puede llevar uno adentro
  // («abanico 001010», «necesito 049374»). Se resuelven aquí para que el
  // vendedor los vea primero en el panel.
  for (const p of codigosEmbebidos(t)) {
    if (vistos.has(p.code)) continue
    arriba.push({ ...p, cobertura: 1, relevancia: 1, similitud: 1, puntaje: 1, motivo: 'Código en la búsqueda' })
    vistos.add(p.code)
  }
  // Los códigos exactos van primero aunque la búsqueda también los haya traído:
  // son lo que el vendedor tecleó. El resto, en orden alfabético.
  return [...arriba, ...alfabetico(lista.filter((c) => !vistos.has(c.code)))].slice(0, limite)
}

function porCodigoOBarras(texto: string): Producto | null {
  const t = texto.trim()
  if (!/^[A-Za-z0-9.\-]{4,}$/.test(t)) return null
  const r = db()
    .prepare('SELECT * FROM productos WHERE code = ? OR barcode = ? LIMIT 1')
    .get(t, t) as Producto | undefined
  return r ?? null
}

/**
 * Códigos y códigos de barras que aparecen embebidos dentro de un texto libre.
 *
 * El cliente puede escribir «necesito 2 abanicos código 001010» o «el 049374,
 * 3 unidades»; `porCodigoOBarras` solo mira el texto completo, así que sin este
 * escaneo esos casos se resuelven por descripción y el código queda ignorado.
 * Se pide al menos un dígito para no probar palabras contra la base.
 */
function codigosEmbebidos(texto: string): Producto[] {
  const tokens = texto.match(/[A-Za-z0-9.\-]{4,}/g)
  if (!tokens) return []
  const salida: Producto[] = []
  const vistos = new Set<string>()
  for (const t of tokens) {
    if (!/\d/.test(t)) continue
    const p = porCodigoOBarras(t)
    if (p && !vistos.has(p.code)) {
      vistos.add(p.code)
      salida.push(p)
    }
  }
  return salida
}

/** Búsqueda exacta por código o código de barras, para lookups del editor. */
export function productoPor(codigo: string): Producto | null {
  return porCodigoOBarras(codigo)
}

function aprendido(clienteNo: string, texto: string): Producto | null {
  const norm = normalizar(texto)
  if (!norm) return null
  const r = db()
    .prepare(
      `SELECT p.* FROM aprendizaje a
         JOIN productos p ON p.code = a.code
        WHERE a.textoNorm = ? AND (a.clienteNo = ? OR a.clienteNo = '')
        ORDER BY (a.clienteNo = ?) DESC, a.veces DESC
        LIMIT 1`,
    )
    .get(norm, clienteNo, clienteNo) as Producto | undefined
  return r ?? null
}

/**
 * Resuelve una línea del pedido a un producto, con su nivel de confianza.
 * Sin llamadas de red: todo sale del espejo local.
 */
export function resolver(
  texto: string,
  clienteNo = '',
  vecinos: { code: string; similitud: number }[] = [],
  bono?: (p: Producto) => number,
): Resolucion {
  const vacio: Resolucion = { confianza: 'sin_match', elegido: null, variantes: [], nota: null }
  if (!texto.trim()) return vacio

  // 1 · Lo que ya corrigió una persona antes gana sobre cualquier heurística.
  const previo = aprendido(clienteNo, texto)
  if (previo) {
    return {
      confianza: 'exacto',
      elegido: { ...previo, cobertura: 1, relevancia: 1, similitud: 1, puntaje: 1, motivo: 'Resuelto así en una cotización anterior' },
      variantes: alfabetico(candidatos(texto, 40, vecinos, bono).filter((c) => c.code !== previo.code)),
      nota: null,
    }
  }

  // 2 · Código o código de barras literal.
  const literal = porCodigoOBarras(texto)
  if (literal) {
    return {
      confianza: 'exacto',
      elegido: { ...literal, cobertura: 1, relevancia: 1, similitud: 1, puntaje: 1, motivo: 'Código exacto' },
      variantes: alfabetico(candidatos(literal.description, 40, vecinos, bono, false).filter((c) => c.code !== literal.code).slice(0, 12)),
      nota: null,
    }
  }

  // 2b · Código embebido en el texto («abanico 001010», «necesito 049374»).
  // Solo se toma cuando hay uno solo: si el texto contiene varios candidatos
  // numéricos que resuelven a productos distintos, la decisión es humana.
  const embebidos = codigosEmbebidos(texto)
  if (embebidos.length === 1) {
    const p = embebidos[0]
    return {
      confianza: 'exacto',
      elegido: { ...p, cobertura: 1, relevancia: 1, similitud: 1, puntaje: 1, motivo: 'Código en la solicitud' },
      variantes: alfabetico(candidatos(p.description, 40, vecinos, bono, false).filter((c) => c.code !== p.code).slice(0, 12)),
      nota: null,
    }
  }
  if (embebidos.length > 1) {
    const variantes: Candidato[] = embebidos.map((p) => ({
      ...p,
      cobertura: 1,
      relevancia: 1,
      similitud: 1,
      puntaje: 1,
      motivo: 'Código en la solicitud',
    }))
    return {
      confianza: 'ambiguo',
      elegido: variantes[0],
      variantes: alfabetico(variantes.slice(1)),
      nota: 'La solicitud tiene varios códigos. Confirma cuál es el que corresponde.',
    }
  }

  const lista = candidatos(texto, 40, vecinos, bono)
  if (lista.length === 0) {
    const r = restriccionesDe(texto)
    const exigido = describirRestricciones(r)
    return {
      ...vacio,
      nota: exigido
        ? `No hay en el catálogo un producto que coincida con ${exigido}. Busca a mano si el cliente acepta otra marca o medida.`
        : 'No hay ningún producto que se parezca en el catálogo.',
    }
  }

  // Un producto bloqueado no se puede cotizar, así que no puede ser la elección
  // por defecto mientras exista un candidato viable. Sigue apareciendo entre las
  // variantes: al vendedor le sirve saber que el artículo existe pero está
  // frenado en el ERP.
  const ordenada =
    cotizable(lista[0]) || !lista.some(cotizable)
      ? lista
      : [...lista.filter(cotizable), ...lista.filter((c) => !cotizable(c))]

  const [top, segundo] = ordenada
  const margen = segundo ? top.puntaje - segundo.puntaje : 1
  // Todas las que pasaron el filtro, no solo las ocho mejores: con la búsqueda
  // fiel al texto la lista ya es corta, y en orden alfabético el vendedor
  // encuentra el modelo sin leer un ranking que no le dice nada.
  const variantes = alfabetico(ordenada.slice(1, 30))

  // 3 · Descripción idéntica: no es solo alta confianza, es certeza.
  if (normalizar(top.description) === normalizar(texto)) {
    return { confianza: 'exacto', elegido: top, variantes, nota: null }
  }

  // Si ni el mejor candidato coincide con la palabra que más pesa del pedido,
  // no hay nada que ofrecer: lo que salió es ruido del índice.
  // La relevancia mide coincidencia de palabras, así que un producto traído por
  // el índice semántico la tiene baja por definición. Si se parece de verdad, no
  // se descarta por eso.
  if (top.relevancia < 0.35 && top.similitud < 0.5) {
    return {
      confianza: 'sin_match',
      elegido: null,
      variantes: alfabetico(ordenada.slice(0, 30)),
      nota: 'Nada en el catálogo se parece a lo pedido. Busca a mano si conoces el producto.',
    }
  }

  // 4 · Un candidato claramente destacado se da por bueno; si el segundo pisa
  // los talones al primero, la decisión es de una persona.
  if (top.cobertura >= 0.7 && margen >= 0.1) {
    return { confianza: 'probable', elegido: top, variantes, nota: notaEstado(top) }
  }

  return {
    confianza: 'ambiguo',
    elegido: top,
    variantes,
    nota:
      notaEstado(top) ??
      (margen < 0.12
        ? 'Hay varios productos parecidos entre sí. Conviene confirmar cuál es.'
        : 'La coincidencia es parcial. Conviene confirmar.'),
  }
}

/** Advertencia sobre el producto elegido, aunque la coincidencia sea buena. */
function notaEstado(p: Producto): string | null {
  if (!cotizable(p)) return 'Bloqueado en el ERP: no se puede cotizar. Hay que elegir otro.'
  if (p.itemStatus === 'Descatalogado') return 'Producto descatalogado, pero se puede cotizar.'
  if (p.inventory <= 0) return 'Sin existencia en ninguna ubicación.'
  return null
}

/** Guarda la corrección del cotizador para que la próxima vez entre directo. */
export function aprender(clienteNo: string, texto: string, code: string) {
  const norm = normalizar(texto)
  if (!norm || !code) return
  db()
    .prepare(
      `INSERT INTO aprendizaje (clienteNo, textoNorm, code, veces, creado)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(clienteNo, textoNorm, code) DO UPDATE SET veces = veces + 1`,
    )
    .run(clienteNo, norm, code, new Date().toISOString())
}
