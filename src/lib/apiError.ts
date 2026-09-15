import { NextResponse } from 'next/server'
import { ErrorNav } from './nav'

/**
 * Respuesta homogénea para errores en las rutas que hablan con NAV.
 *
 * Un `ErrorNav` con código es un rechazo del ERP (no hay documento tocado) y va
 * como 502 con la marca `rechazoDelErp` para que la UI no siembre la duda de si
 * la operación quedó a medias. Cualquier otra cosa es un fallo nuestro y sale
 * como 500 con el mensaje original.
 */
export function respuestaError(e: unknown) {
  if (e instanceof ErrorNav) {
    return NextResponse.json(
      { error: e.message, detalle: e.detalle, rechazoDelErp: e.rechazoDelErp },
      { status: 502 },
    )
  }
  return NextResponse.json(
    { error: e instanceof Error ? e.message : 'Error inesperado' },
    { status: 500 },
  )
}
