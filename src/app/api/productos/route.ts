import { NextResponse } from 'next/server'
import { buscarLibre } from '@/lib/buscar'

export const runtime = 'nodejs'

/** Búsqueda manual desde el panel de variantes. Contra el espejo local, así que
 *  responde mientras el cotizador escribe. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ productos: [] })
  return NextResponse.json({ productos: buscarLibre(q, 24) })
}
