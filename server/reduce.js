// Toute la logique de la coloc : chaque action modifie le document de la coloc
// et prépare les notifications à envoyer. Aucune entrée/sortie ici, tout est testable.
import {
  KINDS, WHAT, TYPES, IKINDS, STAGES, WHEN_KEYS, MAX_MEMBERS, MIN_MEMBERS, PALETTE,
  todayISO, hm, untilLabel, whenRange, whenPhrase, isISO, dayDiff, listNames,
} from '../shared/rules.js'

const NOTIF_CAP = 30
const NOISE_MAX_MS = 4 * 3600e3 // une session sans heure de fin s'arrête toute seule après 4 h

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
export function makeCtx(doc, me, now) {
  return { doc, me, now, out: [], flash: null, newCode: false }
}

function notify(ctx, ids, text, sub = '', actions = [], key = null) {
  const { doc, now } = ctx
  for (const id of ids) {
    if (id === ctx.me) continue
    const list = doc.notifs[id] || (doc.notifs[id] = [])
    const n = { id: rid('n'), text, sub, actions, key, at: now, seen: false }
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
  ctx.me = actor
  return changed
}

function makeEvent(a, today) {
  const when = WHEN_KEYS.includes(a.when) ? a.when : 'soir'
  let day = a.day
  if (when === 'jour' && !(isISO(day) && dayDiff(day, today) >= 0 && dayDiff(day, today) <= 90)) {
    throw new ActionError('Choisis un jour dans les trois prochains mois')
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
    members: [{ id: member.id, name: validName(member.name), color, tokenHash: member.tokenHash, joinedAt: now }],
    status: { [member.id]: { kind: 'home', since: now } },
    door: { closed: false, by: null, at: null },
    noise: null, waiting: [], events: [], ideas: [],
    notifs: { [member.id]: [] }, push: {},
  }
}

export function joinPreview(doc) {
  const mem = activeMembers(doc)
  return {
    name: doc.name, code: doc.code, max: doc.max, free: doc.max - mem.length,
    members: mem.map((m) => ({ name: m.name, color: m.color })), color: freeColor(doc),
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
  doc.members.push({ id, name: n, color: c, tokenHash, joinedAt: now })
  doc.status[id] = { kind: 'home', since: now }
  doc.notifs[id] = []
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
      m.tokenHash = null
      removeMemberData(doc, m.id)
      ctx.flash = m.name + ' ne fait plus partie de la coloc'
      return
    }
    case 'leave': {
      const m = find(doc.members, me)
      notify(ctx, others(doc, me), meName + ' a quitté la coloc', 'Une place se libère.', [{ l: 'OK', a: 'dismiss' }])
      m.gone = true
      m.tokenHash = null
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
      list.push({ endpoint, keys: { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) } })
      doc.push[me] = list.slice(-5)
      ctx.flash = 'Notifs activées sur ce téléphone'
      return
    }
    case 'pushUnsubscribe':
      doc.push[me] = (doc.push[me] || []).filter((x) => x.endpoint !== a.endpoint)
      return

    default:
      throw new ActionError('Action inconnue')
  }
}

/** Ce que voit un habitant : sans les clés, sans les abonnements, seulement ses notifs. */
export function publicState(doc, me, now) {
  return {
    id: doc.id, code: doc.code, name: doc.name, max: doc.max, tz: doc.tz, now, me,
    people: doc.members.map((m) => ({ id: m.id, name: m.name, color: m.color, gone: !!m.gone })),
    status: doc.status, door: doc.door, noise: doc.noise,
    waiting: doc.waiting.includes(me),
    events: doc.events, ideas: doc.ideas,
    notifs: (doc.notifs[me] || []).filter((n) => !n.seen).slice(-10),
    pushCount: (doc.push[me] || []).length,
  }
}
