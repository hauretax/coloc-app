// Stockage : un document JSON par coloc, plus un index code → coloc.
// En prod : Redis (Upstash, branché via Vercel). En local et en test : en mémoire.
import { Redis } from '@upstash/redis'

export function memoryStore() {
  const docs = new Map()
  const kv = new Map()
  const sets = new Map()
  return {
    kind: 'memory',
    async get(id) {
      const v = docs.get(id)
      return v ? JSON.parse(v) : null
    },
    /** Écrit seulement si personne n'a écrit entre-temps (version attendue). */
    async cas(id, doc, expected) {
      const cur = docs.get(id)
      const v = cur ? JSON.parse(cur).version : 0
      if (v !== expected) return false
      docs.set(id, JSON.stringify({ ...doc, version: expected + 1 }))
      doc.version = expected + 1
      return true
    },
    async codeGet(code) { return kv.get('code:' + code) || null },
    async codeClaim(code, id) {
      if (kv.has('code:' + code)) return false
      kv.set('code:' + code, id)
      return true
    },
    async codeDel(code) { kv.delete('code:' + code) },
    async photoPut(key, b64) { kv.set('photo:' + key, b64) },
    async photoGet(key) { return kv.get('photo:' + key) || null },
    async photoDel(key) { kv.delete('photo:' + key) },
    async indexAdd(set, id) {
      if (!sets.has(set)) sets.set(set, new Set())
      sets.get(set).add(id)
    },
    async indexAll(set) { return [...(sets.get(set) || [])] },
    async indexDel(set, id) { sets.get(set)?.delete(id) },
    async hit(key, ttlSec) {
      const k = 'rate:' + key
      const now = Date.now()
      const cur = kv.get(k)
      const entry = cur && cur.exp > now ? cur : { n: 0, exp: now + ttlSec * 1000 }
      entry.n += 1
      kv.set(k, entry)
      return entry.n
    },
  }
}

// Comparer-puis-écrire atomique : la version est dans une clé à part (même slot grâce aux accolades).
const CAS_SCRIPT = `
local v = redis.call('GET', KEYS[2])
if (v or '0') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
return 1`

export function redisStore(url, token) {
  const r = new Redis({ url, token, automaticDeserialization: false })
  const docKey = (id) => `coloc:{${id}}`
  const verKey = (id) => `colocv:{${id}}`
  return {
    kind: 'redis',
    async get(id) {
      const v = await r.get(docKey(id))
      return v ? JSON.parse(v) : null
    },
    async cas(id, doc, expected) {
      const next = { ...doc, version: expected + 1 }
      const res = await r.eval(CAS_SCRIPT, [docKey(id), verKey(id)], [String(expected), JSON.stringify(next), String(expected + 1)])
      if (Number(res) !== 1) return false
      doc.version = expected + 1
      return true
    },
    async codeGet(code) { return (await r.get('code:' + code)) || null },
    async codeClaim(code, id) { return (await r.set('code:' + code, id, { nx: true })) === 'OK' },
    async codeDel(code) { await r.del('code:' + code) },
    // Photos « à qui est-ce ? » : en base64, avec une durée de vie (supprimées plus tôt si l'objet est réclamé).
    async photoPut(key, b64, ttlSec) { await r.set('photo:' + key, b64, { ex: ttlSec }) },
    async photoGet(key) { return (await r.get('photo:' + key)) || null },
    async photoDel(key) { await r.del('photo:' + key) },
    // Index des colocs qui ont des rappels, parcouru par la tâche du soir.
    async indexAdd(set, id) { await r.sadd('index:' + set, id) },
    async indexAll(set) { return (await r.smembers('index:' + set)) || [] },
    async indexDel(set, id) { await r.srem('index:' + set, id) },
    async hit(key, ttlSec) {
      const k = 'rate:' + key
      const n = await r.incr(k)
      if (n === 1) await r.expire(k, ttlSec)
      return n
    },
  }
}
