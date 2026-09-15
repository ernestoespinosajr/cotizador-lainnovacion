/**
 * Los tres precios del catálogo y cómo se le comunican a NAV.
 *
 * NAV tiene dos formas de aceptar un precio distinto al de la lista del cliente:
 *
 *   1. `Line_Discount_Pct` — porcentaje de descuento sobre lo que NAV aplique,
 *      con decimales, entre 0 y 100 (los negativos los rechaza).
 *   2. `Unit_Price` + `Use_Manual_Price=true` — precio unitario forzado, que
 *      permite incluso mandar cero para regalar el producto. Sin el flag NAV
 *      sobreescribe el `Unit_Price` con el de la lista.
 *
 * De ahí el diseño: el cotizador elige un grupo de precio y un descuento
 * adicional, y `calcular()` devuelve las dos representaciones que NAV entiende
 * (`descuentoNav` para el porcentaje y `final` para el precio unitario). El
 * llamador decide cuál usar según la política del documento — el toggle
 * «aplicar el descuento al precio» del paso 4 elige entre ambas.
 *
 * Eso obliga a que el catálogo y el ERP tengan los mismos precios. Hoy no los
 * tienen —en pruebas el catálogo dice 5.250/5.000/4.300 y SANA-TEST cobra
 * 5.650/5.300/4.600 para el mismo producto—, así que en modo porcentaje sale
 * ligeramente corrido y en modo precio manual sale distinto al que el ERP
 * hubiera aplicado. Es la misma deriva de entornos que hace que los códigos
 * sobre 070000 no existan en el ERP de pruebas, y se corrige apuntando ambos al
 * mismo sitio. Ver el README, sección de paso a producción.
 */

import type { Producto } from './buscar'

export const GRUPOS = ['DETALLE', 'PCOMERCIAL', 'MAYOR'] as const
export type GrupoPrecio = (typeof GRUPOS)[number]

export const ROTULO: Record<GrupoPrecio, string> = {
  DETALLE: 'Detalle',
  PCOMERCIAL: 'Comercial',
  MAYOR: 'Por mayor',
}

/** El grupo del cliente tal como lo devuelve NAV, normalizado a los tres conocidos. */
export function grupoDe(valor: string | null | undefined): GrupoPrecio {
  const v = (valor ?? '').trim().toUpperCase()
  return (GRUPOS as readonly string[]).includes(v) ? (v as GrupoPrecio) : 'DETALLE'
}

/** Precio de lista de un producto para un grupo. `null` si el ERP no lo tiene. */
export function precioDe(p: Producto, grupo: GrupoPrecio): number | null {
  const v =
    grupo === 'MAYOR' ? p.priceMayor : grupo === 'PCOMERCIAL' ? p.pricePcomercial : p.priceDetalle
  // El catálogo trae ceros donde no hay precio en esa lista; un cero aquí no es
  // un precio, es la ausencia de uno, y tratarlo como precio regalaría el
  // producto al calcular el descuento.
  return v == null || v === 0 ? (p.unitPrice || null) : v
}

export type Cobro = {
  /** El que NAV aplica por sí solo: el del grupo del cliente. Es el de referencia. */
  base: number | null
  /** El de la lista que eligió el cotizador, antes de su descuento. */
  elegido: number | null
  /** Lo que termina pagando el cliente por unidad. */
  final: number | null
  /** Porcentaje que se le envía a NAV. Ya incluye el cambio de lista. */
  descuentoNav: number
  /**
   * Cuánto se aparta el precio final del que el cliente tiene por defecto, en
   * porcentaje: positivo si sube, negativo si baja, cero si queda igual.
   */
  variacion: number
  /**
   * El final queda por encima del precio del cliente. Un descuento no puede
   * subir un precio —NAV rechaza los negativos—, así que esa línea tiene que
   * viajar como precio manual.
   */
  requierePrecioManual: boolean
}

/**
 * Traduce «esta lista más este descuento» a lo que NAV entiende.
 *
 * El descuento se calcula contra el precio del grupo del CLIENTE, no contra el
 * elegido, porque es sobre ese que NAV va a aplicarlo.
 *
 * Antes, elegir una lista más cara que la del cliente dejaba el precio igual
 * con el aviso «no sube»: NAV solo aceptaba descuentos. Con `Use_Manual_Price`
 * el precio sí se puede subir, así que ahora se cobra lo elegido y se indica
 * cuánto sube o baja respecto al precio por defecto.
 */
export function calcular(
  p: Producto,
  grupoCliente: GrupoPrecio,
  grupoElegido: GrupoPrecio,
  descuentoExtra: number,
): Cobro {
  const base = precioDe(p, grupoCliente)
  const elegido = precioDe(p, grupoElegido)
  const extra = Math.min(100, Math.max(0, descuentoExtra || 0))

  if (base == null || base <= 0 || elegido == null) {
    return { base, elegido, final: null, descuentoNav: extra, variacion: 0, requierePrecioManual: false }
  }

  const final = elegido * (1 - extra / 100)
  const bruto = (1 - final / base) * 100
  // Por debajo de medio centavo es redondeo, no un cambio de precio: sin este
  // margen, «Detalle» con 0% sobre un cliente Detalle podía marcar «sube 0,00%».
  const igual = Math.abs(final - base) < 0.005

  return {
    base,
    elegido,
    final,
    // Dos decimales: NAV los acepta y con menos el precio final se corre en
    // pedidos grandes.
    descuentoNav: igual || bruto < 0 ? 0 : Math.min(100, Math.round(bruto * 100) / 100),
    variacion: igual ? 0 : (final / base - 1) * 100,
    requierePrecioManual: !igual && bruto < 0,
  }
}
