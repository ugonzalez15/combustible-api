import Elysia from 'elysia'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { query, execute } from '../db'
import { logger } from '../logger'
import { normalizarTelefono, type FuelUsuario, type FuelUnidad } from '../types'
import * as session from '../services/session.service'
import * as rendimiento from '../services/rendimiento.service'
import * as tanque from '../services/tanque.service'
import * as alertaSvc from '../services/alerta.service'

// ─── helpers internos ─────────────────────────────────────────────────────────

function etiquetaUnidad(u: FuelUnidad): string {
  const num = u.numero_identificador_activo ?? `#${u.id}`
  const pla = u.placa ? ` · ${u.placa}` : ''
  const mod = u.modelo ? ` ${u.modelo}` : ''
  return `${num}${mod}${pla}`
}

async function getUnidadHoy(conductor_id: string): Promise<number | null> {
  const rows = await query<{ unidad_id: number }>(
    `SELECT unidad_id FROM FUEL_ASIGNACIONES_DIA
     WHERE conductor_id = ? AND fecha = CURDATE() LIMIT 1`,
    [conductor_id],
  )
  return rows[0]?.unidad_id ?? null
}

async function menuConductor(nombre: string, unidad: FuelUnidad): Promise<string> {
  return `Hola ${nombre} 👋\nPipa: ${etiquetaUnidad(unidad)}\n\n¿Qué quieres hacer?\n1️⃣ Registrar carga\n2️⃣ Ver última carga\n3️⃣ Ver mi rendimiento\n4️⃣ Registrar entrada/salida de sucursal\n\nResponde con 1, 2, 3 o 4.\nEscribe *cancelar* en cualquier momento para salir.`
}

// ─── handlers por rol ─────────────────────────────────────────────────────────

async function handleConductor(
  usuario:  FuelUsuario,
  incoming: { body: string; numMedia: number; mediaUrl: string },
): Promise<string> {
  const tel     = usuario.celular_whatsapp
  const nombre  = usuario.nombre
  const estado  = await session.getEstado(tel)
  const paso    = estado?.estado ?? 'idle'
  const ctx     = (estado?.contexto ?? {}) as Record<string, unknown>
  const body    = incoming.body.trim()
  const lower   = body.toLowerCase()

  if (['cancelar', 'salir', 'menu'].includes(lower) && paso !== 'idle') {
    await session.resetEstado(tel)
    return 'Operación cancelada. Escríbeme cuando quieras. 👋'
  }

  if (paso === 'idle') {
    const esHola = lower === 'hola'
    if (!esHola && !['1', '2', '3', '4'].includes(body)) {
      return 'Escríbeme *hola* para comenzar. 👋'
    }

    const unidad_id = await getUnidadHoy(usuario.id)

    if (!unidad_id) {
      const unidades = await query<FuelUnidad>(
        `SELECT fu.id, fu.vehiculo_activo_id, fu.capacidad_litros,
                fu.rendimiento_esperado_kml, fu.activa,
                tv.placa, tv.numero_identificador_activo, tv.marca, tv.modelo
         FROM FUEL_UNIDADES fu
         JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
         WHERE fu.activa = 1 ORDER BY fu.id`,
      )
      if (unidades.length === 0) {
        return 'No hay pipas activas registradas. Contacta al administrador.'
      }
      const lista = unidades.map((u, i) => `${i + 1}. ${etiquetaUnidad(u)}`).join('\n')
      await session.setEstado(tel, 'esperando_unidad', { unidades: unidades.map(u => u.id) })
      return `Buenos días ${nombre} 👋\n\n¿Cuál pipa manejas hoy?\n\n${lista}\n\nResponde con el número de la lista.`
    }

    const unidad = await rendimiento.getUnidad(unidad_id)
    if (!unidad) {
      return 'Error al leer tu unidad asignada. Contacta al administrador.'
    }

    if (body === '2') {
      const last = await query<Record<string, unknown>>(
        `SELECT litros_cargados, km_odometro, rendimiento_real_kml, timestamp
         FROM FUEL_REGISTROS_CARGA WHERE unidad_id = ? ORDER BY timestamp DESC LIMIT 1`,
        [unidad_id],
      )
      if (last.length === 0) {
        return 'Aún no tienes cargas registradas con esta pipa.'
      }
      const r     = last[0]!
      const fecha = String(r.timestamp).substring(0, 10)
      const rend  = r.rendimiento_real_kml != null ? `${r.rendimiento_real_kml} km/L` : 'N/A (primera carga)'
      return `📋 Última carga:\n\nFecha: ${fecha}\nLitros: ${r.litros_cargados} L\nKilometraje: ${r.km_odometro} km\nRendimiento: ${rend}`
    }

    if (body === '3') {
      const stats = await query<{ prom: number; mejor: number; peor: number; total: number }>(
        `SELECT ROUND(AVG(rendimiento_real_kml), 2) AS prom,
                ROUND(MAX(rendimiento_real_kml), 2) AS mejor,
                ROUND(MIN(rendimiento_real_kml), 2) AS peor,
                COUNT(*) AS total
         FROM FUEL_REGISTROS_CARGA
         WHERE unidad_id = ? AND rendimiento_real_kml IS NOT NULL`,
        [unidad_id],
      )
      const s = stats[0]
      if (!s || Number(s.total) < 2) {
        return 'Necesitas al menos 2 cargas para ver tu rendimiento promedio.'
      }
      return `📊 Tu rendimiento:\n\nPromedio: ${s.prom} km/L\nMejor: ${s.mejor} km/L\nMás bajo: ${s.peor} km/L\n\nBasado en ${s.total} cargas.`
    }

    if (body === '1') {
      await session.setEstado(tel, 'esperando_litros', { unidad_id })
      return `Registrar carga (${etiquetaUnidad(unidad)})\n\n⚠️ Pon el medidor de la bomba en CEROS antes de cargar.\n\nPaso 1/4: ¿Cuántos LITROS cargaste? (solo números, ej: 50)`
    }

    if (body === '4') {
      await session.setEstado(tel, 'esperando_tipo_movimiento', { unidad_id })
      return '¿Es una entrada o salida de la sucursal?\n\n1️⃣ Entrada\n2️⃣ Salida'
    }

    return await menuConductor(nombre, unidad)
  }

  if (paso === 'esperando_tipo_movimiento') {
    if (body !== '1' && body !== '2') {
      return 'Responde con 1 (Entrada) o 2 (Salida).'
    }
    const tipo      = body === '1' ? 'entrada' : 'salida'
    const unidad_id = ctx.unidad_id as number
    if (!unidad_id) {
      await session.resetEstado(tel)
      return 'No tienes pipa asignada hoy. Selecciona tu unidad primero.'
    }
    await execute(
      `INSERT INTO FUEL_MOVIMIENTOS_SUCURSAL (id, unidad_id, tipo, registrado_por, sucursal_id)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), unidad_id, tipo, usuario.id, usuario.sucursal_id],
    )
    await session.resetEstado(tel)
    const emoji = tipo === 'entrada' ? '🟢' : '🔴'
    return `${emoji} ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} registrada. ✅`
  }

  if (paso === 'esperando_unidad') {
    const ids = (ctx.unidades as number[]) ?? []
    const idx = parseInt(body, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= ids.length) {
      return `Responde con un número del 1 al ${ids.length}.`
    }
    const unidad_id = ids[idx]!
    const unidad    = await rendimiento.getUnidad(unidad_id)
    if (!unidad || !unidad.activa) {
      return 'Esa unidad no está disponible. Intenta de nuevo.'
    }
    await execute(
      'INSERT INTO FUEL_ASIGNACIONES_DIA (id, conductor_id, unidad_id, fecha) VALUES (?, ?, ?, CURDATE())',
      [randomUUID(), usuario.id, unidad_id],
    )
    await session.resetEstado(tel)
    return `✅ Pipa asignada: ${etiquetaUnidad(unidad)}\n\n${await menuConductor(nombre, unidad)}`
  }

  if (paso === 'esperando_litros') {
    const litros = parseFloat(body)
    if (isNaN(litros) || litros <= 0) {
      return 'Solo escribe números. Ejemplo: 50 o 50.5\n\n¿Cuántos LITROS cargaste?'
    }
    await session.setEstado(tel, 'esperando_foto_surtidor', { ...ctx, litros })
    return `Anotado: ${litros} L ✅\n\nPaso 2/4: Envía una FOTO del MEDIDOR de la bomba (los números del contador). 📸`
  }

  if (paso === 'esperando_foto_surtidor') {
    if (incoming.numMedia < 1 || !incoming.mediaUrl) {
      return 'Necesito la foto del medidor de la bomba. Por favor envía la imagen. 📸'
    }
    await session.setEstado(tel, 'esperando_km', { ...ctx, foto_surtidor_url: incoming.mediaUrl })
    return 'Foto recibida ✅\n\nPaso 3/4: ¿Cuál es el KILOMETRAJE del tablero? (solo números, ej: 14350)'
  }

  if (paso === 'esperando_km') {
    const km = parseInt(body, 10)
    if (isNaN(km) || km <= 0) {
      return 'Solo escribe el número del kilometraje. Ejemplo: 14350\n\n¿Cuál es el KILOMETRAJE?'
    }
    await session.setEstado(tel, 'esperando_foto_odometro', { ...ctx, km_odometro: km })
    return `Anotado: ${km} km ✅\n\nPaso 4/4: Envía una FOTO del TABLERO donde se vea el kilometraje. 📸`
  }

  if (paso === 'esperando_foto_odometro') {
    if (incoming.numMedia < 1 || !incoming.mediaUrl) {
      return 'Necesito la foto del tablero. Por favor envía la imagen. 📸'
    }

    const unidad_id         = ctx.unidad_id as number
    const litros_cargados   = ctx.litros as number
    const km_odometro       = ctx.km_odometro as number
    const foto_surtidor_url = ctx.foto_surtidor_url as string
    const foto_odometro_url = incoming.mediaUrl

    const result = await rendimiento.calcularRendimiento(unidad_id, km_odometro, litros_cargados)
    const cap    = await rendimiento.verificarCapacidad(unidad_id, litros_cargados)
    const salida = await rendimiento.tieneSalidaHoy(unidad_id)

    const km_recorridos   = result?.km_recorridos      ?? null
    const rendimiento_kml = result?.rendimiento_real_kml ?? null
    let   alerta_generada = false

    const registro_id = randomUUID()
    await execute(
      `INSERT INTO FUEL_REGISTROS_CARGA
         (id, conductor_id, unidad_id, litros_cargados, km_odometro, km_recorridos,
          rendimiento_real_kml, foto_odometro_url, foto_surtidor_url, alerta_generada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [registro_id, usuario.id, unidad_id, litros_cargados, km_odometro,
       km_recorridos, rendimiento_kml, foto_odometro_url, foto_surtidor_url],
    )

    await tanque.registrarMovimiento({
      sucursal_id:     usuario.sucursal_id,
      tipo_movimiento: 'despacho',
      litros:          -litros_cargados,
      referencia_id:   registro_id,
      registrado_por:  usuario.id,
    })

    const alertas: string[] = []

    if (result?.alerta) {
      alerta_generada = true
      alertas.push('rendimiento_anomalo')
      await alertaSvc.generarAlerta({
        tipo_alerta:   'rendimiento_anomalo',
        descripcion:   `${nombre} — ${rendimiento_kml} km/L vs ${result.rendimiento_esperado_kml} esperado (${result.porcentaje_vs_esperado}%)`,
        referencia_id: registro_id,
        sucursal_id:   usuario.sucursal_id,
      })
    }

    if (cap.excede) {
      alerta_generada = true
      alertas.push('carga_excesiva')
      await alertaSvc.generarAlerta({
        tipo_alerta:   'carga_excesiva',
        descripcion:   `${nombre} cargó ${litros_cargados} L pero la capacidad de la pipa es ${cap.capacidad_litros} L`,
        referencia_id: registro_id,
        sucursal_id:   usuario.sucursal_id,
      })
    }

    if (!salida) {
      alerta_generada = true
      alertas.push('carga_sin_salida')
      await alertaSvc.generarAlerta({
        tipo_alerta:   'carga_sin_salida',
        descripcion:   `${nombre} registró carga sin movimiento de salida registrado hoy`,
        referencia_id: registro_id,
        sucursal_id:   usuario.sucursal_id,
      })
    }

    if (alerta_generada && registro_id) {
      await execute('UPDATE FUEL_REGISTROS_CARGA SET alerta_generada = 1 WHERE id = ?', [registro_id])
    }

    if (await tanque.estaBajoUmbral(usuario.sucursal_id)) {
      await alertaSvc.generarAlerta({
        tipo_alerta:   'tanque_bajo',
        descripcion:   `Nivel del tanque en ${usuario.sucursal_id} por debajo del umbral`,
        sucursal_id:   usuario.sucursal_id,
      })
    }

    await session.resetEstado(tel)

    let msg: string
    if (result && km_recorridos !== null && rendimiento_kml !== null) {
      msg = `✅ Carga registrada.\n\nLitros: ${litros_cargados} L\nKilometraje: ${km_odometro} km\nRecorriste: ${km_recorridos} km\nRendimiento: ${rendimiento_kml} km/L`
      if (alertas.length > 0) msg += '\n\n⚠️ Se generaron alertas para revisión del supervisor.'
    } else {
      msg = `✅ Primera carga registrada.\n\nLitros: ${litros_cargados} L\nKilometraje: ${km_odometro} km\n\nEn tu próxima carga calcularé el rendimiento.`
    }
    return msg + `\n\nGracias ${nombre}! 👍`
  }

  // fallback
  await session.resetEstado(tel)
  const uid = await getUnidadHoy(usuario.id)
  const u   = uid ? await rendimiento.getUnidad(uid) : null
  return u ? await menuConductor(nombre, u) : ''
}

async function handleVigilante(
  usuario:  FuelUsuario,
  incoming: { body: string; numMedia: number; mediaUrl: string },
): Promise<string> {
  const tel    = usuario.celular_whatsapp
  const nombre = usuario.nombre
  const estado = await session.getEstado(tel)
  const paso   = estado?.estado ?? 'idle'
  const ctx    = (estado?.contexto ?? {}) as Record<string, unknown>
  const body   = incoming.body.trim()
  const lower  = body.toLowerCase()

  const MENU = `Hola ${nombre} 👋\n\n¿Qué quieres hacer?\n1️⃣ Registrar movimiento (entrada/salida)\n2️⃣ Ver pipas dentro de la sucursal\n\nResponde con 1 o 2.`

  if (['cancelar', 'salir', 'menu'].includes(lower) && paso !== 'idle') {
    await session.resetEstado(tel)
    return 'Operación cancelada. 👋'
  }

  if (paso === 'idle') {
    const esHola = lower === 'hola'
    if (!esHola && !['1', '2'].includes(body)) {
      return 'Escríbeme *hola* para comenzar. 👋'
    }

    if (body === '2') {
      const activas = await query<{ placa: string; numero_identificador_activo: string }>(
        `SELECT tv.placa, tv.numero_identificador_activo
         FROM FUEL_MOVIMIENTOS_SUCURSAL ms
         JOIN FUEL_UNIDADES fu ON fu.id = ms.unidad_id
         JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
         WHERE ms.sucursal_id = ?
         GROUP BY ms.unidad_id, tv.placa, tv.numero_identificador_activo
         HAVING MAX(CASE WHEN ms.tipo = 'entrada' THEN ms.timestamp END) =
                MAX(ms.timestamp)`,
        [usuario.sucursal_id],
      )
      if (activas.length === 0) {
        return 'No hay pipas dentro de la sucursal en este momento.'
      }
      const lista = activas.map(a => `• ${a.numero_identificador_activo ?? ''} ${a.placa}`).join('\n')
      return `🚛 Pipas dentro de la sucursal:\n\n${lista}`
    }
    if (body === '1') {
      await session.setEstado(tel, 'esperando_tipo_movimiento')
      return '¿Es una entrada o salida?\n\n1️⃣ Entrada\n2️⃣ Salida'
    }
    return MENU
  }

  if (paso === 'esperando_tipo_movimiento') {
    if (body !== '1' && body !== '2') {
      return 'Responde con 1 (Entrada) o 2 (Salida).'
    }
    const tipo = body === '1' ? 'entrada' : 'salida'
    const unidades = await query<FuelUnidad>(
      `SELECT fu.id, fu.vehiculo_activo_id, fu.capacidad_litros,
              fu.rendimiento_esperado_kml, fu.activa,
              tv.placa, tv.numero_identificador_activo
       FROM FUEL_UNIDADES fu
       JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
       WHERE fu.activa = 1 ORDER BY fu.id`,
    )
    if (unidades.length === 0) {
      await session.resetEstado(tel)
      return 'No hay pipas activas registradas.'
    }
    const lista = unidades.map((u, i) => `${i + 1}. ${etiquetaUnidad(u)}`).join('\n')
    await session.setEstado(tel, 'esperando_numero_unidad', { tipo, unidades: unidades.map(u => u.id) })
    return `¿Cuál pipa?\n\n${lista}\n\nResponde con el número.`
  }

  if (paso === 'esperando_numero_unidad') {
    const ids  = (ctx.unidades as number[]) ?? []
    const tipo = ctx.tipo as 'entrada' | 'salida'
    const idx  = parseInt(body, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= ids.length) {
      return `Responde con un número del 1 al ${ids.length}.`
    }
    const unidad_id = ids[idx]!
    await execute(
      `INSERT INTO FUEL_MOVIMIENTOS_SUCURSAL (id, unidad_id, tipo, registrado_por, sucursal_id)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), unidad_id, tipo, usuario.id, usuario.sucursal_id],
    )
    await session.resetEstado(tel)
    const emoji = tipo === 'entrada' ? '🟢' : '🔴'
    return `${emoji} ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} registrada. ✅`
  }

  await session.resetEstado(tel)
  return MENU
}

async function handleSupervisor(
  usuario:  FuelUsuario,
  incoming: { body: string; numMedia: number; mediaUrl: string },
): Promise<string> {
  const tel    = usuario.celular_whatsapp
  const nombre = usuario.nombre
  const estado = await session.getEstado(tel)
  const paso   = estado?.estado ?? 'idle'
  const body   = incoming.body.trim()
  const lower  = body.toLowerCase()

  const MENU = `Hola ${nombre} 👋\n\n¿Qué quieres hacer?\n1️⃣ Ver nivel del tanque\n2️⃣ Registrar recarga al tanque\n\nResponde con 1 o 2.`

  if (['cancelar', 'salir', 'menu'].includes(lower) && paso !== 'idle') {
    await session.resetEstado(tel)
    return 'Operación cancelada. 👋'
  }

  if (paso === 'idle') {
    const esHola = lower === 'hola'
    if (!esHola && !['1', '2'].includes(body)) {
      return 'Escríbeme *hola* para comenzar. 👋'
    }

    if (body === '1') {
      const nivel = await tanque.getNivelActual(usuario.sucursal_id)
      return `⛽ Nivel actual del tanque:\n\n${nivel.toLocaleString('es-MX')} litros`
    }
    if (body === '2') {
      await session.setEstado(tel, 'esperando_litros_recarga')
      return '¿Cuántos litros se agregaron al tanque? (solo números, ej: 800)'
    }
    return MENU
  }

  if (paso === 'esperando_litros_recarga') {
    const litros = parseFloat(body)
    if (isNaN(litros) || litros <= 0) {
      return 'Solo escribe el número de litros. Ejemplo: 800\n\n¿Cuántos litros se agregaron?'
    }
    await tanque.registrarMovimiento({
      sucursal_id:     usuario.sucursal_id,
      tipo_movimiento: 'recarga',
      litros:          +litros,
      registrado_por:  usuario.id,
    })
    const nivelNuevo = await tanque.getNivelActual(usuario.sucursal_id)
    await session.resetEstado(tel)
    return `✅ Recarga registrada: ${litros} L\n\nNivel actual del tanque: ${nivelNuevo.toLocaleString('es-MX')} L`
  }

  await session.resetEstado(tel)
  return MENU
}

async function handleAdmin(usuario: FuelUsuario): Promise<string> {
  return `Hola ${usuario.nombre} 👋\n\nLos reportes y alertas llegan automáticamente a tu correo.\n\nUsa el panel de administración para gestionar usuarios y unidades.`
}

// ─── rutas ────────────────────────────────────────────────────────────────────

export const publicRoutes = new Elysia()

  .get('/', () => ({
    ok:      true,
    service: 'combustible-api',
    message: 'ERP API running',
  }))

  .get('/health', async () => {
    const start = Date.now()
    try {
      await query('SELECT 1')
      return {
        ok:      true,
        status:  'healthy',
        service: 'combustible-api',
        uptimeSeconds: Math.floor(process.uptime()),
        checks: {
          api:      { ok: true, message: 'API responding' },
          database: { ok: true, connected: true, responseTimeMs: Date.now() - start },
        },
      }
    } catch {
      return {
        ok:      false,
        status:  'unhealthy',
        service: 'combustible-api',
        checks: {
          api:      { ok: true, message: 'API responding' },
          database: { ok: false, connected: false },
        },
      }
    }
  })

  // Identifica usuario por teléfono — llamado por n8n al inicio de cada conversación
  .post('/chatbot/combustible-resolve', async ({ body }) => {
    const { phone } = body as { phone?: string }
    if (!phone) return { ok: false, found: false, message: 'phone requerido' }

    const tel  = normalizarTelefono(phone)
    const rows = await query<FuelUsuario>(
      `SELECT id, www_user_id, nombre, celular_whatsapp, rol, activo, sucursal_id
       FROM FUEL_USUARIOS WHERE celular_whatsapp = ? AND activo = 1 LIMIT 1`,
      [tel],
    )
    if (rows.length === 0) return { ok: true, found: false }
    return { ok: true, found: true, user: rows[0] }
  })

  // Genera una API Key (key se muestra solo una vez)
  .post('/chatbot/create-api-key', async ({ body }) => {
    const { phone, nombre = 'api-key', permisos = 'admin' } = body as {
      phone?: string; nombre?: string; permisos?: string
    }
    if (!phone) return Response.json({ ok: false, message: 'phone requerido' }, { status: 400 })

    const tel  = normalizarTelefono(phone)
    const rows = await query<FuelUsuario>(
      `SELECT id, rol, www_user_id FROM FUEL_USUARIOS WHERE celular_whatsapp = ? AND activo = 1`,
      [tel],
    )
    if (rows.length === 0 || rows[0]!.rol !== 'admin') {
      return Response.json({ ok: false, message: 'Solo administradores pueden crear API Keys' }, { status: 403 })
    }

    const apiKey  = randomBytes(32).toString('hex')
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const creador = rows[0]!.www_user_id ?? 'system'

    await execute(
      `INSERT INTO FUEL_API_KEYS (id, nombre, key_hash, permisos, creado_por) VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), nombre, keyHash, permisos, creador],
    )

    return {
      ok:      true,
      api_key: apiKey,
      last4:   apiKey.slice(-4),
      message: 'Guarda tu API Key en un lugar seguro. No se mostrará de nuevo.',
    }
  })

  // Entry point del chatbot — n8n recibe de Twilio y llama este endpoint con JSON
  .post('/webhook/whatsapp', async ({ body }) => {
    try {
      const { from, body: texto = '', numMedia = 0, mediaUrl = '' } = body as {
        from: string; body?: string; numMedia?: number; mediaUrl?: string
      }

      if (!from) return { ok: false, message: '' }

      const tel  = normalizarTelefono(from)
      const rows = await query<FuelUsuario>(
        `SELECT id, www_user_id, nombre, celular_whatsapp, rol, activo, sucursal_id
         FROM FUEL_USUARIOS WHERE celular_whatsapp = ? LIMIT 1`,
        [tel],
      )

      if (rows.length === 0) {
        logger.warn({ tel }, 'usuario_no_registrado')
        await alertaSvc.generarAlerta({
          tipo_alerta: 'usuario_no_registrado',
          descripcion: `Número no registrado intentó usar el chatbot: ${tel}`,
        })
        return { ok: true, message: '⚠️ Tu número no está registrado. Solicita al administrador que te den de alta.' }
      }

      const usuario = rows[0]!

      if (!usuario.activo) {
        return { ok: true, message: '⚠️ Tu acceso está suspendido. Contacta al administrador.' }
      }

      const incoming = { body: texto, numMedia, mediaUrl }
      let mensaje    = ''

      switch (usuario.rol) {
        case 'conductor':           mensaje = await handleConductor(usuario, incoming);  break
        case 'vigilante':           mensaje = await handleVigilante(usuario, incoming);  break
        case 'supervisor_gasolina': mensaje = await handleSupervisor(usuario, incoming); break
        case 'admin':               mensaje = await handleAdmin(usuario);                break
      }

      return { ok: true, message: mensaje }
    } catch (err) {
      logger.error({ err }, 'Error en webhook/whatsapp')
      return { ok: false, message: '' }
    }
  })
