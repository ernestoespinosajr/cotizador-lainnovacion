import { NextResponse } from 'next/server'
import { candidatos, resolver, type Candidato, type Resolucion } from '@/lib/buscar'
import { parsearExcel, parsearTexto, type LineaSolicitud } from '@/lib/parseo'
import { extraerLineas, iaDisponible, reordenar } from '@/lib/ia'
import { estadoEspejo } from '@/lib/db'
import { bonoDe, patronDe, usoDe } from '@/lib/historial'
import { perfilDe } from '@/lib/perfilCache'
import { cuantizar, normalizarVector, vecinos, vectorizar, vectoresDisponibles } from '@/lib/embeddings'

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

  const consultaDe = (l: LineaSolicitud) => l.codigoCliente || l.busqueda || l.texto

  /*
   * Vecinos semánticos de cada línea.
   *
   * Todas las consultas viajan en UNA sola llamada de embeddings: con cien líneas,
   * cien llamadas sueltas serían minutos. Si no hay índice construido o falla la
   * vectorización, se sigue con búsqueda de texto y nada se rompe.
   */
  let porLinea = new Map<string, { code: string; similitud: number }[]>()
  if (vectoresDisponibles()) {
    try {
      const vs = await vectorizar(lineas.map(consultaDe))
      lineas.forEach((l, i) => {
        const v = vs[i]
        if (v) porLinea.set(l.id, vecinos(cuantizar(normalizarVector(v)), 60))
      })
    } catch (e) {
      console.error('[vectores] no se pudo vectorizar la solicitud, se usa solo texto:', e)
    }
  }

  // Historial del cliente: empuja hacia lo que ya cotiza. Sale de caché salvo
  // la primera vez, y si el ERP no responde se devuelve un perfil vacío y la
  // búsqueda queda igual que antes de existir esto.
  const perfil = await perfilDe(clienteNo)
  const bono = bonoDe(perfil)
  // Va también en las variantes, no solo en el elegido: al elegir una desde el
  // panel esa pasa a ser la elegida, y la ficha se quedaría sin explicar nada.
  // No cuesta: las variantes son del mismo tipo que el elegido, así que sus
  // consultas de presencia caen en las mismas entradas de caché.
  const marcar = (c: Candidato | null) =>
    c
      ? {
          ...c,
          uso: usoDe(perfil, c.code) ?? undefined,
          patron: patronDe(perfil, c.description) ?? undefined,
        }
      : c

  // Recuperación local: milisegundos por línea, incluso con 100 líneas.
  const resueltas: LineaResuelta[] = lineas.map((l) => {
    const r = resolver(consultaDe(l), clienteNo, porLinea.get(l.id) ?? [], bono)
    return {
      ...l,
      resolucion: { ...r, elegido: marcar(r.elegido), variantes: r.variantes.map((v) => marcar(v)!) },
    }
  })

  // El modelo solo reordena lo que la búsqueda dejó dudoso. Lo que ya entró por
  // código o código de barras no se toca: gastar tokens ahí no mejora nada.
  if (iaDisponible()) {
    const dudosas = resueltas.filter((l) => l.resolucion.confianza !== 'exacto')
    if (dudosas.length > 0) {
      const fallos = await reordenar(
        dudosas.map((l) => ({
          id: l.id,
          texto: l.texto,
          candidatos: candidatos(consultaDe(l), 12, porLinea.get(l.id) ?? [], bono),
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
