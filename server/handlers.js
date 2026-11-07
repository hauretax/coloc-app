// Les routes de l'API. Chaque route reçoit {method, body, headers, ip} et renvoie {status, json}.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ALPHABET, CODE_LENGTH, cleanCode } from '../shared/rules.js'
import {
  ActionError, makeCtx, normalize, applyAction, publicState, newColoc, addMember,
  joinPreview, fullError, activeMembers, rid,
} from './reduce.js'

const hash = (t) => createHash('sha256').update(String(t)).digest('hex')
const sameHash = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
function randomCode() {
  const bytes = randomBytes(CODE_LENGTH)
  let c = ''
  for (const b of bytes) c += ALPHABET[b % ALPHABET.length]
  return c
}

export function makeApi({ store, push, clock = () => Date.now() }) {
  async function rateLimit(key, max, ttl) {
    const n = await store.hit(key, ttl)
    if (n > max) throw new ActionError('Trop d’essais. Attends quelques minutes et réessaie.', 429)
  }

  async function claimNewCode(id) {
    for (let i = 0; i < 20; i++) {
      const code = randomCode()
      if (await store.codeClaim(code, id)) return code
    }
    throw new ActionError('Impossible de créer un code, réessaie.', 500)
  }

  /** Lit, modifie, écrit ; recommence si quelqu'un a écrit en même temps. */
  async function mutate(id, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await store.get(id)
      if (!doc) throw new ActionError('Cette coloc n’existe plus.', 404)
      const expected = doc.version || 0
      const result = await fn(doc)
      if (result && result.skipWrite) return { doc, ...result }
      if (await store.cas(id, doc, expected)) return { doc, ...result }
    }
    throw new ActionError('Trop de modifications en même temps, réessaie.', 409)
  }

  async function sendPushes(doc, out) {
    if (!out.length) return
    let gone = []
    try {
      gone = await push.send(doc, out)
    } catch (e) {
      console.error('push', e)
    }
    if (!gone.length) return
    try {
      await mutate(doc.id, (d) => {
        for (const g of gone) if (d.push[g.to]) d.push[g.to] = d.push[g.to].filter((s) => s.endpoint !== g.endpoint)
        return {}
      })
    } catch (e) {
      console.error('push cleanup', e)
    }
  }

  function parseAuth(headers) {
    const h = headers.authorization || headers.Authorization || ''
    const m = /^Bearer ([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_-]+)$/.exec(h)
    if (!m) throw new ActionError('Session manquante', 401, { error: 'gone', message: 'Rejoins ou crée une coloc.' })
    return { colocId: m[1], memberId: m[2], token: m[3] }
  }
  function checkMember(doc, auth) {
    const m = doc && doc.members.find((x) => x.id === auth.memberId)
    if (!m || m.gone || !sameHash(m.tokenHash, hash(auth.token))) {
      const message = doc ? 'Tu ne fais plus partie de « ' + doc.name + ' ».' : 'Cette coloc n’existe plus.'
      throw new ActionError(message, 401, { error: 'gone', message })
    }
  }

  const routes = {
    async vapid() {
      return { status: 200, json: { key: push.publicKey || null } }
    },

    async create({ method, body = {}, ip }) {
      if (method !== 'POST') throw new ActionError('Méthode non permise', 405)
      await rateLimit('create:' + ip, 10, 3600)
      const now = clock()
      const id = rid('c')
      const memberId = rid('m')
      const token = randomBytes(24).toString('base64url')
      const doc = newColoc({
        id, code: 'XXXXXX', name: body.name, max: body.max, tz: body.tz, now,
        member: { id: memberId, name: body.memberName, color: body.color, tokenHash: hash(token) },
      })
      doc.code = await claimNewCode(id)
      if (!(await store.cas(id, doc, 0))) throw new ActionError('Création impossible, réessaie.', 500)
      return { status: 200, json: { session: { colocId: id, memberId, token }, state: publicState(doc, memberId, now) } }
    },

    async join({ method, body = {}, ip }) {
      if (method !== 'POST') throw new ActionError('Méthode non permise', 405)
      await rateLimit('join:' + ip, 40, 600)
      const { code } = cleanCode(body.code)
      if (code.length !== CODE_LENGTH) throw new ActionError('Le code fait 6 caractères.')
      const id = await store.codeGet(code)
      const found = id && (await store.get(id))
      if (!found) throw new ActionError('Aucune coloc avec ce code. Vérifie-le avec tes colocs.', 404)
      if (!body.memberName) {
        if (activeMembers(found).length >= found.max) throw fullError(found)
        return { status: 200, json: { coloc: joinPreview(found) } }
      }
      const now = clock()
      const memberId = rid('m')
      const token = randomBytes(24).toString('base64url')
      const { doc, out } = await mutate(id, (d) => {
        if (d.code !== code) throw new ActionError('Ce code vient de changer. Redemande-le à tes colocs.', 404)
        const ctx = makeCtx(d, null, now)
        normalize(ctx)
        addMember(ctx, { id: memberId, name: body.memberName, color: body.color, tokenHash: hash(token) })
        return { out: ctx.out }
      })
      await sendPushes(doc, out)
      return { status: 200, json: { session: { colocId: id, memberId, token }, state: publicState(doc, memberId, now) } }
    },

    async state({ headers }) {
      const auth = parseAuth(headers)
      const now = clock()
      let doc = await store.get(auth.colocId)
      checkMember(doc, auth)
      const ctx = makeCtx(doc, auth.memberId, now)
      if (normalize(ctx)) {
        // Quelque chose a expiré : on l'enregistre (une seule tentative, la prochaine lecture rattrapera).
        const ok = await store.cas(doc.id, doc, doc.version || 0)
        if (ok) await sendPushes(doc, ctx.out)
        else doc = (await store.get(auth.colocId)) || doc
      }
      return { status: 200, json: { state: publicState(doc, auth.memberId, now) } }
    },

    async action({ method, headers, body = {} }) {
      if (method !== 'POST') throw new ActionError('Méthode non permise', 405)
      const auth = parseAuth(headers)
      const now = clock()
      let oldCode = null
      let newCode = null
      const res = await mutate(auth.colocId, async (d) => {
        checkMember(d, auth)
        const ctx = makeCtx(d, auth.memberId, now)
        normalize(ctx)
        applyAction(ctx, body)
        if (ctx.newCode) {
          oldCode = d.code
          newCode = newCode || (await claimNewCode(d.id))
          d.code = newCode
          ctx.flash = 'Nouveau code : l’ancien ne marche plus'
        }
        return { out: ctx.out, flash: ctx.flash, left: !!ctx.left }
      })
      if (oldCode && oldCode !== res.doc.code) await store.codeDel(oldCode)
      await sendPushes(res.doc, res.out)
      if (res.left) return { status: 200, json: { left: true, message: 'Tu as quitté « ' + res.doc.name + ' ».' } }
      return { status: 200, json: { state: publicState(res.doc, auth.memberId, now), flash: res.flash } }
    },
  }

  return async function handle(route, req) {
    const fn = routes[route]
    if (!fn) return { status: 404, json: { error: 'Route inconnue' } }
    try {
      return await fn({ method: req.method || 'GET', body: req.body || {}, headers: req.headers || {}, ip: req.ip || 'local' })
    } catch (e) {
      if (e instanceof ActionError) return { status: e.status, json: { error: e.message, ...e.extra } }
      console.error(e)
      return { status: 500, json: { error: 'Erreur du serveur, réessaie dans un instant.' } }
    }
  }
}
