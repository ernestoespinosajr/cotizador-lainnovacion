import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // `node:sqlite` y `exceljs` solo deben resolverse en el servidor.
  serverExternalPackages: ['exceljs'],
}

export default nextConfig
