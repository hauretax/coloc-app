// Assemble l'API à partir de l'environnement, et l'adapte aux fonctions Vercel.
import { makeApi } from './handlers.js'
import { memoryStore, redisStore } from './store.js'
import { makePush } from './push.js'

let api = null

export function getApi(env = process.env) {
  if (api) return api
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    if (env.VERCEL) {
      // Sur Vercel sans base : refuser plutôt que perdre les données en silence.
      return async () => ({ status: 503, json: { error: 'La base de données n’est pas encore branchée.' } })
    }
    console.warn('[chez-nous] pas de Redis configuré : stockage en mémoire (perdu au redémarrage)')
  }
  const store = url && token ? redisStore(url, token) : memoryStore()
  api = makeApi({ store, push: makePush(env) })
  return api
}

export const clientIp = (headers) =>
  String(headers['x-forwarded-for'] || headers['x-real-ip'] || 'local').split(',')[0].trim()

/** Fabrique une fonction Vercel (Node) pour une route. */
export function vercel(route) {
  return async function handler(req, res) {
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = {} }
    }
    const out = await getApi()(route, { method: req.method, body: body || {}, headers: req.headers, ip: clientIp(req.headers) })
    res.setHeader('Cache-Control', 'no-store')
    res.status(out.status).json(out.json)
  }
}
