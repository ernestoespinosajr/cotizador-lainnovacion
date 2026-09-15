/**
 * Reglas de producto que necesitan tanto el servidor como el navegador.
 *
 * Vive aparte de `buscar.ts` a propósito: ese módulo importa `db.ts`, que usa
 * `node:sqlite` y `node:fs`, y arrastrarlo a un componente de cliente rompe el
 * empaquetado. Acá no hay ninguna dependencia.
 */

/**
 * ¿NAV acepta este producto en una cotización?
 *
 * Verificado contra el ERP, un estado a la vez: `Activo`, `Descatalogado` y
 * `Sustituto` se cotizan sin problema; `Bloqueado` hace que NAV rechace **la
 * cotización completa** con "Blocked must be equal to 'No' in Item". Como el
 * rechazo es de todo el documento, una sola línea bloqueada tumba un pedido de
 * cien y hay que atajarla antes de emitir.
 */
export const cotizable = (p: { itemStatus: string }) => p.itemStatus !== 'Bloqueado'

/**
 * Descripción 1 y 2 en un solo texto, como pidió La Innovación.
 *
 * El ERP parte el nombre en dos campos de ancho fijo, y la segunda mitad lleva
 * justo lo que distingue un modelo de otro: color, capacidad, versión. Mostradas
 * por separado, la segunda se leía como nota al pie y se pasaba por alto.
 */
export const nombreCompleto = (p: { description: string; description2?: string | null }) =>
  [p.description, p.description2].map((s) => (s ?? '').trim()).filter(Boolean).join(' ')

/**
 * Orden alfabético por el nombre completo, como pidió La Innovación para las
 * variantes. `numeric` pone 12' antes que 18' y no al revés.
 */
export function alfabetico<T extends { code: string; description: string; description2?: string | null }>(
  lista: T[],
): T[] {
  return [...lista].sort(
    (a, b) =>
      nombreCompleto(a).localeCompare(nombreCompleto(b), 'es', { sensitivity: 'base', numeric: true }) ||
      a.code.localeCompare(b.code),
  )
}
