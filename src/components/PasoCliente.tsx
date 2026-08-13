'use client'

import { useEffect, useState } from 'react'
import type { ClienteFicha } from '@/app/api/clientes/route'
import { Etiqueta, Proximamente } from './ui'

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
  return (
    <div className="max-w-3xl">
      <div className="overflow-hidden rounded-caja border-2 border-tinta">
        <div className="flex items-start justify-between gap-4 border-b-2 border-tinta bg-tinta px-5 py-4 text-papel">
          <div className="min-w-0">
            <div className="etiqueta !text-papel/55">Cliente {cliente.no}</div>
            {/* Dos líneas en vez de recortar: las razones sociales dominicanas
                son largas y "INNOVACION MAR…" no le sirve a nadie. */}
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
          <Dato rotulo="Estatus en el ERP">
            <span className={cliente.blocked > 0 ? 'font-bold text-ambar' : ''}>
              {cliente.bloqueoTexto}
            </span>
          </Dato>
        </dl>
      </div>

      <div className="mt-5">
        <Proximamente detalle="El ERP no expone hoy saldos ni cuentas por cobrar: el único indicador disponible es el bloqueo que se ve arriba, que dice si el cliente está frenado pero no cuánto debe ni desde cuándo. Falta el endpoint de estado de cuenta (docs/SOLICITUD_ENDPOINTS.md §3.1).">
          Balance, deuda vencida y crédito disponible
        </Proximamente>
      </div>
    </div>
  )
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="etiqueta">{rotulo}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}
