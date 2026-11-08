import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApi } from '../server/handlers.js'
import { memoryStore } from '../server/store.js'
import { cleanCode, ALPHABET, whenRange, bucket, untilLabel, dayShort, isoAdd, weekendOf, weekendList, weekendSlot } from '../shared/rules.js'
import { PLANTS, LIGHT, HUM, FEEDS, plantDue, feedDue } from '../shared/plants.js'

// Samedi 7 novembre 2026, 16h20 à Paris
const T0 = Date.parse('2026-11-07T15:20:00Z')

function setup() {
  let now = T0
  const sent = []
  const push = {
    publicKey: 'test-key',
    async send(doc, out) { for (const o of out) sent.push({ to: o.to, text: o.n.text, sub: o.n.sub, image: o.n.image, quiet: o.n.quiet, badge: o.n.badge, key: o.n.key }); return [] },
  }
  const store = memoryStore(() => now)
  const api = makeApi({ store, push, clock: () => now, cronSecret: 'sekret' })
  const auth = (s) => ({ authorization: `Bearer ${s.colocId}.${s.memberId}.${s.token}` })
  const call = async (route, body, session, method = 'POST') => {
    const r = await api(route, { method, body, headers: session ? auth(session) : {}, ip: '1.2.3.4' })
    return r
  }
  const act = async (session, body) => {
    const r = await call('action', body, session)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    return r.json
  }
  const get = async (session) => (await call('state', {}, session, 'GET')).json.state
  return { api, store, call, act, get, sent, tick: (ms) => { now += ms } }
}

async function coloc(t, n = 3, max = 4) {
  const huggo = await t.call('create', { name: 'Les Lilas', max, memberName: 'Huggo', tz: 'Europe/Paris' })
  assert.equal(huggo.status, 200, JSON.stringify(huggo.json))
  const code = huggo.json.state.code
  const people = { huggo: huggo.json.session }
  for (const name of ['Léa', 'Sam', 'Inès', 'Max'].slice(0, n - 1)) {
    const r = await t.call('join', { code, memberName: name })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    people[name] = r.json.session
  }
  return { code, people }
}

test('les codes : 6 caractères sans ceux qui se confondent', () => {
  for (const ch of '0OQ1IL2Z5S8BUV') assert.ok(!ALPHABET.includes(ch), ch)
  assert.deepEqual(cleanCode('k7m-4px'), { code: 'K7M4PX', bad: '' })
  assert.equal(cleanCode('K7M 0PX').bad, '0')
  assert.equal(cleanCode('K7M4PXAAA').code, 'K7M4PX')
})

test('créer une coloc donne un code valide et une session', async () => {
  const t = setup()
  const r = await t.call('create', { name: 'Les Lilas', max: 4, memberName: 'Huggo', tz: 'Europe/Paris' })
  assert.equal(r.status, 200)
  assert.match(r.json.state.code, new RegExp(`^[${ALPHABET}]{6}$`))
  assert.equal(r.json.state.people.length, 1)
  assert.ok(!JSON.stringify(r.json.state).includes('tokenHash'))
  const bad = await t.call('create', { name: '', max: 4, memberName: 'Huggo' })
  assert.equal(bad.status, 400)
  const tooMany = await t.call('create', { name: 'X', max: 40, memberName: 'Huggo' })
  assert.equal(tooMany.status, 400)
})

test('rejoindre : aperçu, prénom déjà pris, coloc complète, code inconnu', async () => {
  const t = setup()
  const { code } = await coloc(t, 3, 4)
  const preview = await t.call('join', { code: code.toLowerCase() })
  assert.equal(preview.json.coloc.free, 1)
  const dup = await t.call('join', { code, memberName: 'huggo' })
  assert.equal(dup.status, 409)
  assert.equal((await t.call('join', { code, memberName: 'Inès' })).status, 200)
  const full = await t.call('join', { code })
  assert.equal(full.status, 200, 'l’aperçu reste visible pour pouvoir se reconnecter')
  assert.equal(full.json.coloc.full, true)
  const fifth = await t.call('join', { code, memberName: 'Max' })
  assert.equal(fifth.status, 409)
  assert.match(fifth.json.error, /complète \(4 sur 4\)/)
  assert.equal((await t.call('join', { code: 'AAAAAA' })).status, 404)
  // l'arrivée est notifiée aux autres
  assert.ok(t.sent.some((s) => s.text === 'Inès a rejoint la coloc'))
})

test('une session inventée ou retirée est refusée', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  const fake = { ...people.huggo, token: 'nimportequoi' }
  assert.equal((await t.call('state', {}, fake, 'GET')).status, 401)
  const st = await t.act(people.huggo, { type: 'seen' })
  const lea = st.state.people.find((p) => p.name === 'Léa')
  await t.act(people.huggo, { type: 'memberRemove', id: lea.id })
  const r = await t.call('state', {}, people['Léa'], 'GET')
  assert.equal(r.status, 401)
  assert.equal(r.json.error, 'gone')
})

test('sax : ça me dérange, puis encore 10 min, puis fin automatique', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  const start = await t.act(people.huggo, { type: 'noiseStart', what: 'sax', dur: 0 })
  assert.match(start.flash, /Notif envoyée à Léa et Sam/)
  assert.ok(t.sent.some((s) => s.text === 'Huggo joue du saxophone'))
  const sam = await t.act(people.Sam, { type: 'complain', reason: 'Je bosse' })
  assert.equal(sam.state.noise.complaints.length, 1)
  assert.ok(t.sent.some((s) => s.text === 'Sam : ça me dérange'))
  await t.act(people.huggo, { type: 'noiseTen' })
  t.tick(11 * 60e3)
  const after = await t.call('state', {}, people.Sam, 'GET')
  assert.equal(after.json.state.noise, null)
})

test('calme : « préviens-moi » arrive quand le calme se termine, même tout seul', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  await t.act(people.Sam, { type: 'status', kind: 'calm', reason: 'Révisions', until: T0 + 40 * 60e3 })
  const w = await t.act(people.huggo, { type: 'waitCalm' })
  assert.equal(w.state.waiting, true)
  t.tick(41 * 60e3)
  const st = await t.call('state', {}, people['Léa'], 'GET')
  const samId = st.json.state.people.find((p) => p.name === 'Sam').id
  assert.equal(st.json.state.status[samId].kind, 'home')
  assert.ok(t.sent.some((s) => s.text === 'C’est calme, tu peux jouer'))
})

test('porte : le dernier qui rentre prévient les autres, ouvrez-moi', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  await t.act(people['Léa'], { type: 'status', kind: 'out', back: 'vers 20h' })
  await t.act(people['Léa'], { type: 'status', kind: 'home' })
  assert.equal(t.sent.filter((s) => s.text === 'Tout le monde est rentré').length, 2)
  await t.act(people['Léa'], { type: 'status', kind: 'out', back: 'vers 20h' })
  const closed = await t.act(people.huggo, { type: 'doorClose' })
  assert.match(closed.flash, /Léa a une notif/)
  const knock = await t.act(people['Léa'], { type: 'knock' })
  assert.match(knock.flash, /Huggo et Sam/)
  const huggoState = (await t.call('state', {}, people.huggo, 'GET')).json.state
  const n = huggoState.notifs.at(-1)
  assert.equal(n.text, 'Léa attend devant la porte du bas')
  const leaId = huggoState.people.find((p) => p.name === 'Léa').id
  await t.act(people.huggo, { type: 'goDown', who: leaId, seenId: n.id })
  const samState = (await t.call('state', {}, people.Sam, 'GET')).json.state
  assert.ok(!samState.notifs.some((x) => x.text === 'Léa attend devant la porte du bas'), 'la notif disparaît chez les autres')
})

test('propositions : ce soir sans heure, je viens, envies programmées', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  const a = await t.act(people['Léa'], { type: 'eventAdd', etype: 'film', title: 'Dune', when: 'soir' })
  const ev = a.state.events[0]
  assert.equal(ev.day, '2026-11-07')
  assert.equal(ev.time, null)
  assert.ok(t.sent.some((s) => s.text === 'Léa propose : Dune, ce soir'))
  const g = await t.act(people.huggo, { type: 'eventGoing', id: ev.id, yes: true })
  assert.equal(g.state.events[0].going.length, 2)
  const idea = (await t.act(people.Sam, { type: 'ideaAdd', kind: 'video', title: 'Une semaine en accéléré' })).state.ideas[0]
  const planned = await t.act(people.Sam, { type: 'ideaPlan', id: idea.id, when: 'weekend' })
  const tournage = planned.state.events.find((e) => e.from === idea.id)
  assert.equal(tournage.title, 'Tournage : Une semaine en accéléré')
  assert.deepEqual([tournage.day, tournage.until], ['2026-11-07', '2026-11-08'])
  const del = await t.call('action', { type: 'eventDelete', id: ev.id }, people.Sam)
  assert.equal(del.status, 400)
})

test('réglages : places, nouveau code, quitter', async () => {
  const t = setup()
  const { people, code } = await coloc(t, 3, 3)
  assert.equal((await t.call('join', { code, memberName: 'Max' })).status, 409)
  const up = await t.act(people.huggo, { type: 'colocMax', delta: 1 })
  assert.equal(up.state.max, 4)
  const down = await t.act(people.huggo, { type: 'colocMax', delta: -1 })
  const again = await t.act(people.huggo, { type: 'colocMax', delta: -1 })
  assert.equal(again.state.max, 3, 'jamais moins que le nombre d’habitants')
  assert.equal(down.state.max, 3)
  const nc = await t.act(people.huggo, { type: 'colocNewCode' })
  assert.notEqual(nc.state.code, code)
  assert.equal((await t.call('join', { code })).status, 404)
  const left = await t.act(people.Sam, { type: 'leave' })
  assert.equal(left.left, true)
  assert.equal((await t.call('join', { code: nc.state.code })).status, 200)
})

test('dates : week-end, prochains jours, heures de fin', () => {
  assert.deepEqual(whenRange('weekend', '2026-11-09'), { day: '2026-11-14', until: '2026-11-15' })
  assert.deepEqual(whenRange('weekend', '2026-11-08'), { day: '2026-11-08', until: '2026-11-08' })
  assert.equal(bucket({ when: 'demain', day: '2026-11-08', until: '2026-11-08' }, '2026-11-08'), 'soir')
  assert.equal(bucket({ when: 'soir', day: '2026-11-06', until: '2026-11-06' }, '2026-11-07'), 'passe')
  assert.equal(bucket({ when: 'jour', day: '2026-11-20', until: '2026-11-20' }, '2026-11-07'), 'tard')
  assert.equal(untilLabel(Date.parse('2026-11-07T16:00:00Z'), T0, 'Europe/Paris'), '17h')
  assert.equal(untilLabel(Date.parse('2026-11-08T08:00:00Z'), T0, 'Europe/Paris'), 'demain 9h')
})

test('nouvel appareil : demander, valider sur son téléphone, se connecter', async () => {
  const t = setup()
  const { code, people } = await coloc(t, 3)
  const preview = (await t.call('join', { code })).json.coloc
  const lea = preview.members.find((m) => m.name === 'Léa')
  const start = await t.call('claim', { code, member: lea.id, device: 'mac' })
  assert.equal(start.status, 200, JSON.stringify(start.json))
  assert.equal(start.json.name, 'Léa')
  const claim = start.json.claim
  assert.ok(t.sent.some((s) => s.to === lea.id && s.text === 'Connexion sur un Mac : c’est toi ?'))
  assert.deepEqual((await t.call('claim', claim)).json, { pending: true, asked: false })
  // Sam ne peut pas valider tant que Léa n'a pas demandé de l'aide
  assert.equal((await t.call('action', { type: 'claimOk', id: claim.id }, people.Sam)).status, 400)
  const n = (await t.get(people['Léa'])).notifs.at(-1)
  await t.act(people['Léa'], { type: 'claimOk', id: n.actions[0].v, seenId: n.id })
  const done = await t.call('claim', claim)
  assert.equal(done.status, 200, JSON.stringify(done.json))
  const pc = done.json.session
  assert.equal(pc.memberId, lea.id)
  assert.equal(done.json.state.devices, 2)
  // les deux appareils marchent, la demande ne sert qu'une fois
  assert.equal((await t.call('state', {}, pc, 'GET')).status, 200)
  assert.equal((await t.call('state', {}, people['Léa'], 'GET')).status, 200)
  assert.equal((await t.call('claim', claim)).status, 410)
  // déconnecter les autres appareils depuis l'ordi
  const reset = await t.act(pc, { type: 'devicesReset' })
  assert.equal(reset.state.devices, 1)
  assert.equal((await t.call('state', {}, people['Léa'], 'GET')).status, 401)
})

test('nouvel appareil sans son téléphone : un coloc valide, ou refuse', async () => {
  const t = setup()
  const { code, people } = await coloc(t, 3)
  const sam = (await t.call('join', { code })).json.coloc.members.find((m) => m.name === 'Sam')
  const claim = (await t.call('claim', { code, member: sam.id, device: 'android' })).json.claim
  const asked = await t.call('claim', { ...claim, ask: true })
  assert.deepEqual(asked.json, { pending: true, asked: true })
  assert.ok(t.sent.some((s) => s.text === 'Sam se connecte sur un téléphone Android'))
  await t.act(people.huggo, { type: 'claimOk', id: claim.id })
  assert.ok(t.sent.some((s) => s.to === sam.id && s.text === 'Huggo a validé ta connexion sur un téléphone Android'))
  assert.equal((await t.call('claim', claim)).status, 200)
  const again = (await t.call('claim', { code, member: sam.id, device: 'iphone' })).json.claim
  await t.act(people.Sam, { type: 'claimNo', id: again.id })
  assert.equal((await t.call('claim', again)).status, 403)
  const late = (await t.call('claim', { code, member: sam.id })).json.claim
  t.tick(11 * 60e3)
  assert.equal((await t.call('claim', late)).status, 410)
})

test('code de connexion : affiché sur le téléphone, tapé sur le PC, même compte', async () => {
  const t = setup()
  const { code, people } = await coloc(t, 3)
  const lea = people['Léa']
  // il faut être connecté pour afficher un code
  assert.equal((await t.call('pair', {})).status, 401)
  const p = await t.call('pair', {}, lea)
  assert.equal(p.status, 200, JSON.stringify(p.json))
  assert.match(p.json.code, new RegExp(`^[${ALPHABET}]{6}$`))
  assert.notEqual(p.json.code, code)
  // une demande « c'est moi » en attente : visible sur le téléphone de Léa, pas chez Sam
  const preview = (await t.call('join', { code })).json.coloc
  const claim = (await t.call('claim', { code, member: lea.memberId, device: 'windows' })).json.claim
  const mine = (await t.get(lea)).claims
  assert.equal(mine.length, 1)
  assert.deepEqual([mine[0].device, mine[0].mine, mine[0].id], ['windows', true, claim.id])
  assert.equal((await t.get(people.Sam)).claims.length, 0)
  assert.ok(preview.members.length === 3)
  // le PC tape le code dans la même case que le code de la coloc
  const pc = await t.call('join', { code: p.json.code.toLowerCase(), device: 'windows' })
  assert.equal(pc.status, 200, JSON.stringify(pc.json))
  assert.equal(pc.json.session.memberId, lea.memberId)
  assert.equal(pc.json.session.colocId, lea.colocId)
  assert.equal(pc.json.state.devices, 2)
  assert.equal((await t.call('state', {}, pc.json.session, 'GET')).status, 200)
  assert.equal((await t.call('state', {}, lea, 'GET')).status, 200)
  assert.ok(t.sent.some((s) => s.to === lea.memberId && s.text === 'Ton compte est ouvert sur un PC Windows' && s.quiet))
  // la demande « c'est moi » ne sert plus : elle disparaît
  const after = await t.get(lea)
  assert.equal(after.claims.length, 0)
  assert.ok(!after.notifs.some((n) => n.key === 'claim:' + claim.id))
  assert.equal((await t.call('claim', claim)).status, 410)
  // un code ne sert qu'une fois
  assert.equal((await t.call('join', { code: p.json.code })).status, 404)
  // un code de connexion ne permet pas de demander « c'est moi »
  const p2 = (await t.call('pair', {}, lea)).json
  assert.equal((await t.call('claim', { code: p2.code, member: lea.memberId })).status, 404)
  // et il expire au bout de 10 minutes
  t.tick(10 * 60e3 + 1)
  assert.equal((await t.call('join', { code: p2.code })).status, 404)
  // quelqu'un retiré de la coloc ne peut plus s'en servir
  const p3 = (await t.call('pair', {}, people.Sam)).json
  await t.act(people.huggo, { type: 'memberRemove', id: people.Sam.memberId })
  assert.equal((await t.call('join', { code: p3.code })).status, 410)
})

test('une coloc créée avant les appareils multiples marche toujours', async () => {
  const t = setup()
  const { people } = await coloc(t, 2)
  const id = people.huggo.colocId
  const doc = await t.store.get(id)
  for (const m of doc.members) { m.tokenHash = m.tokens[0]; delete m.tokens }
  for (const k of ['items', 'reminders', 'lost', 'claims', 'links', 'shopping']) delete doc[k]
  assert.ok(await t.store.cas(id, doc, doc.version))
  const st = await t.get(people.huggo)
  assert.deepEqual([st.items, st.lost, st.devices], [[], [], 1])
  await t.act(people['Léa'], { type: 'itemAdd', list: 'courses', text: 'PQ' })
  const saved = await t.store.get(id)
  assert.ok(saved.members.every((m) => Array.isArray(m.tokens) && !('tokenHash' in m)))
})

test('agenda : on peut proposer un truc dans plusieurs mois', async () => {
  const t = setup()
  const { people } = await coloc(t, 2)
  const r = await t.act(people.huggo, { type: 'eventAdd', title: 'Nouvel an', when: 'jour', day: '2026-12-31' })
  assert.equal(r.state.events[0].day, '2026-12-31')
  assert.equal((await t.act(people.huggo, { type: 'eventAdd', title: 'Été', when: 'jour', day: '2027-07-14' })).state.events.length, 2)
  assert.equal((await t.call('action', { type: 'eventAdd', title: 'Trop loin', when: 'jour', day: '2028-01-01' }, people.huggo)).status, 400)
  assert.equal(dayShort('2026-12-31', '2026-11-07'), 'Jeu. 31 déc.')
  assert.equal(dayShort('2026-11-10', '2026-11-07'), 'Mar. 10')
})

test('courses : liste, je pars faire les courses, ajout prévenu, cochés effacés', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  await t.act(people['Léa'], { type: 'itemAdd', list: 'courses', text: 'Lessive' })
  const dup = await t.act(people.Sam, { type: 'itemAdd', list: 'courses', text: 'lessive' })
  assert.equal(dup.flash, 'Déjà sur la liste')
  await t.act(people.Sam, { type: 'itemAdd', list: 'todo', text: 'Appeler le proprio' })
  const go = await t.act(people.huggo, { type: 'shopping' })
  assert.match(go.flash, /Léa et Sam/)
  assert.ok(t.sent.some((s) => s.text === 'Huggo part faire les courses'))
  await t.act(people.Sam, { type: 'itemAdd', list: 'courses', text: 'PQ' })
  assert.ok(t.sent.some((s) => s.text === 'Sam ajoute : PQ'))
  const st = await t.get(people.huggo)
  assert.equal(st.items.length, 3)
  const lessive = st.items.find((i) => i.text === 'Lessive')
  const done = await t.act(people.huggo, { type: 'itemDone', id: lessive.id })
  assert.equal(done.state.items.find((i) => i.id === lessive.id).done.by, people.huggo.memberId)
  t.tick(3 * 864e5 + 1000)
  const later = await t.get(people.huggo)
  assert.deepEqual(later.items.map((i) => i.text), ['Appeler le proprio', 'PQ'])
  assert.equal(later.shopping, null)
})

test('tricount : on garde le lien, même collé avec le message de partage', async () => {
  const t = setup()
  const { people } = await coloc(t, 2)
  const r = await t.act(people.huggo, { type: 'colocLink', url: 'Rejoins le tricount « Coloc » : https://tricount.com/aBcD123xyz.' })
  assert.equal(r.state.links.tricount, 'https://tricount.com/aBcD123xyz')
  assert.equal((await t.act(people.huggo, { type: 'colocLink', url: 'tricount.com/aBc' })).state.links.tricount, 'https://tricount.com/aBc')
  assert.equal((await t.call('action', { type: 'colocLink', url: 'pas un lien' }, people.huggo)).status, 400)
  assert.equal((await t.act(people.huggo, { type: 'colocLink', url: '' })).state.links.tricount, null)
})

test('rappels : la tâche du soir prévient le bon jour, une seule fois, et « je m’en occupe »', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  // T0 est un samedi (6). Poubelles le samedi et le mardi.
  const r = await t.act(people['Léa'], { type: 'remindAdd', text: 'Poubelles jaunes', days: [6, 2] })
  const rem = r.state.reminders[0]
  assert.equal((await t.call('cron', {}, null, 'GET')).status, 401)
  const cron = () => t.api('cron', { method: 'GET', headers: { authorization: 'Bearer sekret' } })
  const first = await cron()
  assert.deepEqual(first.json, { colocs: 1, sent: 3 })
  assert.ok(t.sent.some((s) => s.text === 'Ce soir : poubelles jaunes'))
  assert.equal((await cron()).json.sent, 0, 'pas deux fois le même soir')
  await t.act(people.Sam, { type: 'remindTake', id: rem.id })
  const quiet = t.sent.filter((s) => s.text === 'Sam s’en occupe : poubelles jaunes')
  assert.equal(quiet.length, 2)
  assert.ok(quiet.every((s) => s.quiet))
  const huggo = await t.get(people.huggo)
  assert.equal(huggo.reminders[0].taken.by, people.Sam.memberId)
  assert.ok(!huggo.notifs.some((n) => n.key === 'remind:' + rem.id), 'la notif du soir disparaît dans l’appli')
  t.tick(864e5) // dimanche : rien
  assert.equal((await cron()).json.sent, 0)
  t.tick(2 * 864e5) // mardi
  assert.equal((await cron()).json.sent, 3)
})

test('à qui est-ce ? : photo, pas à moi, personne ne le réclame', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString('base64')
  assert.equal((await t.call('photo', { data: 'aGVsbG8=' }, people.huggo)).status, 400)
  const up = await t.call('photo', { data: 'data:image/jpeg;base64,' + jpeg }, people.huggo)
  assert.equal(up.status, 200)
  const shown = await t.api('photo', { method: 'GET', query: { c: people.huggo.colocId, p: up.json.id } })
  assert.equal(shown.status, 200)
  assert.equal(shown.body[0], 0xff)
  const add = await t.act(people.huggo, { type: 'lostAdd', photo: up.json.id, note: 'Pull bleu' })
  const item = add.state.lost[0]
  assert.equal(item.url, '/api/photo?c=' + people.huggo.colocId + '&p=' + up.json.id)
  const notif = t.sent.find((s) => s.text === 'Huggo a trouvé un truc : à qui est-ce ?')
  assert.equal(notif.image, item.url)
  await t.act(people['Léa'], { type: 'lostNot', id: item.id })
  assert.equal((await t.get(people.huggo)).lost.length, 1, 'Sam n’a pas encore répondu')
  const last = await t.act(people.Sam, { type: 'lostNot', id: item.id })
  assert.equal(last.state.lost.length, 0)
  assert.ok(t.sent.some((s) => s.to === people.huggo.memberId && s.text === 'Personne ne réclame « Pull bleu »'))
  assert.equal((await t.api('photo', { method: 'GET', query: { c: people.huggo.colocId, p: up.json.id } })).status, 404, 'photo effacée')
  // « c'est à moi »
  const up2 = (await t.call('photo', { data: jpeg }, people.Sam)).json.id
  const it2 = (await t.act(people.Sam, { type: 'lostAdd', photo: up2 })).state.lost[0]
  const mine = await t.act(people['Léa'], { type: 'lostMine', id: it2.id })
  assert.equal(mine.state.lost.length, 0)
  assert.ok(t.sent.some((s) => s.to === people.Sam.memberId && s.text === 'C’est à Léa'))
})

test('plantes : prochain arrosage selon la saison, engrais de mars à septembre', () => {
  const p = { water: [7, 14], feed: 30, log: [{ k: 'water', at: Date.parse('2027-05-01T10:00:00Z') }], snooze: null }
  assert.deepEqual(plantDue(p, '2027-05-03', 'Europe/Paris'), { due: '2027-05-08', last: '2027-05-01', lastBy: undefined, every: 7, late: -5 })
  assert.equal(plantDue(p, '2027-11-03', 'Europe/Paris').every, 14, 'en automne-hiver, on espace')
  assert.equal(plantDue({ ...p, log: [] }, '2027-05-03', 'Europe/Paris').late, 0, 'jamais arrosée : aujourd’hui')
  assert.equal(plantDue({ ...p, snooze: '2027-05-10' }, '2027-05-03', 'Europe/Paris').due, '2027-05-10', 'pas encore soif')
  assert.equal(feedDue(p, '2027-05-03', 'Europe/Paris'), true)
  assert.equal(feedDue(p, '2027-11-03', 'Europe/Paris'), false, 'pas d’engrais en hiver')
  assert.equal(feedDue({ ...p, feed: 0 }, '2027-05-03', 'Europe/Paris'), false)
  for (const [k, sp] of Object.entries(PLANTS)) {
    assert.ok(sp.water[0] <= sp.water[1], k + ' : on arrose moins en hiver')
    assert.ok(LIGHT[sp.light] && HUM[sp.hum] && FEEDS.includes(sp.feed), k)
  }
})

test('plantes : ajouter, arroser, pas encore soif, modifier, photo, retirer', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  assert.equal((await t.call('action', { type: 'plantAdd', sp: 'autre', name: ' ' }, people.huggo)).status, 400, 'une plante inconnue a besoin d’un nom')
  // Samedi 7 novembre : automne-hiver, la Monstera se contente d'un arrosage tous les 14 jours.
  let st = (await t.act(people.huggo, { type: 'plantAdd', sp: 'monstera', room: 'Salon', ago: 7 })).state
  const mon = st.plants[0]
  assert.equal(mon.name, 'Monstera')
  assert.deepEqual(mon.water, [7, 14])
  assert.equal(mon.toxic, true)
  assert.equal(plantDue(mon, '2026-11-07', 'Europe/Paris').due, '2026-11-14')
  st = (await t.act(people.huggo, { type: 'plantAdd', sp: 'basilic', name: 'Basilic du balcon', owner: people['Léa'].memberId })).state
  const bas = st.plants[1]
  assert.equal(bas.owner, people['Léa'].memberId)
  assert.equal(plantDue(bas, '2026-11-07', 'Europe/Paris').late, 0, 'jamais arrosé : à faire')
  const w = await t.act(people['Léa'], { type: 'plantLog', id: bas.id, kind: 'water' })
  assert.equal(w.flash, 'Arrosée. Prochain arrosage : mardi 10 novembre')
  assert.equal(w.state.plants[1].log[0].by, people['Léa'].memberId)
  // Mardi : le basilic a soif, mais la terre est encore humide.
  t.tick(3 * 864e5)
  const ck = await t.act(people.Sam, { type: 'plantLog', id: bas.id, kind: 'check' })
  assert.equal(ck.flash, 'OK, on la revérifie demain')
  const b2 = ck.state.plants[1]
  assert.equal(plantDue(b2, '2026-11-10', 'Europe/Paris').due, '2026-11-11')
  const undo = await t.act(people.Sam, { type: 'plantLogDelete', id: bas.id, log: b2.log[1].id })
  assert.equal(undo.state.plants[1].snooze, null, 'pas encore soif retiré : on n’attend plus')
  // Arrosée hier, oublié de le noter
  const y = await t.act(people.huggo, { type: 'plantLog', id: mon.id, kind: 'water', ago: 1 })
  assert.equal(plantDue(y.state.plants[0], '2026-11-10', 'Europe/Paris').last, '2026-11-09')
  assert.equal((await t.call('action', { type: 'plantLog', id: mon.id, kind: 'water', ago: 99 }, people.huggo)).status, 400)
  // Modifier : nom vide = nom de l'espèce, lumière inconnue = on garde l'ancienne
  const ed = await t.act(people.Sam, { type: 'plantEdit', id: mon.id, sp: 'monstera', name: '', light: 'néon', water: [6, 12], room: 'Chambre', notes: 'Tuteur à changer' })
  assert.deepEqual([ed.state.plants[0].name, ed.state.plants[0].light, ed.state.plants[0].water, ed.state.plants[0].room], ['Monstera', 'vive', [6, 12], 'Chambre'])
  // Photo : gardée pour de bon une fois la plante enregistrée, effacée quand on la change ou qu'on retire la plante
  const kept = []
  const keep = t.store.photoKeep
  t.store.photoKeep = async (k) => { kept.push(k); return keep(k) }
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')
  const ph = (await t.call('photo', { data: jpeg }, people.Sam)).json.id
  await t.act(people.Sam, { type: 'plantEdit', id: mon.id, name: 'Gérard' })
  const withPhoto = await t.act(people.Sam, { type: 'plantEdit', id: mon.id, photo: ph })
  assert.deepEqual([withPhoto.state.plants[0].name, withPhoto.state.plants[0].room], ['Gérard', 'Chambre'], 'changer la photo ne touche pas au reste')
  assert.equal(withPhoto.state.plants[0].url, '/api/photo?c=' + people.Sam.colocId + '&p=' + ph)
  assert.deepEqual(kept, [people.Sam.colocId + ':' + ph])
  const photoStatus = async () => (await t.api('photo', { method: 'GET', query: { c: people.Sam.colocId, p: ph } })).status
  assert.equal(await photoStatus(), 200)
  await t.act(people.Sam, { type: 'plantDelete', id: mon.id })
  assert.equal(await photoStatus(), 404)
  // Léa quitte la coloc : le basilic n'a plus de responsable
  const left = await t.act(people.huggo, { type: 'memberRemove', id: people['Léa'].memberId })
  assert.deepEqual(left.state.plants.map((p) => [p.name, p.owner]), [['Basilic du balcon', null]])
})

test('plantes : la tâche du soir prévient qui s’en occupe, une fois, puis tous les 3 jours', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')
  const ph = (await t.call('photo', { data: jpeg }, people.huggo)).json.id
  const add = (body) => t.act(people.huggo, { type: 'plantAdd', ...body })
  await add({ sp: 'monstera', ago: 14, photo: ph }) // à arroser aujourd'hui
  await add({ sp: 'basilic', ago: 0 }) // mardi
  const st = (await add({ sp: 'pothos', ago: 20, owner: people['Léa'].memberId })).state // en retard, c'est Léa qui s'en occupe
  const [mon, bas, pot] = st.plants
  const cron = () => t.api('cron', { method: 'GET', headers: { authorization: 'Bearer sekret' } })
  t.sent.length = 0
  assert.deepEqual((await cron()).json, { colocs: 1, sent: 3 })
  const to = (who) => t.sent.filter((s) => s.to === people[who].memberId).map((s) => s.text)
  assert.deepEqual(to('Léa'), ['2 plantes ont soif'])
  assert.deepEqual(to('huggo'), ['Monstera a soif'])
  assert.deepEqual(to('Sam'), ['Monstera a soif'])
  assert.equal(t.sent.find((s) => s.to === people.huggo.memberId).image, '/api/photo?c=' + people.huggo.colocId + '&p=' + ph)
  assert.equal((await cron()).json.sent, 0, 'pas deux fois le même soir')
  t.tick(864e5)
  assert.equal((await cron()).json.sent, 0, 'pas tous les soirs')
  // Dimanche : Huggo arrose la Monstera, le Pothos a encore soif ; puis Léa l'arrose, tout est fait.
  t.sent.length = 0
  await t.act(people.huggo, { type: 'plantLog', id: mon.id, kind: 'water' })
  assert.equal(t.sent.length, 0)
  await t.act(people['Léa'], { type: 'plantLog', ids: [pot.id], kind: 'water' })
  assert.deepEqual(t.sent.map((s) => [s.text, s.quiet]), [['Léa a arrosé les plantes', true], ['Léa a arrosé les plantes', true]])
  assert.ok(!(await t.get(people.Sam)).notifs.some((n) => n.key === 'plants'), 'la notif disparaît dans l’appli')
  // Mardi : le basilic. Mercredi : rien. Vendredi : on rappelle, sauf à Sam qui est en voyage.
  t.tick(2 * 864e5)
  t.sent.length = 0
  assert.equal((await cron()).json.sent, 3)
  assert.ok(t.sent.every((s) => s.text === 'Basilic a soif'))
  t.tick(864e5)
  assert.equal((await cron()).json.sent, 0)
  await t.act(people.Sam, { type: 'status', kind: 'away', back: 'dans une semaine' })
  t.tick(2 * 864e5)
  assert.equal((await cron()).json.sent, 2)
  // Vendredi soir, la terre est encore humide : on revient voir demain, et la notif repart.
  await t.act(people.huggo, { type: 'plantLog', id: bas.id, kind: 'check' })
  t.tick(864e5)
  assert.equal((await cron()).json.sent, 2)
  // Plus de plantes ni de rappels : la coloc sort de l'index du soir.
  for (const id of [mon.id, bas.id, pot.id]) await t.act(people.huggo, { type: 'plantDelete', id })
  assert.deepEqual((await cron()).json, { colocs: 1, sent: 0 })
  assert.deepEqual((await cron()).json, { colocs: 0, sent: 0 })
})

test('chat : message, élément cité, notifs regroupées, lu', async () => {
  const t = setup()
  const { people } = await coloc(t, 3)
  const lea = people['Léa']
  const sam = people.Sam
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')
  const ph = (await t.call('photo', { data: jpeg }, lea)).json.id
  const keys = (await t.act(lea, { type: 'lostAdd', photo: ph, note: 'Clés' })).state.lost[0]
  t.sent.length = 0
  t.tick(60e3)

  // Message vide, élément inconnu
  assert.equal((await t.call('action', { type: 'chatSend', text: '   ' }, people.huggo)).status, 400)
  const bad = await t.call('action', { type: 'chatSend', text: 'hein', ref: { t: 'lost', id: 'o_nope' } }, people.huggo)
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /plus dans la liste/)
  assert.equal((await t.call('action', { type: 'chatSend', text: 'x', ref: { t: '__proto__', id: 'a' } }, people.huggo)).status, 400)

  // Huggo répond à « à qui est-ce ? » dans le chat
  const r = await t.act(people.huggo, { type: 'chatSend', text: '  C’est la clé de la boîte aux lettres\r\n\n\n\nelle était dans l’entrée ', ref: { t: 'lost', id: keys.id } })
  const m = r.state.chat[0]
  assert.equal(m.text, 'C’est la clé de la boîte aux lettres\n\nelle était dans l’entrée')
  assert.deepEqual([m.ref.t, m.ref.id, m.ref.title, m.ref.url], ['lost', keys.id, 'Clés', keys.url])
  assert.equal(r.state.chatRead, m.at, 'ses propres messages sont lus')
  assert.equal(t.sent.length, 2, 'Léa et Sam')
  const toLea = t.sent.find((x) => x.to === lea.memberId)
  assert.deepEqual([toLea.text, toLea.key, toLea.badge, toLea.image, toLea.quiet], ['Huggo · « Clés »', 'chat', 1, keys.url, false])
  assert.match(toLea.sub, /^C’est la clé de la boîte aux lettres/)
  const leaState = await t.get(lea)
  assert.ok(!leaState.notifs.some((n) => n.key === 'chat'), 'pas de bannière dans l’appli pour le chat')
  assert.equal(leaState.chat.filter((x) => x.by !== lea.memberId && x.at > leaState.chatRead).length, 1, 'non lu pour Léa')

  // Deuxième message : la notif dit « 2 nouveaux messages » à qui n'a pas lu, et ne sonne pas pour qui est dans le chat
  t.tick(5000)
  await t.act(lea, { type: 'chatRead', at: m.at })
  t.tick(10000)
  t.sent.length = 0
  await t.act(people.huggo, { type: 'chatSend', text: 'Je la mets sur le meuble' })
  const toSam = t.sent.find((x) => x.to === sam.memberId)
  assert.deepEqual([toSam.text, toSam.sub, toSam.badge, toSam.quiet], ['2 nouveaux messages', 'Huggo : Je la mets sur le meuble', 2, false])
  const toLea2 = t.sent.find((x) => x.to === lea.memberId)
  assert.deepEqual([toLea2.text, toLea2.badge, toLea2.quiet], ['Huggo', 1, true])

  // Lu : plus rien de non lu ; une date dans le futur est ramenée à maintenant
  const read = await t.act(sam, { type: 'chatRead', at: Date.now() + 9e12 })
  assert.equal(read.state.chat.filter((x) => x.by !== sam.memberId && x.at > read.state.chatRead).length, 0)
  assert.ok(read.state.chatRead <= T0 + 120e3)

  // Retirer : seulement ses messages
  const second = read.state.chat[1]
  assert.equal((await t.call('action', { type: 'chatDelete', id: second.id }, sam)).status, 400)
  assert.equal((await t.act(people.huggo, { type: 'chatDelete', id: second.id })).state.chat.length, 1)

  // L'objet est réclamé : il sort de la liste, mais sa photo reste visible dans le chat (elle expirera)
  const expired = []
  t.store.photoExpire = async (k, ttl) => { expired.push([k, ttl]) }
  await t.act(lea, { type: 'lostMine', id: keys.id })
  assert.deepEqual(expired, [[lea.colocId + ':' + ph, 120 * 86400]])
  assert.equal((await t.api('photo', { method: 'GET', query: { c: lea.colocId, p: ph } })).status, 200)
  const after = await t.get(sam)
  assert.equal(after.lost.length, 0)
  assert.equal(after.chat[0].ref.url, keys.url)

  // Une plante, une course, une soirée, une envie
  const pl = (await t.act(sam, { type: 'plantAdd', sp: 'pothos' })).state.plants[0]
  const it = (await t.act(sam, { type: 'itemAdd', list: 'courses', text: 'Lait' })).state.items[0]
  const ev = (await t.act(sam, { type: 'eventAdd', etype: 'film', title: 'Dune', when: 'soir' })).state.events[0]
  const idea = (await t.act(sam, { type: 'ideaAdd', kind: 'video', title: 'Clip' })).state.ideas[0]
  for (const [ref, title] of [[{ t: 'plant', id: pl.id }, 'Pothos'], [{ t: 'item', id: it.id }, 'Lait'], [{ t: 'event', id: ev.id }, 'Dune'], [{ t: 'idea', id: idea.id }, 'Clip']]) {
    const res = await t.act(lea, { type: 'chatSend', text: 'ok', ref })
    assert.equal(res.state.chat[res.state.chat.length - 1].ref.title, title)
  }
  const last = (await t.get(lea)).chat
  assert.equal(last[last.length - 3].ref.list, 'courses')
  assert.equal(last[last.length - 1].ref.kind, 'video')

  // Le chat garde les 200 derniers messages
  for (let i = 0; i < 205; i++) await t.act(sam, { type: 'chatSend', text: 'm' + i })
  const full = await t.get(sam)
  assert.equal(full.chat.length, 200)
  assert.equal(full.chat[199].text, 'm204')

  // Quelqu'un qui arrive voit l'historique, sans 200 messages « non lus »
  const max = await t.call('join', { code: (await t.get(sam)).code, memberName: 'Max' })
  const mx = max.json.state
  assert.equal(mx.chat.length, 200)
  assert.equal(mx.chat.filter((x) => x.at > mx.chatRead).length, 0)
})

test('état : rien de changé depuis la version affichée, réponse vide', async () => {
  const t = setup()
  const { people } = await coloc(t, 2)
  const st = await t.get(people.huggo)
  const same = await t.call('state', {}, people.huggo, 'GET')
  assert.ok(same.json.state)
  const r = await t.api('state', { method: 'GET', query: { v: String(st.version) }, headers: { authorization: `Bearer ${people.huggo.colocId}.${people.huggo.memberId}.${people.huggo.token}` } })
  assert.deepEqual(r.json, { same: true })
  await t.act(people['Léa'], { type: 'chatSend', text: 'coucou' })
  const r2 = await t.api('state', { method: 'GET', query: { v: String(st.version) }, headers: { authorization: `Bearer ${people.huggo.colocId}.${people.huggo.memberId}.${people.huggo.token}` } })
  assert.equal(r2.json.state.chat[0].text, 'coucou')
  assert.equal(r2.json.state.version, st.version + 1)
})

test('week-end : là ou pas, 4 week-ends, le soir où l’on n’est pas là les rappels vont aux autres', async () => {
  assert.deepEqual(['2026-11-09', '2026-11-13', '2026-11-14', '2026-11-15'].map(weekendOf), ['2026-11-14', '2026-11-14', '2026-11-14', '2026-11-14'])
  assert.deepEqual(weekendList('2026-11-07'), ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'])
  assert.deepEqual(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map(weekendSlot), [0, 1, 2, -1])

  const t = setup() // samedi 7 novembre, 16h20
  const { people } = await coloc(t, 3)
  const lea = people['Léa']
  const sam = people.Sam
  assert.equal((await t.call('action', { type: 'weekend', sat: '2026-12-05', days: [true, true, true] }, lea)).status, 400, '5e week-end')
  assert.equal((await t.call('action', { type: 'weekend', sat: '2026-11-08', days: [true, true, true] }, lea)).status, 400, 'pas un samedi')
  const r = await t.act(lea, { type: 'weekend', sat: '2026-11-07', days: [false, false, false] })
  assert.equal(r.flash, 'Noté : pas là ce week-end')
  assert.deepEqual(r.state.weekends['2026-11-07'][lea.memberId].days, [false, false, false])
  const r2 = await t.act(sam, { type: 'weekend', sat: '2026-11-14', days: [true, 'x', false] })
  assert.equal(r2.flash, 'Noté pour le week-end du 14 nov.')
  assert.deepEqual(r2.state.weekends['2026-11-14'][sam.memberId].days, [true, null, false])
  assert.equal((await t.act(sam, { type: 'weekend', sat: '2026-11-14', days: [null, null, null] })).state.weekends['2026-11-14'], undefined, 'plus rien de dit')
  assert.equal((await t.act(sam, { type: 'weekend', sat: '2026-11-21', days: [true, true, true] })).flash, 'Noté : tu es là le week-end du 21 nov.')

  // Samedi soir : Léa n'est pas là. Les poubelles et la plante dont elle s'occupe vont aux autres.
  await t.act(people.huggo, { type: 'remindAdd', text: 'Poubelles', days: [6] })
  await t.act(lea, { type: 'plantAdd', sp: 'pothos', owner: lea.memberId })
  t.sent.length = 0
  await t.api('cron', { method: 'GET', headers: { authorization: 'Bearer sekret' } })
  const to = (text) => t.sent.filter((x) => x.text === text).map((x) => x.to).sort()
  const others = [people.huggo.memberId, sam.memberId].sort()
  assert.deepEqual(to('Ce soir : poubelles'), others)
  assert.deepEqual(to('Pothos a soif'), others)

  // Lundi : le week-end passé disparaît ; quelqu'un qui part emporte ses réponses
  t.tick(2 * 864e5)
  const mon = await t.get(lea)
  assert.equal(mon.weekends['2026-11-07'], undefined)
  assert.ok(mon.weekends['2026-11-21'])
  const gone = await t.act(people.huggo, { type: 'memberRemove', id: sam.memberId })
  assert.equal(gone.state.weekends['2026-11-21'], undefined)
})
