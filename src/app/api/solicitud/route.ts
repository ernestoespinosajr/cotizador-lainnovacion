import { NextResponse } from 'next/server'
import { candidatos, resolver, type Resolucion } from '@/lib/buscar'
import { parsearExcel, parsearTexto, type LineaSolicitud } from '@/lib/parseo'
import { extraerLineas, iaDisponible, reordenar } from '@/lib/ia'
import { estadoEspejo } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 120

export type LineaResuelta = LineaSolicitud & { resolucion: Resolucion }

export async function POST(req: Request) {
  const espejo = estadoEspejo()
  if (!espejo.listo) {
    return NextResponse.json(
      { error: 'El catálogo local está vacío. Ejecuta `npm run sync` para traerlo del ERP.' },
      { status: 503 },
    )
  }

  const tipo = req.headers.get('content-type') ?? ''
  let lineas: LineaSolicitud[] = []
  let clienteNo = ''

  try {
    if (tipo.includes('multipart/form-data')) {
      const form = await req.formData()
      clienteNo = String(form.get('clienteNo') ?? '')
      const archivo = form.get('archivo')
      if (!(archivo instanceof File)) {
        return NextResponse.json({ error: 'No llegó ningún archivo.' }, { status: 400 })
      }
      lineas = await parsearExcel(await archivo.arrayBuffer())
    } else {
      const { texto, clienteNo: c } = (await req.json()) as { texto?: string; clienteNo?: string }
      clienteNo = c ?? ''
      if (!texto?.trim()) {
        return NextResponse.json({ error: 'No llegó ningún texto.' }, { status: 400 })
      }
      // Con clave de API el modelo separa las líneas mucho mejor que las reglas;
      // sin ella, `extraerLineas` ya cae solo al parseo determinista.
      lineas = iaDisponible() ? await extraerLineas(texto) : parsearTexto(texto)
    }
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo leer la solicitud: ${e instanceof Error ? e.message : e}` },
      { status: 400 },
    )
  }

  if (lineas.length === 0) {
    return NextResponse.json({ lineas: [], aviso: 'No se encontró ningún producto en la solicitud.' })
  }

  // Recuperación local: milisegundos por línea, incluso con 100 líneas.
  const resueltas: LineaResuelta[] = lineas.map((l) => ({
    ...l,
    resolucion: resolver(l.codigoCliente || l.busqueda || l.texto, clienteNo),
  }))

  // El modelo solo reordena lo que la búsqueda dejó dudoso. Lo que ya entró por
  // código o código de barras no se toca: gastar tokens ahí no mejora nada.
  if (iaDisponible()) {
    const dudosas = resueltas.filter((l) => l.resolucion.confianza !== 'exacto')
    if (dudosas.length > 0) {
      const fallos = await reordenar(
        dudosas.map((l) => ({
          id: l.id,
          texto: l.texto,
          candidatos: candidatos(l.codigoCliente || l.busqueda || l.texto, 12),
        })),
      )

      for (const l of resueltas) {
        const f = fallos.get(l.id)
        if (!f) continue
        const pool = [l.resolucion.elegido, ...l.resolucion.variantes].filter(Boolean)
        const elegido = f.code ? (pool.find((c) => c!.code === f.code) ?? null) : null
        l.resolucion = {
          confianza: f.confianza,
          elegido,
          variantes: pool.filter((c) => c!.code !== elegido?.code) as typeof l.resolucion.variantes,
          nota: f.motivo,
        }
      }
    }
  }

  return NextResponse.json({ lineas: resueltas, ia: iaDisponible(), espejo })
}
