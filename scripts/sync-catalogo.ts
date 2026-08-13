/**
 * Sincroniza el espejo local desde el ERP.
 *
 *   npm run sync              # productos + clientes
 *   npm run sync:clientes     # solo clientes (tarda menos de 2 s)
 *
 * Coste medido: productos son 13 páginas de 5000 a ~12-17 s cada una, o sea
 * unos 3 minutos y ~20 MB. Clientes son 3 páginas instantáneas. Pensado para
 * correr de madrugada por cron.
 *
 * Es un volcado completo porque el ERP no expone marca de tiempo por registro;
 * en cuanto exista un `modifiedAt` filtrable esto pasa a ser incremental
 * (ver docs/SOLICITUD_ENDPOINTS.md §4.2).
 */
import { join } from 'node:path'
import { db, setMeta, textoIndexable } from '../src/lib/db.ts'
import { paginaClientes, paginaProductos } from '../src/lib/erp.ts'

try {
  process.loadEnvFile(join(process.cwd(), '.env.local'))
} catch {
  // Sin .env.local se usan los valores por defecto de erp.ts.
}

const soloArg = process.argv.find((a) => a.startsWith('--solo='))
const solo = soloArg?.split('=')[1]

function seg(desde: number) {
  return `${((Date.now() - desde) / 1000).toFixed(1)}s`
}

async function syncProductos() {
  const d = db()
  const t0 = Date.now()
  console.log('→ Productos: volcado completo, ~13 páginas de 5000.')

  // Se carga a una tabla temporal y se intercambia al final, para que la app
  // nunca lea un catálogo a medio escribir.
  d.exec('DROP TABLE IF EXISTS productos_nuevo; CREATE TABLE productos_nuevo AS SELECT * FROM productos WHERE 0')

  const ins = d.prepare(`
    INSERT INTO productos_nuevo
      (code, description, description2, divisionCode, categoryCode, groupCode,
       barcode, unitMeasure, itemStatus, clasificacion, unitPrice, unitCost,
       inventory, locationCount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)

  let total = 0
  for (let page = 1; ; page++) {
    const t = Date.now()
    const r = await paginaProductos(page)
    if (r.data.length === 0) break

    d.exec('BEGIN')
    try {
      for (const p of r.data) {
        ins.run(
          p.code,
          p.description ?? '',
          p.description2 ?? '',
          p.divisionCode ?? '',
          p.categoryCode ?? '',
          p.groupCode ?? '',
          p.barcode ?? '',
          p.unitMeasure ?? '',
          p.itemStatus ?? '',
          p.clasificacion ?? '',
          p.unitPrice,
          p.unitCost,
          p.inventory ?? 0,
          p.locationCount ?? 0,
        )
      }
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }

    total += r.data.length
    console.log(`  página ${page}: ${r.data.length} filas en ${seg(t)} (acumulado ${total})`)
    if (r.data.length < 5000) break
  }

  d.exec('BEGIN')
  d.exec('DROP TABLE productos')
  d.exec('ALTER TABLE productos_nuevo RENAME TO productos')
  d.exec('CREATE INDEX IF NOT EXISTS idx_prod_barcode ON productos(barcode)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_prod_status  ON productos(itemStatus)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_prod_grupo   ON productos(groupCode)')
  d.exec('COMMIT')

  reindexar('productos', 'code')
  setMeta('productos_total', String(total))
  console.log(`✓ Productos: ${total} en ${seg(t0)}`)
  return total
}

async function syncClientes() {
  const d = db()
  const t0 = Date.now()
  console.log('→ Clientes.')

  d.exec('DROP TABLE IF EXISTS clientes_nuevo; CREATE TABLE clientes_nuevo AS SELECT * FROM clientes WHERE 0')

  const ins = d.prepare(`
    INSERT INTO clientes_nuevo
      (no, name, name2, phoneNo, mobilePhoneNo, vatRegistrationNo, contact,
       telefono2, correo1, email, blocked)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `)

  let total = 0
  for (let page = 1; ; page++) {
    const r = await paginaClientes(page)
    if (r.data.length === 0) break

    d.exec('BEGIN')
    try {
      for (const c of r.data) {
        ins.run(
          c.no,
          c.name ?? '',
          c.name2 ?? '',
          c.phoneNo ?? '',
          c.mobilePhoneNo ?? '',
          c.vatRegistrationNo ?? '',
          c.contact ?? '',
          c.telefono2 ?? '',
          c.correo1 ?? '',
          c.email ?? '',
          c.blocked ?? 0,
        )
      }
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
    total += r.data.length
    if (r.data.length < 5000) break
  }

  d.exec('BEGIN')
  d.exec('DROP TABLE clientes')
  d.exec('ALTER TABLE clientes_nuevo RENAME TO clientes')
  d.exec('COMMIT')

  reindexar('clientes', 'no')
  setMeta('clientes_total', String(total))
  console.log(`✓ Clientes: ${total} en ${seg(t0)}`)
  return total
}

/** Reconstruye el índice FTS desde la tabla base. */
function reindexar(tabla: 'productos' | 'clientes', llave: 'code' | 'no') {
  const d = db()
  const t = Date.now()
  d.exec(`DELETE FROM ${tabla}_fts`)
  d.exec('BEGIN')
  try {
    const ins = d.prepare(`INSERT INTO ${tabla}_fts(${llave}, texto) VALUES (?, ?)`)
    if (tabla === 'productos') {
      const filas = d
        .prepare('SELECT code, description, description2, barcode FROM productos')
        .all() as { code: string; description: string; description2: string; barcode: string }[]
      for (const p of filas) ins.run(p.code, textoIndexable(p))
    } else {
      const filas = d
        .prepare('SELECT no, name, name2, vatRegistrationNo, contact FROM clientes')
        .all() as {
        no: string
        name: string
        name2: string
        vatRegistrationNo: string
        contact: string
      }[]
      for (const c of filas) {
        ins.run(c.no, [c.no, c.name, c.name2, c.vatRegistrationNo, c.contact].filter(Boolean).join(' '))
      }
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  d.exec(`INSERT INTO ${tabla}_fts(${tabla}_fts) VALUES('optimize')`)
  console.log(`  índice FTS de ${tabla} reconstruido en ${seg(t)}`)
}

const t0 = Date.now()
try {
  if (solo !== 'clientes') await syncProductos()
  if (solo !== 'productos') await syncClientes()
  setMeta('ultima_sync', new Date().toISOString())
  db().exec('VACUUM')
  console.log(`\nListo en ${seg(t0)}.`)
} catch (e) {
  console.error('\n✗ La sincronización falló:', e instanceof Error ? e.message : e)
  process.exit(1)
}
