'use client'

import { useEffect, useState } from 'react'
import type { ClienteFicha } from '@/app/api/clientes/route'
import type { SituacionCliente } from '@/app/api/clientes/[no]/route'
import { Etiqueta, pesos } from './ui'

export default function PasoCliente({
  elegido,
  onElegir,
}: {
  elegido: ClienteFicha | null
  onElegir: (c: ClienteFicha | null) => void
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

  if (elegido) return <Ficha cliente={elegido} onCambiar={() => onElegir(null)} />

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

function Ficha({ cliente, onCambiar }: { cliente: ClienteFicha; onCambiar: () => void }) {
  const [nav, setNav] = useState<SituacionCliente | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        if (r.ok) setNav(d.cliente)
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
    </div>
  )
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
