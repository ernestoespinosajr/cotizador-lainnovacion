'use client'

import { useEffect, useRef } from 'react'
import type { Candidato } from '@/lib/buscar'
import { GRUPOS, precioDe, ROTULO, type GrupoPrecio } from '@/lib/precios'
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
  grupoCliente,
  onCerrar,
}: {
  producto: Candidato
  /** Lo que decía la solicitud. Ausente en las líneas agregadas a mano. */
  pedido?: string
  /** Para marcar cuál de las tres listas le corresponde a este cliente. */
  grupoCliente: GrupoPrecio
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
            <Sitios producto={p} />
          </section>

          <Separador />

          <section>
            <div className="etiqueta">Precios de lista</div>
            <div className="mt-1.5 flex flex-wrap gap-x-8 gap-y-2">
              {GRUPOS.map((g) => {
                const v = precioDe(p, g)
                const suyo = g === grupoCliente
                return (
                  <div key={g}>
                    <div className={`text-xs ${suyo ? 'font-bold text-tinta' : 'text-humo'}`}>
                      {ROTULO[g]}
                      {suyo && ' · el suyo'}
                    </div>
                    <div className={`cifra text-sm ${suyo ? 'font-bold' : ''}`}>
                      {v ? pesos.format(v) : <span className="text-rojo">—</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <Separador />

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Dato rotulo="Unidad">{p.unitMeasure || '—'}</Dato>
            <Dato rotulo="Clasificación">{p.clasificacion || '—'}</Dato>
            <Dato rotulo="Estado en el ERP">
              <EstadoLargo estado={p.itemStatus} />
            </Dato>
          </div>

          {(p.uso || p.patron) && (
            <>
              <Separador />
              <section>
                <div className="etiqueta">Historial de este cliente</div>
                {p.uso && (
                  <p className="mt-1.5 text-sm">
                    Ya se le cotizó <span className="cifra font-bold">{p.uso.veces}</span>{' '}
                    {p.uso.veces === 1 ? 'vez' : 'veces'}
                    {fechaLarga(p.uso.ultima) && <>, la última el {fechaLarga(p.uso.ultima)}</>}.
                  </p>
                )}
                {p.patron && (
                  <p className="mt-1.5 text-sm">
                    De sus <span className="cifra font-bold">{p.patron.total}</span>{' '}
                    {plural(p.patron.tipo)} anteriores,{' '}
                    {enumerar(
                      p.patron.rasgos.map((r) => `${r.veces} ${r.termino.toUpperCase()}`),
                    )}
                    . Por eso este quedó delante de los demás de su tipo.
                  </p>
                )}
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

/** Tiendas 01-05, almacenes 11, 12 y 15. Solo se listan los que tienen unidades. */
const SITIOS = [
  ['01', 'Tienda 01'],
  ['02', 'Tienda 02'],
  ['03', 'Tienda 03'],
  ['04', 'Tienda 04'],
  ['05', 'Tienda 05'],
  ['11', 'Almacén 11'],
  ['12', 'Almacén 12'],
  ['15', 'Almacén 15'],
] as const

/**
 * Reparto de la existencia.
 *
 * El ERP detalla ocho sitios pero el artículo puede estar en más: medido sobre
 * 400 productos, en 58 —el 14,5%— el total es mayor que la suma de los ocho, y
 * el conteo de ubicaciones llega a 28. Por eso se rotula «tiendas y almacenes
 * principales» y, cuando la cuenta no cuadra, se dice cuánto queda fuera en vez
 * de dejar que el vendedor lo sume y le falten unidades.
 */
function Sitios({ producto }: { producto: Candidato }) {
  const p = producto
  const filas = SITIOS.map(([k, rotulo]) => ({
    rotulo,
    cantidad: (p as unknown as Record<string, number>)[`inventory${k}`] ?? 0,
  })).filter((f) => f.cantidad > 0)

  if (filas.length === 0) return null

  const detallado = filas.reduce((a, f) => a + f.cantidad, 0)
  const fuera = Math.max(0, p.inventory - detallado)

  return (
    <div className="mt-3">
      <div className="etiqueta">En tiendas y almacenes principales</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {filas.map((f) => (
          <div key={f.rotulo} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-humo">{f.rotulo}</span>
            <span className="cifra font-semibold">{f.cantidad.toLocaleString('es-DO')}</span>
          </div>
        ))}
      </div>
      {fuera > 0 && (
        <p className="mt-2 text-xs text-humo">
          Otras <span className="cifra">{fuera.toLocaleString('es-DO')}</span> unidades están en
          ubicaciones que el ERP no detalla.
        </p>
      )}
    </div>
  )
}

/**
 * Plural del tipo de producto. Los tipos del catálogo son sustantivos comunes
 * —abanico, extractor, escalera, nevera—, así que la regla de vocal/consonante
 * los cubre; el caso de la z va aparte porque «lapiz» rompería.
 */
function plural(t: string) {
  if (/z$/.test(t)) return `${t.slice(0, -1)}ces`
  return /[aeiou]$/.test(t) ? `${t}s` : `${t}es`
}

/** «a, b y c» — la coma sola en una lista de tres se lee como enumeración rota. */
function enumerar(partes: string[]) {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
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
