/**
 * Caché en memoria del perfil de historial, por cliente.
 *
 * Traer el historial cuesta unos 2,3 s, y en una solicitud de 100 líneas se
 * consultaría una vez por línea. El perfil se arma una vez al elegir el cliente
 * y de ahí en adelante sale de memoria.
 *
 * Diez minutos alcanzan para una sesión de cotización completa y evitan que un
 * documento emitido hoy tarde en aparecer. Si el proceso se reinicia se pierde,
 * y no pasa nada: se vuelve a pedir.
 */

import { historialCliente } from './erp'
import { PERFIL_VACIO, perfilDeHistorial, type PerfilCliente } from './historial'

const VIDA_MS = 10 * 60 * 1000

const cache = new Map<string, { perfil: PerfilCliente; expira: number }>()
/** Peticiones en vuelo, para que dos búsquedas simultáneas no pidan lo mismo dos veces. */
const enVuelo = new Map<string, Promise<PerfilCliente>>()

export async function perfilDe(clienteNo: string): Promise<PerfilCliente> {
  if (!clienteNo) return PERFIL_VACIO

  const guardado = cache.get(clienteNo)
  if (guardado && Date.now() < guardado.expira) return guardado.perfil

  const yaVa = enVuelo.get(clienteNo)
  if (yaVa) return yaVa

  const tarea = (async () => {
    try {
      const perfil = perfilDeHistorial(await historialCliente(clienteNo))
      cache.set(clienteNo, { perfil, expira: Date.now() + VIDA_MS })
      return perfil
    } catch (e) {
      // El historial es una mejora, no un requisito: si el ERP no responde, la
      // búsqueda sigue funcionando exactamente como antes de existir esto.
      console.error(`[historial] ${clienteNo} sin perfil:`, e)
      return PERFIL_VACIO
    } finally {
      enVuelo.delete(clienteNo)
    }
  })()

  enVuelo.set(clienteNo, tarea)
  return tarea
}

export function olvidarPerfil(clienteNo: string) {
  cache.delete(clienteNo)
}
