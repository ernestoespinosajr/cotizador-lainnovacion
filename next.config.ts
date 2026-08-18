import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Paquetes que deben resolverse en Node y no pasar por el empaquetado.
   *
   * `pdfkit` lee las métricas de fuente (`Helvetica.afm`) desde su propia
   * carpeta en tiempo de ejecución; empaquetado, la ruta se rompe y falla con
   * ENOENT solo al ejecutarse dentro de Next —por eso pasa la prueba con `node`
   * directo y falla en la ruta del API—.
   */
  serverExternalPackages: ['exceljs', 'pdfkit'],
}

export default nextConfig
