import { NextResponse } from 'next/server'
import { consultarCotizacion } from '@/lib/nav'
import { respuestaError } from '@/lib/apiError'

export const runtime = 'nodejs'

/**
 * Consulta una cotización ya emitida.
 *
 * Es lectura pura: sirve para abrir el editor sin haber creado el documento en
 * esta sesión, y para refrescar la vista después de agregar, editar o borrar
 * líneas.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params
  const quoteNo = decodeURIComponent(no).trim()
  if (!quoteNo) {
    return NextResponse.json({ error: 'Falta el número de cotización.' }, { status: 400 })
  }
  try {
    const cotizacion = await consultarCotizacion(quoteNo)
    return NextResponse.json({ cotizacion })
  } catch (e) {
    return respuestaError(e)
  }
}
