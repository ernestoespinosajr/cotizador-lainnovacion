import { NextResponse } from 'next/server'
import { buscarLibre } from '@/lib/buscar'
import { cuantizar, normalizarVector, vecinos, vectorizar, vectoresDisponibles } from '@/lib/embeddings'

export const runtime = 'nodejs'

/**
 * Búsqueda manual desde el panel de variantes.
 *
 * El texto sale del espejo local y responde mientras el cotizador escribe. Si hay
 * índice semántico se agrega, porque acá es donde más sirve: el vendedor busca a
 * mano justamente cuando lo automático no encontró.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ productos: [] })

  let cercanos: { code: string; similitud: number }[] = []
  if (vectoresDisponibles()) {
    try {
      const [v] = await vectorizar([q])
      if (v) cercanos = vecinos(cuantizar(normalizarVector(v)), 40)
    } catch (e) {
      console.error('[vectores] búsqueda manual sin semántica:', e)
    }
  }

  return NextResponse.json({ productos: buscarLibre(q, 24, cercanos) })
}
