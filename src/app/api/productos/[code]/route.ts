import { NextResponse } from 'next/server'
import { productoPor } from '@/lib/buscar'

export const runtime = 'nodejs'

/**
 * Lectura exacta de un producto por su código.
 *
 * Sirve al editor de cotizaciones: NAV devuelve solo los campos que quedaron en
 * la línea (código, descripción, precio unitario, descuento), y para reconstruir
 * las tres listas y el inventario hace falta rehidratar contra el espejo local.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const producto = productoPor(decodeURIComponent(code).trim())
  if (!producto) {
    return NextResponse.json({ error: 'Producto no encontrado en el espejo local.' }, { status: 404 })
  }
  return NextResponse.json({ producto })
}
