/**
 * Cliente del API de GestionIncidencias.
 *
 * Solo existen estas rutas: /api/auth/login, /api/auth/me, /api/users,
 * /api/health y /api/catalogos/{productos,clientes}. Todo lo demás devuelve el
 * HTML del SPA. Ver docs/SOLICITUD_ENDPOINTS.md.
 *
 * OJO con los tiempos: /catalogos/productos tarda entre 9 y 26 s por petición
 * sin importar los filtros — el coste es el escaneo de la vista del ERP, no las
 * filas devueltas. Por eso el catálogo se espeja en local (ver db.ts) y este
 * cliente solo se usa para la sincronización y para consultas de clientes.
 */

// Se leen de forma diferida y no en constantes de módulo: los `import` de ESM
// se evalúan antes que `process.loadEnvFile()` del script de sincronización, y
// con constantes las credenciales quedarían vacías para siempre.
const base = () => process.env.ERP_BASE_URL ?? ''
const email = () => process.env.ERP_EMAIL ?? ''
const password = () => process.env.ERP_PASSWORD ?? ''

/**
 * Sin valor por defecto a propósito. Con uno, quien olvide configurar
 * `ERP_BASE_URL` apuntaría en silencio a la instancia de pruebas creyendo estar
 * en producción; es preferible que falle de entrada y con un mensaje claro.
 */
function exigirConfig() {
  const faltan = [
    !base() && 'ERP_BASE_URL',
    !email() && 'ERP_EMAIL',
    !password() && 'ERP_PASSWORD',
  ].filter(Boolean)

  if (faltan.length > 0) {
    throw new Error(
      `Falta configurar ${faltan.join(', ')}. Copia .env.local.example a .env.local.`,
    )
  }
}

export type ProductoERP = {
  code: string
  description: string
  description2: string
  divisionCode: string
  categoryCode: string
  groupCode: string
  barcode: string
  unitMeasure: string
  /** `Activo` | `Descatalogado` | `Bloqueado` | `Sustituto` */
  itemStatus: string
  clasificacion: string
  unitPrice: number | null
  unitCost: number | null
  /** Inventario sumado de todas las ubicaciones. */
  inventory: number
  /** En cuántas ubicaciones hay existencia. */
  locationCount: number
}

export type ClienteERP = {
  no: string
  name: string
  name2: string
  phoneNo: string
  mobilePhoneNo: string
  vatRegistrationNo: string
  contact: string
  telefono2: string
  correo1: string
  email: string
  /** Enum de NAV: 0 sin bloqueo · 1 envío · 2 facturación · 3 todo. */
  blocked: number
}

type Pagina<T> = {
  page: number
  pageSize: number
  total: number | null
  totalPages: number | null
  data: T[]
}

let tokenCache: { token: string; expira: number } | null = null

async function token(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expira) return tokenCache.token

  exigirConfig()

  const res = await fetch(`${base()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email(), password: password() }),
  })

  if (!res.ok) {
    throw new Error(`Login del ERP falló (${res.status}): ${await res.text()}`)
  }

  const data = (await res.json()) as { token: string }
  // El JWT dura 7 días; se renueva a los 6 por margen.
  tokenCache = { token: data.token, expira: Date.now() + 6 * 24 * 3600 * 1000 }
  return data.token
}

async function get<T>(ruta: string, params: Record<string, string | number | boolean>) {
  // Antes de construir la URL: con `base()` vacío, `new URL` revienta con un
  // "Invalid URL" que no le dice a nadie qué configurar.
  exigirConfig()
  const url = new URL(`${base()}${ruta}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await token()}` },
    // El endpoint de productos llega a tardar 26 s; 3 minutos deja margen para
    // las páginas de 5000 sin cortar la sincronización a mitad.
    signal: AbortSignal.timeout(180_000),
    cache: 'no-store',
  })

  const tipo = res.headers.get('content-type') ?? ''
  if (!tipo.includes('application/json')) {
    // Cuando una ruta no está montada, el servidor sirve el HTML del SPA con un
    // 200. Sin este chequeo el error aparece más tarde y sin explicación.
    throw new Error(
      `${ruta} devolvió ${tipo || 'sin content-type'} en vez de JSON. ` +
        'La ruta no está montada en esa instancia del ERP.',
    )
  }

  return (await res.json()) as Pagina<T>
}

export function paginaProductos(page: number, pageSize = 5000) {
  // `total=false` se salta el COUNT, que en esta vista cuesta un par de segundos.
  return get<ProductoERP>('/api/catalogos/productos', { page, pageSize, total: false })
}

export function paginaClientes(page: number, pageSize = 5000) {
  return get<ClienteERP>('/api/catalogos/clientes', { page, pageSize })
}

/** Búsqueda de clientes en vivo: la tabla responde en menos de 300 ms. */
export async function buscarClientes(search: string, pageSize = 20) {
  const r = await get<ClienteERP>('/api/catalogos/clientes', { search, pageSize })
  return r.data
}

export async function contarProductos() {
  const r = await get<ProductoERP>('/api/catalogos/productos', { page: 1, pageSize: 1 })
  return r.total ?? 0
}
