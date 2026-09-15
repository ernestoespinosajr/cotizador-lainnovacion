'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Punto de entrada para abrir una cotización existente por su número.
 *
 * Es intencionalmente austero: sin buscador contra NAV (no hay servicio de
 * listado) y sin memoria local de cotizaciones recientes. Sirve como "escribe
 * el número, presiona Abrir" cuando el vendedor viene con el papel en la mano.
 */
export default function Page() {
  const router = useRouter()
  const [no, setNo] = useState('')

  const abrir = (e: React.FormEvent) => {
    e.preventDefault()
    const v = no.trim()
    if (v) router.push(`/cotizacion/${encodeURIComponent(v)}`)
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <p className="etiqueta">Cotización existente</p>
      <h1 className="titulo mt-1 text-2xl">Abrir por número</h1>
      <p className="mt-2 text-sm text-humo">
        El número que devolvió el ERP al emitir. Se abre la vista de edición para agregar,
        modificar o borrar líneas mientras la cotización siga abierta.
      </p>

      <form onSubmit={abrir} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className="etiqueta">N°</span>
          <input
            autoFocus
            value={no}
            onChange={(e) => setNo(e.target.value)}
            placeholder="p.ej. COT-12345"
            className="cifra mt-1 w-full rounded-control border border-linea bg-papel px-3 py-2 text-sm focus:border-tinta focus:outline-none"
          />
        </label>
        <button type="submit" className="boton" disabled={!no.trim()}>
          Abrir
        </button>
      </form>

      <Link href="/" className="mt-6 inline-block text-xs text-humo hover:text-tinta">
        ← Volver al cotizador
      </Link>
    </div>
  )
}
