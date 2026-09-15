'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import type { ClienteFicha } from '@/app/api/clientes/route'
import type { SituacionCliente } from '@/app/api/clientes/[no]/route'
import { grupoDe } from '@/lib/precios'
import type { LineaResuelta } from '@/app/api/solicitud/route'
import { cotizable } from '@/lib/producto'
import PasoCliente from '@/components/PasoCliente'
import PasoProductos, { type LineaEstado } from '@/components/PasoProductos'
import PasoSolicitud from '@/components/PasoSolicitud'
import PasoCotizacion from '@/components/PasoCotizacion'

const PASOS = ['Cliente', 'Solicitud', 'Productos', 'Cotización'] as const

export default function Page() {
  const [paso, setPaso] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState<ClienteFicha | null>(null)
  // La ficha de NAV la consulta el paso 1; se guarda acá porque el grupo de
  // precio lo necesita el paso 3 para preseleccionar la lista.
  const [situacion, setSituacion] = useState<SituacionCliente | null>(null)
  const [lineas, setLineas] = useState<LineaEstado[]>([])
  const [ia, setIa] = useState(false)
  // Toggle global de presentación del descuento. Vive en el padre para que el
  // vendedor pueda encenderlo/apagarlo desde el paso de productos y llegue al
  // paso de emisión ya en el modo elegido.
  const [precioConDescuento, setPrecioConDescuento] = useState(false)

  /**
   * El cliente va primero y condiciona todo lo que sigue: define los precios que
   * NAV va a aplicar, y su vocabulario aprendido resuelve líneas desde el primer
   * análisis. Sin cliente no se puede ni interpretar bien la solicitud.
   */
  const alcanzable = (i: number) =>
    i === 0 || (i === 1 && !!cliente) || (i >= 2 && lineas.length > 0)

  async function analizar(entrada: { texto?: string; archivo?: File }) {
    setCargando(true)
    setError(null)
    try {
      const res = entrada.archivo
        ? await fetch('/api/solicitud', { method: 'POST', body: cuerpoArchivo(entrada.archivo, cliente?.no) })
        : await fetch('/api/solicitud', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texto: entrada.texto, clienteNo: cliente?.no ?? '' }),
          })

      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? 'No se pudo analizar la solicitud.')
        return
      }
      if (!d.lineas?.length) {
        setError(d.aviso ?? 'No se encontró ningún producto en la solicitud.')
        return
      }

      setIa(Boolean(d.ia))
      setLineas(
        (d.lineas as LineaResuelta[]).map((l) => ({
          ...l,
          elegido: l.resolucion.elegido,
          // Lo dudoso entra desmarcado a propósito: incluir por defecto algo que
          // el sistema no tiene claro es la forma más fácil de que una línea
          // equivocada llegue al cliente. Un producto bloqueado nunca entra
          // marcado, porque NAV rechazaría la cotización completa por su culpa.
          incluida:
            (l.resolucion.confianza === 'exacto' || l.resolucion.confianza === 'probable') &&
            !!l.resolucion.elegido &&
            cotizable(l.resolucion.elegido),
        })),
      )
      setPaso(2)
    } catch (e) {
      setError(`Falló la conexión: ${e instanceof Error ? e.message : e}`)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen">
      {/* Fondo blanco: el logo es negro y rojo sobre blanco, y así vive sobre su
          propio color en vez de ir metido en un recuadro. La franja roja al pie
          repite la barra que el propio logo lleva bajo el logotipo. */}
      <header className="sticky top-0 z-40 border-b-[3px] border-rojo bg-papel">
        <div className="mx-auto max-w-7xl px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Image
                src="/logo-innovacion.png"
                alt="La Innovación"
                width={168}
                height={59}
                priority
                className="h-9 w-auto"
              />
              <span className="hidden h-6 w-px bg-linea sm:block" />
              <span className="titulo hidden text-sm text-humo sm:block">Cotizador</span>
            </div>

            {/* En móvil el nombre del paso va aquí, en el hueco que dejaba el
                logo, y no en una fila propia. La barra de abajo ya dice en cuál
                de los cuatro estás, así que repetir "Paso 3 de 4" en texto solo
                gastaba una línea. */}
            <span className="titulo text-right text-xs leading-tight sm:hidden">
              {PASOS[paso]}
            </span>

            {/* Escritorio: los cuatro pasos con su nombre, que ahí sí entran. */}
            <nav aria-label="Pasos" className="hidden items-center gap-1 sm:flex">
              {PASOS.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  disabled={!alcanzable(i)}
                  onClick={() => setPaso(i)}
                  aria-current={i === paso ? 'step' : undefined}
                  className={`flex items-baseline gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    i === paso ? 'bg-rojo text-papel' : 'text-humo hover:bg-bruma hover:text-tinta'
                  }`}
                >
                  <span className="cifra opacity-60">{i + 1}</span>
                  {p}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-linea" aria-hidden />
              <Link
                href="/cotizacion"
                className="rounded-control px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-humo transition-colors hover:bg-bruma hover:text-tinta"
              >
                Abrir existente
              </Link>
            </nav>
          </div>

          {/*
            Móvil: barra segmentada en vez de cuatro pastillas que se desbordan
            a dos filas irregulares. Un stepper y no pestañas, porque los pasos
            son una secuencia con bloqueo —sin cliente no hay solicitud, y sin
            solicitud no hay productos ni cotización—, y unas pestañas
            prometerían cuatro destinos igual de disponibles.

            Es la misma forma que la espina de confianza del lote: que el
            progreso del flujo y el del lote se lean igual mantiene la
            herramienta de una pieza.
          */}
          <nav aria-label="Pasos" className="mt-1 sm:hidden">
            <ol className="flex gap-1.5">
              {PASOS.map((p, i) => (
                <li key={p} className="flex-1">
                  <button
                    type="button"
                    disabled={!alcanzable(i)}
                    onClick={() => setPaso(i)}
                    aria-label={`Paso ${i + 1} de ${PASOS.length}: ${p}`}
                    aria-current={i === paso ? 'step' : undefined}
                    // El área táctil es mucho más alta que la barra: un objetivo
                    // de 6 px no se toca con el pulgar. Quedan 30 px de alto por
                    // unos 85 de ancho, por encima del mínimo de WCAG 2.5.8.
                    className="block w-full py-3 disabled:cursor-not-allowed"
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-colors ${
                        i === paso
                          ? 'bg-rojo'
                          : i < paso
                            ? 'bg-tinta'
                            : alcanzable(i)
                              ? 'bg-humo/35'
                              : 'bg-linea'
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <h1 className="sr-only">Cotizador de La Innovación</h1>

        {paso === 0 && (
          <Seccion
            titulo="¿A quién se cotiza?"
            bajada="Busca por nombre, RNC o código. De esto dependen los precios que va a aplicar el ERP."
          >
            <PasoCliente
              elegido={cliente}
              onElegir={(c) => {
                setCliente(c)
                setSituacion(null)
              }}
              onSituacion={setSituacion}
            />
            {cliente && (
              // Con líneas ya cargadas el botón salta a Productos: volver a la
              // solicitud obligaría a pasar por una pantalla que ya se usó.
              <button type="button" className="boton mt-6" onClick={() => setPaso(lineas.length ? 2 : 1)}>
                {lineas.length ? 'Ver los productos' : 'Cargar la solicitud'}
              </button>
            )}
          </Seccion>
        )}

        {paso === 1 && (
          <Seccion
            titulo="Pega la solicitud tal como llegó"
            bajada="Correo, WhatsApp o el Excel que mandó el cliente. No hace falta ordenarlo antes."
          >
            <PasoSolicitud onAnalizar={analizar} cargando={cargando} error={error} />
          </Seccion>
        )}

        {paso === 2 && (
          <Seccion
            titulo="Revisa lo que encontró"
            bajada={cliente ? `Cotización para ${cliente.name}.` : 'Falta elegir el cliente.'}
          >
            <PasoProductos
              lineas={lineas}
              setLineas={setLineas}
              ia={ia}
              clienteNo={cliente?.no ?? ''}
              grupoCliente={grupoDe(situacion?.grupoPrecio)}
              precioConDescuento={precioConDescuento}
              setPrecioConDescuento={setPrecioConDescuento}
            />
            <button type="button" className="boton mt-6" onClick={() => setPaso(3)}>
              Continuar
            </button>
          </Seccion>
        )}

        {paso === 3 && (
          <Seccion
            titulo="Emitir la cotización"
            bajada="El ERP calcula los precios del cliente y devuelve el documento con su número."
          >
            <PasoCotizacion
              cliente={cliente}
              lineas={lineas}
              grupoCliente={grupoDe(situacion?.grupoPrecio)}
              precioConDescuento={precioConDescuento}
              setPrecioConDescuento={setPrecioConDescuento}
              onVolver={() => setPaso(2)}
            />
          </Seccion>
        )}

      </main>
    </div>
  )
}

function cuerpoArchivo(archivo: File, clienteNo?: string) {
  const fd = new FormData()
  fd.append('archivo', archivo)
  fd.append('clienteNo', clienteNo ?? '')
  return fd
}

function Seccion({
  titulo,
  bajada,
  children,
}: {
  titulo: string
  bajada: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="titulo text-2xl">{titulo}</h2>
      <p className="mt-1 max-w-2xl text-sm text-humo">{bajada}</p>
      <div className="mt-6">{children}</div>
    </section>
  )
}
