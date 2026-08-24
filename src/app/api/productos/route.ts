import { NextResponse } from 'next/server'
import { buscarLibre } from '@/lib/buscar'
import { bonoDe, patronDe, usoDe } from '@/lib/historial'
import { perfilDe } from '@/lib/perfilCache'
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
  const params = new URL(req.url).searchParams
  const q = params.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ productos: [] })
  const clienteNo = params.get('cliente')?.trim() ?? ''

  let cercanos: { code: string; similitud: number }[] = []
  if (vectoresDisponibles()) {
    try {
      const [v] = await vectorizar([q])
      if (v) cercanos = vecinos(cuantizar(normalizarVector(v)), 40)
    } catch (e) {
      console.error('[vectores] búsqueda manual sin semántica:', e)
    }
  }

  // Mismo empujón por historial que en la resolución automática: si el panel
  // ordenara distinto que la lista de la que se abrió, el vendedor vería dos
  // criterios contradictorios en la misma pantalla.
  const perfil = await perfilDe(clienteNo)
  const productos = buscarLibre(q, 24, cercanos, bonoDe(perfil)).map((c) => ({
    ...c,
    uso: usoDe(perfil, c.code) ?? undefined,
    patron: patronDe(perfil, c.description) ?? undefined,
  }))

  return NextResponse.json({ productos })
}
