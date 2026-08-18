/**
 * Capa de interpretación con ChatGPT (OpenAI).
 *
 * Hace dos cosas, y ninguna es buscar: el modelo nunca ve el catálogo completo
 * —63.702 productos son del orden de 1,3 millones de tokens, no caben en el
 * prompt ni tendría sentido el costo—. La recuperación ocurre en local
 * (buscar.ts) y el modelo solo razona sobre la lista corta de candidatos.
 *
 *   1 · Extraer líneas de un texto sucio de correo o WhatsApp.
 *   2 · Reordenar los candidatos de cada línea y explicar la elección.
 *
 * Sin OPENAI_API_KEY todo cae al camino determinista: el cotizador funciona
 * igual, con parseo por reglas y ranking por FTS.
 */
import OpenAI from 'openai'
import type { Candidato } from './buscar.ts'
import type { LineaSolicitud } from './parseo.ts'
import { parsearTexto } from './parseo.ts'

/**
 * Cambiar de modelo es una variable de entorno. No se fija uno más nuevo por
 * defecto porque no todas las cuentas tienen acceso a los mismos, y este trabajo
 * —extraer y reordenar sobre listas cortas— no necesita el modelo más grande.
 */
const MODELO = process.env.OPENAI_MODEL ?? 'gpt-4.1'

export const iaDisponible = () => Boolean(process.env.OPENAI_API_KEY)

function cliente() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

/**
 * Llama al modelo exigiendo una estructura exacta.
 *
 * `strict: true` obliga a que la respuesta valide contra el esquema, así que no
 * hace falta parsear a mano ni defenderse de JSON mal formado. El esquema exige
 * `additionalProperties: false` y que toda propiedad esté en `required`.
 *
 * No se fija `temperature` ni límite de tokens a propósito: varios modelos
 * recientes rechazan esos parámetros y el esquema ya acota la salida.
 */
async function pedirJson<T>(
  c: OpenAI,
  nombre: string,
  esquema: Record<string, unknown>,
  system: string,
  user: string,
): Promise<T | null> {
  const r = await c.chat.completions.create({
    model: MODELO,
    response_format: {
      type: 'json_schema',
      json_schema: { name: nombre, strict: true, schema: esquema },
    },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })

  const txt = r.choices[0]?.message?.content
  if (!txt) return null
  // El modelo puede negarse; en ese caso `refusal` viene lleno y `content` vacío.
  return JSON.parse(txt) as T
}

// ── 1 · Extracción de líneas ────────────────────────────────────────────────

const ESQUEMA_LINEAS = {
  type: 'object',
  properties: {
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'El producto pedido, sin la cantidad, tal como lo escribió el cliente.' },
          busqueda: {
            type: 'string',
            description:
              'El mismo producto con la ortografía corregida y el término que usaría un catálogo dominicano.',
          },
          cantidad: { type: 'number' },
          unidad: { type: ['string', 'null'] },
          lineaOriginal: { type: 'integer', description: 'Número de línea del texto de origen.' },
        },
        required: ['texto', 'busqueda', 'cantidad', 'unidad', 'lineaOriginal'],
        additionalProperties: false,
      },
    },
  },
  required: ['lineas'],
  additionalProperties: false,
} as const

const PROMPT_EXTRACCION = `Eres el asistente de cotizaciones de La Innovación, una tienda por departamentos dominicana.

Recibes el texto crudo de un correo o un WhatsApp de un cliente que pide una cotización. Extrae las líneas de producto.

Reglas:
- Una entrada por producto pedido. Si el cliente pide "3 neveras y 2 estufas", son dos entradas.
- "texto" es solo el producto, sin la cantidad y sin cortesías. Conserva marca, modelo, medidas y color: son lo que permite encontrarlo.
- Si no se indica cantidad, pon 1.
- Ignora saludos, despedidas, firmas, direcciones, condiciones de pago y todo lo que no sea un producto.
- No inventes productos que no estén en el texto. Si el mensaje no pide nada concreto, devuelve una lista vacía.
- El texto viene con cada línea numerada como "N| contenido". Usa esa N en "lineaOriginal".
- Responde siempre en español dominicano, con tuteo.

Sobre "busqueda": es lo que se va a buscar en el catálogo del ERP, y es distinto de "texto".
- Corrige las faltas: "nebera" es nevera, "microhondas" es microondas, "labadora" es lavadora, "ornillas" es hornillas.
- Usa la palabra del catálogo, no la del cliente: en República Dominicana se dice "chapa" pero el catálogo dice CERRADURA; "refrigerador" es NEVERA; "greca" es GRECA; "zafacón" es ZAFACON; "arrocera" es OLLA ARROCERA.
- Deja el singular y quita muletillas, pero conserva marca, modelo y medidas.
- Si el término del cliente ya es el correcto, repítelo igual.`

export async function extraerLineas(texto: string): Promise<LineaSolicitud[]> {
  const c = cliente()
  if (!c) return parsearTexto(texto)

  const numerado = texto
    .split(/\r?\n/)
    .map((l, i) => `${i + 1}| ${l}`)
    .join('\n')

  try {
    const d = await pedirJson<{
      lineas: {
        texto: string
        busqueda: string
        cantidad: number
        unidad: string | null
        lineaOriginal: number
      }[]
    }>(c, 'lineas_solicitud', ESQUEMA_LINEAS, PROMPT_EXTRACCION, numerado)

    if (!d?.lineas) return parsearTexto(texto)

    return d.lineas
      .filter((l) => l.texto?.trim().length >= 3)
      .map((l, i) => ({
        id: `ia${i}_${Date.now().toString(36)}`,
        texto: l.texto.trim(),
        busqueda: l.busqueda?.trim() || l.texto.trim(),
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

const ESQUEMA_DECISIONES = {
  type: 'object',
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
        additionalProperties: false,
      },
    },
  },
  required: ['decisiones'],
  additionalProperties: false,
} as const

const PROMPT_RANKING = `Eres el asistente de cotizaciones de La Innovación. Para cada línea pedida por un cliente recibes una lista corta de candidatos del catálogo, ya filtrada por búsqueda de texto.

Elige el producto correcto de cada lista y clasifica tu confianza:
- "exacto": el candidato es sin duda lo que pidieron (marca, modelo y medidas coinciden).
- "probable": es casi seguro el correcto y ningún otro compite de cerca.
- "ambiguo": hay varios candidatos plausibles y la diferencia importa. Elige el mejor igual, pero marca ambiguo.
- "sin_match": ningún candidato sirve. Pon code en null.

Ten en cuenta:
- Un candidato con estado "Bloqueado" no se puede cotizar: el ERP rechaza el documento completo. No lo elijas si hay cualquier otro que corresponda.
- Prefiere productos "Activo" y con existencia sobre "Descatalogado", pero solo si de verdad corresponden a lo pedido. Nunca elijas un producto equivocado por tener stock.
- Cuidado con los repuestos: un "NIPLE KDK" o un "TORNILLO ESTUFA" mencionan la marca o el tipo pero son piezas, no el aparato. Si piden un abanico, un repuesto de abanico no sirve.
- Las medidas y capacidades tienen que coincidir: una nevera de 18 pies no sustituye a una de 12.
- El "motivo" es para que un vendedor decida rápido. Una frase, en español dominicano con tuteo. Si es "sin_match", explica por qué no hay nada.
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
  c: OpenAI,
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
      precioLista: k.unitPrice,
    })),
  }))

  const d = await pedirJson<{ decisiones: FalloIA[] }>(
    c,
    'decisiones_cotizador',
    ESQUEMA_DECISIONES,
    PROMPT_RANKING,
    JSON.stringify(payload, null, 1),
  )

  if (!d?.decisiones) return []

  const validos = new Set(lote.flatMap((l) => l.candidatos.map((k) => k.code)))

  // El modelo no debería devolver un código que no estaba entre los candidatos,
  // pero si pasa se descarta en vez de arrastrar un producto inventado hasta la
  // cotización.
  return d.decisiones.filter((x) => x.code === null || validos.has(x.code))
}
