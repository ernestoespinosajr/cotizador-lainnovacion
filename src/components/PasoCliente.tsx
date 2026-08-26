'use client'

import { useEffect, useState } from 'react'
import type { ClienteFicha } from '@/app/api/clientes/route'
import type { SituacionCliente } from '@/app/api/clientes/[no]/route'
import type { ResumenHistorial } from '@/app/api/clientes/[no]/historial/route'
import { Etiqueta, pesos } from './ui'

export default function PasoCliente({
  elegido,
  onElegir,
  onSituacion,
}: {
  elegido: ClienteFicha | null
  onElegir: (c: ClienteFicha | null) => void
  /** La ficha de NAV se consulta acá; el paso 3 la necesita para los precios. */
  onSituacion: (s: SituacionCliente | null) => void
}) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<ClienteFicha[]>([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) {
      setLista([])
      return
    }
    setBuscando(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clientes?q=${encodeURIComponent(q)}`)
        const d = await r.json()
        setLista(d.clientes ?? [])
      } finally {
        setBuscando(false)
      }
    }, 160)
    return () => clearTimeout(t)
  }, [q])

  if (elegido)
    return <Ficha cliente={elegido} onCambiar={() => onElegir(null)} onSituacion={onSituacion} />

  return (
    <div className="max-w-3xl">
      <Etiqueta>Buscar cliente</Etiqueta>
      <input
        className="campo mt-2"
        placeholder="Nombre, RNC, código o contacto"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
        autoFocus
      />
      <p className="mt-1.5 text-xs text-humo">
        {buscando ? 'Buscando…' : '12.317 clientes. Puedes escribir el RNC directo.'}
      </p>

      <div className="mt-4 divide-y divide-linea border-y border-linea">
        {lista.map((c) => (
          <button
            key={c.no}
            type="button"
            onClick={() => onElegir(c)}
            className="flex w-full items-center gap-4 rounded-control px-2 py-3 text-left hover:bg-bruma"
          >
            <span className="cifra w-16 shrink-0 text-xs text-humo">{c.no}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              <span className="block truncate text-xs text-humo">
                {[c.vatRegistrationNo && `RNC ${c.vatRegistrationNo}`, c.contacto]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {c.blocked > 0 && (
              <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-ambar">
                {c.bloqueoTexto}
              </span>
            )}
          </button>
        ))}
      </div>

      {q.trim().length >= 2 && !buscando && lista.length === 0 && (
        <p className="mt-4 text-sm text-humo">Ningún cliente coincide con esa búsqueda.</p>
      )}
    </div>
  )
}

function Ficha({
  cliente,
  onCambiar,
  onSituacion,
}: {
  cliente: ClienteFicha
  onCambiar: () => void
  onSituacion: (s: SituacionCliente | null) => void
}) {
  const [nav, setNav] = useState<SituacionCliente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hist, setHist] = useState<ResumenHistorial | null>(null)

  // En paralelo con la consulta a NAV y no después: son servicios distintos, y
  // encadenarlas sumaría las dos esperas sin ninguna razón.
  useEffect(() => {
    let vivo = true
    setHist(null)
    fetch(`/api/clientes/${encodeURIComponent(cliente.no)}/historial`)
      .then((r) => r.json())
      .then((d: ResumenHistorial) => vivo && setHist(d))
      // La ruta ya devuelve vacío ante cualquier fallo del ERP; esto solo cubre
      // que se caiga la red del navegador.
      .catch(() => vivo && setHist(null))
    return () => {
      vivo = false
    }
  }, [cliente.no])

  // La situación financiera se consulta al elegir el cliente, no al buscar: esta
  // llamada llega hasta NAV y tarda ~1,5 s, mientras la búsqueda es local.
  useEffect(() => {
    let vivo = true
    setNav(null)
    setError(null)
    fetch(`/api/clientes/${encodeURIComponent(cliente.no)}`)
      .then(async (r) => {
        const d = await r.json()
        if (!vivo) return
        if (r.ok) {
          setNav(d.cliente)
          onSituacion(d.cliente)
        }
        else setError(d.error ?? 'No se pudo consultar la situación del cliente.')
      })
      .catch((e) => vivo && setError(String(e)))
    return () => {
      vivo = false
    }
  }, [cliente.no])

  return (
    <div className="max-w-3xl">
      <div className="overflow-hidden rounded-caja border-2 border-tinta">
        <div className="flex items-start justify-between gap-4 border-b-2 border-tinta bg-tinta px-5 py-4 text-papel">
          <div className="min-w-0">
            <div className="etiqueta !text-papel/55">Cliente {cliente.no}</div>
            <h2 className="titulo mt-1 line-clamp-3 text-lg leading-tight sm:line-clamp-2 sm:text-xl">
              {cliente.name}
            </h2>
          </div>
          <button type="button" onClick={onCambiar} className="shrink-0 rounded-control border border-papel/35 px-2.5 py-1 text-xs font-bold uppercase tracking-wide hover:bg-papel hover:text-tinta">
            Cambiar
          </button>
        </div>

        <dl className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
          <Dato rotulo="RNC">{cliente.vatRegistrationNo || '—'}</Dato>
          <Dato rotulo="Contacto">{cliente.contacto || '—'}</Dato>
          <Dato rotulo="Teléfonos">{cliente.telefonos.join(' · ') || '—'}</Dato>
          <Dato rotulo="Correo">{cliente.correos.join(' · ') || '—'}</Dato>
          <Dato rotulo="Condición de pago">
            {nav ? nav.condicionPago || '—' : <Cargando />}
          </Dato>
          <Dato rotulo="Grupo de precio">{nav ? nav.grupoPrecio || '—' : <Cargando />}</Dato>
        </dl>
      </div>

      {/* Situación financiera: es lo que decide si conviene cotizarle. */}
      <div className="mt-5 rounded-caja border border-linea p-5">
        <Etiqueta>Situación en el ERP</Etiqueta>

        {error && (
          <p className="mt-3 rounded-control border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">
            {error}
          </p>
        )}

        {!nav && !error && <p className="mt-3 text-sm text-humo">Consultando el ERP…</p>}

        {nav && (
          <>
            <dl className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-3">
              <Dato rotulo="Límite de crédito">
                <span className="cifra">{pesos.format(nav.limite)}</span>
              </Dato>
              <Dato rotulo={nav.balance < 0 ? 'Saldo a favor' : 'Balance'}>
                <span className={`cifra ${nav.debe ? 'font-bold text-ambar' : ''}`}>
                  {pesos.format(Math.abs(nav.balance))}
                </span>
              </Dato>
              <Dato rotulo="Crédito disponible">
                <span className="cifra font-bold">
                  {nav.disponible == null ? 'sin límite' : pesos.format(nav.disponible)}
                </span>
              </Dato>
            </dl>

            {/* Un bloqueo de facturación no es un aviso: NAV rechaza la cotización.
                Conviene saberlo antes de armar cien líneas, no al emitir. */}
            {nav.impideCotizar ? (
              <p className="mt-4 rounded-control border-l-4 border-rojo bg-bruma px-4 py-3 text-sm">
                <span className="font-bold">
                  Este cliente está bloqueado para {nav.bloqueo === 'All' ? 'todo' : 'facturación'}.
                </span>{' '}
                El ERP va a rechazar la cotización. Hay que liberarlo antes de emitirla.
              </p>
            ) : nav.bloqueo ? (
              <p className="mt-4 text-sm text-ambar">
                <span className="font-semibold">Bloqueado para envío.</span> Se puede cotizar, pero
                no despachar.
              </p>
            ) : null}
          </>
        )}
      </div>

      <Historial resumen={hist} />
    </div>
  )
}

/**
 * Documentos anteriores del cliente.
 *
 * Dice «cotizado» y no «comprado» a propósito: lo que devuelve el ERP es casi
 * todo cotizaciones y no consta si se cerraron. Prometer una compra que quizá
 * no ocurrió le haría creer al vendedor que conoce al cliente mejor de lo que
 * lo conoce.
 */
function Historial({ resumen }: { resumen: ResumenHistorial | null }) {
  const [todo, setTodo] = useState(false)
  if (!resumen || resumen.documentos.length === 0) return null

  const visibles = todo ? resumen.documentos : resumen.documentos.slice(0, 4)

  return (
    <div className="mt-5 rounded-caja border border-linea p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Etiqueta>Ya se le ha cotizado</Etiqueta>
        <span className="text-xs text-humo">
          <span className="cifra">{resumen.totalDocumentos}</span> documentos ·{' '}
          <span className="cifra">{resumen.productosDistintos}</span> productos distintos
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {visibles.map((d) => (
          <div key={d.no} className="rounded-control border border-linea bg-bruma p-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="cifra text-xs text-humo">{d.no}</span>
              <span className="cifra text-xs text-humo">{fecha(d.fecha)}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {d.lineas.map((l) => (
                <li key={l.code} className="flex gap-2 text-xs leading-snug">
                  <span className="cifra shrink-0 text-humo">{l.cantidad}×</span>
                  <span className="min-w-0 flex-1 truncate" title={l.descripcion}>
                    {l.descripcion}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-linea pt-2">
              {d.restantes > 0 ? (
                <span className="text-xs text-humo">y {d.restantes} más</span>
              ) : (
                <span />
              )}
              <span className="cifra text-xs font-semibold">{pesos.format(d.monto)}</span>
            </div>
          </div>
        ))}
      </div>

      {resumen.documentos.length > 4 && (
        <button
          type="button"
          onClick={() => setTodo((v) => !v)}
          className="mt-3 rounded-control border border-linea px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-bruma"
        >
          {todo ? 'Ver menos' : `Ver los ${resumen.documentos.length}`}
        </button>
      )}
    </div>
  )
}

/** Sin hora: la hora del ERP viene en UTC y aquí solo importa el día. */
function fecha(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function Cargando() {
  return <span className="text-humo">…</span>
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="etiqueta">{rotulo}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}
