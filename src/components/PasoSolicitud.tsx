'use client'

import { useRef, useState } from 'react'
import { Etiqueta } from './ui'

const EJEMPLO = `Buenos días,

Favor cotizarme lo siguiente para la sucursal de Santiago:

- 12 abanicos de techo KDK
- 3 neveras de dos puertas
- 8 microondas 1.1 pies
- 2 extractores de grasa de 90cm
- 5 licuadoras Oster de vidrio

Quedo atento. Gracias.`

export default function PasoSolicitud({
  onAnalizar,
  cargando,
  error,
}: {
  onAnalizar: (entrada: { texto?: string; archivo?: File }) => void
  cargando: boolean
  error: string | null
}) {
  const [texto, setTexto] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [sobre, setSobre] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const enviar = () => {
    if (archivo) onAnalizar({ archivo })
    else if (texto.trim()) onAnalizar({ texto })
  }

  const tomar = (f: File | null | undefined) => {
    if (!f) return
    setArchivo(f)
    setTexto('')
  }

  return (
    // `items-start`: sin esto el grid iguala la altura de las dos columnas, así
    // que al estirar el textarea del correo crecía también el área del Excel.
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
      <div>
        <Etiqueta>Pega el correo o el WhatsApp</Etiqueta>
        <textarea
          className="campo mt-2 min-h-64 resize-y font-[inherit] leading-relaxed"
          placeholder="Pega aquí el mensaje del cliente, tal como llegó."
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            if (e.target.value) setArchivo(null)
          }}
          disabled={cargando}
        />
        <button
          type="button"
          onClick={() => {
            setTexto(EJEMPLO)
            setArchivo(null)
          }}
          className="mt-2 text-xs font-semibold text-humo underline underline-offset-4 hover:text-tinta"
        >
          Usar un ejemplo
        </button>
      </div>

      <div className="flex flex-col">
        <Etiqueta>O sube el Excel que mandó</Etiqueta>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setSobre(true)
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={(e) => {
            e.preventDefault()
            setSobre(false)
            tomar(e.dataTransfer.files?.[0])
          }}
          className={`mt-2 flex min-h-64 flex-col items-center justify-center rounded-caja border-2 border-dashed p-6 text-center transition-colors ${
            sobre ? 'border-rojo bg-bruma' : 'border-linea'
          }`}
        >
          {archivo ? (
            <>
              <p className="text-sm font-bold">{archivo.name}</p>
              <p className="mt-1 text-xs text-humo">
                {(archivo.size / 1024).toFixed(0)} KB · listo para analizar
              </p>
              <button
                type="button"
                onClick={() => setArchivo(null)}
                className="mt-3 text-xs font-semibold text-humo underline underline-offset-4 hover:text-tinta"
              >
                Quitar
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">Arrastra el archivo aquí</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-humo">
                .xlsx o .xls. Se detectan solas las columnas de descripción, cantidad y código,
                aunque el encabezado no esté en la primera fila.
              </p>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="boton-borde mt-4"
              >
                Elegir archivo
              </button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            onChange={(e) => tomar(e.target.files?.[0])}
          />
        </div>
      </div>

      <div className="lg:col-span-2">
        {error && (
          <p className="mb-3 rounded-control border-l-4 border-rojo bg-bruma px-4 py-3 text-sm font-medium">
            {error}
          </p>
        )}
        <button
          type="button"
          className="boton"
          onClick={enviar}
          disabled={cargando || (!texto.trim() && !archivo)}
        >
          {cargando ? 'Analizando…' : 'Analizar solicitud'}
        </button>
      </div>
    </div>
  )
}
