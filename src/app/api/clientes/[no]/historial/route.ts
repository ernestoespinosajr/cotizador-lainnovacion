import { NextResponse } from 'next/server'
import { historialCliente } from '@/lib/erp'
import { perfilDeHistorial } from '@/lib/historial'

export const runtime = 'nodejs'
export const maxDuration = 60

export type LineaDocumento = {
  code: string
  descripcion: string
  cantidad: number
  precio: number
}

export type DocumentoPrevio = {
  no: string
  tipo: string
  fecha: string
  monto: number
  lineas: LineaDocumento[]
  /** Líneas que no se muestran por no caber en la tarjeta. */
  restantes: number
}

export type ResumenHistorial = {
  documentos: DocumentoPrevio[]
  /** Totales sobre todo lo traído, no solo sobre lo que se muestra. */
  totalDocumentos: number
  totalLineas: number
  productosDistintos: number
}

/** Cuántas líneas caben en una tarjeta sin que deje de leerse de un vistazo. */
const LINEAS_VISIBLES = 4

/**
 * Documentos anteriores del cliente, para las tarjetas del paso 1.
 *
 * Va en su propia ruta y no dentro de la ficha del cliente a propósito: la ficha
 * cruza hasta NAV y esto va al API del ERP. Separadas, la interfaz pinta la
 * situación crediticia apenas llega y el historial cuando llegue, en vez de
 * esperar a la más lenta de las dos.
 *
 * Son casi todo cotizaciones —el histórico facturado viene vacío en esta
 * instancia—, así que la interfaz dice «cotizado» y no «comprado».
 */
export async function GET(_req: Request, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params

  try {
    // 50 en vez de 100: responde en 0,6 s contra 2,3 s, y para las tarjetas
    // sobra. El perfil que alimenta la búsqueda sí trae 100.
    const docs = await historialCliente(no, 50)
    const perfil = perfilDeHistorial(docs)

    const documentos: DocumentoPrevio[] = docs
      .map((d) => {
        const items = (d.lines ?? []).filter((l) => l.type === 2 && l.no)
        return {
          no: d.no,
          tipo: d.documentTypeName,
          fecha: d.orderDate,
          monto: d.amountIncludingVat || d.amount,
          lineas: items.slice(0, LINEAS_VISIBLES).map((l) => ({
            code: l.no,
            descripcion: l.description,
            cantidad: l.quantity,
            precio: l.unitPrice,
          })),
          restantes: Math.max(0, items.length - LINEAS_VISIBLES),
        }
      })
      // Un documento sin artículos no le dice nada al vendedor.
      .filter((d) => d.lineas.length > 0)

    const resumen: ResumenHistorial = {
      documentos,
      totalDocumentos: docs.length,
      totalLineas: perfil.lineas,
      productosDistintos: perfil.codigos.size,
    }

    return NextResponse.json(resumen)
  } catch (e) {
    console.error(`[historial] ${no}:`, e)
    // 200 con vacío y no un error: el historial es información de apoyo. Que el
    // ERP no lo devuelva no debe teñir de rojo el paso de elegir cliente.
    return NextResponse.json({
      documentos: [],
      totalDocumentos: 0,
      totalLineas: 0,
      productosDistintos: 0,
    } satisfies ResumenHistorial)
  }
}
