import { NextResponse } from 'next/server'
import { aprender } from '@/lib/buscar'

export const runtime = 'nodejs'

/**
 * Emisión de la cotización — pendiente de backend.
 *
 * El ERP no expone hoy ningún endpoint que escriba: no hay POST de cotización,
 * ni numeración, ni precio por cliente, ni ITBIS. Ver docs/SOLICITUD_ENDPOINTS.md
 * §3.2 y §3.3, que ya especifican lo que hace falta pedir.
 *
 * Lo que sí se guarda desde ya son las correcciones del cotizador: cada línea
 * que resolvió a mano alimenta el aprendizaje, así que cuando los endpoints
 * existan el sistema llega con meses de vocabulario de sus clientes aprendido.
 */
export async function POST(req: Request) {
  const { clienteNo, lineas } = (await req.json()) as {
    clienteNo?: string
    lineas?: { texto: string; code: string }[]
  }

  for (const l of lineas ?? []) {
    if (l.code && l.texto) aprender(clienteNo ?? '', l.texto, l.code)
  }

  return NextResponse.json(
    {
      pendiente: true,
      guardado: (lineas ?? []).length,
      mensaje:
        'La selección quedó registrada, pero la cotización todavía no se puede emitir: ' +
        'el ERP no tiene endpoint para crearla ni para dar el precio con ITBIS del cliente.',
      requiere: ['POST /api/cotizaciones', 'POST /api/catalogos/productos/cotizar'],
    },
    { status: 501 },
  )
}
