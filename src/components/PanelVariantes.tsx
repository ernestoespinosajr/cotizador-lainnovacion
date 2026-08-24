'use client'

import { useEffect, useRef, useState } from 'react'
import type { Candidato } from '@/lib/buscar'
import { ESTADOS, pesos } from './ui'

/**
 * Las variantes se piden, no se imponen.
 *
 * Con 100 líneas, mostrar tres opciones por fila son 300 decisiones y nadie las
 * revisa. Aquí la fila muestra un producto resuelto y este panel se abre solo si
 * el cotizador lo pide — sea porque duda, sea porque quiere ofrecer otra cosa.
 * Por eso el botón está en TODAS las filas y no solo en las problemáticas: si
 * apareciera únicamente cuando hay error, dejaría de servir para vender.
 *
 * Es un panel lateral y no un modal a propósito: la fila de la que salió sigue
 * a la vista.
 */
export default function PanelVariantes({
  pedido,
  elegido,
  variantes,
  onElegir,
  onCerrar,
  clienteNo,
  // 'agregar' abre el mismo panel sin línea de origen, para sumar un producto
  // que el cliente pidió durante la llamada. Es la misma búsqueda y la misma
  // lista: no hay razón para que el cotizador aprenda dos pantallas distintas.
  modo = 'variantes',
}: {
  pedido: string
  elegido: Candidato | null
  variantes: Candidato[]
  onElegir: (c: Candidato) => void
  onCerrar: () => void
  clienteNo: string
  modo?: 'variantes' | 'agregar'
}) {
  const agregando = modo === 'agregar'
  const [q, setQ] = useState('')
  const [manual, setManual] = useState<Candidato[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const buscarRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Al agregar, el foco va al buscador: no hay nada que mirar todavía y el
    // cotizador está al teléfono. Al ver variantes va al cierre, porque ahí lo
    // primero es leer la lista.
    if (agregando) buscarRef.current?.focus()
    else cerrarRef.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar, agregando])

  useEffect(() => {
    if (q.trim().length < 2) {
      setManual(null)
      return
    }
    // El espejo local responde en milisegundos, así que se puede buscar
    // mientras escribe sin castigar nada.
    setBuscando(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/productos?q=${encodeURIComponent(q)}&cliente=${encodeURIComponent(clienteNo)}`,
        )
        const d = await r.json()
        setManual(d.productos ?? [])
      } finally {
        setBuscando(false)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [q, clienteNo])

  const lista = manual ?? variantes

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Cerrar variantes"
        onClick={onCerrar}
        className="flex-1 bg-tinta/25"
      />

      <aside
        role="dialog"
        aria-label="Variantes del producto"
        className="flex h-full w-full max-w-xl flex-col overflow-hidden rounded-l-caja border-l-4 border-tinta bg-papel shadow-2xl"
      >
        <header className="border-b-2 border-tinta bg-tinta px-5 py-4 text-papel">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="etiqueta !text-papel/55">
                {agregando ? 'Nuevo producto' : 'El cliente pidió'}
              </div>
              <p className="mt-1 truncate text-base font-bold">
                {agregando ? 'Busca y elige lo que se suma a la cotización' : pedido}
              </p>
            </div>
            <button
              ref={cerrarRef}
              type="button"
              onClick={onCerrar}
              className="shrink-0 rounded-control border border-papel/35 px-2.5 py-1 text-xs font-bold uppercase tracking-wide hover:bg-papel hover:text-tinta"
            >
              Cerrar
            </button>
          </div>
        </header>

        <div className="border-b border-linea px-5 py-3">
          <label className="etiqueta" htmlFor="buscar-variante">
            Buscar en el catálogo
          </label>
          <input
            ref={buscarRef}
            id="buscar-variante"
            className="campo mt-1.5"
            placeholder="Nombre, código o código de barras"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          <p className="mt-1.5 text-xs text-humo">
            {buscando
              ? 'Buscando…'
              : manual
                ? `${lista.length} resultados de tu búsqueda`
                : agregando
                  ? 'Escribe lo que pidió el cliente. Son 63.702 productos.'
                  : 'O elige una de las alternativas que siguen.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {lista.length === 0 && (
            <p className="p-5 text-sm text-humo">
              {manual
                ? 'Nada coincide con esa búsqueda.'
                : agregando
                  ? 'Empieza a escribir para buscar en el catálogo.'
                  : 'No hay alternativas para esta línea.'}
            </p>
          )}

          {lista.map((c) => {
            const actual = c.code === elegido?.code
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => onElegir(c)}
                className={`flex w-full items-start gap-3 border-b border-linea px-5 py-3.5 text-left transition-colors hover:bg-bruma ${
                  actual ? 'bg-bruma' : ''
                }`}
              >
                <span className="mt-1 w-16 shrink-0">
                  <span className="cifra block text-xs text-humo">{c.code}</span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug">{c.description}</span>
                  {c.description2 && (
                    <span className="block text-xs text-humo">{c.description2}</span>
                  )}
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Existencia inventario={c.inventory} />
                    <Estado estado={c.itemStatus} />
                    <Cotizado uso={c.uso} />
                    {actual && <span className="font-bold uppercase tracking-wide">Seleccionado</span>}
                  </span>
                </span>

                <span className="cifra shrink-0 text-right text-sm font-bold">
                  {c.unitPrice ? pesos.format(c.unitPrice) : <span className="text-humo">sin precio</span>}
                </span>
              </button>
            )
          })}
        </div>

        <footer className="border-t border-linea bg-bruma px-5 py-3 text-xs text-humo">
          El precio y la existencia salen del último volcado del ERP. Se revalidan al emitir la
          cotización.
        </footer>
      </aside>
    </div>
  )
}

/**
 * El conteo de ubicaciones ya no se muestra aquí.
 *
 * Decía "en 25 ubicaciones" junto a la cantidad, y se leía como que la
 * existencia estaba repartida en 25 sitios. No es eso: son las ubicaciones
 * donde el artículo está dado de alta, tenga o no unidades. 30.455 productos
 * del catálogo —el 48%— aparecen con ubicaciones y cero disponible. El dato
 * queda en la ficha, donde cabe explicarlo.
 */
export function Existencia({ inventario }: { inventario: number }) {
  if (inventario > 0) {
    return (
      <span className="text-humo">
        <span className="cifra font-semibold text-tinta">{inventario.toLocaleString('es-DO')}</span>{' '}
        u.
      </span>
    )
  }
  return <span className="font-semibold text-rojo">Sin existencia</span>
}

/**
 * Marca de que a este cliente ya se le cotizó este producto exacto.
 *
 * Es el dato, no la conclusión: el vendedor decide. Por eso lleva las veces y la
 * fecha en vez de un «recomendado» que esconda de dónde sale.
 */
export function Cotizado({ uso }: { uso?: { veces: number; ultima: string } }) {
  if (!uso) return null
  const d = new Date(uso.ultima)
  const cuando = Number.isNaN(d.getTime())
    ? ''
    : ` · ${d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
  return (
    <span className="font-semibold text-tinta">
      Ya cotizado <span className="cifra">{uso.veces}</span>
      {uso.veces === 1 ? ' vez' : ' veces'}
      {cuando}
    </span>
  )
}

export function Estado({ estado }: { estado: string }) {
  if (estado === 'Activo') return null
  const tono = estado === 'Bloqueado' || estado === 'Descatalogado' ? 'text-ambar' : 'text-humo'
  return <span className={`font-semibold uppercase tracking-wide ${tono}`}>{estado}</span>
}

export { ESTADOS }
