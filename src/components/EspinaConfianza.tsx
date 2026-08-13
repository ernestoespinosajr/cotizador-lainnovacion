'use client'

import type { Confianza } from '@/lib/buscar'
import { ESTADOS } from './ui'

const ORDEN: Confianza[] = ['exacto', 'probable', 'ambiguo', 'sin_match']

/**
 * La forma del lote de un vistazo, y a la vez el filtro.
 *
 * Con 100 líneas lo primero que necesita saber el cotizador no es qué dice la
 * fila 1, sino cuánto trabajo real tiene por delante. La barra es proporcional,
 * así que "12 a revisar de 100" se ve antes de leer una sola fila; y como cada
 * tramo filtra la tabla, la propia medición es la navegación. No hace falta un
 * panel de filtros aparte.
 */
export default function EspinaConfianza({
  conteo,
  filtro,
  onFiltrar,
}: {
  conteo: Record<Confianza, number>
  filtro: Confianza | null
  onFiltrar: (c: Confianza | null) => void
}) {
  const total = ORDEN.reduce((s, k) => s + conteo[k], 0)
  if (total === 0) return null

  const pendientes = conteo.ambiguo + conteo.sin_match

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="etiqueta">Estado del lote</div>
        <div className="text-sm">
          {pendientes === 0 ? (
            <span className="font-semibold">Nada pendiente de revisar.</span>
          ) : (
            <>
              <span className="cifra font-bold">{pendientes}</span>
              <span className="text-humo"> de {total} líneas necesitan tu decisión</span>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full border border-tinta" role="presentation">
        {ORDEN.map((k) =>
          conteo[k] > 0 ? (
            <div
              key={k}
              className={`${ESTADOS[k].marca} ${k === 'probable' ? 'opacity-40' : ''} transition-opacity`}
              style={{ width: `${(conteo[k] / total) * 100}%` }}
              title={`${conteo[k]} ${ESTADOS[k].corto}`}
            />
          ) : null,
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {ORDEN.map((k) => {
          const activo = filtro === k
          return (
            <button
              key={k}
              type="button"
              disabled={conteo[k] === 0}
              onClick={() => onFiltrar(activo ? null : k)}
              aria-pressed={activo}
              className={`flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                activo ? 'border-tinta bg-tinta text-papel' : 'border-linea hover:border-tinta'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-[2px] ${ESTADOS[k].marca} ${k === 'probable' ? 'opacity-40' : ''}`}
              />
              <span className="cifra">{conteo[k]}</span>
              <span className="uppercase tracking-wide">{ESTADOS[k].corto}</span>
            </button>
          )
        })}
        {filtro && (
          <button type="button" onClick={() => onFiltrar(null)} className="px-2 text-xs font-semibold text-humo underline underline-offset-4 hover:text-tinta">
            Ver todas
          </button>
        )}
      </div>
    </div>
  )
}
