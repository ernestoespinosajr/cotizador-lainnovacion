/**
 * Capa de interpretación con Claude.
 *
 * Hace dos cosas, y ninguna es buscar: el modelo nunca ve el catálogo completo
 * —63.702 productos son del orden de 1.3 millones de tokens, no caben en el
 * prompt ni tendría sentido el costo—. La recuperación ocurre en local
 * (buscar.ts) y el modelo solo razona sobre la lista corta de candidatos.
 *
 *   1 · Extraer líneas de un texto sucio de correo o WhatsApp.
 *   2 · Reordenar los candidatos de cada línea y explicar la elección.
 *
 * Sin ANTHROPIC_API_KEY todo cae al camino determinista: el cotizador funciona
 * igual, con parseo por reglas y ranking por FTS.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { Candidato } from './buscar.ts'
import type { LineaSolicitud } from './parseo.ts'
import { parsearTexto } from './parseo.ts'

const MODELO = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'

export const iaDisponible = () => Boolean(process.env.ANTHROPIC_API_KEY)

function cliente() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

// ── 1 · Extracción de líneas ────────────────────────────────────────────────

const HERRAMIENTA_LINEAS = {
  name: 'registrar_lineas',
  description: 'Registra las líneas de producto encontradas en la solicitud.',
  input_schema: {
    type: 'object' as const,
    properties: {
      lineas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'El producto pedido, sin la cantidad.' },
            cantidad: { type: 'number' },
            unidad: { type: ['string', 'null'] },
            lineaOriginal: { type: 'number', description: 'Número de línea del texto de origen, 1-based.' },
          },
          required: ['texto', 'cantidad', 'lineaOriginal'],
        },
      },
    },
    required: ['lineas'],
  },
}

const PROMPT_EXTRACCION = `Eres el asistente de cotizaciones de La Innovación, una tienda por departamentos dominicana.

Recibes el texto crudo de un correo o un WhatsApp de un cliente que pide una cotización. Extrae las líneas de producto.

Reglas:
- Una entrada por producto pedido. Si el cliente pide "3 neveras y 2 estufas", son dos entradas.
- "texto" es solo el producto, sin la cantidad y sin cortesías. Conserva marca, modelo, medidas y color: son lo que permite encontrarlo.
- Si no se indica cantidad, pon 1.
- Ignora saludos, despedidas, firmas, direcciones, condiciones de pago y todo lo que no sea un producto.
- No inventes productos que no estén en el texto. Si el mensaje no pide nada concreto, devuelve una lista vacía.
- El texto viene con cada línea numerada como "N| contenido". Usa esa N en "lineaOriginal".`

export async function extraerLineas(texto: string): Promise<LineaSolicitud[]> {
  const c = cliente()
  if (!c) return parsearTexto(texto)

  const numerado = texto
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n')

  try {
    const r = await c.messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: PROMPT_EXTRACCION,
      tools: [HERRAMIENTA_LINEAS],
      tool_choice: { type: 'tool', name: 'registrar_lineas' },
      messages: [{ role: 'user', content: numerado }],
    })

    const uso = r.content.find((b) => b.type === 'tool_use')
    if (!uso || uso.type !== 'tool_use') return parsearTexto(texto)

    const { lineas } = uso.input as {
      lineas: { texto: string; cantidad: number; unidad?: string | null; lineaOriginal: number }[]
    }

    return lineas
      .filter((l) => l.texto?.trim().length >= 3)
      .map((l, i) => ({
        id: `ia${i}_${Date.now().toString(36)}`,
        texto: l.texto.trim(),
        cantidad: l.cantidad > 0 ? l.cantidad : 1,
        unidad: l.unidad ?? null,
        codigoCliente: null,
        origen: { tipo: 'texto' as const, linea: l.lineaOriginal ?? i + 1 },
      }))
  } catch (e) {
    console.error('[ia] extracción falló, se usa el parseo determinista:', e)
    return parsearTexto(texto)
  }
}

// ── 2 · Reordenamiento de candidatos ────────────────────────────────────────

export type FalloIA = {
  id: string
  code: string | null
  confianza: 'exacto' | 'probable' | 'ambiguo' | 'sin_match'
  motivo: string
}

const HERRAMIENTA_FALLOS = {
  name: 'registrar_decisiones',
  description: 'Registra, para cada línea, el producto elegido y la confianza.',
  input_schema: {
    type: 'object' as const,
    properties: {
      decisiones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: ['string', 'null'], description: 'Código del producto elegido, o null.' },
            confianza: { type: 'string', enum: ['exacto', 'probable', 'ambiguo', 'sin_match'] },
            motivo: { type: 'string', description: 'Una frase corta, en español, para el cotizador.' },
          },
          required: ['id', 'code', 'confianza', 'motivo'],
        },
      },
    },
    required: ['decisiones'],
  },
}

const PROMPT_RANKING = `Eres el asistente de cotizaciones de La Innovación. Para cada línea pedida por un cliente recibes una lista corta de candidatos del catálogo, ya filtrada por búsqueda de texto.

Elige el producto correcto de cada lista y clasifica tu confianza:
- "exacto": el candidato es sin duda lo que pidieron (marca, modelo y medidas coinciden).
- "probable": es casi seguro el correcto y ningún otro compite de cerca.
- "ambiguo": hay varios candidatos plausibles y la diferencia importa. Elige el mejor igual, pero marca ambiguo.
- "sin_match": ningún candidato sirve. Pon code en null.

Ten en cuenta:
- Prefiere productos "Activo" y con existencia sobre "Descatalogado" o "Bloqueado", pero solo si de verdad corresponden a lo pedido. Nunca elijas un producto equivocado por tener stock.
- Las medidas y capacidades tienen que coincidir: una nevera de 18 pies no sustituye a una de 12.
- El "motivo" es para que un vendedor decida rápido. Una frase. Si es "sin_match", explica por qué no hay nada.
- No inventes códigos. Solo puedes usar los códigos que aparecen en los candidatos.`

/** Un lote chico mantiene el prompt manejable y permite paralelizar. */
const POR_LOTE = 8

export async function reordenar(
  entradas: { id: string; texto: string; candidatos: Candidato[] }[],
): Promise<Map<string, FalloIA>> {
  const salida = new Map<string, FalloIA>()
  const c = cliente()
  if (!c || entradas.length === 0) return salida

  const lotes: (typeof entradas)[] = []
  for (let i = 0; i < entradas.length; i += POR_LOTE) lotes.push(entradas.slice(i, i + POR_LOTE))

  // Hasta 4 lotes en vuelo: con 100 líneas son 13 llamadas y el total baja de
  // minutos a decenas de segundos, sin castigar el límite de tasa.
  const EN_VUELO = 4
  for (let i = 0; i < lotes.length; i += EN_VUELO) {
    const tanda = lotes.slice(i, i + EN_VUELO)
    const rs = await Promise.allSettled(tanda.map((lote) => procesarLote(c, lote)))
    for (const r of rs) {
      if (r.status === 'fulfilled') for (const d of r.value) salida.set(d.id, d)
      else console.error('[ia] lote de ranking falló:', r.reason)
    }
  }

  return salida
}

async function procesarLote(
  c: Anthropic,
  lote: { id: string; texto: string; candidatos: Candidato[] }[],
): Promise<FalloIA[]> {
  const payload = lote.map((l) => ({
    id: l.id,
    pedido: l.texto,
    candidatos: l.candidatos.slice(0, 12).map((k) => ({
      code: k.code,
      descripcion: [k.description, k.description2].filter(Boolean).join(' '),
      estado: k.itemStatus,
      existencia: k.inventory,
      precio: k.unitPrice,
    })),
  }))

  const r = await c.messages.create({
    model: MODELO,
    max_tokens: 4000,
    system: PROMPT_RANKING,
    tools: [HERRAMIENTA_FALLOS],
    tool_choice: { type: 'tool', name: 'registrar_decisiones' },
    messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }],
  })

  const uso = r.content.find((b) => b.type === 'tool_use')
  if (!uso || uso.type !== 'tool_use') return []

  const { decisiones } = uso.input as { decisiones: FalloIA[] }
  const validos = new Set(lote.flatMap((l) => l.candidatos.map((k) => k.code)))

  // El modelo no debería devolver un código que no estaba entre los candidatos,
  // pero si pasa se descarta en vez de arrastrar un producto inventado hasta la
  // cotización.
  return decisiones.filter((d) => d.code === null || validos.has(d.code))
}
