// Les routes de l'API. Chaque route reçoit {method, body, headers, ip} et renvoie {status, json}.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ALPHABET, CODE_LENGTH, cleanCode } from '../shared/rules.js'
import {
  ActionError, makeCtx, normalize, applyAction, publicState, newColoc, addMember,
  joinPreview, rid, upgrade, addClaim, askOthers, addToken, remindTick, pairDevice,
} from './reduce.js'

const PHOTO_TTL = 120 * 86400 // secondes ; l'objet disparaît de la liste avant (90 jours au plus)
const PHOTO_MAX = 1_400_000 // caractères base64, soit environ 1 Mo
const PAIR_TTL = 600 // secondes : durée de vie d'un code de connexion
const PAIR = 'pair:' // les codes de connexion partagent l'espace des codes de coloc (jamais de doublon)
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_]{3,40}$/.test(v)

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

export function makeApi({ store, push, clock = () => Date.now(), cronSecret = null }) {
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

  const load = async (id) => upgrade(await store.get(id))
  /** Le code d'une coloc (pas un code de connexion). */
  const colocFor = async (code) => {
    const v = await store.codeGet(code)
    return v && !v.startsWith(PAIR) ? v : null
  }

  /** Lit, modifie, écrit ; recommence si quelqu'un a écrit en même temps. */
  async function mutate(id, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await load(id)
      if (!doc) throw new ActionError('Cette coloc n’existe plus.', 404)
      const expected = doc.version || 0
      const result = await fn(doc)
      if (result && result.skipWrite) return { doc, ...result }
      if (await store.cas(id, doc, expected)) return { doc, ...result }
    }
    throw new ActionError('Trop de modifications en même temps, réessaie.', 409)
  }

  /** Ce qui se fait après une écriture réussie : photos à effacer, index des rappels. */
  async function afterWrite(doc, { dropPhotos = [], indexReminders = false } = {}) {
    try {
      for (const p of dropPhotos) await store.photoDel(doc.id + ':' + p)
      if (indexReminders) await store.indexAdd('reminders', doc.id)
    } catch (e) {
      console.error('afterWrite', e)
    }
  }

  async function sendPushes(doc, out) {
    if (!out || !out.length) return
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
    const h = hash(auth.token)
    if (!m || m.gone || !(m.tokens || []).some((t) => sameHash(t, h))) {
      const message = doc ? 'Tu ne fais plus partie de « ' + doc.name + ' ».' : 'Cette coloc n’existe plus.'
      throw new ActionError(message, 401, { error: 'gone', message })
    }
  }

  /** Le code tapé est un code de connexion : on ouvre le compte sur ce nouvel appareil. */
  async function pairRedeem(code, device) {
    const ref = await store.codeTake(code)
    if (!ref || !ref.startsWith(PAIR)) throw new ActionError('Ce code a expiré ou a déjà servi. Affiches-en un nouveau.', 404)
    const [colocId, memberId] = ref.slice(PAIR.length).split(':')
    const now = clock()
    const token = randomBytes(24).toString('base64url')
    const { doc, out } = await mutate(colocId, (d) => {
      const ctx = makeCtx(d, null, now)
      normalize(ctx)
      pairDevice(ctx, memberId, hash(token), device)
      return { out: ctx.out }
    })
    await sendPushes(doc, out)
    return { status: 200, json: { session: { colocId, memberId, token }, state: publicState(doc, memberId, now) } }
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
      const ref = await store.codeGet(code)
      if (ref && ref.startsWith(PAIR)) return pairRedeem(code, body.device)
      const id = ref
      const found = id && (await load(id))
      if (!found) throw new ActionError('Aucune coloc avec ce code. Vérifie-le avec tes colocs.', 404)
      // L'aperçu s'affiche même si la coloc est pleine : on peut toujours s'y reconnecter (« c'est moi »).
      if (!body.memberName) return { status: 200, json: { coloc: joinPreview(found) } }
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
      let doc = await load(auth.colocId)
      checkMember(doc, auth)
      const ctx = makeCtx(doc, auth.memberId, now)
      if (normalize(ctx)) {
        // Quelque chose a expiré : on l'enregistre (une seule tentative, la prochaine lecture rattrapera).
        const ok = await store.cas(doc.id, doc, doc.version || 0)
        if (ok) {
          await afterWrite(doc, ctx)
          await sendPushes(doc, ctx.out)
        } else doc = (await load(auth.colocId)) || doc
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
        const ctx = makeCtx(d, auth.memberId, now, hash(auth.token))
        normalize(ctx)
        applyAction(ctx, body)
        if (ctx.newCode) {
          oldCode = d.code
          newCode = newCode || (await claimNewCode(d.id))
          d.code = newCode
          ctx.flash = 'Nouveau code : l’ancien ne marche plus'
        }
        return { out: ctx.out, flash: ctx.flash, left: !!ctx.left, dropPhotos: ctx.dropPhotos, indexReminders: ctx.indexReminders }
      })
      if (oldCode && oldCode !== res.doc.code) await store.codeDel(oldCode)
      await afterWrite(res.doc, res)
      await sendPushes(res.doc, res.out)
      if (res.left) return { status: 200, json: { left: true, message: 'Tu as quitté « ' + res.doc.name + ' ».' } }
      return { status: 200, json: { state: publicState(res.doc, auth.memberId, now), flash: res.flash } }
    },

    /** Se reconnecter depuis un nouvel appareil : on demande, puis on attend qu'un appareil déjà connecté valide. */
    async claim({ method, body = {}, ip }) {
      if (method !== 'POST') throw new ActionError('Méthode non permise', 405)
      const now = clock()
      if (body.code) {
        await rateLimit('claim:' + ip, 10, 600)
        const { code } = cleanCode(body.code)
        const id = code.length === CODE_LENGTH && (await colocFor(code))
        if (!id) throw new ActionError('Aucune coloc avec ce code.', 404)
        if (!isId(body.member)) throw new ActionError('Choisis ton prénom.')
        const claimId = rid('k')
        const secret = randomBytes(24).toString('base64url')
        let name = ''
        const { doc, out } = await mutate(id, (d) => {
          const ctx = makeCtx(d, null, now)
          normalize(ctx)
          name = addClaim(ctx, { id: claimId, member: body.member, secretHash: hash(secret), device: body.device }).name
          return { out: ctx.out }
        })
        await sendPushes(doc, out)
        return { status: 200, json: { claim: { colocId: id, id: claimId, secret, member: body.member }, name } }
      }
      // Attente : la demande a-t-elle été validée ?
      if (!isId(body.colocId) || !isId(body.id) || typeof body.secret !== 'string') throw new ActionError('Demande invalide.')
      const token = randomBytes(24).toString('base64url')
      const res = await mutate(body.colocId, (d) => {
        const cl = d.claims.find((c) => c.id === body.id)
        if (!cl || !sameHash(cl.secretHash, hash(body.secret))) throw new ActionError('Cette demande n’existe plus. Recommence.', 410)
        if (cl.exp <= now) throw new ActionError('Personne n’a validé à temps. Recommence.', 410)
        if (cl.ok === false) throw new ActionError('Connexion refusée.', 403)
        if (cl.ok === null) {
          if (body.ask && !cl.asked) {
            const ctx = makeCtx(d, null, now)
            askOthers(ctx, cl)
            return { pending: true, asked: true, out: ctx.out }
          }
          return { skipWrite: true, pending: true, asked: cl.asked }
        }
        const m = d.members.find((x) => x.id === cl.member)
        if (!m || m.gone) throw new ActionError('Tu ne fais plus partie de cette coloc.', 410)
        addToken(d, m.id, hash(token))
        d.claims = d.claims.filter((c) => c.id !== cl.id)
        return { memberId: m.id }
      })
      await sendPushes(res.doc, res.out)
      if (res.pending) return { status: 200, json: { pending: true, asked: !!res.asked } }
      const session = { colocId: res.doc.id, memberId: res.memberId, token }
      return { status: 200, json: { session, state: publicState(res.doc, res.memberId, now) } }
    },

    /** Un appareil connecté affiche un code de connexion (10 min, une seule fois) à taper sur l'autre. */
    async pair({ method, headers }) {
      if (method !== 'POST') throw new ActionError('Méthode non permise', 405)
      const auth = parseAuth(headers)
      const doc = await load(auth.colocId)
      checkMember(doc, auth)
      await rateLimit('pair:' + auth.memberId, 10, 600)
      for (let i = 0; i < 20; i++) {
        const code = randomCode()
        if (await store.codeClaimTemp(code, PAIR + doc.id + ':' + auth.memberId, PAIR_TTL)) {
          return { status: 200, json: { code, exp: clock() + PAIR_TTL * 1000 } }
        }
      }
      throw new ActionError('Impossible de créer un code, réessaie.', 500)
    },

    /** Photos « à qui est-ce ? » : envoi (habitant connecté) et affichage (lien impossible à deviner). */
    async photo({ method, headers, body = {}, query = {} }) {
      if (method === 'GET') {
        const c = String(query.c || '')
        const p = String(query.p || '')
        if (!isId(c) || !/^[a-f0-9]{32}$/.test(p)) return { status: 404, json: { error: 'Photo introuvable' } }
        const b64 = await store.photoGet(c + ':' + p)
        if (!b64) return { status: 404, json: { error: 'Photo introuvable' } }
        return {
          status: 200,
          body: Buffer.from(b64, 'base64'),
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' },
        }
      }
      if (method !== 'POST') throw new ActionError('Méthode non permise', 405)
      const auth = parseAuth(headers)
      checkMember(await load(auth.colocId), auth)
      await rateLimit('photo:' + auth.memberId, 30, 3600)
      const data = typeof body.data === 'string' ? body.data.replace(/^data:image\/jpeg;base64,/, '') : ''
      if (!data || data.length > PHOTO_MAX || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new ActionError('Photo trop lourde ou illisible.')
      const head = Buffer.from(data.slice(0, 8), 'base64')
      if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) throw new ActionError('Ce n’est pas une photo JPEG.')
      const id = randomBytes(16).toString('hex')
      await store.photoPut(auth.colocId + ':' + id, data, PHOTO_TTL)
      return { status: 200, json: { id } }
    },

    /** Tâche planifiée (Vercel Cron, une fois par jour en fin d'après-midi) : rappels du soir. */
    async cron({ headers }) {
      const h = headers.authorization || headers.Authorization || ''
      if (!cronSecret || !sameHash(h, 'Bearer ' + cronSecret)) return { status: 401, json: { error: 'Non autorisé' } }
      const now = clock()
      let sent = 0
      const ids = await store.indexAll('reminders')
      for (const id of ids) {
        try {
          const res = await mutate(id, (d) => {
            const ctx = makeCtx(d, null, now)
            normalize(ctx)
            if (!d.reminders.length) return { skipWrite: true, empty: true }
            if (!remindTick(ctx)) return { skipWrite: true }
            return { out: ctx.out, dropPhotos: ctx.dropPhotos }
          })
          if (res.empty) await store.indexDel('reminders', id)
          await afterWrite(res.doc, res)
          await sendPushes(res.doc, res.out)
          sent += (res.out || []).length
        } catch (e) {
          if (e instanceof ActionError && e.status === 404) await store.indexDel('reminders', id)
          else console.error('cron', id, e)
        }
      }
      return { status: 200, json: { colocs: ids.length, sent } }
    },
  }

  return async function handle(route, req) {
    const fn = routes[route]
    if (!fn) return { status: 404, json: { error: 'Route inconnue' } }
    try {
      return await fn({ method: req.method || 'GET', body: req.body || {}, query: req.query || {}, headers: req.headers || {}, ip: req.ip || 'local' })
    } catch (e) {
      if (e instanceof ActionError) return { status: e.status, json: { error: e.message, ...e.extra } }
      console.error(e)
      return { status: 500, json: { error: 'Erreur du serveur, réessaie dans un instant.' } }
    }
  }
}
