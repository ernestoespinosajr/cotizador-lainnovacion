/**
 * Espejo local del catálogo del ERP, sobre `node:sqlite` (viene en Node 24, sin
 * dependencia nativa) con índices FTS5.
 *
 * Por qué existe: el endpoint de productos del ERP tarda entre 9 y 26 s por
 * petición sin importar los filtros —una búsqueda por código de barras que
 * devuelve 394 bytes tarda 10.3 s—, así que no sirve ni para búsqueda
 * interactiva ni para proponer alternativas, que necesita recorrer el catálogo.
 * Aquí las mismas 63.702 filas se consultan en milisegundos.
 *
 * Regla de oro: lo local se usa para ENCONTRAR, el ERP para COMPROMETER. El
 * inventario y el precio de las líneas ya elegidas se revalidan contra el ERP
 * antes de emitir la cotización, así que un espejo con horas de antigüedad
 * nunca llega al documento final.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RUTA = process.env.COTIZADOR_DB ?? join(process.cwd(), 'data', 'catalogo.db')

let _db: DatabaseSync | null = null

export function db(): DatabaseSync {
  if (_db) return _db
  mkdirSync(dirname(RUTA), { recursive: true })
  const d = new DatabaseSync(RUTA)
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA synchronous = NORMAL')
  migrar(d)
  _db = d
  return d
}

function migrar(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS productos (
      code          TEXT PRIMARY KEY,
      description   TEXT NOT NULL DEFAULT '',
      description2  TEXT NOT NULL DEFAULT '',
      divisionCode  TEXT NOT NULL DEFAULT '',
      categoryCode  TEXT NOT NULL DEFAULT '',
      groupCode     TEXT NOT NULL DEFAULT '',
      barcode       TEXT NOT NULL DEFAULT '',
      unitMeasure   TEXT NOT NULL DEFAULT '',
      itemStatus    TEXT NOT NULL DEFAULT '',
      clasificacion TEXT NOT NULL DEFAULT '',
      unitPrice     REAL,
      unitCost      REAL,
      inventory     REAL NOT NULL DEFAULT 0,
      locationCount INTEGER NOT NULL DEFAULT 0
    );

    -- Los tres precios y el inventario por sitio llegaron después de la primera
    -- versión y se agregan más abajo con ALTER, no acá: IF NOT EXISTS no añade
    -- columnas a una tabla que ya existe, y sin eso un espejo ya sincronizado
    -- se quedaría sin ellas para siempre.

    CREATE INDEX IF NOT EXISTS idx_prod_barcode  ON productos(barcode);
    CREATE INDEX IF NOT EXISTS idx_prod_status   ON productos(itemStatus);
    CREATE INDEX IF NOT EXISTS idx_prod_grupo    ON productos(groupCode);

    -- 'remove_diacritics 2' iguala acentuadas y sin acentuar; los clientes
    -- escriben sin acentos la mitad de las veces.
    CREATE VIRTUAL TABLE IF NOT EXISTS productos_fts USING fts5(
      code UNINDEXED,
      texto,
      tokenize = "unicode61 remove_diacritics 2",
      prefix = '2 3 4'
    );

    -- Vocabulario del índice: da en cuántos productos aparece cada término.
    -- Es lo que permite pesar "nevera" muy por encima de "dos" al puntuar una
    -- línea; sin esto, un TORNILLO ESTUFA le gana a una estufa de verdad.
    CREATE VIRTUAL TABLE IF NOT EXISTS productos_vocab
      USING fts5vocab(productos_fts, 'row');

    CREATE TABLE IF NOT EXISTS clientes (
      no                TEXT PRIMARY KEY,
      name              TEXT NOT NULL DEFAULT '',
      name2             TEXT NOT NULL DEFAULT '',
      phoneNo           TEXT NOT NULL DEFAULT '',
      mobilePhoneNo     TEXT NOT NULL DEFAULT '',
      vatRegistrationNo TEXT NOT NULL DEFAULT '',
      contact           TEXT NOT NULL DEFAULT '',
      telefono2         TEXT NOT NULL DEFAULT '',
      correo1           TEXT NOT NULL DEFAULT '',
      email             TEXT NOT NULL DEFAULT '',
      blocked           INTEGER NOT NULL DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS clientes_fts USING fts5(
      no UNINDEXED,
      texto,
      tokenize = "unicode61 remove_diacritics 2",
      prefix = '2 3 4'
    );

    -- Cada corrección del cotizador se guarda aquí. Los clientes recurrentes
    -- repiten su propio vocabulario, así que con el tiempo estas filas
    -- resuelven las líneas de entrada antes de tocar la búsqueda.
    CREATE TABLE IF NOT EXISTS aprendizaje (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      clienteNo  TEXT NOT NULL DEFAULT '',
      textoNorm  TEXT NOT NULL,
      code       TEXT NOT NULL,
      veces      INTEGER NOT NULL DEFAULT 1,
      creado     TEXT NOT NULL,
      UNIQUE(clienteNo, textoNorm, code)
    );

    -- Posición de cada producto dentro de data/vectores.bin. El hash permite
    -- revectorizar solo lo que cambió tras una sincronización.
    CREATE TABLE IF NOT EXISTS vectores (
      code TEXT PRIMARY KEY,
      pos  INTEGER NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    -- Respuestas de la IA por huella de la pregunta. La misma solicitud tiene
    -- que dar el mismo resultado, y el modelo no lo garantiza ni con
    -- temperatura cero. Como la huella incluye los candidatos, un cambio en el
    -- catálogo produce otra pregunta y no se sirve una respuesta vieja.
    CREATE TABLE IF NOT EXISTS ia_cache (
      huella    TEXT PRIMARY KEY,
      respuesta TEXT NOT NULL,
      creado    TEXT NOT NULL
    );
  `)

  agregarColumnas(d, 'productos', [
    ['priceDetalle', 'REAL'],
    ['pricePcomercial', 'REAL'],
    ['priceMayor', 'REAL'],
    ...SITIOS.map((s) => [`inventory${s}`, 'REAL NOT NULL DEFAULT 0'] as [string, string]),
  ])
}

/**
 * Sitios donde el ERP reporta existencia: 01 a 05 son tiendas y 11, 12 y 15
 * almacenes.
 *
 * No son todas las ubicaciones que existen. Medido sobre 400 productos, en 58
 * —el 14,5%— el total del ERP es mayor que la suma de estos ocho, y el
 * `locationCount` llega a 28. Por eso la interfaz habla de «tiendas y almacenes
 * principales» y nunca presenta este desglose como el reparto completo.
 */
export const SITIOS = ['01', '02', '03', '04', '05', '11', '12', '15'] as const
export const ALMACENES = new Set(['11', '12', '15'])

/** Añade columnas que falten, para que un espejo viejo no haya que rehacerlo. */
function agregarColumnas(d: DatabaseSync, tabla: string, cols: [string, string][]) {
  const hay = new Set(
    (d.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map((c) => c.name),
  )
  for (const [nombre, tipo] of cols) {
    if (!hay.has(nombre)) d.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo}`)
  }
}

export function setMeta(clave: string, valor: string) {
  db()
    .prepare('INSERT INTO meta(clave, valor) VALUES(?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
    .run(clave, valor)
}

export function getMeta(clave: string): string | null {
  const r = db().prepare('SELECT valor FROM meta WHERE clave = ?').get(clave) as
    | { valor: string }
    | undefined
  return r?.valor ?? null
}

export function estadoEspejo() {
  const d = db()
  const p = d.prepare('SELECT COUNT(*) n FROM productos').get() as { n: number }
  const c = d.prepare('SELECT COUNT(*) n FROM clientes').get() as { n: number }
  return {
    productos: p.n,
    clientes: c.n,
    sincronizado: getMeta('ultima_sync'),
    listo: p.n > 0,
  }
}

/**
 * Texto que se indexa por producto. Se repite el código y el código de barras
 * dentro del texto para que una búsqueda por cualquiera de los dos entre por
 * FTS con la misma ruta que la descripción.
 */
export function textoIndexable(p: {
  code: string
  description: string
  description2: string
  barcode: string
}) {
  return [p.code, p.description, p.description2, p.barcode].filter(Boolean).join(' ')
}
