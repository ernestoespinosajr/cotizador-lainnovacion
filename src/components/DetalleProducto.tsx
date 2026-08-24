'use client'

import { useEffect, useRef } from 'react'
import type { Candidato } from '@/lib/buscar'
import { pesos } from './ui'

/**
 * Ficha ampliada de un producto.
 *
 * La columna de existencia venía apilando tres cosas —cantidad, ubicaciones y
 * el historial del cliente— en 8rem de ancho, y todo se partía en dos líneas.
 * En la tabla queda lo que se compara de un vistazo entre filas: la cantidad
 * disponible y, si lo hay, el impedimento. Lo demás se consulta cuando hace
 * falta, que es de a un producto por vez.
 */
export default function DetalleProducto({
  producto,
  pedido,
  onCerrar,
}: {
  producto: Candidato
  /** Lo que decía la solicitud. Ausente en las líneas agregadas a mano. */
  pedido?: string
  onCerrar: () => void
}) {
  const cerrarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cerrarRef.current?.focus()
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const p = producto

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/40 p-0 sm:items-center sm:p-6"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de ${p.description}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-caja border-2 border-tinta bg-papel sm:rounded-caja"
      >
        <header className="flex items-start justify-between gap-4 border-b-2 border-tinta bg-tinta px-5 py-4 text-papel">
          <div className="min-w-0">
            <div className="etiqueta !text-papel/55">Producto {p.code}</div>
            <h2 className="titulo mt-1 text-base leading-tight">{p.description}</h2>
            {p.description2 && <p className="mt-1 text-xs text-papel/70">{p.description2}</p>}
          </div>
          <button
            ref={cerrarRef}
            type="button"
            onClick={onCerrar}
            className="shrink-0 rounded-control border border-papel/35 px-2.5 py-1 text-xs font-bold uppercase tracking-wide hover:bg-papel hover:text-tinta"
          >
            Cerrar
          </button>
        </header>

        <div className="space-y-5 p-5">
          <section>
            <div className="etiqueta">Existencia</div>
            <p className="mt-1.5 text-sm">
              {p.inventory > 0 ? (
                <>
                  <span className="cifra text-lg font-bold">
                    {p.inventory.toLocaleString('es-DO')}
                  </span>{' '}
                  unidades en total
                </>
              ) : (
                <span className="font-bold text-rojo">Sin existencia</span>
              )}
            </p>
            {p.locationCount > 0 && (
              <p className="mt-1.5 text-xs text-humo">
                Dado de alta en <span className="cifra">{p.locationCount}</span>{' '}
                {p.locationCount === 1 ? 'ubicación' : 'ubicaciones'} —sucursales y almacenes—, que
                no es lo mismo que tener existencia en todas. El ERP no devuelve el reparto por
                ubicación, solo el total y el conteo.
              </p>
            )}
          </section>

          <Separador />

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Dato rotulo="Precio de lista">
              {p.unitPrice ? (
                <span className="cifra font-bold">{pesos.format(p.unitPrice)}</span>
              ) : (
                <span className="text-rojo">sin precio</span>
              )}
            </Dato>
            <Dato rotulo="Unidad">{p.unitMeasure || '—'}</Dato>
            <Dato rotulo="Estado en el ERP">
              <EstadoLargo estado={p.itemStatus} />
            </Dato>
            <Dato rotulo="Clasificación">{p.clasificacion || '—'}</Dato>
          </div>

          {p.uso && (
            <>
              <Separador />
              <section>
                <div className="etiqueta">Historial de este cliente</div>
                <p className="mt-1.5 text-sm">
                  Ya se le cotizó <span className="cifra font-bold">{p.uso.veces}</span>{' '}
                  {p.uso.veces === 1 ? 'vez' : 'veces'}
                  {fechaLarga(p.uso.ultima) && <>, la última el {fechaLarga(p.uso.ultima)}</>}.
                </p>
                <p className="mt-1.5 text-xs text-humo">
                  Sale de sus documentos anteriores en el ERP, que son cotizaciones: no consta que
                  se hayan cerrado en venta.
                </p>
              </section>
            </>
          )}

          <Separador />

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Dato rotulo="División">{p.divisionCode || '—'}</Dato>
            <Dato rotulo="Categoría">{p.categoryCode || '—'}</Dato>
            <Dato rotulo="Grupo">{p.groupCode || '—'}</Dato>
            <Dato rotulo="Código de barras">
              <span className="cifra">{p.barcode || '—'}</span>
            </Dato>
          </div>

          {pedido && (
            <>
              <Separador />
              <section>
                <div className="etiqueta">Por qué salió este producto</div>
                <p className="mt-1.5 text-sm">
                  La solicitud decía «{pedido}». {p.motivo}.
                </p>
              </section>
            </>
          )}
        </div>

        <footer className="border-t border-linea bg-bruma px-5 py-3 text-xs text-humo">
          El precio y la existencia salen del último volcado del ERP. Se revalidan al emitir la
          cotización.
        </footer>
      </div>
    </div>
  )
}

function Separador() {
  return <hr className="border-linea" />
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="etiqueta">{rotulo}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}

/** En la tabla el estado va abreviado; aquí cabe decir qué implica. */
function EstadoLargo({ estado }: { estado: string }) {
  if (estado === 'Bloqueado') {
    return (
      <span className="font-semibold text-rojo">
        Bloqueado — el ERP rechaza la cotización completa si va en una línea
      </span>
    )
  }
  if (estado === 'Descatalogado') {
    return <span className="font-semibold text-ambar">Descatalogado — se cotiza, pero no se repone</span>
  }
  if (estado === 'Sustituto') {
    return <span className="text-humo">Sustituto de otro artículo</span>
  }
  return <span>Activo</span>
}

function fechaLarga(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('es-DO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
}
