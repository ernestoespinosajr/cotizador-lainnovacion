import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cotizador · La Innovación',
  description: 'Convierte solicitudes de correo, WhatsApp y Excel en cotizaciones.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
