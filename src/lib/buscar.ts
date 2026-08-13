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
  inventory: number
  locationCount: number
}

export type Confianza = 'exacto' | 'probable' | 'ambiguo' | 'sin_match'

export type Candidato = Producto & {
  /** 0..1 — porción del pedido, pesada por rareza, que aparece en el producto. */
  cobertura: number
  /** 0..1 — si coincidió con el término más discriminante del pedido. */
  relevancia: number
  puntaje: number
  motivo: string
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

export function terminos(s: string) {
  return normalizar(s)
    .split(' ')
    .filter((t) => t.length >= 2 && !VACIAS.has(t))
    .map(singular)
    .filter((t) => !VACIAS.has(t))
}

/**
 * FTS5 con OR de prefijos. El OR es intencional: exigir todos los términos
 * (AND) deja fuera los casos que más importan, donde el cliente escribe una
 * palabra que el ERP no usa. bm25 se encarga de premiar a los que coinciden en
 * más términos.
 */
function consultaFts(ts: string[]) {
  return ts
    .map((t) => (t.length >= 3 ? `"${t}"*` : `"${t}"`))
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

function idf(termino: string) {
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
  return ts.map((t, i) => idf(t) * (i === 0 ? PESO_NUCLEO : 1))
}

function textoDe(p: Producto) {
  return normalizar(`${p.code} ${p.description} ${p.description2} ${p.barcode}`)
}

function cobertura(ts: string[], ws: number[], p: Producto) {
  if (ts.length === 0) return 0
  const texto = textoDe(p)
  let hallado = 0
  let total = 0
  ts.forEach((t, i) => {
    total += ws[i]
    if (texto.includes(t)) hallado += ws[i]
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
  // Prefijo en cualquier dirección: cubre el plural que quede sin normalizar
  // ("NEVERAS EXHIBIDORAS" contra `nevera`) sin depender de acertar el stem.
  const cabeza = palabras[0] ?? ''
  if (cabeza === nucleo || cabeza.startsWith(nucleo)) return 1
  if (cabeza.length >= 4 && nucleo.startsWith(cabeza)) return 1
  // Segunda posición: suele ser un compuesto legítimo ("AIRE ACONDICIONADO"),
  // pero también el patrón "PIEZA + producto". Cuenta, con la mitad del peso.
  if (palabras[1] === nucleo) return 0.35
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
  const maxHallado = Math.max(0, ...ws.filter((_, i) => texto.includes(ts[i])))
  return maxQuery > 0 ? maxHallado / maxQuery : 0
}

/** Recupera candidatos del espejo local. Milisegundos, no segundos. */
export function candidatos(texto: string, limite = 40): Candidato[] {
  const ts = terminos(texto)
  if (ts.length === 0) return []

  const d = db()
  const filas = d
    .prepare(
      `SELECT p.*, bm25(productos_fts) AS rank
         FROM productos_fts f
         JOIN productos p ON p.code = f.code
        WHERE productos_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
    )
    .all(consultaFts(ts), limite * 3) as (Producto & { rank: number })[]

  if (filas.length === 0) return []

  // bm25 ya pondera por rareza y por longitud del documento, y lo hace bien: es
  // quien ordena. La cobertura solo desempata y el estado/existencia apenas
  // empuja. Un reordenamiento propio más agresivo destruye un buen ranking.
  const brutos = filas.map((f) => -f.rank)
  const mejor = Math.max(...brutos)
  const peor = Math.min(...brutos)
  const rango = mejor - peor || 1

  const ws = pesos(ts)
  const scored = filas.map((p) => {
    const cob = cobertura(ts, ws, p)
    const bm25 = (-p.rank - peor) / rango
    return {
      ...p,
      cobertura: cob,
      relevancia: relevancia(ts, ws, p),
      puntaje:
        0.34 * bm25 + 0.28 * cob + 0.30 * posicionNucleo(ts, p) + bonoDisponibilidad(p),
      motivo:
        cob >= 0.99
          ? 'Coincide con todo lo pedido'
          : `Coincide con ${Math.round(cob * 100)}% de lo pedido`,
    }
  })

  scored.sort((a, b) => b.puntaje - a.puntaje)
  return scored.slice(0, limite)
}

/** Búsqueda manual desde el panel de variantes. */
export function buscarLibre(texto: string, limite = 30) {
  const t = texto.trim()
  if (!t) return []
  const exacto = porCodigoOBarras(t)
  const lista = candidatos(t, limite)
  if (exacto && !lista.some((c) => c.code === exacto.code)) {
    return [{ ...exacto, cobertura: 1, relevancia: 1, puntaje: 1, motivo: 'Código exacto' }, ...lista].slice(0, limite)
  }
  return lista
}

function porCodigoOBarras(texto: string): Producto | null {
  const t = texto.trim()
  if (!/^[A-Za-z0-9.\-]{4,}$/.test(t)) return null
  const r = db()
    .prepare('SELECT * FROM productos WHERE code = ? OR barcode = ? LIMIT 1')
    .get(t, t) as Producto | undefined
  return r ?? null
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
export function resolver(texto: string, clienteNo = ''): Resolucion {
  const vacio: Resolucion = { confianza: 'sin_match', elegido: null, variantes: [], nota: null }
  if (!texto.trim()) return vacio

  // 1 · Lo que ya corrigió una persona antes gana sobre cualquier heurística.
  const previo = aprendido(clienteNo, texto)
  if (previo) {
    return {
      confianza: 'exacto',
      elegido: { ...previo, cobertura: 1, relevancia: 1, puntaje: 1, motivo: 'Resuelto así en una cotización anterior' },
      variantes: candidatos(texto).filter((c) => c.code !== previo.code).slice(0, 8),
      nota: null,
    }
  }

  // 2 · Código o código de barras literal.
  const literal = porCodigoOBarras(texto)
  if (literal) {
    return {
      confianza: 'exacto',
      elegido: { ...literal, cobertura: 1, relevancia: 1, puntaje: 1, motivo: 'Código exacto' },
      variantes: candidatos(literal.description).filter((c) => c.code !== literal.code).slice(0, 8),
      nota: null,
    }
  }

  const lista = candidatos(texto)
  if (lista.length === 0) {
    return { ...vacio, nota: 'No hay ningún producto que se parezca en el catálogo.' }
  }

  const [top, segundo] = lista
  const margen = segundo ? top.puntaje - segundo.puntaje : 1
  const variantes = lista.slice(1, 9)

  // 3 · Descripción idéntica: no es solo alta confianza, es certeza.
  if (normalizar(top.description) === normalizar(texto)) {
    return { confianza: 'exacto', elegido: top, variantes, nota: null }
  }

  // Si ni el mejor candidato coincide con la palabra que más pesa del pedido,
  // no hay nada que ofrecer: lo que salió es ruido del índice.
  if (top.relevancia < 0.35) {
    return {
      confianza: 'sin_match',
      elegido: null,
      variantes: lista.slice(0, 8),
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
      margen < 0.12
        ? 'Hay varios productos parecidos entre sí. Conviene confirmar cuál es.'
        : 'La coincidencia es parcial. Conviene confirmar.',
  }
}

/** Advertencia sobre el producto elegido, aunque la coincidencia sea buena. */
function notaEstado(p: Producto): string | null {
  if (p.itemStatus === 'Descatalogado') return 'Producto descatalogado.'
  if (p.itemStatus === 'Bloqueado') return 'Producto bloqueado en el ERP.'
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
