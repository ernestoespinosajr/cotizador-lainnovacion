/**
 * Búsqueda semántica sobre el catálogo.
 *
 * Existe porque la búsqueda por palabras llegó a su techo, y se midió dónde:
 *
 *   · Vocabulario. El cliente dice «hornillas» y el catálogo «quemadores»;
 *     «blanca» y el catálogo «BLANCO». Sin una letra en común no hay coincidencia.
 *   · Relevancia en conjuntos grandes. «pintura» coincide con 2.468 productos y
 *     bm25 no sabe cuál es una pintura blanca de pared: premia lo corto y lo raro.
 *   · Producto contra pieza. PLANCHA DE ROPA y PLANCHA DE CORCHO comparten la
 *     palabra que más pesa.
 *
 * Los vectores se guardan cuantizados a int8 en un solo archivo binario. A 512
 * dimensiones son 63.702 × 512 = 32 MB, contra los 391 MB que ocuparían en
 * float32 a dimensión completa. Para similitud coseno sobre vectores
 * normalizados, int8 conserva el orden de los vecinos sin diferencia práctica, y
 * un recorrido completo se mide en decenas de milisegundos: no hace falta un
 * índice aproximado.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from './db.ts'

/** Reducidas desde las 1.536 nativas. El modelo lo soporta y la calidad aguanta. */
export const DIMS = 512
export const MODELO_EMBEDDING = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small'

const RUTA = process.env.COTIZADOR_VECTORES ?? join(process.cwd(), 'data', 'vectores.bin')

/** Escala de cuantización: un vector normalizado vive en [-1, 1]. */
const ESCALA = 127

export function cuantizar(v: number[]): Int8Array {
  const out = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) {
    const q = Math.round(v[i] * ESCALA)
    out[i] = q > 127 ? 127 : q < -127 ? -127 : q
  }
  return out
}

export function normalizarVector(v: number[]): number[] {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

// ── Carga del blob ──────────────────────────────────────────────────────────

type Indice = { vectores: Int8Array; codigos: string[] }
let _indice: Indice | null = null

/** ¿Hay vectores construidos? Si no, la búsqueda cae a solo texto. */
export function vectoresDisponibles() {
  if (_indice) return true
  if (!existsSync(RUTA)) return false
  const n = (db().prepare('SELECT COUNT(*) c FROM vectores').get() as { c: number }).c
  return n > 0
}

function indice(): Indice | null {
  if (_indice) return _indice
  if (!existsSync(RUTA)) return null

  const filas = db().prepare('SELECT code FROM vectores ORDER BY pos').all() as { code: string }[]
  if (filas.length === 0) return null

  const buf = readFileSync(RUTA)
  const esperado = filas.length * DIMS
  if (buf.length < esperado) {
    console.error(
      `[vectores] el archivo tiene ${buf.length} bytes y la tabla espera ${esperado}. ` +
        'Corre `npm run vectores` para reconstruirlo.',
    )
    return null
  }

  _indice = {
    vectores: new Int8Array(buf.buffer, buf.byteOffset, esperado),
    codigos: filas.map((f) => f.code),
  }
  return _indice
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

export type Vecino = { code: string; similitud: number }

/**
 * Los `k` productos más parecidos al vector de la consulta.
 *
 * Recorrido completo con producto punto en int8. El acumulador va en entero y se
 * escala al final una sola vez.
 */
export function vecinos(consulta: Int8Array, k = 60): Vecino[] {
  const ix = indice()
  if (!ix) return []

  const { vectores, codigos } = ix
  const n = codigos.length
  const mejores: Vecino[] = []
  let piso = -Infinity

  for (let i = 0; i < n; i++) {
    const base = i * DIMS
    let punto = 0
    for (let d = 0; d < DIMS; d++) punto += consulta[d] * vectores[base + d]

    if (mejores.length < k) {
      mejores.push({ code: codigos[i], similitud: punto })
      if (mejores.length === k) {
        mejores.sort((a, b) => b.similitud - a.similitud)
        piso = mejores[k - 1].similitud
      }
    } else if (punto > piso) {
      // Inserción ordenada: mantener k elementos cuesta menos que ordenar 63.702.
      mejores[k - 1] = { code: codigos[i], similitud: punto }
      let j = k - 1
      while (j > 0 && mejores[j].similitud > mejores[j - 1].similitud) {
        const t = mejores[j]
        mejores[j] = mejores[j - 1]
        mejores[j - 1] = t
        j--
      }
      piso = mejores[k - 1].similitud
    }
  }

  mejores.sort((a, b) => b.similitud - a.similitud)
  // De vuelta a 0..1: ambos lados estaban escalados por 127.
  const div = ESCALA * ESCALA
  return mejores.map((m) => ({ code: m.code, similitud: Math.max(0, m.similitud / div) }))
}

// ── Llamada a OpenAI ────────────────────────────────────────────────────────

/**
 * Vectoriza textos. Se usa tanto al construir el índice como al consultar.
 *
 * Al consultar conviene mandar todas las líneas de la solicitud en una sola
 * llamada: con cien líneas, cien llamadas sueltas serían minutos de espera.
 */
export async function vectorizar(textos: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || textos.length === 0) return []

  const { default: OpenAI } = await import('openai')
  const c = new OpenAI({ apiKey })

  const r = await c.embeddings.create({
    model: MODELO_EMBEDDING,
    dimensions: DIMS,
    input: textos.map((t) => t.slice(0, 2000)),
  })

  return r.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

/** Vectoriza y cuantiza una consulta, lista para `vecinos()`. */
export async function vectorConsulta(texto: string): Promise<Int8Array | null> {
  const [v] = await vectorizar([texto])
  return v ? cuantizar(normalizarVector(v)) : null
}

/** Texto que se vectoriza de un producto: solo lo que tiene significado. */
export function textoSemantico(p: { description: string; description2: string }) {
  return [p.description, p.description2].filter(Boolean).join(' ').trim()
}
