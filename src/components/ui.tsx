import type { Confianza } from '@/lib/buscar'

export const pesos = new Intl.NumberFormat('es-DO', {
  style: 'currency',
  currency: 'DOP',
  minimumFractionDigits: 2,
})

export const ESTADOS: Record<
  Confianza,
  { rotulo: string; corto: string; marca: string; fondo: string; texto: string }
> = {
  exacto: {
    rotulo: 'Listo',
    corto: 'listos',
    marca: 'bg-tinta',
    fondo: 'bg-papel',
    texto: 'text-tinta',
  },
  probable: {
    rotulo: 'Probable',
    corto: 'probables',
    marca: 'bg-humo',
    fondo: 'bg-papel',
    texto: 'text-humo',
  },
  ambiguo: {
    rotulo: 'Revisar',
    corto: 'a revisar',
    marca: 'bg-ambar',
    // Sin tinte de fondo: cuando la mitad del lote queda dudosa, teñir la fila
    // pinta la pantalla entera y el color deja de señalar nada. La marca del
    // margen y la nota en ámbar alcanzan para reclamar la atención.
    fondo: 'bg-papel',
    texto: 'text-ambar',
  },
  sin_match: {
    rotulo: 'Sin match',
    corto: 'sin match',
    marca: 'bg-rojo',
    fondo: 'bg-papel',
    texto: 'text-rojo',
  },
}

export function Etiqueta({ children }: { children: React.ReactNode }) {
  return <div className="etiqueta">{children}</div>
}

const porcentaje = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 2 })

/**
 * Cuánto sube o baja el precio respecto al que el cliente tiene por defecto.
 *
 * Lo pidió La Innovación para validar de un vistazo el efecto de cambiar la
 * lista o poner un descuento. Sin cambio no se muestra nada: una línea igual al
 * precio del cliente no tiene nada que avisar.
 */
export function Variacion({ variacion }: { variacion: number }) {
  if (variacion === 0) return null
  const sube = variacion > 0
  return (
    <span className={`block text-xs font-semibold ${sube ? 'text-ambar' : 'text-humo'}`}>
      {sube ? '↑ sube' : '↓ baja'} <span className="cifra">{porcentaje.format(Math.abs(variacion))}%</span>
    </span>
  )
}
