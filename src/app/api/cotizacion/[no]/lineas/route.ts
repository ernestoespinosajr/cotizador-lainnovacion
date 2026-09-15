import { NextResponse } from 'next/server'
import { agregarLineas, type LineaPedida } from '@/lib/nav'
import { respuestaError } from '@/lib/apiError'

export const runtime = 'nodejs'

/**
 * Agrega una o varias líneas a una cotización existente.
 *
 * Formato del body: `{ lineas: [{ code, cantidad, descuento?, precio? }, ...] }`.
 * Si cualquier línea falla, NAV revierte todas y la cotización queda como
 * estaba (por eso el borde es «se manda un lote y se recibe la cotización
 * refrescada completa», no una respuesta por línea).
 */
export async function POST(req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params
  const quoteNo = decodeURIComponent(no).trim()
  const body = (await req.json()) as { lineas?: LineaPedida[] }
  const lineas = (body.lineas ?? []).filter((l) => l?.code && l.cantidad > 0)

  if (!quoteNo) {
    return NextResponse.json({ error: 'Falta el número de cotización.' }, { status: 400 })
  }
  if (lineas.length === 0) {
    return NextResponse.json({ error: 'No hay líneas para agregar.' }, { status: 400 })
  }

  try {
    const cotizacion = await agregarLineas(quoteNo, lineas)
    return NextResponse.json({ cotizacion })
  } catch (e) {
    return respuestaError(e)
  }
}
