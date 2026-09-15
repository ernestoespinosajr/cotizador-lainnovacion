'use client'

import { useState } from 'react'
import type { CotizacionNav } from '@/lib/nav'
import type { ClienteFicha } from '@/app/api/clientes/route'
import type { LineaEstado } from './PasoProductos'
import { calcular, type GrupoPrecio } from '@/lib/precios'
import { cotizable, nombreCompleto } from '@/lib/producto'
import { Etiqueta, pesos } from './ui'

type Emitida = { cotizacion: CotizacionNav; referencia: string; cotizador: string }

/**
 * Emisión de la cotización.
 *
 * Es el único punto donde aparecen los precios reales: NAV aplica el grupo de
 * precio del cliente y no hay servicio para consultarlos sin crear el documento.
 * Por eso el paso muestra primero lo que se va a enviar, y recién después de
 * emitir revela los importes.
 */
export default function PasoCotizacion({
  cliente,
  lineas,
  grupoCliente,
  precioConDescuento,
  setPrecioConDescuento,
  onVolver,
}: {
  cliente: ClienteFicha | null
  lineas: LineaEstado[]
  /** Necesario para convertir la lista elegida en el descuento que NAV acepta. */
  grupoCliente: GrupoPrecio
  /** Toggle global de presentación del descuento. Compartido con el paso 3. */
  precioConDescuento: boolean
  setPrecioConDescuento: (v: boolean) => void
  onVolver: () => void
}) {
  const [emitiendo, setEmitiendo] = useState(false)
  const [error, setError] = useState<{
    mensaje: string
    referencia?: string
    detalle?: string
    rechazoDelErp?: boolean
  } | null>(null)
  const [emitida, setEmitida] = useState<Emitida | null>(null)

  const incluidas = lineas.filter((l) => l.incluida && l.elegido)

  // NAV rechaza el documento completo si una sola línea lleva un producto
  // bloqueado, y devuelve un error crudo del tipo "Blocked must be equal to 'No'
  // in Item: No.=037508". Con cien líneas eso es inservible, así que se atajan
  // acá y se nombran.
  const bloqueadas = incluidas.filter((l) => !cotizable(l.elegido!))
  const puedeEmitir = incluidas.length > 0 && bloqueadas.length === 0

  async function emitir() {
    setEmitiendo(true)
    setError(null)
    try {
      const res = await fetch('/api/cotizacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteNo: cliente?.no,
          lineas: incluidas.map((l) => {
            const cobro = calcular(
              l.elegido!,
              grupoCliente,
              l.grupoPrecio ?? grupoCliente,
              l.descuento ?? 0,
            )
            // Con precio manual NAV ignora la lista del grupo y usa el que
            // mandamos. Sin base o sin lista elegida el catálogo no puede armar
            // un final confiable: se cae al camino del porcentaje, que era el
            // comportamiento previo.
            // Precio manual también cuando la lista elegida es más cara que la
            // del cliente: un descuento no puede subir el precio.
            if ((precioConDescuento || cobro.requierePrecioManual) && cobro.final != null) {
              return {
                code: l.elegido!.code,
                cantidad: l.cantidad,
                texto: l.texto,
                precio: cobro.final,
              }
            }
            return {
              code: l.elegido!.code,
              cantidad: l.cantidad,
              texto: l.texto,
              descuento: cobro.descuentoNav,
            }
          }),
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError({
          mensaje: d.error ?? 'No se pudo emitir la cotización.',
          referencia: d.referencia,
          detalle: d.detalle,
          rechazoDelErp: d.rechazoDelErp,
        })
        return
      }
      setEmitida(d as Emitida)
    } catch (e) {
      setError({ mensaje: `Falló la conexión: ${e instanceof Error ? e.message : e}` })
    } finally {
      setEmitiendo(false)
    }
  }

  async function verPdf() {
    if (!emitida) return
    const res = await fetch('/api/cotizacion/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cotizacion: emitida.cotizacion, cotizador: emitida.cotizador }),
    })
    if (!res.ok) {
      setError({ mensaje: 'No se pudo generar el PDF.' })
      return
    }
    // Se abre en una pestaña para que el vendedor lo revise antes de mandarlo.
    const url = URL.createObjectURL(await res.blob())
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  if (!cliente) {
    return (
      <p className="rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">
        Falta elegir el cliente. El ERP necesita saber a quién se cotiza para aplicar sus precios.
      </p>
    )
  }

  if (emitida) return <Resultado emitida={emitida} onVerPdf={verPdf} error={error?.mensaje} />

  return (
    <div className="max-w-3xl">
      <div className="rounded-caja border-2 border-tinta p-5">
        <Etiqueta>Se va a emitir</Etiqueta>
        <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="etiqueta">Cliente</dt>
            <dd className="mt-0.5 text-sm font-semibold">
              <span className="cifra text-humo">{cliente.no}</span> · {cliente.name}
            </dd>
          </div>
          <div>
            <dt className="etiqueta">Líneas</dt>
            <dd className="cifra mt-0.5 text-sm font-semibold">{incluidas.length}</dd>
          </div>
        </dl>

        <p className="mt-4 rounded-control border-l-4 border-linea bg-bruma px-4 py-2.5 text-xs leading-relaxed text-humo">
          El monto final lo calcula el ERP y aparece al emitir. La cotización queda registrada con
          su número: si algo cambia después, se edita desde «Abrir existente» mientras siga abierta.
        </p>

        {/*
          Recordatorio de cómo va a viajar el descuento al ERP. El toggle en sí
          se maneja desde el paso anterior; acá se muestra el estado para que el
          vendedor no llegue a Emitir sin saber en qué modo está. Si quiere
          cambiarlo, vuelve un paso.
        */}
        <p className="mt-4 rounded-control border-l-4 border-tinta bg-bruma px-4 py-2.5 text-xs leading-relaxed">
          <span className="font-semibold text-tinta">Descuento:</span>{' '}
          {precioConDescuento ? (
            <>
              se aplicará al precio unitario. El ERP guarda el precio ya rebajado y el PDF no
              muestra la columna de descuento.
            </>
          ) : (
            <>
              se enviará como porcentaje. El ERP guarda el precio de lista con el descuento por
              línea y el PDF lo imprime en su columna.
            </>
          )}{' '}
          <button
            type="button"
            className="cifra font-bold text-tinta underline hover:no-underline"
            onClick={onVolver}
          >
            cambiar
          </button>
        </p>
      </div>

      {bloqueadas.length > 0 && (
        <div className="mt-4 rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3">
          <p className="text-sm font-bold">
            {bloqueadas.length === 1
              ? 'Una línea lleva un producto bloqueado en el ERP.'
              : `${bloqueadas.length} líneas llevan productos bloqueados en el ERP.`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-humo">
            El ERP rechaza la cotización completa por su causa, no solo esa línea. Hay que
            reemplazarlos o desmarcarlos en el paso anterior.
          </p>
          <ul className="mt-2 space-y-0.5">
            {bloqueadas.map((l) => (
              <li key={l.id} className="text-xs">
                <span className="cifra text-humo">{l.elegido!.code}</span>{' '}
                <span className="font-semibold">{l.elegido!.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">
          <p className="font-semibold leading-relaxed">{error.mensaje}</p>

          {/* La referencia solo importa cuando quedó la duda de si el documento
              se creó. Si el ERP respondió rechazando, no se creó nada y sembrar
              la duda solo confunde. */}
          {error.rechazoDelErp ? (
            <p className="mt-1.5 text-xs text-humo">
              No se creó ninguna cotización en el ERP.
            </p>
          ) : (
            error.referencia && (
              <p className="mt-1.5 text-xs text-humo">
                Referencia enviada: <span className="cifra">{error.referencia}</span>. Como el fallo
                fue de comunicación, la cotización pudo quedar creada en el ERP con esa referencia.
              </p>
            )
          )}

          {error.detalle && error.detalle !== error.mensaje && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-humo hover:text-tinta">
                Ver el mensaje original del ERP
              </summary>
              <p className="cifra mt-1.5 text-[0.7rem] leading-relaxed text-humo">{error.detalle}</p>
            </details>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="boton" onClick={emitir} disabled={emitiendo || !puedeEmitir}>
          {emitiendo ? 'Emitiendo en el ERP…' : `Emitir cotización (${incluidas.length} líneas)`}
        </button>
        <button type="button" className="boton-borde" onClick={onVolver}>
          Volver a los productos
        </button>
      </div>
    </div>
  )
}

function Resultado({
  emitida,
  onVerPdf,
  error,
}: {
  emitida: Emitida
  onVerPdf: () => void
  error?: string
}) {
  const c = emitida.cotizacion
  const t = c.Totals
  const n = (v: string) => Number(v) || 0

  /*
   * Descuento total real.
   *
   * `Totals.InvoiceDiscountAmount` es el descuento a nivel de cabecera y en la
   * práctica llega en cero, porque acá los descuentos se aplican por línea con
   * `Line_Discount_Pct`. Antes se mostraba solo el de cabecera y el bloque de
   * totales quedaba en 0,00 aunque el cotizador hubiera puesto 15% en cada
   * línea. Se suman también los `LineDiscountAmount` para reflejar lo que el
   * cliente realmente ahorra.
   */
  const descuentoTotal =
    n(t.InvoiceDiscountAmount) +
    c.Lineas.reduce((acc, l) => acc + n(l.LineDiscountAmount), 0)

  /*
   * Líneas que el ERP valoró en cero.
   *
   * No significa que el producto no tenga precio: puede tenerlo en el catálogo y
   * no tenerlo en la lista del grupo del cliente. NAV no avisa, devuelve 0 y sigue
   * —una LAVADORA FRIGIDAIRE de RD$53.990 salió en 0.00 para el grupo PCOMERCIAL—.
   * Sin este control la cotización se le manda al cliente regalando el producto.
   */
  const sinPrecio = c.Lineas.filter((l) => n(l.UnitPrice) === 0)

  return (
    <div className="max-w-4xl">
      <div className="overflow-hidden rounded-caja border-2 border-tinta">
        <div className="border-b-2 border-tinta bg-tinta px-5 py-4 text-papel">
          <div className="etiqueta !text-papel/55">Cotización emitida</div>
          <p className="cifra mt-1 text-2xl font-bold">{c.QuoteNo}</p>
          <p className="mt-1 text-xs text-papel/65">
            {c.Customer.Name} · vendedor {c.Header.SalespersonCode || '—'} · tienda{' '}
            {c.Header.LocationCode || '—'} · condiciones {c.Header.PaymentTermsCode || '—'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-linea bg-bruma">
                <th className="etiqueta px-3 py-2 text-left">Código</th>
                <th className="etiqueta px-3 py-2 text-left">Producto</th>
                <th className="etiqueta px-3 py-2 text-right">Ctd.</th>
                <th className="etiqueta px-3 py-2 text-right">Precio</th>
                <th className="etiqueta px-3 py-2 text-right">ITBIS</th>
                <th className="etiqueta px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {c.Lineas.map((l) => (
                <tr key={l.LineNo} className="border-b border-linea last:border-b-0">
                  <td className="cifra px-3 py-2 text-xs text-humo">{l.No}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">
                      {nombreCompleto({ description: l.Description, description2: l.Description2 })}
                    </span>
                  </td>
                  <td className="cifra px-3 py-2 text-right">{n(l.Quantity)}</td>
                  <td
                    className={`cifra px-3 py-2 text-right ${n(l.UnitPrice) === 0 ? 'font-bold text-rojo' : ''}`}
                  >
                    {pesos.format(n(l.UnitPrice))}
                  </td>
                  <td className="cifra px-3 py-2 text-right text-humo">
                    {pesos.format(n(l.AmountIncludingVAT) - n(l.Amount))}
                  </td>
                  <td className="cifra px-3 py-2 text-right font-semibold">
                    {pesos.format(n(l.AmountIncludingVAT))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="flex flex-wrap justify-end gap-x-8 gap-y-2 border-t-2 border-tinta bg-bruma px-5 py-4">
          <Total rotulo="Subtotal">{pesos.format(n(t.TotalAmountExclVAT || t.SubTotal))}</Total>
          {descuentoTotal > 0 && (
            <Total rotulo="Descuento">{pesos.format(descuentoTotal)}</Total>
          )}
          <Total rotulo="ITBIS">{pesos.format(n(t.VATAmount))}</Total>
          <Total rotulo="Total" fuerte>
            {pesos.format(n(t.TotalAmountInclVAT))}
          </Total>
        </dl>
      </div>

      {sinPrecio.length > 0 && (
        <div className="mt-4 rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3">
          <p className="text-sm font-bold">
            {sinPrecio.length === 1
              ? 'Una línea salió con precio cero.'
              : `${sinPrecio.length} líneas salieron con precio cero.`}{' '}
            No mandes esta cotización así.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-humo">
            El producto puede tener precio en el catálogo y no tenerlo en la lista del grupo de
            precio de este cliente. Hay que cargarlo en el ERP y volver a emitir.
          </p>
          <ul className="mt-2 space-y-0.5">
            {sinPrecio.map((l) => (
              <li key={l.LineNo} className="text-xs">
                <span className="cifra text-humo">{l.No}</span>{' '}
                <span className="font-semibold">
                  {nombreCompleto({ description: l.Description, description2: l.Description2 })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">{error}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className="boton" onClick={onVerPdf}>
          Ver el PDF
        </button>
        <p className="text-xs text-humo">
          Referencia interna <span className="cifra">{emitida.referencia}</span>
          {emitida.cotizador && <> · cotizador {emitida.cotizador}</>}
        </p>
      </div>
    </div>
  )
}

function Total({
  rotulo,
  children,
  fuerte,
}: {
  rotulo: string
  children: React.ReactNode
  fuerte?: boolean
}) {
  return (
    <div className="text-right">
      <dt className="etiqueta">{rotulo}</dt>
      <dd className={`cifra mt-0.5 ${fuerte ? 'text-lg font-bold' : 'text-sm'}`}>{children}</dd>
    </div>
  )
}
