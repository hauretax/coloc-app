import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApi } from '../server/handlers.js'
import { memoryStore } from '../server/store.js'
import { cleanCode, ALPHABET, whenRange, bucket, untilLabel, dayShort, isoAdd } from '../shared/rules.js'

// Samedi 7 novembre 2026, 16h20 à Paris
const T0 = Date.parse('2026-11-07T15:20:00Z')

function setup() {
  let now = T0
  const sent = []
  const push = {
    publicKey: 'test-key',
    async send(doc, out) { for (const o of out) sent.push({ to: o.to, text: o.n.text, image: o.n.image, quiet: o.n.quiet }); return [] },
  }
  const store = memoryStore()
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
