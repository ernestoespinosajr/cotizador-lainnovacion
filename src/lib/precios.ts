/**
 * Los tres precios del catálogo y cómo se le comunican a NAV.
 *
 * NAV no acepta que se le mande un precio. Se probaron seis formas contra la
 * pasarela —Unit_Price, UnitPrice, Price y Line_Discount_Amount por línea, y
 * Customer_Price_Group, Price_Group y CustomerPriceGroup en la cabecera— y las
 * ignora todas: siempre aplica el precio del grupo que el cliente tiene en su
 * ficha. Lo único que sí respeta es `Line_Discount_Pct`, con decimales, entre 0
 * y 100 (los negativos los rechaza con un mensaje explícito).
 *
 * De ahí el diseño: el cotizador elige un grupo de precio y un descuento
 * adicional, y las dos cosas viajan convertidas a un único porcentaje sobre el
 * precio que NAV va a aplicar de todos modos.
 *
 * Eso obliga a que el catálogo y el ERP tengan los mismos precios. Hoy no los
 * tienen —en pruebas el catálogo dice 5.250/5.000/4.300 y SANA-TEST cobra
 * 5.650/5.300/4.600 para el mismo producto—, así que el porcentaje sale
 * ligeramente corrido. Es la misma deriva de entornos que hace que los códigos
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
  /** El que NAV va a aplicar por sí solo: el del grupo del cliente. */
  base: number | null
  /** El de la lista que eligió el cotizador, antes de su descuento. */
  elegido: number | null
  /** Lo que termina pagando el cliente por unidad. */
  final: number | null
  /** Porcentaje único que se le envía a NAV. Ya incluye el cambio de lista. */
  descuentoNav: number
  /**
   * Cuando el grupo elegido es más caro que el del cliente. NAV no puede subir
   * un precio, solo descontarlo, así que se cobra el del cliente y se avisa.
   */
  noSePuedeSubir: boolean
}

/**
 * Traduce «esta lista más este descuento» al único porcentaje que NAV entiende.
 *
 * El descuento se calcula contra el precio del grupo del CLIENTE, no contra el
 * elegido, porque es sobre ese que NAV va a aplicarlo.
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
    return { base, elegido, final: null, descuentoNav: extra, noSePuedeSubir: false }
  }

  const final = elegido * (1 - extra / 100)
  const bruto = (1 - final / base) * 100

  if (bruto < 0) {
    // Subir de lista no es posible: NAV rechaza un descuento negativo. Se cobra
    // el precio del cliente, que es lo que el ERP haría igual.
    return { base, elegido, final: base, descuentoNav: 0, noSePuedeSubir: true }
  }

  return {
    base,
    elegido,
    final,
    // Dos decimales: NAV los acepta y con menos el precio final se corre en
    // pedidos grandes.
    descuentoNav: Math.min(100, Math.round(bruto * 100) / 100),
    noSePuedeSubir: false,
  }
}
