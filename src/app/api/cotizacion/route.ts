import { NextResponse } from 'next/server'
import { aprender } from '@/lib/buscar'
import { crearCotizacion, ErrorNav, nuevaReferencia, type CotizacionNav } from '@/lib/nav'
import { usuarioActual } from '@/lib/erp'

export const runtime = 'nodejs'
export const maxDuration = 180

export type RespuestaCotizacion = {
  cotizacion: CotizacionNav
  referencia: string
  /** Nombre del cotizador, para el campo COTIZADOR del PDF. */
  cotizador: string
}

/**
 * Emite la cotización en el ERP.
 *
 * NAV es el motor de precios: aquí solo viajan códigos y cantidades, y la
 * respuesta trae los precios del grupo del cliente, los descuentos y el ITBIS.
 * Es la única forma de conocer el precio real —no existe servicio de consulta de
 * precios—, así que esta llamada es a la vez el cálculo y la persistencia.
 */
export async function POST(req: Request) {
  const { clienteNo, ubicacion, lineas } = (await req.json()) as {
    clienteNo?: string
    ubicacion?: string
    lineas?: {
      code: string
      cantidad: number
      texto?: string
      descuento?: number
      /** Precio unitario forzado. Ver `LineaPedida` en `lib/nav.ts`. */
      precio?: number
    }[]
  }

  const items = (lineas ?? []).filter((l) => l.code && l.cantidad > 0)

  if (!clienteNo) {
    return NextResponse.json({ error: 'Falta elegir el cliente.' }, { status: 400 })
  }
  if (items.length === 0) {
    return NextResponse.json({ error: 'No hay líneas seleccionadas.' }, { status: 400 })
  }

  // La referencia se genera acá y se devuelve siempre, incluso si NAV falla:
  // si la respuesta se pierde en la red la cotización pudo quedar creada, y esta
  // es la única pista para buscarla a mano en el ERP.
  const referencia = nuevaReferencia()

  try {
    const cotizacion = await crearCotizacion({
      clienteNo,
      referencia,
      ubicacion,
      lineas: items.map((l) => ({
        code: l.code,
        cantidad: l.cantidad,
        descuento: l.descuento,
        precio: l.precio,
      })),
    })

    // Emitida sin problemas: las correcciones del cotizador pasan a ser
    // vocabulario de este cliente para la próxima solicitud.
    for (const l of items) {
      if (l.texto) aprender(clienteNo, l.texto, l.code)
    }

    const u = await usuarioActual()
    const cotizador = u ? `${u.firstName} ${u.lastName}`.trim() : ''

    return NextResponse.json({ cotizacion, referencia, cotizador } satisfies RespuestaCotizacion)
  } catch (e) {
    if (e instanceof ErrorNav) {
      return NextResponse.json(
        {
          error: e.message,
          codigo: e.codigo,
          detalle: e.detalle,
          // Si el ERP respondió rechazando, no hay documento creado y no
          // corresponde sembrar la duda con la referencia.
          rechazoDelErp: e.rechazoDelErp,
          referencia,
        },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error inesperado', referencia },
      { status: 500 },
    )
  }
}
