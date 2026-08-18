/**
 * Construye el índice semántico del catálogo.
 *
 *   npm run vectores          # solo lo que falta o cambió
 *   npm run vectores -- --todo # desde cero
 *
 * Coste: unos 1,3 millones de tokens para las 63.702 descripciones, que con
 * text-embedding-3-small son centavos. Es incremental por hash del texto, así que
 * después de una sincronización solo se revectoriza lo que cambió.
 */
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { db, setMeta } from '../src/lib/db.ts'
import {
  DIMS,
  MODELO_EMBEDDING,
  cuantizar,
  normalizarVector,
  textoSemantico,
  vectorizar,
} from '../src/lib/embeddings.ts'

try {
  process.loadEnvFile(join(process.cwd(), '.env.local'))
} catch {
  /* sin .env.local se usan las variables del entorno */
}

if (!process.env.OPENAI_API_KEY) {
  console.error('Falta OPENAI_API_KEY. Es la misma clave que usa la capa de IA.')
  process.exit(1)
}

const RUTA = join(process.cwd(), 'data', 'vectores.bin')
const desdeCero = process.argv.includes('--todo')
/** La API acepta lotes grandes; 512 mantiene cada petición liviana. */
const LOTE = 512
/** Peticiones en paralelo. Más que esto empieza a chocar con el límite de tasa. */
const EN_VUELO = 4

const d = db()
const productos = d
  .prepare('SELECT code, description, description2 FROM productos ORDER BY code')
  .all() as { code: string; description: string; description2: string }[]

const hash = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 16)

const previos = desdeCero
  ? new Map<string, string>()
  : new Map(
      (d.prepare('SELECT code, hash FROM vectores').all() as { code: string; hash: string }[]).map(
        (r) => [r.code, r.hash],
      ),
    )

// El blob se reescribe completo y en el orden de `productos`, así que hay que
// tener a mano el vector de todos: los que no cambiaron se releen del anterior.
const anteriores = new Map<string, Int8Array>()
if (!desdeCero && previos.size > 0) {
  try {
    const { readFileSync, existsSync } = await import('node:fs')
    if (existsSync(RUTA)) {
      const buf = readFileSync(RUTA)
      const orden = d.prepare('SELECT code, pos FROM vectores ORDER BY pos').all() as {
        code: string
        pos: number
      }[]
      for (const { code, pos } of orden) {
        const ini = pos * DIMS
        if (ini + DIMS <= buf.length) {
          anteriores.set(code, new Int8Array(buf.subarray(ini, ini + DIMS)))
        }
      }
    }
  } catch (e) {
    console.log('  (no se pudo releer el blob anterior; se revectoriza todo)')
    previos.clear()
  }
}

// Un puñado de productos no tiene ninguna descripción. La API rechaza cadenas
// vacías, y de todos modos no hay nada que vectorizar: quedan sin vector y solo
// se encuentran por código o por texto.
const conTexto = productos.filter((p) => textoSemantico(p).length > 0)
const pendientes = conTexto.filter((p) => previos.get(p.code) !== hash(textoSemantico(p)))

console.log(`Catálogo: ${productos.length.toLocaleString('es-DO')} productos` +
  (productos.length !== conTexto.length ? ` (${productos.length - conTexto.length} sin descripción, se omiten)` : ''))
console.log(`Modelo:   ${MODELO_EMBEDDING} · ${DIMS} dimensiones`)
console.log(`Por vectorizar: ${pendientes.length.toLocaleString('es-DO')}`)
if (pendientes.length === 0) {
  console.log('Nada que hacer.')
  process.exit(0)
}

const nuevos = new Map<string, Int8Array>()
const lotes: (typeof pendientes)[] = []
for (let i = 0; i < pendientes.length; i += LOTE) lotes.push(pendientes.slice(i, i + LOTE))

const t0 = Date.now()
let hechos = 0

for (let i = 0; i < lotes.length; i += EN_VUELO) {
  const tanda = lotes.slice(i, i + EN_VUELO)
  const rs = await Promise.all(
    tanda.map(async (lote) => {
      const vs = await vectorizar(lote.map(textoSemantico))
      return lote.map((p, j) => [p.code, vs[j]] as const)
    }),
  )
  for (const lote of rs) {
    for (const [code, v] of lote) {
      if (v) nuevos.set(code, cuantizar(normalizarVector(v)))
    }
  }
  hechos += tanda.reduce((s, l) => s + l.length, 0)
  const seg = (Date.now() - t0) / 1000
  const ritmo = hechos / seg
  const falta = (pendientes.length - hechos) / (ritmo || 1)
  console.log(
    `  ${hechos.toLocaleString('es-DO')}/${pendientes.length.toLocaleString('es-DO')}` +
      ` · ${ritmo.toFixed(0)}/s · faltan ~${Math.round(falta)}s`,
  )
}

// ── Escritura del blob y del índice ─────────────────────────────────────────
mkdirSync(join(process.cwd(), 'data'), { recursive: true })
const blob = new Int8Array(conTexto.length * DIMS)
let sinVector = 0

d.exec('BEGIN')
try {
  d.exec('DELETE FROM vectores')
  const ins = d.prepare('INSERT INTO vectores (code, pos, hash) VALUES (?, ?, ?)')
  conTexto.forEach((p, pos) => {
    const v = nuevos.get(p.code) ?? anteriores.get(p.code)
    if (!v) {
      sinVector++
      return
    }
    blob.set(v, pos * DIMS)
    ins.run(p.code, pos, hash(textoSemantico(p)))
  })
  d.exec('COMMIT')
} catch (e) {
  d.exec('ROLLBACK')
  throw e
}

writeFileSync(RUTA, blob)
setMeta('vectores_modelo', `${MODELO_EMBEDDING}/${DIMS}`)
setMeta('vectores_fecha', new Date().toISOString())

const n = (d.prepare('SELECT COUNT(*) c FROM vectores').get() as { c: number }).c
console.log(
  `\n✓ ${n.toLocaleString('es-DO')} vectores en ${(blob.length / 1024 / 1024).toFixed(0)} MB` +
    ` · ${((Date.now() - t0) / 1000).toFixed(0)}s` +
    (sinVector ? ` · ${sinVector} sin vector` : ''),
)
