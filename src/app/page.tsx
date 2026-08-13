'use client'

import Image from 'next/image'
import { useState } from 'react'
import type { ClienteFicha } from '@/app/api/clientes/route'
import type { LineaResuelta } from '@/app/api/solicitud/route'
import PasoCliente from '@/components/PasoCliente'
import PasoProductos, { type LineaEstado } from '@/components/PasoProductos'
import PasoSolicitud from '@/components/PasoSolicitud'
import { Proximamente } from '@/components/ui'

const PASOS = ['Solicitud', 'Cliente', 'Productos', 'Cotización'] as const

export default function Page() {
  const [paso, setPaso] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cliente, setCliente] = useState<ClienteFicha | null>(null)
  const [lineas, setLineas] = useState<LineaEstado[]>([])
  const [ia, setIa] = useState(false)

  /** Solicitud y Cliente están siempre disponibles; los dos últimos no existen
   *  hasta que hay líneas cargadas. */
  const alcanzable = (i: number) => i <= 1 || lineas.length > 0

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
          // equivocada llegue al cliente.
          incluida: l.resolucion.confianza === 'exacto' || l.resolucion.confianza === 'probable',
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
            </nav>
          </div>

          {/*
            Móvil: barra segmentada en vez de cuatro pastillas que se desbordan
            a dos filas irregulares. Un stepper y no pestañas, porque los pasos
            son una secuencia con bloqueo —Productos y Cotización no existen
            hasta que hay una solicitud cargada—, y unas pestañas prometerían
            cuatro destinos igual de disponibles.

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
            titulo="Pega la solicitud tal como llegó"
            bajada="Correo, WhatsApp o el Excel que mandó el cliente. No hace falta ordenarlo antes."
          >
            <PasoSolicitud onAnalizar={analizar} cargando={cargando} error={error} />
          </Seccion>
        )}

        {paso === 1 && (
          <Seccion titulo="¿A quién se cotiza?" bajada="Busca por nombre, RNC o código.">
            <PasoCliente elegido={cliente} onElegir={setCliente} />
            {cliente && (
              <button type="button" className="boton mt-6" onClick={() => setPaso(lineas.length ? 2 : 0)}>
                {lineas.length ? 'Ver los productos' : 'Cargar la solicitud'}
              </button>
            )}
          </Seccion>
        )}

        {paso === 2 && (
          <Seccion
            titulo="Revisa lo que encontró"
            bajada={
              cliente
                ? `Cotización para ${cliente.name}.`
                : 'Todavía no elegiste cliente; puedes hacerlo en el paso 2.'
            }
          >
            <PasoProductos lineas={lineas} setLineas={setLineas} ia={ia} />
            <button type="button" className="boton mt-6" onClick={() => setPaso(3)}>
              Continuar
            </button>
          </Seccion>
        )}

        {paso === 3 && (
          <Seccion titulo="Emitir la cotización" bajada="Este paso todavía no existe del lado del ERP.">
            <div className="max-w-3xl space-y-5">
              <Proximamente detalle="El ERP no tiene ningún endpoint que escriba: no hay POST de cotización, ni numeración, ni PDF. Tampoco hay forma de pedir el precio que le corresponde a este cliente con su descuento y su ITBIS, así que emitirla hoy daría un documento con el precio de lista genérico. Ver docs/SOLICITUD_ENDPOINTS.md §3.2 y §3.3.">
                Emisión, numeración y PDF de la cotización
              </Proximamente>

              <div className="rounded-caja border border-linea p-5">
                <div className="etiqueta">Lo que sí queda guardado</div>
                <p className="mt-2 text-sm leading-relaxed">
                  Cada línea que corregiste a mano se registra como vocabulario de este cliente. Los
                  clientes repiten su forma de nombrar las cosas, así que esas correcciones hacen que
                  la próxima solicitud entre resuelta sin que nadie las revise. Cuando los endpoints
                  existan, el sistema arranca con ese aprendizaje ya hecho.
                </p>
                <button
                  type="button"
                  className="boton mt-4"
                  onClick={async () => {
                    await fetch('/api/cotizacion', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        clienteNo: cliente?.no ?? '',
                        lineas: lineas
                          .filter((l) => l.incluida && l.elegido)
                          .map((l) => ({ texto: l.texto, code: l.elegido!.code })),
                      }),
                    })
                    setPaso(2)
                  }}
                >
                  Guardar las correcciones
                </button>
              </div>
            </div>
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
