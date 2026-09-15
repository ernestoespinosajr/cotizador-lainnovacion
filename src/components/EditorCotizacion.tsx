'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CotizacionNav, LineaNav } from '@/lib/nav'
import type { Producto } from '@/lib/buscar'
import type { SituacionCliente } from '@/app/api/clientes/[no]/route'
import PanelVariantes, { Estado, Existencia } from './PanelVariantes'
import DetalleProducto from './DetalleProducto'
import { calcular, GRUPOS, grupoDe, ROTULO, type GrupoPrecio } from '@/lib/precios'
import { cotizable } from '@/lib/producto'
import { Etiqueta, pesos } from './ui'

type Borrador = { cantidad: string; grupo: GrupoPrecio; descuento: string }

/**
 * Editor de una cotización ya emitida.
 *
 * Los controles espejan el paso 3 de creación: cantidad, lista de precio,
 * descuento adicional y toggle global «aplicar el descuento al precio». Cada
 * acción va contra NAV por separado —no hay «emisión» que acumule cambios— y
 * respeta que NAV solo edita cotizaciones con `Status = Open`.
 *
 * NAV solo devuelve `UnitPrice` y `LineDiscountPct` por línea; no dice qué
 * grupo de precio ni qué descuento adicional se usaron para llegar ahí. El
 * editor no lo reconstruye: presenta el estado del ERP como información y los
 * controles funcionan como «cambio deseado». Si no se toca la lista de precio
 * ni el descuento, ese lado de la línea no viaja al ERP y los precios se
 * preservan.
 *
 * Los borradores viven acá y no dentro de cada fila para poder contar cuántas
 * líneas quedan pendientes de guardar y ofrecer un guardado global — con la
 * escala real (cotizaciones de 30–100 líneas) apretar «Guardar» fila por fila
 * era la queja principal del vendedor.
 */
export default function EditorCotizacion({ quoteNo }: { quoteNo: string }) {
  const [cotizacion, setCotizacion] = useState<CotizacionNav | null>(null)
  const [ficha, setFicha] = useState<SituacionCliente | null>(null)
  const [productos, setProductos] = useState<Record<string, Producto>>({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [agregando, setAgregando] = useState(false)
  const [detalle, setDetalle] = useState<string | null>(null)
  const [precioConDescuento, setPrecioConDescuento] = useState(false)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})

  const grupoCliente: GrupoPrecio = ficha ? grupoDe(ficha.grupoPrecio) : 'DETALLE'

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/cotizacion/${encodeURIComponent(quoteNo)}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) {
        setError(d.error ?? 'No se pudo abrir la cotización.')
        setCotizacion(null)
        return
      }
      const cot = d.cotizacion as CotizacionNav
      setCotizacion(cot)

      const custNo = cot.Customer?.No ?? ''
      const codes = [...new Set(cot.Lineas.map((l) => l.No).filter(Boolean))]
      const [fichaRes, ...prodRes] = await Promise.all([
        custNo
          ? fetch(`/api/clientes/${encodeURIComponent(custNo)}`, { cache: 'no-store' })
              .then((x) => (x.ok ? x.json() : null))
              .catch(() => null)
          : Promise.resolve(null),
        ...codes.map((c) =>
          fetch(`/api/productos/${encodeURIComponent(c)}`, { cache: 'no-store' })
            .then((x) => (x.ok ? x.json() : null))
            .catch(() => null),
        ),
      ])
      if (fichaRes && !fichaRes.error) setFicha(fichaRes as SituacionCliente)
      const mapa: Record<string, Producto> = {}
      codes.forEach((c, i) => {
        const p = prodRes[i]?.producto
        if (p) mapa[c] = p as Producto
      })
      setProductos(mapa)
    } catch (e) {
      setError(`Falló la conexión: ${e instanceof Error ? e.message : e}`)
    } finally {
      setCargando(false)
    }
  }, [quoteNo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cada vez que llega una cotización nueva se resetean los borradores a lo
  // que dice el ERP. El descuento arranca con el `LineDiscountPct` de NAV para
  // que la fila refleje el estado real del documento; si el vendedor no toca
  // nada el guardado no dispara nada.
  useEffect(() => {
    if (!cotizacion) return
    const nuevo: Record<string, Borrador> = {}
    for (const l of cotizacion.Lineas) {
      nuevo[l.LineNo] = {
        cantidad: String(Number(l.Quantity) || 0),
        grupo: grupoCliente,
        descuento: String(Number(l.LineDiscountPct) || 0),
      }
    }
    setBorradores(nuevo)
  }, [cotizacion, grupoCliente])

  const setBorrador = useCallback((lineNo: string, cambio: Partial<Borrador>) => {
    setBorradores((prev) => ({ ...prev, [lineNo]: { ...prev[lineNo], ...cambio } }))
  }, [])

  const calcularCambios = useCallback(
    (linea: LineaNav): { cantidad?: number; precio?: number; descuento?: number } | null => {
      const b = borradores[linea.LineNo]
      const p = productos[linea.No]
      if (!b) return null
      const cantidadNav = Number(linea.Quantity) || 0
      const descuentoNav = Number(linea.LineDiscountPct) || 0
      const cantidadN = parseNumero(b.cantidad)
      const descuentoN = parseNumero(b.descuento)
      const cantidadTocada = cantidadN != null && cantidadN !== cantidadNav
      const descuentoTocado = descuentoN != null && Math.abs(descuentoN - descuentoNav) > 0.005
      const precioTocado = b.grupo !== grupoCliente || descuentoTocado

      // Conversión automática: con el toggle en on, las líneas del ERP que
      // tienen `LineDiscountPct > 0` se marcan como pendientes de guardar
      // aunque el vendedor no las haya tocado. El precio manual que se manda
      // preserva el total exacto (Amount / Quantity), así el ERP guarda el
      // mismo importe pero con el descuento embebido en el unitario y
      // `LineDiscountPct = 0`, y el PDF sale sin descuento visible.
      const conversion = precioConDescuento && !precioTocado && descuentoNav > 0

      if (!cantidadTocada && !precioTocado && !conversion) return null

      const out: { cantidad?: number; precio?: number; descuento?: number } = {}
      if (cantidadTocada && cantidadN != null) out.cantidad = cantidadN
      if (precioTocado && p) {
        const c = calcular(p, grupoCliente, b.grupo, descuentoN ?? 0)
        if (precioConDescuento && c.final != null) {
          // Junto con el precio manual va `descuento: 0` porque NAV, en un
          // update, mantiene el `Line_Discount_Pct` previo si no se lo pisa;
          // sin esto, un precio manual sobre una línea con 10% quedaría con
          // 10% adicional sobre el «final» — el descuento se aplicaría dos
          // veces y el PDF seguiría mostrando el porcentaje.
          out.precio = c.final
          out.descuento = 0
        } else {
          out.descuento = c.descuentoNav
        }
      } else if (conversion) {
        const ctd = Number(linea.Quantity) || 0
        if (ctd > 0) {
          out.precio = (Number(linea.Amount) || 0) / ctd
          out.descuento = 0
        }
      }
      return Object.keys(out).length > 0 ? out : null
    },
    [borradores, productos, grupoCliente, precioConDescuento],
  )

  const lineasSucias = useMemo(() => {
    if (!cotizacion) return [] as { linea: LineaNav; cambios: NonNullable<ReturnType<typeof calcularCambios>> }[]
    const r: { linea: LineaNav; cambios: NonNullable<ReturnType<typeof calcularCambios>> }[] = []
    for (const l of cotizacion.Lineas) {
      const c = calcularCambios(l)
      if (c) r.push({ linea: l, cambios: c })
    }
    return r
  }, [cotizacion, calcularCambios])

  async function mutar(url: string, init: RequestInit, marca: string): Promise<boolean> {
    setOcupada(marca)
    setError(null)
    try {
      const r = await fetch(url, { ...init, cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) {
        setError(d.error ?? 'El ERP rechazó la operación.')
        return false
      }
      if (d.cotizacion) {
        const cot = d.cotizacion as CotizacionNav
        setCotizacion(cot)
        const faltantes = [...new Set(cot.Lineas.map((l) => l.No).filter((c) => c && !productos[c]))]
        if (faltantes.length > 0) {
          const prods = await Promise.all(
            faltantes.map((c) =>
              fetch(`/api/productos/${encodeURIComponent(c)}`, { cache: 'no-store' })
                .then((x) => (x.ok ? x.json() : null))
                .catch(() => null),
            ),
          )
          setProductos((prev) => {
            const next = { ...prev }
            faltantes.forEach((c, i) => {
              const p = prods[i]?.producto
              if (p) next[c] = p as Producto
            })
            return next
          })
        }
      }
      return true
    } catch (e) {
      setError(`Falló la conexión: ${e instanceof Error ? e.message : e}`)
      return false
    } finally {
      setOcupada(null)
    }
  }

  const guardarLinea = (linea: LineaNav) => {
    const cambios = calcularCambios(linea)
    if (!cambios) return Promise.resolve(false)
    return mutar(
      `/api/cotizacion/${encodeURIComponent(quoteNo)}/lineas/${encodeURIComponent(linea.LineNo)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios) },
      `edit-${linea.LineNo}`,
    )
  }

  const borrarLinea = (linea: LineaNav) =>
    mutar(
      `/api/cotizacion/${encodeURIComponent(quoteNo)}/lineas/${encodeURIComponent(linea.LineNo)}`,
      { method: 'DELETE' },
      `del-${linea.LineNo}`,
    )

  async function guardarTodo() {
    if (lineasSucias.length === 0) return
    setOcupada('save-all')
    setError(null)
    // Se guarda secuencial para que el error de una línea no dispare paralelo
    // sobre las siguientes y NAV se quede con el estado a medio aplicar.
    for (const { linea, cambios } of lineasSucias) {
      try {
        const r = await fetch(
          `/api/cotizacion/${encodeURIComponent(quoteNo)}/lineas/${encodeURIComponent(linea.LineNo)}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios), cache: 'no-store' },
        )
        const d = await r.json()
        if (!r.ok) {
          setError(`Línea ${linea.LineNo}: ${d.error ?? 'error del ERP'}. Se detuvo el guardado.`)
          if (d.cotizacion) setCotizacion(d.cotizacion as CotizacionNav)
          setOcupada(null)
          return
        }
        if (d.cotizacion) setCotizacion(d.cotizacion as CotizacionNav)
      } catch (e) {
        setError(`Falló la conexión: ${e instanceof Error ? e.message : e}`)
        setOcupada(null)
        return
      }
    }
    setOcupada(null)
  }

  async function agregarLinea(codigo: string) {
    setAgregando(false)
    await mutar(
      `/api/cotizacion/${encodeURIComponent(quoteNo)}/lineas`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineas: [{ code: codigo, cantidad: 1 }] }),
      },
      'add',
    )
  }

  async function verPdf() {
    if (!cotizacion) return
    // El PDF sale de la cotización que devolvió NAV: si hay cambios locales sin
    // guardar, esos no viajan y el PDF queda desactualizado. Se avisa antes de
    // abrir para que no lo confunda con un bug.
    if (lineasSucias.length > 0) {
      const ok = window.confirm(
        `Tienes ${lineasSucias.length} línea${lineasSucias.length === 1 ? '' : 's'} con cambios sin guardar.\n\n` +
          'El PDF muestra lo que el ERP tiene guardado, no los cambios que estás tecleando. ' +
          '¿Abrirlo igual?',
      )
      if (!ok) return
    }
    const r = await fetch('/api/cotizacion/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cotizacion, cotizador: '' }),
    })
    if (!r.ok) {
      setError('No se pudo generar el PDF.')
      return
    }
    const url = URL.createObjectURL(await r.blob())
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const lineaDetalle = useMemo(() => {
    if (!detalle || !cotizacion) return null
    const linea = cotizacion.Lineas.find((l) => l.LineNo === detalle)
    if (!linea) return null
    const p = productos[linea.No]
    return p ? { linea, producto: p } : null
  }, [detalle, cotizacion, productos])

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-40 border-b-[3px] border-rojo bg-papel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div>
            <p className="etiqueta">Editar cotización</p>
            <p className="cifra mt-0.5 text-sm font-bold">{quoteNo}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/cotizacion" className="text-humo hover:text-tinta">
              Abrir otra
            </Link>
            <Link href="/" className="text-humo hover:text-tinta">
              ← Cotizador
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        {cargando && <p className="text-sm text-humo">Cargando cotización…</p>}

        {!cargando && error && !cotizacion && (
          <div className="rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">
            <p className="font-semibold">{error}</p>
            <Link href="/cotizacion" className="mt-2 inline-block text-xs text-humo hover:text-tinta">
              Volver a buscar
            </Link>
          </div>
        )}

        {cotizacion && (
          <Vista
            cotizacion={cotizacion}
            productos={productos}
            borradores={borradores}
            grupoCliente={grupoCliente}
            precioConDescuento={precioConDescuento}
            setPrecioConDescuento={setPrecioConDescuento}
            calcularCambios={calcularCambios}
            error={error}
            ocupada={ocupada}
            onBorrador={setBorrador}
            onGuardarLinea={guardarLinea}
            onBorrarLinea={borrarLinea}
            onDetalle={setDetalle}
            onAgregar={() => setAgregando(true)}
            onVerPdf={verPdf}
          />
        )}

        {agregando && cotizacion && (
          <PanelVariantes
            pedido=""
            elegido={null}
            variantes={[]}
            onElegir={(c) => agregarLinea(c.code)}
            onCerrar={() => setAgregando(false)}
            clienteNo={cotizacion.Customer.No ?? ''}
            modo="agregar"
          />
        )}

        {lineaDetalle && (
          <DetalleProducto
            producto={{
              // `DetalleProducto` acepta un `Candidato` pero solo usa los campos
              // del `Producto` base; los extras del ranking se rellenan neutros
              // porque acá no hay pedido que puntuar.
              ...lineaDetalle.producto,
              cobertura: 0,
              relevancia: 0,
              similitud: 0,
              puntaje: 0,
              motivo: '',
            }}
            grupoCliente={grupoCliente}
            onCerrar={() => setDetalle(null)}
          />
        )}
      </main>

      {/*
        Barra sticky con el estado de guardado. Antes el único botón de emisión
        era el pequeño «Guardar» de cada fila y se perdía en el scroll horizontal
        de la tabla; el vendedor no lo encontraba y creía que el PDF no reflejaba
        sus cambios cuando en realidad nunca los mandó al ERP.
      */}
      {cotizacion && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t-2 border-tinta bg-papel px-5 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-humo">
              {lineasSucias.length === 0 ? (
                <>Todo lo tecleado está guardado en el ERP.</>
              ) : (
                <>
                  <span className="cifra font-bold text-rojo">{lineasSucias.length}</span>{' '}
                  {lineasSucias.length === 1 ? 'línea' : 'líneas'} con cambios sin guardar. El PDF
                  refleja lo que el ERP tiene, no lo que estás tecleando.
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="boton"
                onClick={guardarTodo}
                disabled={lineasSucias.length === 0 || ocupada != null}
              >
                {ocupada === 'save-all'
                  ? 'Guardando…'
                  : lineasSucias.length === 0
                    ? 'Guardar cambios'
                    : `Guardar cambios (${lineasSucias.length})`}
              </button>
              <button
                type="button"
                className="boton-borde"
                onClick={verPdf}
                disabled={ocupada != null}
              >
                Ver el PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Vista({
  cotizacion,
  productos,
  borradores,
  grupoCliente,
  precioConDescuento,
  setPrecioConDescuento,
  calcularCambios,
  error,
  ocupada,
  onBorrador,
  onGuardarLinea,
  onBorrarLinea,
  onDetalle,
  onAgregar,
  onVerPdf,
}: {
  cotizacion: CotizacionNav
  productos: Record<string, Producto>
  borradores: Record<string, Borrador>
  grupoCliente: GrupoPrecio
  precioConDescuento: boolean
  setPrecioConDescuento: (v: boolean) => void
  calcularCambios: (
    linea: LineaNav,
  ) => { cantidad?: number; precio?: number; descuento?: number } | null
  error: string | null
  ocupada: string | null
  onBorrador: (lineNo: string, cambio: Partial<Borrador>) => void
  onGuardarLinea: (linea: LineaNav) => Promise<boolean>
  onBorrarLinea: (linea: LineaNav) => Promise<boolean>
  onDetalle: (lineNo: string) => void
  onAgregar: () => void
  onVerPdf: () => void
}) {
  const c = cotizacion
  const t = c.Totals
  const n = (v: string) => Number(v) || 0
  const descuentoTotal = useMemo(
    () => n(t.InvoiceDiscountAmount) + c.Lineas.reduce((acc, l) => acc + n(l.LineDiscountAmount), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.Lineas, t.InvoiceDiscountAmount],
  )

  return (
    <>
      <div className="overflow-hidden rounded-caja border-2 border-tinta">
        <div className="border-b-2 border-tinta bg-tinta px-5 py-4 text-papel">
          <Etiqueta>Cliente</Etiqueta>
          <p className="mt-1 text-sm font-semibold">
            <span className="cifra text-papel/70">{c.Customer.No}</span> · {c.Customer.Name}
          </p>
          <p className="mt-1 text-xs text-papel/65">
            vendedor {c.Header.SalespersonCode || '—'} · tienda {c.Header.LocationCode || '—'} ·
            condiciones {c.Header.PaymentTermsCode || '—'} · lista{' '}
            <span className="cifra">{ROTULO[grupoCliente]}</span>
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 border-b border-linea bg-bruma px-5 py-3 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 accent-[#e91f29]"
            checked={precioConDescuento}
            onChange={(e) => setPrecioConDescuento(e.target.checked)}
          />
          <span>
            <span className="font-semibold text-tinta">
              Aplicar el descuento al precio (no mostrar la columna de descuento)
            </span>
            <span className="mt-0.5 block text-humo">
              Al guardar, el ERP recibirá el precio ya rebajado en vez del porcentaje. El precio
              final se calcula desde el catálogo local: si el catálogo y el ERP no están
              sincronizados el número puede diferir del que el ERP hubiera aplicado.
            </span>
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-sm">
            <thead>
              <tr className="border-b border-linea bg-bruma">
                <th className="etiqueta px-3 py-2 text-left">Línea</th>
                <th className="etiqueta px-3 py-2 text-left">Producto</th>
                <th className="etiqueta px-3 py-2 text-right">Ctd.</th>
                <th className="etiqueta px-3 py-2 text-left">Existencia</th>
                <th className="etiqueta px-3 py-2 text-left">Lista de precio</th>
                <th className="etiqueta px-3 py-2 text-right">% Desc.</th>
                <th className="etiqueta px-3 py-2 text-right">Precio unitario</th>
                <th className="etiqueta px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {c.Lineas.map((l) => {
                const b = borradores[l.LineNo]
                if (!b) return null
                return (
                  <FilaEditor
                    key={l.LineNo}
                    linea={l}
                    borrador={b}
                    onBorrador={(cambio) => onBorrador(l.LineNo, cambio)}
                    producto={productos[l.No]}
                    grupoCliente={grupoCliente}
                    precioConDescuento={precioConDescuento}
                    cambios={calcularCambios(l)}
                    ocupada={ocupada}
                    onGuardar={() => onGuardarLinea(l)}
                    onBorrar={() => onBorrarLinea(l)}
                    onDetalle={() => onDetalle(l.LineNo)}
                  />
                )
              })}
              {c.Lineas.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-humo">
                    La cotización no tiene líneas. Agrega una para volver a valorarla.
                  </td>
                </tr>
              )}
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

      {error && (
        <p className="mt-4 rounded-caja border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">{error}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="boton-borde"
          onClick={onAgregar}
          disabled={ocupada === 'add'}
        >
          {ocupada === 'add' ? 'Agregando…' : '+ Agregar línea'}
        </button>
        {/* onVerPdf y guardarTodo también están en la barra sticky, pero acá
            quedan expuestos para pantallas altas sin scroll a la barra. */}
        <button type="button" className="boton-borde" onClick={onVerPdf}>
          Ver el PDF
        </button>
        <p className="basis-full text-xs text-humo">
          El ERP solo permite editar cotizaciones abiertas. Si una acción falla con «no editable»,
          la cotización ya está liberada o aprobada.
        </p>
      </div>
    </>
  )
}

function FilaEditor({
  linea,
  borrador,
  onBorrador,
  producto,
  grupoCliente,
  precioConDescuento,
  cambios,
  ocupada,
  onGuardar,
  onBorrar,
  onDetalle,
}: {
  linea: LineaNav
  borrador: Borrador
  onBorrador: (c: Partial<Borrador>) => void
  producto: Producto | undefined
  grupoCliente: GrupoPrecio
  precioConDescuento: boolean
  cambios: { cantidad?: number; precio?: number; descuento?: number } | null
  ocupada: string | null
  onGuardar: () => Promise<boolean>
  onBorrar: () => Promise<boolean>
  onDetalle: () => void
}) {
  const n = (v: string) => Number(v) || 0
  const precioNav = n(linea.UnitPrice)
  const descuentoNav = n(linea.LineDiscountPct)

  const descuentoN = parseNumero(borrador.descuento)
  const descuentoTocado = descuentoN != null && Math.abs(descuentoN - descuentoNav) > 0.005
  const precioTocado = borrador.grupo !== grupoCliente || descuentoTocado
  const cobro = producto && precioTocado ? calcular(producto, grupoCliente, borrador.grupo, descuentoN ?? 0) : null
  const precioMostrado = cobro?.final != null ? cobro.final : precioNav
  const precioTachado = cobro?.base != null && cobro.final != null && cobro.final < cobro.base - 0.005
  const noSePuedeSubir = cobro?.noSePuedeSubir ?? false

  const bloqueado = producto ? !cotizable(producto) : false
  const sucio = cambios != null && !bloqueado
  // Sucia sin haber tocado nada: el toggle global va a convertir el descuento
  // existente en precio manual al guardar.
  const conversionAuto = sucio && !precioTocado && descuentoNav > 0 && precioConDescuento

  const editando = ocupada === `edit-${linea.LineNo}`
  const borrando = ocupada === `del-${linea.LineNo}`
  const guardandoTodo = ocupada === 'save-all'
  const otraOcupada = ocupada != null && !editando && !borrando

  return (
    <tr
      className={`border-b border-linea last:border-b-0 ${sucio ? 'bg-[#fff9e6]' : ''}`}
    >
      <td className="cifra px-3 py-2 align-top text-xs text-humo">
        {linea.LineNo}
        {sucio && (
          <span className="mt-1 block text-[0.6rem] font-bold text-rojo">
            {conversionAuto ? '→ precio' : 'MOD.'}
          </span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <span className="block text-sm font-semibold leading-snug">{linea.Description}</span>
        <span className="mt-0.5 block text-xs text-humo">
          <span className="cifra">{linea.No}</span>
          {linea.Description2 && ` · ${linea.Description2}`}
        </span>
        <span className="mt-0.5 block text-[0.7rem] text-humo">
          ERP actual: <span className="cifra">{pesos.format(precioNav)}</span>
          {descuentoNav > 0 && (
            <>
              {' '}
              · <span className="cifra">{descuentoNav}%</span> desc
            </>
          )}
        </span>
        {conversionAuto && (
          <span className="mt-0.5 block text-[0.7rem] font-semibold text-rojo">
            Al guardar, el {descuentoNav}% pasará al precio unitario y desaparecerá del PDF.
          </span>
        )}
        {producto && producto.itemStatus !== 'Activo' && (
          <span className="mt-1 block">
            <Estado estado={producto.itemStatus} />
          </span>
        )}
        {bloqueado && (
          <span className="mt-1 block text-[0.7rem] font-semibold text-rojo">
            Producto bloqueado en el ERP: no se puede modificar esta línea.
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <input
          type="text"
          inputMode="decimal"
          value={borrador.cantidad}
          onChange={(e) => onBorrador({ cantidad: e.target.value })}
          disabled={otraOcupada || bloqueado || guardandoTodo}
          className="cifra w-16 rounded-control border border-linea bg-papel px-1.5 py-1 text-right text-sm focus:border-tinta focus:outline-none disabled:opacity-50"
          aria-label={`Cantidad de ${linea.Description}`}
        />
      </td>
      <td className="px-3 py-2 align-top text-xs">
        {producto ? <Existencia inventario={producto.inventory} /> : '—'}
      </td>
      <td className="px-3 py-2 align-top">
        {producto ? (
          <select
            value={borrador.grupo}
            onChange={(e) => onBorrador({ grupo: e.target.value as GrupoPrecio })}
            disabled={otraOcupada || bloqueado || guardandoTodo}
            className="w-full rounded-control border border-linea bg-papel px-1.5 py-1 text-xs focus:border-tinta focus:outline-none disabled:opacity-50"
            aria-label={`Lista de precio de ${linea.Description}`}
          >
            {GRUPOS.map((g) => (
              <option key={g} value={g}>
                {ROTULO[g]}
                {g === grupoCliente ? ' ·' : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-humo">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <span className="flex items-baseline justify-end gap-0.5">
          <input
            type="text"
            inputMode="decimal"
            value={borrador.descuento}
            onChange={(e) => onBorrador({ descuento: e.target.value })}
            disabled={otraOcupada || bloqueado || !producto || guardandoTodo}
            className="cifra w-14 rounded-control border border-linea bg-papel px-1.5 py-1 text-right text-sm focus:border-tinta focus:outline-none disabled:opacity-50"
            aria-label={`Descuento adicional de ${linea.Description}`}
          />
          <span className="text-xs text-humo">%</span>
        </span>
      </td>
      <td className="px-3 py-2 text-right align-top">
        <span className="cifra block text-sm font-bold">{pesos.format(precioMostrado)}</span>
        {precioTachado && cobro?.base != null && (
          <span className="cifra block text-xs text-humo line-through">
            {pesos.format(cobro.base)}
          </span>
        )}
        {noSePuedeSubir && (
          <span className="block text-xs font-semibold text-ambar">no sube</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center justify-end gap-1.5">
          {producto && (
            <button
              type="button"
              onClick={onDetalle}
              title="Ver detalle del producto"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-linea text-[0.7rem] font-bold text-humo hover:border-tinta hover:text-tinta"
              aria-label={`Ver detalle de ${linea.Description}`}
            >
              i
            </button>
          )}
          <button
            type="button"
            className={`!px-2.5 !py-1 !text-[0.65rem] ${sucio ? 'boton' : 'boton-borde'}`}
            onClick={onGuardar}
            disabled={!sucio || editando || otraOcupada || guardandoTodo}
          >
            {editando ? 'Guardando…' : sucio ? 'Guardar' : 'Sin cambios'}
          </button>
          <button
            type="button"
            className="boton-borde !px-2 !py-1 !text-[0.65rem] hover:!border-rojo hover:!bg-rojo hover:!text-papel"
            onClick={() => {
              if (!window.confirm(`Borrar la línea ${linea.LineNo} (${linea.Description})?`)) return
              void onBorrar()
            }}
            disabled={borrando || otraOcupada || guardandoTodo}
            title="Borrar la línea"
          >
            {borrando ? '…' : 'Borrar'}
          </button>
        </div>
      </td>
    </tr>
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

function parseNumero(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '' || t === '.' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
