import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizar } from '@/lib/buscar'

export const runtime = 'nodejs'

export type ClienteFicha = {
  no: string
  name: string
  name2: string
  vatRegistrationNo: string
  contacto: string
  telefonos: string[]
  correos: string[]
  blocked: number
  bloqueoTexto: string
}

/** Enum `Blocked` de NAV. Es lo único que hay hoy sobre la situación del
 *  cliente: no existe endpoint de saldos ni de cuentas por cobrar. */
const BLOQUEO: Record<number, string> = {
  0: 'Sin bloqueo',
  1: 'Bloqueado para envío',
  2: 'Bloqueado para facturación',
  3: 'Bloqueado para todo',
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ clientes: [] })

  const ts = normalizar(q)
    .split(' ')
    .filter(Boolean)
    .map((t) => (t.length >= 3 ? `"${t}"*` : `"${t}"`))
  if (ts.length === 0) return NextResponse.json({ clientes: [] })

  const filas = db()
    .prepare(
      `SELECT c.* FROM clientes_fts f
         JOIN clientes c ON c.no = f.no
        WHERE clientes_fts MATCH ?
        ORDER BY bm25(clientes_fts)
        LIMIT 20`,
    )
    .all(ts.join(' AND ')) as {
    no: string
    name: string
    name2: string
    phoneNo: string
    mobilePhoneNo: string
    telefono2: string
    vatRegistrationNo: string
    contact: string
    correo1: string
    email: string
    blocked: number
  }[]

  const clientes: ClienteFicha[] = filas.map((c) => ({
    no: c.no,
    name: c.name,
    name2: c.name2,
    vatRegistrationNo: c.vatRegistrationNo,
    contacto: c.contact || c.name2,
    telefonos: [c.phoneNo, c.mobilePhoneNo, c.telefono2].filter((t) => t?.trim()),
    correos: [c.correo1, c.email].filter((t) => t?.trim()),
    blocked: c.blocked,
    bloqueoTexto: BLOQUEO[c.blocked] ?? `Código ${c.blocked}`,
  }))

  return NextResponse.json({ clientes })
}
