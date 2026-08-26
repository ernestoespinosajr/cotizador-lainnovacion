'use client'

import { useMemo, useState } from 'react'
import type { Candidato, Confianza } from '@/lib/buscar'
import { cotizable } from '@/lib/producto'
import type { LineaResuelta } from '@/app/api/solicitud/route'
import EspinaConfianza from './EspinaConfianza'
import PanelVariantes, { Estado, Existencia } from './PanelVariantes'
import DetalleProducto from './DetalleProducto'
import { calcular, GRUPOS, ROTULO, type GrupoPrecio } from '@/lib/precios'
import { ESTADOS, pesos } from './ui'

export type LineaEstado = LineaResuelta & {
  elegido: Candidato | null
  incluida: boolean
  /**
   * Lista de precio elegida por el cotizador. Sin valor significa «la del
   * cliente»: así una línea nueva hereda el grupo aunque la ficha de NAV llegue
   * después, y no queda clavada al que hubiera en ese instante.
   */
  grupoPrecio?: GrupoPrecio
  /** Descuento adicional en porcentaje, sobre la lista elegida. */
  descuento?: number
}

export default function PasoProductos({
  lineas,
  setLineas,
  ia,
  clienteNo,
  grupoCliente,
}: {
  lineas: LineaEstado[]
  setLineas: (f: (prev: LineaEstado[]) => LineaEstado[]) => void
  ia: boolean
  // La búsqueda manual del panel ordena con el historial del cliente, igual que
  // la automática. Sin esto, abrir el panel reordenaría la lista sin motivo
  // visible.
  clienteNo: string
  /** Grupo de precio del cliente en el ERP. Es el que viene preseleccionado. */
  grupoCliente: GrupoPrecio
}) {
  const [filtro, setFiltro] = useState<Confianza | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<string | null>(null)
  const [agregando, setAgregando] = useState(false)

  const conteo = useMemo(() => {
    const c: Record<Confianza, number> = { exacto: 0, probable: 0, ambiguo: 0, sin_match: 0 }
    for (const l of lineas) c[l.resolucion.confianza]++
    return c
  }, [lineas])

  const visibles = filtro ? lineas.filter((l) => l.resolucion.confianza === filtro) : lineas
  const activa = lineas.find((l) => l.id === abierta) ?? null
  const conFicha = lineas.find((l) => l.id === detalle) ?? null

  const incluidas = lineas.filter((l) => l.incluida && l.elegido)

  const actualizar = (id: string, cambio: Partial<LineaEstado>) =>
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, ...cambio } : l)))

  /**
   * Solo se borran las líneas agregadas a mano. Las que vinieron en la
   * solicitud se desmarcan, no se eliminan: que el cliente haya pedido algo que
   * no le podemos vender es justamente lo que hay que poder explicarle después,
   * y borrar la fila destruye ese registro.
   */
  const quitar = (id: string) => setLineas((prev) => prev.filter((l) => l.id !== id))

  const agregar = (c: Candidato) => {
    setLineas((prev) => [
      ...prev,
      {
        id: `manual_${prev.length}_${Date.now().toString(36)}`,
        texto: c.description,
        cantidad: 1,
        unidad: null,
        codigoCliente: null,
        origen: { tipo: 'manual' },
        // Lo eligió una persona mirando la ficha: no hay nada que reconciliar.
        resolucion: { confianza: 'exacto', elegido: c, variantes: [], nota: null },
        elegido: c,
        incluida: true,
      },
    ])
    setAgregando(false)
  }

  return (
    <div>
      <div className="rounded-caja border-2 border-tinta p-5">
        <EspinaConfianza conteo={conteo} filtro={filtro} onFiltrar={setFiltro} />
        {!ia && (
          <p className="mt-4 rounded-control border-l-4 border-linea bg-bruma px-4 py-2.5 text-xs leading-relaxed text-humo">
            Sin <span className="cifra">OPENAI_API_KEY</span>, las líneas se resuelven solo por
            búsqueda de texto. El modelo es el que distingue casos como &quot;lavadora carga
            frontal&quot; de un repuesto que menciona la palabra lavadora.
          </p>
        )}
      </div>

      <div className="mt-5 overflow-hidden rounded-caja border border-linea">
        <div className="hidden grid-cols-[3px_auto_3.5rem_1fr_6rem_7.5rem_4.5rem_7rem_9.5rem] items-center gap-3 border-b-2 border-tinta bg-bruma py-2 pr-4 lg:grid">
          <span />
          <span />
          <span className="etiqueta">Cant.</span>
          <span className="etiqueta">Producto</span>
          <span className="etiqueta">Existencia</span>
          <span className="etiqueta">Lista de precio</span>
          <span className="etiqueta">Desc.</span>
          <span className="etiqueta text-right">Precio unitario</span>
          <span />
        </div>

        {visibles.map((l) => (
          <Fila
            key={l.id}
            linea={l}
            onAbrir={() => setAbierta(l.id)}
            onDetalle={() => setDetalle(l.id)}
            grupoCliente={grupoCliente}
            onCambiar={(c) => actualizar(l.id, c)}
            onQuitar={l.origen.tipo === 'manual' ? () => quitar(l.id) : undefined}
          />
        ))}

        {visibles.length === 0 && (
          <p className="p-6 text-sm text-humo">No hay líneas en este estado.</p>
        )}

        {/*
          Las cotizaciones se negocian hablando: el cliente llama, agrega algo o
          cambia de idea, y el cotizador tiene que poder sumarlo sin volver al
          paso 1 y perder todo lo ya revisado.

          Va al final de la lista, que es donde se agrega una fila en cualquier
          planilla. Se oculta al filtrar por estado, porque ahí el listado es un
          subconjunto y una fila nueva aparecería o no según el filtro activo.
        */}
        {!filtro && (
          <button
            type="button"
            onClick={() => setAgregando(true)}
            className="flex w-full items-center gap-2 border-t border-dashed border-linea px-4 py-3.5 text-left text-sm font-bold uppercase tracking-wide text-humo transition-colors hover:bg-bruma hover:text-tinta"
          >
            <span className="text-base leading-none">+</span>
            Agregar producto
          </button>
        )}
      </div>

      {/*
        Al pie va el conteo, no un total.

        El precio del espejo es la lista genérica y NAV aplica el grupo del
        cliente: para el ítem 001010 el espejo dice 5.995,00 y NAV devuelve
        5.000,00 a un cliente y 4.152,54 a otro. Un total con 31% de error es
        peor que ningún total, porque el vendedor se lo canta al cliente por
        teléfono. El monto real aparece en el paso 4, calculado por el ERP.
      */}
      <div className="sticky bottom-0 mt-5 flex items-center justify-between gap-4 rounded-caja border-2 border-tinta bg-papel px-4 py-2.5 md:px-5 md:py-4">
        <div>
          <div className="etiqueta hidden md:block">Seleccionadas</div>
          <p className="text-sm md:mt-0.5">
            <span className="cifra text-base font-bold md:text-lg">{incluidas.length}</span>
            <span className="text-humo"> de {lineas.length} líneas</span>
          </p>
        </div>
        <p className="max-w-xs text-right text-xs leading-snug text-humo">
          Los precios son de lista. El ERP aplica el grupo del cliente al emitir.
        </p>
      </div>

      {activa && (
        <PanelVariantes
          pedido={activa.texto}
          elegido={activa.elegido}
          variantes={
            activa.elegido
              ? [activa.elegido, ...activa.resolucion.variantes].filter(
                  (c, i, a) => a.findIndex((x) => x.code === c.code) === i,
                )
              : activa.resolucion.variantes
          }
          onElegir={(c) => {
            actualizar(activa.id, { elegido: c, incluida: true })
            setAbierta(null)
          }}
          onCerrar={() => setAbierta(null)}
          clienteNo={clienteNo}
          modo="variantes"
        />
      )}

      {conFicha?.elegido && (
        <DetalleProducto
          producto={conFicha.elegido}
          pedido={conFicha.origen.tipo === 'manual' ? undefined : conFicha.texto}
          grupoCliente={grupoCliente}
          onCerrar={() => setDetalle(null)}
        />
      )}

      {agregando && (
        <PanelVariantes
          pedido=""
          elegido={null}
          variantes={[]}
          onElegir={agregar}
          onCerrar={() => setAgregando(false)}
          clienteNo={clienteNo}
          modo="agregar"
        />
      )}
    </div>
  )
}

function Fila({
  linea,
  onAbrir,
  onDetalle,
  grupoCliente,
  onCambiar,
  onQuitar,
}: {
  linea: LineaEstado
  onAbrir: () => void
  onDetalle: () => void
  grupoCliente: GrupoPrecio
  onCambiar: (c: Partial<LineaEstado>) => void
  /** Solo llega en las líneas agregadas a mano. */
  onQuitar?: () => void
}) {
  const estado = ESTADOS[linea.resolucion.confianza]
  const p = linea.elegido
  const pideAtencion = linea.resolucion.confianza === 'ambiguo' || linea.resolucion.confianza === 'sin_match'
  const manual = linea.origen.tipo === 'manual'
  // NAV rechaza el documento entero si una línea lleva un producto bloqueado, así
  // que la casilla se deshabilita: no es una preferencia, es un impedimento.
  const bloqueado = !!p && !cotizable(p)
  // Sin elección explícita se usa el grupo del cliente: así la línea sigue al
  // cliente si su ficha llega después de resolverse la solicitud.
  const grupo = linea.grupoPrecio ?? grupoCliente
  const cobro = p ? calcular(p, grupoCliente, grupo, linea.descuento ?? 0) : null

  return (
    <div
      className={`grid grid-cols-[3px_auto_1fr] items-start gap-3 border-b border-linea py-3 pr-4 last:border-b-0 lg:grid-cols-[3px_auto_3.5rem_1fr_6rem_7.5rem_4.5rem_7rem_9.5rem] lg:items-center ${estado.fondo}`}
    >
      {/* Marca de margen: la señal de confianza que se ve sin abrir nada. Si una
          fila dudosa se viera igual que una resuelta, nadie la abriría. */}
      <span className={`h-full min-h-10 w-[3px] ${estado.marca}`} aria-hidden />

      <span className="pl-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[#e91f29]"
          checked={linea.incluida && !bloqueado}
          disabled={!p || bloqueado}
          onChange={(e) => onCambiar({ incluida: e.target.checked })}
          aria-label={`Incluir ${p?.description ?? linea.texto}`}
        />
      </span>

      <span className="hidden lg:block">
        <input
          type="number"
          min={1}
          value={linea.cantidad}
          onChange={(e) => onCambiar({ cantidad: Math.max(1, Number(e.target.value) || 1) })}
          className="cifra w-14 rounded-control border border-linea bg-papel px-1.5 py-1 text-sm focus:border-tinta focus:outline-none"
          aria-label="Cantidad"
        />
      </span>

      <span className="min-w-0">
        {p ? (
          <>
            <span className="block text-sm font-semibold leading-snug">{p.description}</span>
            <span className="mt-0.5 block text-xs text-humo">
              <span className="cifra">{p.code}</span>
              {/* Una línea agregada a mano no tiene un "pidió" que citar: no
                  vino en la solicitud, la sumó el cotizador hablando. */}
              {manual ? ' · agregado durante la conversación' : ` · pidió: “${linea.texto}”`}
              <span className="lg:hidden"> · {linea.cantidad} u.</span>
            </span>
          </>
        ) : (
          <>
            <span className="block text-sm font-semibold leading-snug">“{linea.texto}”</span>
            <span className={`mt-0.5 block text-xs font-semibold ${estado.texto}`}>
              {linea.resolucion.nota ?? 'Sin coincidencia en el catálogo'}
            </span>
          </>
        )}
        {p && (bloqueado || pideAtencion) && linea.resolucion.nota && (
          <span className={`mt-1 block text-xs font-semibold ${bloqueado ? 'text-rojo' : estado.texto}`}>
            {linea.resolucion.nota}
          </span>
        )}
      </span>

      {/* Solo lo que se compara de un vistazo entre filas. El estado se queda
          porque no es información adicional sino un impedimento: con un producto
          bloqueado el ERP rechaza el documento entero. El resto vive en la ficha. */}
      <span className="hidden text-xs lg:block">
        {p ? <Existencia inventario={p.inventory} /> : '—'}
        {p && p.itemStatus !== 'Activo' && (
          <span className="mt-0.5 block">
            <Estado estado={p.itemStatus} />
          </span>
        )}
      </span>

      <span className="hidden lg:block">
        {p ? (
          <select
            value={grupo}
            onChange={(e) => onCambiar({ grupoPrecio: e.target.value as GrupoPrecio })}
            className="w-full rounded-control border border-linea bg-papel px-1.5 py-1 text-xs focus:border-tinta focus:outline-none"
            aria-label={`Lista de precio de ${p.description}`}
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
      </span>

      <span className="hidden lg:block">
        {p ? (
          <span className="flex items-baseline gap-0.5">
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={linea.descuento ?? 0}
              onChange={(e) =>
                onCambiar({ descuento: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
              }
              className="cifra w-12 rounded-control border border-linea bg-papel px-1.5 py-1 text-sm focus:border-tinta focus:outline-none"
              aria-label={`Descuento de ${p.description}`}
            />
            <span className="text-xs text-humo">%</span>
          </span>
        ) : (
          <span className="text-xs text-humo">—</span>
        )}
      </span>

      <span className="hidden text-right lg:block">
        {cobro?.final != null ? (
          <>
            <span className="cifra block text-sm font-bold">{pesos.format(cobro.final)}</span>
            {/* El tachado solo aparece cuando de verdad hay rebaja: sin esto una
                línea sin descuento mostraría dos veces la misma cifra. */}
            {cobro.base != null && cobro.final < cobro.base - 0.005 && (
              <span className="cifra block text-xs text-humo line-through">
                {pesos.format(cobro.base)}
              </span>
            )}
            {cobro.noSePuedeSubir && (
              <span className="block text-xs font-semibold text-ambar">no sube</span>
            )}
          </>
        ) : (
          <span className="cifra text-sm text-humo">—</span>
        )}
      </span>

      <span className="hidden items-center justify-end gap-1.5 lg:flex">
        <button type="button" onClick={onAbrir} className="boton-borde !px-2.5 !py-1 !text-[0.65rem]">
          {p ? 'Variantes' : 'Buscar'}
        </button>
        {p && <Info onAbrir={onDetalle} descripcion={p.description} />}
        {/* El hueco se reserva siempre, tenga o no botón de quitar: si solo se
            ocupara en las líneas manuales, el botón Variantes de esas filas
            quedaría corrido y la columna se vería rota. */}
        <span className="flex w-6 shrink-0 justify-end">
          {onQuitar && <Quitar onQuitar={onQuitar} descripcion={p?.description ?? linea.texto} />}
        </span>
      </span>

      <span className="col-start-3 flex items-center gap-3 lg:hidden">
        <span className="cifra text-sm font-bold">
          {cobro?.final != null ? pesos.format(cobro.final) : '—'}
        </span>
        <button type="button" onClick={onAbrir} className="boton-borde !px-2 !py-0.5 !text-[0.65rem]">
          {p ? 'Variantes' : 'Buscar'}
        </button>
        {p && <Info onAbrir={onDetalle} descripcion={p.description} />}
        {onQuitar && <Quitar onQuitar={onQuitar} descripcion={p?.description ?? linea.texto} />}
      </span>
    </div>
  )
}

/** Misma caja de 22 px que el botón de quitar, para que la fila no se descuadre. */
function Info({ onAbrir, descripcion }: { onAbrir: () => void; descripcion: string }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      title="Ver detalle"
      aria-label={`Ver detalle de ${descripcion}`}
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-linea text-[0.7rem] font-bold text-humo hover:border-tinta hover:text-tinta"
    >
      i
    </button>
  )
}

/**
 * Cuadrado de 22 px, la misma altura que el botón de Variantes, para que se
 * lean como un par y no como un signo suelto encima del botón. La × va en SVG
 * y no como carácter: el glifo "×" de la tipografía se centra distinto en cada
 * sistema y ahí nacía buena parte del efecto de descuadre.
 */
function Quitar({ onQuitar, descripcion }: { onQuitar: () => void; descripcion: string }) {
  return (
    <button
      type="button"
      onClick={onQuitar}
      title="Quitar esta línea"
      aria-label={`Quitar ${descripcion}`}
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-control border border-transparent text-humo transition-colors hover:border-rojo hover:bg-rojo hover:text-papel"
    >
      <svg viewBox="0 0 10 10" aria-hidden className="h-2.5 w-2.5">
        <path
          d="M1 1 L9 9 M9 1 L1 9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </button>
  )
}
