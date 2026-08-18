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
