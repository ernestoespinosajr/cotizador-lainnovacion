import { NextResponse } from 'next/server'
import { actualizarLinea, borrarLinea } from '@/lib/nav'
import { respuestaError } from '@/lib/apiError'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ no: string; lineNo: string }> }

/**
 * Actualiza los campos editables de una línea. El body puede traer cualquier
 * combinación de `cantidad`, `precio` y `descuento`; los ausentes no se tocan.
 * `precio` incluye el flag `Use_Manual_Price=true` al viajar a NAV.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { no, lineNo } = await ctx.params
  const quoteNo = decodeURIComponent(no).trim()
  const ln = Number(lineNo)

  if (!quoteNo || !Number.isFinite(ln)) {
    return NextResponse.json({ error: 'Falta cotización o número de línea.' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    cantidad?: unknown
    precio?: unknown
    descuento?: unknown
  }

  // Solo se reenvían números finitos; así el ERP ve exactamente los campos que
  // el cliente pidió cambiar y no un descuento en cero por accidente.
  const cambios: { cantidad?: number; precio?: number; descuento?: number } = {}
  if (typeof body.cantidad === 'number' && Number.isFinite(body.cantidad)) {
    cambios.cantidad = body.cantidad
  }
  if (typeof body.precio === 'number' && Number.isFinite(body.precio)) {
    cambios.precio = body.precio
  }
  if (typeof body.descuento === 'number' && Number.isFinite(body.descuento)) {
    cambios.descuento = body.descuento
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: 'No hay cambios para aplicar.' }, { status: 400 })
  }

  try {
    const cotizacion = await actualizarLinea(quoteNo, ln, cambios)
    return NextResponse.json({ cotizacion })
  } catch (e) {
    return respuestaError(e)
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { no, lineNo } = await ctx.params
  const quoteNo = decodeURIComponent(no).trim()
  const ln = Number(lineNo)

  if (!quoteNo || !Number.isFinite(ln)) {
    return NextResponse.json({ error: 'Falta cotización o número de línea.' }, { status: 400 })
  }

  try {
    const cotizacion = await borrarLinea(quoteNo, ln)
    return NextResponse.json({ cotizacion })
  } catch (e) {
    return respuestaError(e)
  }
}
