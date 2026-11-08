// Toute la logique de la coloc : chaque action modifie le document de la coloc
// et prépare les notifications à envoyer. Aucune entrée/sortie ici, tout est testable.
import {
  KINDS, WHAT, TYPES, IKINDS, STAGES, WHEN_KEYS, MAX_MEMBERS, MIN_MEMBERS, PALETTE, MAX_AHEAD, LISTS, DEVICES,
  todayISO, hm, untilLabel, whenRange, whenPhrase, isISO, dayDiff, listNames, weekday, photoUrl, isoAdd, dayLong, plural,
} from '../shared/rules.js'
import { PLANTS, LIGHT, HUM, FEEDS, LOGS, plantDue, snoozeDays, lastLog } from '../shared/plants.js'

const NOTIF_CAP = 30
const NOISE_MAX_MS = 4 * 3600e3 // une session sans heure de fin s'arrête toute seule après 4 h
const CLAIM_MS = 10 * 60e3 // une demande de connexion depuis un nouvel appareil vaut 10 min
const DONE_KEEP_MS = 3 * 864e5 // les courses cochées restent visibles 3 jours
const SHOPPING_MS = 2 * 3600e3 // « je fais les courses » dure 2 h
const LOST_MAX_MS = 90 * 864e5 // un objet trouvé jamais réclamé disparaît au bout de 3 mois
const MAX_TOKENS = 10 // appareils connectés par personne
const MAX_PLANTS = 60
const PLANT_LOG = 40 // événements gardés par plante (arrosages, engrais…)
const PLANT_RENUDGE = 3 // une plante oubliée est rappelée tous les 3 jours
const CHAT_MAX = 200 // messages gardés dans le chat
const CHAT_LEN = 1000
const CHAT_ACTIVE_MS = 45e3 // a lu le chat il y a moins de 45 s : il est dedans, la notif arrive sans sonner

export class ActionError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
export const rid = (p) => p + '_' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10)

export const activeMembers = (doc) => doc.members.filter((m) => !m.gone)
const nameOf = (doc, id) => (doc.members.find((m) => m.id === id) || { name: '?' }).name
const names = (doc, ids) => listNames(ids.map((id) => nameOf(doc, id)))
export const others = (doc, me) => activeMembers(doc).map((m) => m.id).filter((id) => id !== me)
export const insideIds = (doc, except) =>
  activeMembers(doc).map((m) => m.id).filter((id) => id !== except && ['home', 'calm'].includes(doc.status[id]?.kind))

export function freeColor(doc) {
  const taken = activeMembers(doc).map((m) => m.color)
  return PALETTE.find((c) => !taken.includes(c)) || PALETTE[0]
}

/** Contexte d'une requête : le document, qui agit, l'heure, et ce qu'il faudra envoyer. */
export function makeCtx(doc, me, now, tokenHash = null) {
  return { doc, me, now, tokenHash, out: [], flash: null, newCode: false, dropPhotos: [], keepPhotos: [], indexReminders: false }
}

/** Met à niveau un document écrit par une version plus ancienne de l'appli. */
export function upgrade(doc) {
  if (!doc) return doc
  for (const m of doc.members) {
    if (!Array.isArray(m.tokens)) m.tokens = m.tokenHash ? [m.tokenHash] : []
    delete m.tokenHash
  }
  for (const k of ['items', 'reminders', 'lost', 'claims', 'plants', 'chat']) if (!Array.isArray(doc[k])) doc[k] = []
  for (const k of ['links', 'chatRead']) if (!doc[k] || typeof doc[k] !== 'object') doc[k] = {}
  if (doc.shopping === undefined) doc.shopping = null
  return doc
}

/** extra : { quiet } pour une notif qui remplace la précédente sans sonner, { image } pour une photo,
    { seen } pour ne pas l'afficher dans l'appli (seulement sur le téléphone). */
function notify(ctx, ids, text, sub = '', actions = [], key = null, extra = null) {
  const { doc, now } = ctx
  for (const id of ids) {
    if (id === ctx.me) continue
    const list = doc.notifs[id] || (doc.notifs[id] = [])
    const n = { id: rid('n'), text, sub, actions, key, at: now, seen: false, ...extra }
    list.push(n)
    if (list.length > NOTIF_CAP) list.splice(0, list.length - NOTIF_CAP)
    ctx.out.push({ to: id, n })
  }
}

function markSeenKey(doc, key) {
  for (const list of Object.values(doc.notifs)) for (const n of list) if (n.key === key) n.seen = true
}

function calmEnded(ctx, who) {
  const { doc } = ctx
  for (const w of [...doc.waiting]) {
    if (others(doc, w).some((id) => doc.status[id]?.kind === 'calm')) continue
    notify(ctx, [w], 'C’est calme, tu peux jouer', nameOf(doc, who) + ' n’a plus besoin de calme.',
      [{ l: 'Je joue maintenant', a: 'noise' }, { l: 'Plus tard', a: 'dismiss' }])
    doc.waiting = doc.waiting.filter((x) => x !== w)
  }
}

/** Fait expirer ce qui doit l'être (calme terminé, session de bruit finie, vieux événements). */
export function normalize(ctx) {
  const { doc, now } = ctx
  const actor = ctx.me
  ctx.me = null // personne n'est « l'auteur » de ces changements : tout le monde est prévenu
  let changed = false
  for (const m of activeMembers(doc)) {
    const s = doc.status[m.id]
    if (s && s.kind === 'calm' && s.until <= now) {
      doc.status[m.id] = { kind: 'home', since: s.until }
      calmEnded(ctx, m.id)
      changed = true
    }
  }
  const n = doc.noise
  if (n && ((n.until && n.until <= now) || (!n.until && now - n.since > NOISE_MAX_MS))) {
    markSeenKey(doc, 'noise')
    doc.noise = null
    changed = true
  }
  const today = todayISO(now, doc.tz)
  const before = doc.events.length
  doc.events = doc.events.filter((e) => dayDiff(e.until, today) > -60)
  if (doc.events.length !== before) changed = true
  const items = doc.items.filter((i) => !i.done || now - i.done.at < DONE_KEEP_MS)
  if (items.length !== doc.items.length) { doc.items = items; changed = true }
  const claims = doc.claims.filter((c) => c.exp > now)
  if (claims.length !== doc.claims.length) { doc.claims = claims; changed = true }
  for (const l of [...doc.lost]) {
    if (now - l.at > LOST_MAX_MS) { dropLost(ctx, l); changed = true } else if (checkLost(ctx, l)) changed = true
  }
  if (doc.shopping && now - doc.shopping.at > SHOPPING_MS) {
    markSeenKey(doc, 'shopping')
    doc.shopping = null
    changed = true
  }
  ctx.me = actor
  return changed
}

/** Appelé une fois par jour en fin d'après-midi (tâche planifiée) : envoie les rappels du jour. */
export function remindTick(ctx) {
  const { doc, now } = ctx
  const actor = ctx.me
  ctx.me = null
  const today = todayISO(now, doc.tz)
  const wd = weekday(today)
  let changed = false
  for (const r of doc.reminders) {
    if (!r.days.includes(wd) || r.sent === today) continue
    r.sent = today
    changed = true
    if (r.taken && r.taken.day === today) continue
    const to = activeMembers(doc).map((m) => m.id).filter((id) => doc.status[id]?.kind !== 'away')
    notify(ctx, to, 'Ce soir : ' + lowerFirst(r.text), 'Qui s’en occupe ?',
      [{ l: 'Je m’en occupe', a: 'remindTake', v: r.id }, { l: 'Plus tard', a: 'dismiss' }], 'remind:' + r.id)
  }
  ctx.me = actor
  return changed
}

/* ---------- Plantes ---------- */
/** Tâche du soir : prévient quand une plante a soif. Sa ou son responsable si elle en a un (et qu'il n'est pas
    en voyage), sinon tout le monde à la coloc. Une notif par personne, puis un rappel tous les 3 jours si rien ne bouge. */
export function plantTick(ctx) {
  const { doc, now } = ctx
  const actor = ctx.me
  ctx.me = null
  const today = todayISO(now, doc.tz)
  const here = activeMembers(doc).map((m) => m.id).filter((id) => doc.status[id]?.kind !== 'away')
  const per = new Map()
  let changed = false
  for (const p of doc.plants) {
    const d = plantDue(p, today, doc.tz)
    if (d.late < 0) continue
    const ck = lastLog(p, 'check')
    const touched = [d.last, ck && todayISO(ck.at, doc.tz)].filter(Boolean).sort().pop() || ''
    if (p.nudged && p.nudged > touched && dayDiff(today, p.nudged) < PLANT_RENUDGE) continue
    const to = p.owner && here.includes(p.owner) ? [p.owner] : here
    if (!to.length) continue
    p.nudged = today
    changed = true
    for (const id of to) per.set(id, (per.get(id) || []).concat(p))
  }
  for (const [id, list] of per) {
    for (const n of doc.notifs[id] || []) if (n.key === 'plants') n.seen = true
    const one = list.length === 1
    notify(ctx, [id], one ? list[0].name + ' a soif' : list.length + ' plantes ont soif',
      (one ? '' : listNames(list.map((p) => p.name)) + '. ') + 'Touche la terre avant d’arroser : si elle est encore humide, attends un peu.',
      [{ l: 'Voir les plantes', a: 'openPlantes' }, { l: 'Plus tard', a: 'dismiss' }], 'plants',
      one && list[0].photo ? { image: photoUrl(doc.id, list[0].photo) } : null)
  }
  ctx.me = actor
  return changed
}

/** Plus rien à arroser : la notif « … a soif » est remplacée, sans sonner, chez ceux qui l'avaient. */
function plantsWatered(ctx, today) {
  const { doc, me } = ctx
  if (doc.plants.some((p) => plantDue(p, today, doc.tz).late >= 0)) return
  const told = Object.keys(doc.notifs).filter((id) => id !== me && doc.notifs[id].some((n) => n.key === 'plants' && !n.seen))
  markSeenKey(doc, 'plants')
  if (told.length) {
    notify(ctx, told, nameOf(doc, me) + ' a arrosé les plantes', 'Rien à faire pour toi.', [], 'plants', { quiet: true, seen: true })
  }
}

const validPhoto = (v) => (typeof v === 'string' && /^[a-f0-9]{32}$/.test(v) ? v : null)

/** Champs d'une plante envoyés par le formulaire, vérifiés. Un champ absent garde sa valeur ;
    à la création, il vient de la fiche de l'espèce. */
function plantFields(doc, a, cur) {
  const v = (k) => (a[k] === undefined && cur ? cur[k] : a[k])
  const sp = PLANTS[v('sp')] ? v('sp') : 'autre'
  const base = PLANTS[sp]
  const prev = cur || base
  const int = (x, lo, hi, d) => {
    const n = Math.round(Number(x))
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d
  }
  const w = Array.isArray(v('water')) ? v('water') : prev.water
  const name = str(v('name'), 30) || (sp === 'autre' ? '' : base.n)
  if (!name) throw new ActionError('Donne-lui un nom')
  const toxic = v('toxic')
  return {
    sp,
    name,
    room: str(v('room'), 30),
    water: [int(w[0], 1, 60, prev.water[0]), int(w[1], 1, 90, prev.water[1])],
    light: LIGHT[v('light')] ? v('light') : prev.light,
    hum: HUM[v('hum')] ? v('hum') : prev.hum,
    feed: FEEDS.includes(Number(v('feed'))) ? Number(v('feed')) : prev.feed,
    toxic: toxic === true || toxic === false || toxic === null ? toxic : prev.toxic,
    owner: activeMembers(doc).some((m) => m.id === v('owner')) ? v('owner') : null,
    notes: str(v('notes'), 400),
  }
}

const LOG_FLASH = { feed: 'Engrais noté', repot: 'Rempotage noté', prune: 'Taille notée' }

const lowerFirst = (t) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t)

/* ---------- Chat ---------- */
/** Texte d'un message : retours à la ligne gardés (trois d'affilée au plus), caractères de contrôle retirés. */
const msgText = (v) => String(v ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, CHAT_LEN)

/** Ce dont parle un message (objet trouvé, soirée, envie, course, plante) : copié au moment de l'envoi,
    pour que le message garde son sens même quand l'élément n'est plus dans la liste. */
const REF_FROM = {
  lost: (doc, id) => { const l = find(doc.lost, id); return l && { title: l.note || 'Objet trouvé', photo: l.photo } },
  event: (doc, id) => { const e = find(doc.events, id); return e && { title: e.title } },
  idea: (doc, id) => { const i = find(doc.ideas, id); return i && { title: i.title, kind: i.kind } },
  item: (doc, id) => { const i = find(doc.items, id); return i && { title: i.text, list: i.list } },
  plant: (doc, id) => { const p = find(doc.plants, id); return p && { title: p.name, photo: p.photo || null } },
}
function chatRef(doc, r) {
  const from = r && typeof r === 'object' && Object.hasOwn(REF_FROM, r.t) ? REF_FROM[r.t] : null
  const snap = from && from(doc, String(r.id))
  if (!snap) throw new ActionError('Ce dont tu parles n’est plus dans la liste. Retire-le pour envoyer.')
  return { t: r.t, id: String(r.id), ...snap }
}
const unreadFor = (doc, id) => {
  const at = (doc.chatRead[id] || {}).at || 0
  return doc.chat.filter((m) => m.by !== id && m.at > at).length
}

/** Notif d'un message : seulement sur le téléphone (pas dans la liste des notifs de l'appli), et une seule à la fois :
    la suivante remplace la précédente (« 3 nouveaux messages »). */
function chatNotify(ctx, m) {
  const { doc, me, now } = ctx
  const who = nameOf(doc, me) + (m.ref ? ' · « ' + m.ref.title + ' »' : '')
  const body = m.text.length > 180 ? m.text.slice(0, 177) + '…' : m.text
  for (const id of others(doc, me)) {
    const n = unreadFor(doc, id)
    const seen = (doc.chatRead[id] || {}).seen || 0
    ctx.out.push({
      to: id,
      n: {
        id: rid('n'), key: 'chat', open: 'chat', badge: n, at: now,
        text: n > 1 ? n + ' nouveaux messages' : who,
        sub: n > 1 ? who + ' : ' + body : body,
        quiet: now - seen < CHAT_ACTIVE_MS,
        image: m.ref && m.ref.photo ? photoUrl(doc.id, m.ref.photo) : null,
      },
    })
  }
}

/* ---------- Objets trouvés ---------- */
function dropLost(ctx, l) {
  ctx.doc.lost = ctx.doc.lost.filter((x) => x.id !== l.id)
  markSeenKey(ctx.doc, 'lost:' + l.id)
  ctx.dropPhotos.push(l.photo)
}

/** Si tout le monde a dit « pas à moi », l'objet sort de la liste et celui qui l'a trouvé est prévenu. */
function checkLost(ctx, l) {
  const mem = activeMembers(ctx.doc)
  if (mem.length < 2 || !mem.every((m) => l.notMine.includes(m.id))) return false
  dropLost(ctx, l)
  notify(ctx, [l.by], 'Personne ne réclame ' + (l.note ? '« ' + l.note + ' »' : 'ton objet trouvé'),
    'Tout le monde a répondu « pas à moi ». Tu peux le donner ou le jeter.')
  return true
}

/* ---------- Connexion depuis un nouvel appareil ---------- */
export function addClaim(ctx, { id, member, secretHash, device }) {
  const { doc, now } = ctx
  const m = find(doc.members, member)
  if (!m || m.gone) throw new ActionError('Cette personne ne fait plus partie de la coloc.', 404)
  const dev = DEVICES[device] ? device : 'autre'
  const pending = doc.claims.filter((c) => c.member === member)
  if (pending.length >= 3) doc.claims = doc.claims.filter((c) => c !== pending[0])
  doc.claims.push({ id, member, secretHash, device: dev, at: now, exp: now + CLAIM_MS, ok: null, by: null, asked: false })
  notify(ctx, [member], 'Connexion sur ' + DEVICES[dev] + ' : c’est toi ?',
    'Quelqu’un veut entrer dans « ' + doc.name + ' » sous ton nom. Si ce n’est pas toi, refuse.',
    [{ l: 'Oui, c’est moi', a: 'claimOk', v: id }, { l: 'Non', a: 'claimNo', v: id }], 'claim:' + id)
  return m
}

/** La personne n'a pas son téléphone : on demande aux autres de valider. */
export function askOthers(ctx, claim) {
  if (claim.asked) return
  claim.asked = true
  const name = nameOf(ctx.doc, claim.member)
  notify(ctx, others(ctx.doc, claim.member), name + ' se connecte sur ' + DEVICES[claim.device],
    name + ' n’a pas son téléphone sous la main. Valide seulement si c’est bien ' + name + '.',
    [{ l: 'Valider', a: 'claimOk', v: claim.id }, { l: 'Refuser', a: 'claimNo', v: claim.id }], 'claim:' + claim.id)
}

/** Connexion avec un code affiché sur un appareil déjà connecté : pas besoin de valider. */
export function pairDevice(ctx, memberId, tokenHash, device) {
  const { doc } = ctx
  const m = find(doc.members, memberId)
  if (!m || m.gone) throw new ActionError('Tu ne fais plus partie de cette coloc.', 410)
  const dev = DEVICES[device] ? device : 'autre'
  addToken(doc, m.id, tokenHash)
  // Les demandes « c'est moi » encore en attente ne servent plus à rien.
  for (const cl of doc.claims) if (cl.member === m.id && cl.ok === null) markSeenKey(doc, 'claim:' + cl.id)
  doc.claims = doc.claims.filter((c) => !(c.member === m.id && c.ok === null))
  notify(ctx, [m.id], 'Ton compte est ouvert sur ' + DEVICES[dev],
    'Si ce n’était pas toi, déconnecte tes autres appareils dans les réglages de la coloc.', [], 'pair', { quiet: true, seen: true })
  return m
}

/** Donne une clé de plus à quelqu'un (un appareil de plus). */
export function addToken(doc, memberId, tokenHash) {
  const m = find(doc.members, memberId)
  m.tokens = m.tokens.concat(tokenHash).slice(-MAX_TOKENS)
}

function makeEvent(a, today) {
  const when = WHEN_KEYS.includes(a.when) ? a.when : 'soir'
  let day = a.day
  if (when === 'jour' && !(isISO(day) && dayDiff(day, today) >= 0 && dayDiff(day, today) <= MAX_AHEAD)) {
    throw new ActionError('Choisis un jour dans l’année qui vient')
  }
  const { day: d, until } = whenRange(when, today, day)
  const t = /^([01]?\d|2[0-3])h([0-5]\d)?$/.test(a.time || '') ? a.time : null
  return { when, day: d, until, time: t }
}

function proposalNotif(ctx, ev, title, today) {
  const { doc, me } = ctx
  const to = others(doc, me).filter((id) => doc.status[id]?.kind !== 'away')
  notify(ctx, to, nameOf(doc, me) + ' propose ' + title + ', ' + whenPhrase(ev, today),
    ev.time ? 'Vers ' + ev.time + '.' : 'Pas d’heure, on voit sur le moment.',
    [{ l: 'Je viens', a: 'going', v: ev.id }, { l: 'Pas cette fois', a: 'dismiss' }])
}

function removeMemberData(doc, id) {
  delete doc.notifs[id]
  delete doc.push[id]
  delete doc.status[id]
  doc.waiting = doc.waiting.filter((x) => x !== id)
  if (doc.noise && doc.noise.by === id) doc.noise = null
  for (const p of doc.plants) if (p.owner === id) p.owner = null
  delete doc.chatRead[id]
}

const find = (list, id) => list.find((x) => x.id === id)
const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : list.concat(id))

/* ---------- Création et arrivée ---------- */
export function validName(raw) {
  const name = str(raw, 20)
  if (!name) throw new ActionError('Dis-nous ton prénom.')
  return name
}

export function newColoc({ id, code, name, max, tz, now, member }) {
  const colocName = str(name, 30)
  if (!colocName) throw new ActionError('Donne un nom à la coloc.')
  const m = Math.round(Number(max))
  if (!(m >= MIN_MEMBERS && m <= MAX_MEMBERS)) throw new ActionError('Entre 2 et 12 habitants.')
  const color = PALETTE.includes(member.color) ? member.color : PALETTE[0]
  return {
    id, code, name: colocName, max: m, tz: str(tz, 60) || 'Europe/Paris', createdAt: now, version: 0,
    members: [{ id: member.id, name: validName(member.name), color, tokens: [member.tokenHash], joinedAt: now }],
    status: { [member.id]: { kind: 'home', since: now } },
    door: { closed: false, by: null, at: null },
    noise: null, waiting: [], events: [], ideas: [],
    items: [], reminders: [], lost: [], claims: [], plants: [], chat: [], chatRead: {}, links: {}, shopping: null,
    notifs: { [member.id]: [] }, push: {},
  }
}

export function joinPreview(doc) {
  const mem = activeMembers(doc)
  return {
    name: doc.name, code: doc.code, max: doc.max, free: Math.max(0, doc.max - mem.length), full: mem.length >= doc.max,
    members: mem.map((m) => ({ id: m.id, name: m.name, color: m.color })), color: freeColor(doc),
  }
}

export function fullError(doc) {
  const n = activeMembers(doc).length
  return new ActionError('« ' + doc.name + ' » est complète (' + n + ' sur ' + doc.max + '). Quelqu’un de la coloc peut ajouter une place dans ses réglages.', 409)
}

export function addMember(ctx, { id, name, color, tokenHash }) {
  const { doc, now } = ctx
  const mem = activeMembers(doc)
  if (mem.length >= doc.max) throw fullError(doc)
  const n = validName(name)
  if (mem.some((m) => m.name.toLowerCase() === n.toLowerCase())) {
    throw new ActionError('« ' + n + ' » est déjà dans cette coloc. Ajoute une initiale.', 409)
  }
  const taken = mem.map((m) => m.color)
  const c = PALETTE.includes(color) && !taken.includes(color) ? color : freeColor(doc)
  doc.members.push({ id, name: n, color: c, tokens: [tokenHash], joinedAt: now })
  doc.status[id] = { kind: 'home', since: now }
  doc.notifs[id] = []
  doc.chatRead[id] = { at: now, seen: 0 } // l'historique du chat est visible, mais pas « non lu »
  ctx.me = id
  const left = doc.max - mem.length - 1
  notify(ctx, others(doc, id), n + ' a rejoint la coloc',
    left > 0 ? 'Il reste ' + left + ' place' + (left > 1 ? 's' : '') + '.' : 'La coloc est maintenant complète.',
    [{ l: 'OK', a: 'dismiss' }])
}

/* ---------- Actions ---------- */
export function applyAction(ctx, a = {}) {
  const { doc, me, now } = ctx
  const tz = doc.tz
  const today = todayISO(now, tz)
  const meName = nameOf(doc, me)

  if (a.seenId) {
    const n = (doc.notifs[me] || []).find((x) => x.id === a.seenId)
    if (n) n.seen = true
  }

  switch (a.type) {
    case 'seen':
      return

    case 'status': {
      if (!KINDS[a.kind]) throw new ActionError('Statut inconnu')
      const prev = doc.status[me]?.kind
      const st = { kind: a.kind, since: now }
      if (a.kind === 'calm') {
        const until = Number(a.until)
        if (!(until > now && until <= now + 2 * 864e5)) throw new ActionError('Choisis une heure de fin dans les 48 h')
        st.until = until
        st.reason = str(a.reason, 40) || 'Besoin de calme'
      }
      if (a.kind === 'out' || a.kind === 'away') st.back = str(a.back, 40) || 'bientôt'
      doc.status[me] = st
      const anyoneOut = activeMembers(doc).some((m) => doc.status[m.id]?.kind === 'out')
      if (prev === 'out' && a.kind !== 'out' && !anyoneOut && !doc.door.closed) {
        notify(ctx, insideIds(doc, me), 'Tout le monde est rentré', meName + ' vient d’arriver : tu peux fermer la porte du bas.',
          [{ l: 'Je la ferme', a: 'doorClose' }, { l: 'Plus tard', a: 'dismiss' }])
      }
      if (prev === 'calm' && a.kind !== 'calm') calmEnded(ctx, me)
      if (a.kind === 'calm' && doc.noise && doc.noise.by !== me) {
        notify(ctx, [doc.noise.by], meName + ' demande du calme', st.reason + ' · jusqu’à ' + untilLabel(st.until, now, tz),
          [{ l: 'J’arrête', a: 'noiseStop' }, { l: 'OK', a: 'dismiss' }])
      }
      ctx.flash = a.kind === 'out' && doc.door.closed
        ? 'La porte du bas est fermée. En arrivant, appuie sur « Ouvrez-moi ».'
        : 'Statut mis à jour'
      return
    }

    case 'noiseStart': {
      if (doc.noise && doc.noise.by !== me) throw new ActionError(nameOf(doc, doc.noise.by) + ' fait déjà du bruit en ce moment.')
      const what = WHAT[a.what] ? a.what : 'sax'
      const dur = [0, 30, 60, 120].includes(Number(a.dur)) ? Number(a.dur) : 0
      const told = insideIds(doc, me)
      markSeenKey(doc, 'noise')
      doc.noise = { by: me, what, since: now, until: dur ? now + dur * 60e3 : null, complaints: [], told }
      doc.waiting = doc.waiting.filter((x) => x !== me)
      notify(ctx, told, WHAT[what].other(meName),
        (doc.noise.until ? 'Jusqu’à ' + hm(doc.noise.until, tz) + '. ' : '') + 'Dis-le si ça te dérange.',
        [{ l: 'Ça me dérange', a: 'complain' }, { l: 'Pas de souci', a: 'dismiss' }], 'noise')
      ctx.flash = told.length ? 'Notif envoyée à ' + names(doc, told) : 'Personne d’autre n’est là. Bonne séance !'
      return
    }

    case 'noiseStop': {
      if (!doc.noise) return
      if (doc.noise.by !== me) throw new ActionError('Seule la personne qui fait du bruit peut arrêter la session.')
      markSeenKey(doc, 'noise')
      notify(ctx, doc.noise.complaints.map((c) => c.by), meName + ' a arrêté', 'Le calme est revenu.')
      doc.noise = null
      ctx.flash = 'Session terminée'
      return
    }

    case 'noiseTen': {
      if (!doc.noise || doc.noise.by !== me) return
      doc.noise.until = now + 10 * 60e3
      const end = hm(doc.noise.until, tz)
      for (const c of doc.noise.complaints) c.answer = meName + ' finit vers ' + end
      notify(ctx, doc.noise.complaints.map((c) => c.by), meName + ' finit dans 10 min', 'Fin vers ' + end + '.')
      ctx.flash = 'Réponse envoyée'
      return
    }

    case 'complain': {
      const n = doc.noise
      if (!n) throw new ActionError('C’est déjà fini.')
      if (n.by === me) return
      const reason = str(a.reason, 60) || 'Ça me dérange'
      n.complaints = n.complaints.filter((c) => c.by !== me).concat({ by: me, reason, answer: null })
      notify(ctx, [n.by], meName + ' : ça me dérange', reason,
        [{ l: 'J’arrête', a: 'noiseStop' }, { l: 'Encore 10 min', a: 'noiseTen' }])
      ctx.flash = 'Envoyé à ' + nameOf(doc, n.by)
      return
    }

    case 'waitCalm':
      if (!doc.waiting.includes(me)) doc.waiting.push(me)
      ctx.flash = 'Une notif t’arrivera dès que c’est calme'
      return

    case 'doorClose': {
      doc.door = { closed: true, by: me, at: now }
      const out = others(doc, me).filter((id) => doc.status[id]?.kind === 'out')
      if (out.length) {
        notify(ctx, out, meName + ' a fermé la porte du bas', 'En arrivant, appuie sur « Ouvrez-moi » pour prévenir ceux qui sont là.',
          [{ l: 'OK', a: 'dismiss' }])
      }
      ctx.flash = out.length ? 'Porte fermée, ' + names(doc, out) + (out.length > 1 ? ' ont' : ' a') + ' une notif' : 'Porte du bas fermée'
      return
    }

    case 'doorOpen':
      doc.door = { closed: false, by: null, at: null }
      ctx.flash = 'Porte du bas ouverte'
      return

    case 'knock': {
      const inside = insideIds(doc, me)
      if (!inside.length) { ctx.flash = 'D’après les statuts, personne n’est à la coloc.'; return }
      notify(ctx, inside, meName + ' attend devant la porte du bas', 'Quelqu’un peut descendre ouvrir ?',
        [{ l: 'J’y vais', a: 'goDown', v: me }], 'knock:' + me)
      ctx.flash = 'C’est envoyé à ' + names(doc, inside)
      return
    }

    case 'goDown': {
      const who = str(a.who, 40)
      if (!activeMembers(doc).some((m) => m.id === who) || who === me) return
      markSeenKey(doc, 'knock:' + who)
      notify(ctx, [who], meName + ' descend t’ouvrir', 'Plus que quelques secondes.')
      ctx.flash = 'Message envoyé à ' + nameOf(doc, who)
      return
    }

    case 'eventAdd': {
      const title = str(a.title, 80)
      if (!title) throw new ActionError('Dis ce que tu proposes')
      const ev = { id: rid('e'), type: TYPES[a.etype] ? a.etype : 'autre', title, by: me, going: [me], note: str(a.note, 120), createdAt: now, ...makeEvent(a, today) }
      doc.events.push(ev)
      if (doc.events.length > 200) doc.events.shift()
      proposalNotif(ctx, ev, ': ' + title, today)
      ctx.flash = 'Proposé à la coloc'
      return
    }

    case 'eventGoing': {
      const e = find(doc.events, a.id)
      if (!e) throw new ActionError('Cette proposition n’existe plus.')
      e.going = a.yes === true ? (e.going.includes(me) ? e.going : e.going.concat(me)) : toggle(e.going, me)
      if (a.yes === true) ctx.flash = 'Noté, tu viens'
      return
    }

    case 'eventDelete': {
      const e = find(doc.events, a.id)
      if (!e) return
      if (e.by !== me) throw new ActionError('Seule la personne qui a proposé peut retirer.')
      doc.events = doc.events.filter((x) => x.id !== e.id)
      for (const i of doc.ideas) if (i.planned === e.id) i.planned = null
      ctx.flash = 'Proposition retirée'
      return
    }

    case 'ideaAdd': {
      const title = str(a.title, 80)
      if (!title) throw new ActionError('Donne-lui un titre')
      const kind = IKINDS[a.kind] ? a.kind : 'film'
      doc.ideas.push({ id: rid('i'), kind, title, by: me, plus: [me], stage: 0, crew: [me], planned: null, createdAt: now })
      if (doc.ideas.length > 300) doc.ideas.shift()
      ctx.flash = 'Ajouté aux envies'
      return
    }

    case 'ideaPlus': { const i = find(doc.ideas, a.id); if (i) i.plus = toggle(i.plus, me); return }
    case 'ideaCrew': { const i = find(doc.ideas, a.id); if (i) i.crew = toggle(i.crew, me); return }
    case 'ideaStage': {
      const i = find(doc.ideas, a.id)
      const s = Math.round(Number(a.stage))
      if (i && s >= 0 && s < STAGES.length) i.stage = s
      return
    }
    case 'ideaDelete': {
      const i = find(doc.ideas, a.id)
      if (!i) return
      if (i.by !== me) throw new ActionError('Seule la personne qui l’a ajoutée peut la retirer.')
      doc.ideas = doc.ideas.filter((x) => x.id !== i.id)
      ctx.flash = 'Envie retirée'
      return
    }
    case 'ideaPlan': {
      const i = find(doc.ideas, a.id)
      if (!i) throw new ActionError('Cette envie n’existe plus.')
      const type = i.kind === 'film' ? 'film' : i.kind === 'video' ? 'video' : 'sortie'
      const title = i.kind === 'video' ? 'Tournage : ' + i.title : i.title
      const ev = { id: rid('e'), type, title, by: me, going: [me], note: '', createdAt: now, from: i.id, ...makeEvent(a, today) }
      doc.events.push(ev)
      i.planned = ev.id
      proposalNotif(ctx, ev, '« ' + i.title + ' »', today)
      ctx.flash = 'Proposé à la coloc'
      return
    }

    case 'colocMax': {
      const d = Number(a.delta) > 0 ? 1 : -1
      doc.max = Math.min(MAX_MEMBERS, Math.max(MIN_MEMBERS, activeMembers(doc).length, doc.max + d))
      return
    }
    case 'colocNewCode':
      ctx.newCode = true
      return

    case 'memberRemove': {
      const m = find(doc.members, a.id)
      if (!m || m.gone || m.id === me) return
      m.gone = true
      m.tokens = []
      removeMemberData(doc, m.id)
      ctx.flash = m.name + ' ne fait plus partie de la coloc'
      return
    }
    case 'leave': {
      const m = find(doc.members, me)
      notify(ctx, others(doc, me), meName + ' a quitté la coloc', 'Une place se libère.', [{ l: 'OK', a: 'dismiss' }])
      m.gone = true
      m.tokens = []
      removeMemberData(doc, me)
      ctx.left = true
      return
    }

    case 'pushSubscribe': {
      const s = a.sub || {}
      const endpoint = typeof s.endpoint === 'string' ? s.endpoint : ''
      const keys = s.keys || {}
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
        throw new ActionError('Abonnement aux notifs invalide')
      }
      const list = (doc.push[me] || []).filter((x) => x.endpoint !== endpoint)
      list.push({ endpoint, keys: { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) }, tok: tokTag(ctx) })
      doc.push[me] = list.slice(-MAX_TOKENS)
      ctx.flash = 'Notifs activées sur ce téléphone'
      return
    }
    case 'pushUnsubscribe':
      doc.push[me] = (doc.push[me] || []).filter((x) => x.endpoint !== a.endpoint)
      return

    case 'devicesReset': {
      // Ne garde que l'appareil qui fait la demande (et ses notifs).
      const m = find(doc.members, me)
      if (ctx.tokenHash) m.tokens = [ctx.tokenHash]
      const tok = tokTag(ctx)
      doc.push[me] = (doc.push[me] || []).filter((x) => tok && x.tok === tok)
      ctx.flash = 'Tes autres appareils sont déconnectés'
      return
    }

    /* ----- Connexion d'un nouvel appareil ----- */
    case 'claimOk':
    case 'claimNo': {
      const cl = find(doc.claims, a.id)
      if (!cl || cl.exp <= now) throw new ActionError('Cette demande a expiré.')
      if (cl.member !== me && !cl.asked) throw new ActionError('Seule la personne concernée peut valider.')
      if (cl.ok !== null) return
      cl.ok = a.type === 'claimOk'
      cl.by = me
      markSeenKey(doc, 'claim:' + cl.id)
      if (cl.ok && cl.member !== me) {
        notify(ctx, [cl.member], meName + ' a validé ta connexion sur ' + DEVICES[cl.device],
          'Si ce n’était pas toi, déconnecte tes autres appareils dans les réglages de la coloc.')
      }
      ctx.flash = cl.ok ? 'C’est bon, l’appareil se connecte' : 'Demande refusée'
      return
    }

    /* ----- Courses et choses à faire ----- */
    case 'itemAdd': {
      const list = LISTS[a.list] ? a.list : 'courses'
      const text = str(a.text, 80)
      if (!text) throw new ActionError('Écris ce qu’il faut')
      if (doc.items.some((i) => i.list === list && !i.done && i.text.toLowerCase() === text.toLowerCase())) {
        ctx.flash = 'Déjà sur la liste'
        return
      }
      doc.items.push({ id: rid('t'), list, text, by: me, at: now, done: null })
      if (doc.items.length > 300) doc.items.shift()
      const sh = doc.shopping
      if (list === 'courses' && sh && sh.by !== me) notify(ctx, [sh.by], meName + ' ajoute : ' + text, 'Sur la liste des courses.')
      return
    }
    case 'itemDone': {
      const i = find(doc.items, a.id)
      if (i) i.done = i.done ? null : { by: me, at: now }
      return
    }
    case 'itemDelete':
      doc.items = doc.items.filter((x) => x.id !== a.id)
      return
    case 'itemClear':
      doc.items = doc.items.filter((x) => !(x.list === a.list && x.done))
      return
    case 'shopping': {
      if (doc.shopping && doc.shopping.by === me) {
        markSeenKey(doc, 'shopping')
        doc.shopping = null
        ctx.flash = 'Courses terminées'
        return
      }
      doc.shopping = { by: me, at: now }
      markSeenKey(doc, 'shopping')
      const to = others(doc, me).filter((id) => doc.status[id]?.kind !== 'away')
      notify(ctx, to, meName + ' part faire les courses', 'Il te manque un truc ? Ajoute-le à la liste, ' + meName + ' le verra.',
        [{ l: 'Ajouter un truc', a: 'openCommun' }, { l: 'OK', a: 'dismiss' }], 'shopping')
      ctx.flash = to.length ? 'Prévenu : ' + names(doc, to) : 'C’est noté'
      return
    }
    case 'colocLink': {
      const raw = String(a.url ?? '').trim()
      // On accepte le message de partage entier de Tricount : on y prend le premier lien.
      let url = (raw.match(/https?:\/\/\S+/i) || [''])[0]
      if (!url && /^[\w-]+(\.[\w-]+)+\/\S*$/.test(raw)) url = 'https://' + raw
      url = url.replace(/^http:/i, 'https:').replace(/[)\].,;!?»"']+$/, '').slice(0, 300)
      if (raw && !url) throw new ActionError('Colle le lien de partage du Tricount (il commence par https://)')
      doc.links.tricount = url || null
      ctx.flash = url ? 'Lien du Tricount enregistré' : 'Lien retiré'
      return
    }

    /* ----- Rappels (poubelles…) ----- */
    case 'remindAdd': {
      const text = str(a.text, 50)
      if (!text) throw new ActionError('Dis ce qu’il faut faire')
      const days = [...new Set((Array.isArray(a.days) ? a.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      if (!days.length) throw new ActionError('Choisis au moins un jour')
      if (doc.reminders.length >= 10) throw new ActionError('10 rappels au maximum')
      doc.reminders.push({ id: rid('r'), text, days, by: me, at: now, sent: null, taken: null })
      ctx.indexReminders = true
      ctx.flash = 'Rappel ajouté'
      return
    }
    case 'remindDelete':
      doc.reminders = doc.reminders.filter((x) => x.id !== a.id)
      ctx.flash = 'Rappel supprimé'
      return
    case 'remindTake': {
      const r = find(doc.reminders, a.id)
      if (!r) throw new ActionError('Ce rappel n’existe plus.')
      if (r.taken && r.taken.day === today) {
        if (r.taken.by === me) { r.taken = null; ctx.flash = 'OK, plus personne ne s’en occupe'; return }
        ctx.flash = nameOf(doc, r.taken.by) + ' s’en occupe déjà'
        return
      }
      r.taken = { by: me, day: today }
      markSeenKey(doc, 'remind:' + r.id)
      // Remplace la notif « Ce soir : … » sur les téléphones des autres, sans sonner.
      notify(ctx, others(doc, me), meName + ' s’en occupe : ' + lowerFirst(r.text), 'Rien à faire pour toi.', [],
        'remind:' + r.id, { quiet: true, seen: true })
      ctx.flash = 'Merci ! Les autres le voient'
      return
    }

    /* ----- À qui est-ce ? ----- */
    case 'lostAdd': {
      const photo = typeof a.photo === 'string' && /^[a-f0-9]{32}$/.test(a.photo) ? a.photo : null
      if (!photo) throw new ActionError('Il manque la photo')
      const note = str(a.note, 80)
      const l = { id: rid('o'), photo, note, by: me, at: now, notMine: [me] }
      doc.lost.push(l)
      if (doc.lost.length > 40) dropLost(ctx, doc.lost[0])
      const to = others(doc, me)
      notify(ctx, to, meName + ' a trouvé un truc : à qui est-ce ?', note || 'Regarde la photo dans l’appli.',
        [{ l: 'C’est à moi', a: 'lostMine', v: l.id }, { l: 'Pas à moi', a: 'lostNot', v: l.id }], 'lost:' + l.id,
        { image: photoUrl(doc.id, photo) })
      ctx.flash = to.length ? 'Toute la coloc a une notif' : 'Ajouté'
      return
    }
    case 'lostMine': {
      const l = find(doc.lost, a.id)
      if (!l) throw new ActionError('Il a déjà été réclamé ou retiré.')
      dropLost(ctx, l)
      notify(ctx, [l.by], 'C’est à ' + meName + (l.note ? ' : ' + l.note : ''), 'Plus besoin de chercher.')
      ctx.flash = l.by === me ? 'Retiré de la liste' : 'Noté, ' + nameOf(doc, l.by) + ' a une notif'
      return
    }
    case 'lostNot': {
      const l = find(doc.lost, a.id)
      if (!l) return
      if (a.undo) l.notMine = l.notMine.filter((x) => x !== me)
      else if (!l.notMine.includes(me)) l.notMine.push(me)
      if (checkLost(ctx, l)) ctx.flash = 'Personne ne le réclame, il sort de la liste'
      return
    }
    case 'lostDelete': {
      const l = find(doc.lost, a.id)
      if (!l) return
      if (l.by !== me) throw new ActionError('Seule la personne qui l’a trouvé peut le retirer.')
      dropLost(ctx, l)
      ctx.flash = 'Retiré'
      return
    }

    /* ----- Plantes ----- */
    case 'plantAdd': {
      if (doc.plants.length >= MAX_PLANTS) throw new ActionError(MAX_PLANTS + ' plantes au maximum')
      const photo = validPhoto(a.photo)
      const p = { id: rid('p'), ...plantFields(doc, a, null), photo, log: [], snooze: null, nudged: null, by: me, at: now }
      // Dernier arrosage, s'il est connu : « aujourd'hui », « hier », « il y a une semaine »…
      const ago = a.ago === null || a.ago === undefined || a.ago === '' ? null : Math.round(Number(a.ago))
      if (ago !== null && ago >= 0 && ago <= 60) p.log.push({ id: rid('l'), k: 'water', by: me, at: now - ago * 864e5 })
      doc.plants.push(p)
      if (photo) ctx.keepPhotos.push(photo)
      ctx.indexReminders = true // la tâche du soir passe aussi par les plantes
      ctx.flash = 'Plante ajoutée'
      return
    }
    case 'plantEdit': {
      const p = find(doc.plants, a.id)
      if (!p) throw new ActionError('Cette plante n’existe plus.')
      Object.assign(p, plantFields(doc, a, p))
      if (a.photo !== undefined) {
        const photo = validPhoto(a.photo)
        if (photo !== p.photo) {
          if (p.photo) ctx.dropPhotos.push(p.photo)
          if (photo) ctx.keepPhotos.push(photo)
          p.photo = photo
        }
      }
      ctx.flash = 'Enregistré'
      return
    }
    case 'plantDelete': {
      const p = find(doc.plants, a.id)
      if (!p) return
      doc.plants = doc.plants.filter((x) => x.id !== p.id)
      if (p.photo) ctx.dropPhotos.push(p.photo)
      ctx.flash = 'Plante retirée'
      return
    }
    case 'plantLog': {
      if (!LOGS[a.kind]) throw new ActionError('Action inconnue')
      const ids = Array.isArray(a.ids) ? a.ids.slice(0, MAX_PLANTS) : [a.id]
      const list = ids.map((id) => find(doc.plants, id)).filter(Boolean)
      if (!list.length) throw new ActionError('Cette plante n’existe plus.')
      const ago = Math.round(Number(a.ago) || 0)
      if (!(ago >= 0 && ago <= 30)) throw new ActionError('Choisis un jour dans le mois passé')
      for (const p of list) {
        p.log.push({ id: rid('l'), k: a.kind, by: me, at: now - ago * 864e5 })
        p.log.sort((x, y) => x.at - y.at)
        if (p.log.length > PLANT_LOG) p.log.splice(0, p.log.length - PLANT_LOG)
        if (a.kind === 'water') p.snooze = null
        if (a.kind === 'check') p.snooze = isoAdd(today, snoozeDays(plantDue(p, today, tz).every))
      }
      const one = list[0]
      if (a.kind === 'water') {
        plantsWatered(ctx, today)
        ctx.flash = list.length > 1
          ? plural(list.length, 'plante') + ' arrosées'
          : 'Arrosée. Prochain arrosage : ' + dayLong(plantDue(one, today, tz).due, today).toLowerCase()
      } else if (a.kind === 'check') {
        ctx.flash = 'OK, on la revérifie ' + dayLong(one.snooze, today).toLowerCase()
      } else ctx.flash = LOG_FLASH[a.kind]
      return
    }
    case 'plantLogDelete': {
      const p = find(doc.plants, a.id)
      if (!p) return
      p.log = p.log.filter((l) => l.id !== a.log)
      // « Pas encore soif » retiré : on n'attend plus.
      const ck = lastLog(p, 'check')
      const w = lastLog(p, 'water')
      if (!ck || (w && w.at > ck.at)) p.snooze = null
      ctx.flash = 'Retiré de l’historique'
      return
    }

    /* ----- Chat ----- */
    case 'chatSend': {
      const text = msgText(a.text)
      if (!text) throw new ActionError('Écris ton message')
      const ref = a.ref ? chatRef(doc, a.ref) : null
      const m = { id: rid('w'), by: me, at: now, text, ref }
      doc.chat.push(m)
      if (doc.chat.length > CHAT_MAX) doc.chat.splice(0, doc.chat.length - CHAT_MAX)
      doc.chatRead[me] = { at: now, seen: now }
      chatNotify(ctx, m)
      return
    }
    case 'chatRead': {
      const prev = doc.chatRead[me] || { at: 0 }
      const at = Math.min(now, Number(a.at) || 0)
      doc.chatRead[me] = { at: Math.max(prev.at || 0, at), seen: now }
      return
    }
    case 'chatDelete': {
      const m = find(doc.chat, a.id)
      if (!m) return
      if (m.by !== me) throw new ActionError('Tu ne peux retirer que tes messages.')
      doc.chat = doc.chat.filter((x) => x.id !== m.id)
      ctx.flash = 'Message retiré'
      return
    }

    default:
      throw new ActionError('Action inconnue')
  }
}

const tokTag = (ctx) => (ctx.tokenHash ? ctx.tokenHash.slice(0, 12) : null)

/** Ce que voit un habitant : sans les clés, sans les abonnements, seulement ses notifs. */
export function publicState(doc, me, now) {
  const m = find(doc.members, me)
  return {
    id: doc.id, code: doc.code, name: doc.name, max: doc.max, tz: doc.tz, now, me,
    people: doc.members.map((m) => ({ id: m.id, name: m.name, color: m.color, gone: !!m.gone })),
    status: doc.status, door: doc.door, noise: doc.noise,
    waiting: doc.waiting.includes(me),
    events: doc.events, ideas: doc.ideas,
    items: doc.items, reminders: doc.reminders, shopping: doc.shopping, links: doc.links,
    lost: doc.lost.map((l) => ({ ...l, url: photoUrl(doc.id, l.photo) })),
    plants: doc.plants.map((p) => ({ ...p, url: p.photo ? photoUrl(doc.id, p.photo) : null })),
    chat: doc.chat.map((m) => (m.ref && m.ref.photo ? { ...m, ref: { ...m.ref, url: photoUrl(doc.id, m.ref.photo) } } : m)),
    chatRead: (doc.chatRead[me] || {}).at || 0,
    version: doc.version || 0,
    notifs: (doc.notifs[me] || []).filter((n) => !n.seen).slice(-10),
    pushCount: (doc.push[me] || []).length,
    devices: m ? m.tokens.length : 0,
    // Demandes « c'est moi » en attente : les miennes, et celles où l'on demande l'aide de la coloc.
    claims: doc.claims
      .filter((c) => c.ok === null && c.exp > now && (c.member === me || c.asked))
      .map((c) => ({ id: c.id, member: c.member, device: c.device, at: c.at, exp: c.exp, asked: c.asked, mine: c.member === me })),
  }
}
