'use client'

import { use } from 'react'
import EditorCotizacion from '@/components/EditorCotizacion'

export default function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = use(params)
  return <EditorCotizacion quoteNo={decodeURIComponent(no)} />
}
