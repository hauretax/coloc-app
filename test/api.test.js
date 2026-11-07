import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApi } from '../server/handlers.js'
import { memoryStore } from '../server/store.js'
import { cleanCode, ALPHABET, whenRange, bucket, untilLabel } from '../shared/rules.js'

// Samedi 7 novembre 2026, 16h20 à Paris
const T0 = Date.parse('2026-11-07T15:20:00Z')

function setup() {
  let now = T0
  const sent = []
  const push = {
    publicKey: 'test-key',
    async send(doc, out) { for (const o of out) sent.push({ to: o.to, text: o.n.text }); return [] },
  }
  const api = makeApi({ store: memoryStore(), push, clock: () => now })
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
  return { api, call, act, sent, tick: (ms) => { now += ms } }
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
  assert.equal(full.status, 409)
  assert.match(full.json.error, /complète \(4 sur 4\)/)
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
  assert.equal((await t.call('join', { code })).status, 409)
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
