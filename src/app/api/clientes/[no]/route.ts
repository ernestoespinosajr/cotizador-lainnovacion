import { NextResponse } from 'next/server'
import { consultarCliente, ErrorNav, situacion } from '@/lib/nav'

export const runtime = 'nodejs'

export type SituacionCliente = {
  no: string
  nombre: string
  rnc: string
  contacto: string
  direccion: string
  telefono: string
  correo: string
  condicionPago: string
  grupoPrecio: string
  vendedorCodigo: string
  limite: number
  balance: number
  disponible: number | null
  debe: boolean
  bloqueo: string
  impideCotizar: boolean
}

/**
 * Situación del cliente en el ERP: balance, límite y bloqueo.
 *
 * Se consulta al elegir el cliente y no durante la búsqueda: la búsqueda sale
 * del espejo local y responde en milisegundos, mientras esta llamada cruza hasta
 * NAV y tarda alrededor de 1,5 s.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params

  try {
    const c = await consultarCliente(no)
    const s = situacion(c)

    const ficha: SituacionCliente = {
      no: c.No,
      nombre: c.Name,
      rnc: c.VATRegistrationNo,
      contacto: c.Contact || c.Name2,
      direccion: [c.Address, c.Address2, c.City].filter(Boolean).join(', '),
      telefono: c.Phone,
      correo: c.Email,
      condicionPago: c.PaymentTermsCode,
      grupoPrecio: c.CustomerPriceGroup,
      vendedorCodigo: c.SalespersonCode,
      ...s,
    }

    return NextResponse.json({ cliente: ficha })
  } catch (e) {
    if (e instanceof ErrorNav) {
      // 502: el fallo es de la pasarela o de NAV, no de esta petición.
      return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 502 })
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error inesperado' },
      { status: 500 },
    )
  }
}
