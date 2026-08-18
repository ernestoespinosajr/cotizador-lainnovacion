import { generarPdf } from '@/lib/pdf'
import type { CotizacionNav } from '@/lib/nav'

export const runtime = 'nodejs'

/**
 * Devuelve el PDF de una cotización ya emitida.
 *
 * Recibe el documento tal como lo devolvió NAV en vez de volver a consultarlo:
 * no existe servicio para leer una cotización, así que el cliente conserva la
 * respuesta de la emisión y la manda de vuelta acá.
 */
export async function POST(req: Request) {
  const { cotizacion, cotizador } = (await req.json()) as {
    cotizacion?: CotizacionNav
    cotizador?: string
  }

  if (!cotizacion?.QuoteNo) {
    return Response.json({ error: 'Falta la cotización a imprimir.' }, { status: 400 })
  }

  try {
    const pdf = await generarPdf({ cotizacion, cotizador: cotizador ?? '' })
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${cotizacion.QuoteNo}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return Response.json(
      { error: `No se pudo generar el PDF: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    )
  }
}
