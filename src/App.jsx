import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, loadSession, saveSession } from './api.js'
import { Icon, Av, Avs, Chips, Label, Sheet, Stepper, Logo, copyText } from './ui.jsx'
import Onboarding from './Onboarding.jsx'
import { pushStatus, enablePush, resyncPush, isIOS, isStandalone } from './push.js'
import {
  KINDS, WHAT, TYPES, IKINDS, STAGES, BUCKETS, MAX_MEMBERS, MIN_MEMBERS,
  todayISO, hm, untilLabel, bucket, whenShort, dayShort, isoAdd, listNames, plural, fmtCode,
} from '../shared/rules.js'

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [boot, setBoot] = useState(null)
  const [goneMsg, setGoneMsg] = useState('')
  if (!session) {
    return (
      <Onboarding
        msg={goneMsg}
        onDone={(s, st) => {
          saveSession(s)
          try { history.replaceState(null, '', '/') } catch { /* rien */ }
          setBoot(st)
          setGoneMsg('')
          setSession(s)
        }}
      />
    )
  }
  return (
    <Coloc
      key={session.memberId}
      session={session}
      boot={boot}
      onGone={(m) => { saveSession(null); setBoot(null); setGoneMsg(m || ''); setSession(null) }}
    />
  )
}

/* ---------- Choix de statut, de bruit, de moment ---------- */
const STATUS_OPTS = [
  ['home', 'À la coloc', 'Tu es là, rien de spécial'],
  ['calm', 'Au calme', 'Tu es là, mais pas de bruit stp'],
  ['out', 'Dehors', 'Tu rentres aujourd’hui'],
  ['away', 'En voyage', 'Pas de retour ce soir'],
]
const CALM_REASONS = ['Je bosse', 'En call', 'Révisions', 'Je dors', 'Besoin de calme']
const AWAY_BACK = ['demain soir', 'dans quelques jours', 'dans une semaine']
const COMPLAINTS = ['Je suis en call', 'Je bosse', 'Je dors', 'Juste pas maintenant']
const WHEN_OPTS = [
  { v: 'soir', l: 'Ce soir' }, { v: 'demain', l: 'Demain' }, { v: 'weekend', l: 'Ce week-end' },
  { v: 'semaine', l: 'Dans la semaine' }, { v: 'jour', l: 'Un jour précis' },
]
const TIME_OPTS = [{ v: '', l: 'Pas d’heure' }, ...['18h', '19h', '20h', '21h', '22h'].map((x) => ({ v: x, l: x }))]
const TYPE_OPTS = Object.entries(TYPES).map(([v, t]) => ({ v, l: t.label }))

function atHour(base, h, addDays = 0) {
  const d = new Date(base)
  d.setDate(d.getDate() + addDays)
  d.setHours(h, 0, 0, 0)
  return d.getTime()
}
function calmUntilOptions(now) {
  const list = [
    { v: '1h', l: 'Dans 1 h', ms: now + 3600e3 },
    { v: '2h', l: 'Dans 2 h', ms: now + 7200e3 },
  ]
  for (const h of [20, 23]) if (atHour(now, h) - now > 2.5 * 3600e3) list.push({ v: h + 'h', l: 'Jusqu’à ' + h + 'h', ms: atHour(now, h) })
  list.push({ v: 'matin', l: 'Demain matin', ms: atHour(now, 9, 1) })
  return list
}
function outBackOptions(now, tz) {
  const list = [{ v: 'vers ' + hm(now + 3600e3, tz), l: 'Dans 1 h' }]
  for (const h of [20, 23]) if (atHour(now, h) - now > 1.5 * 3600e3) list.push({ v: 'vers ' + h + 'h', l: 'Vers ' + h + 'h' })
  list.push({ v: 'tard ce soir', l: 'Tard ce soir' }, { v: 'à une heure inconnue', l: 'Je ne sais pas' })
  return list
}

/* ---------- La coloc ---------- */
function Coloc({ session, boot, onGone }) {
  const [st, setSt] = useState(boot)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState('home')
  const [filter, setFilter] = useState('all')
  const [sheet, setSheet] = useState(null)
  const [flash, setFlash] = useState(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [push, setPush] = useState('off')
  const flashT = useRef(0)

  const showFlash = useCallback((m) => {
    setFlash(m)
    clearTimeout(flashT.current)
    flashT.current = setTimeout(() => setFlash(null), 2800)
  }, [])
  const handleErr = useCallback((e) => {
    if (e instanceof ApiError && e.status === 401 && e.data && e.data.error === 'gone') { onGone(e.data.message); return true }
    return false
  }, [onGone])

  const refresh = useCallback(async () => {
    try {
      const r = await api.state(session)
      setSt(r.state)
      setNow(Date.now())
      setLoadErr('')
    } catch (e) {
      if (!handleErr(e)) setLoadErr(e.message)
    }
  }, [session, handleErr])

  const act = useCallback(async (a) => {
    setBusy(true)
    try {
      const r = await api.action(session, a)
      if (r.left) { onGone(r.message); return null }
      setSt(r.state)
      setNow(Date.now())
      if (r.flash) showFlash(r.flash)
      return r
    } catch (e) {
      if (!handleErr(e)) showFlash(e.message)
      return null
    } finally {
      setBusy(false)
    }
  }, [session, handleErr, onGone, showFlash])

  useEffect(() => {
    if (!boot) refresh()
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = setInterval(tick, 12000)
    const onMsg = (e) => { if (e.data && e.data.type === 'refresh') refresh() }
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
      navigator.serviceWorker?.removeEventListener('message', onMsg)
    }
  }, [refresh, boot])

  useEffect(() => { pushStatus().then(setPush) }, [])
  const pushCount = st ? st.pushCount : 1
  useEffect(() => {
    if (st) resyncPush(session, pushCount).then((r) => { if (r && r.state) setSt(r.state) }).catch(() => {})
    // une seule fois par session de l'appli
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!st])

  if (!st) {
    return (
      <div className="splash">
        <Logo s={30} cls="xl" />
        <p>{loadErr || 'Chargement…'}</p>
        {loadErr ? <button type="button" className="btn btn-primary" onClick={refresh}>Réessayer</button> : null}
      </div>
    )
  }

  const tz = st.tz
  const today = todayISO(now, tz)
  const P = (id) => st.people.find((p) => p.id === id) || { id, name: '?', color: '#ccc' }
  const members = st.people.filter((p) => !p.gone)
  const status = (id) => {
    const s = st.status[id] || { kind: 'home', since: now }
    return s.kind === 'calm' && s.until <= now ? { kind: 'home', since: s.until } : s
  }
  const sinceLabel = (ms) => {
    const d = todayISO(ms, tz)
    if (d === today) return hm(ms, tz)
    if (d === isoAdd(today, -1)) return 'hier ' + hm(ms, tz)
    return dayShort(d, today).toLowerCase()
  }
  const detail = (id) => {
    const s = status(id)
    if (s.kind === 'home') return 'depuis ' + sinceLabel(s.since)
    if (s.kind === 'calm') return s.reason + ' · jusqu’à ' + untilLabel(s.until, now, tz)
    return 'retour ' + s.back
  }
  const enable = async () => {
    try {
      const r = await enablePush(session)
      if (r && r.state) setSt(r.state)
      setPush('on')
      showFlash('Notifs activées sur ce téléphone')
    } catch (e) {
      showFlash(e.message)
      pushStatus().then(setPush)
    }
  }
  const c = {
    st, me: st.me, P, members, status, detail, act, busy, today, now, tz, sinceLabel,
    open: (type, extra) => setSheet({ type, ...extra }), close: () => setSheet(null), setTab, flash: showFlash,
    session, push, enable,
  }

  const titles = { home: st.name, agenda: 'Agenda', envies: 'Envies' }
  const subs = {
    home: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now),
    agenda: 'Ce soir, demain, ce week-end…',
    envies: 'Films, idées de sorties, projets vidéo',
  }
  const tabs = [['home', 'Maison', 'home'], ['agenda', 'Agenda', 'cal'], ['envies', 'Envies', 'bulb']]
  const meK = KINDS[status(st.me).kind]

  return (
    <div className="shell">
      <div className="app">
        <nav className="nav" aria-label="Sections">
          <div className="nav-brand"><Logo s={17} />Chez nous</div>
          {tabs.map(([k, l, i]) => (
            <button key={k} type="button" className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
              <span className="tab-ic"><Icon n={i} s={22} /></span><span>{l}</span>
            </button>
          ))}
          <button type="button" className="nav-me" onClick={() => c.open('status')}>
            <Av p={P(st.me)} s={36} />
            <span><b>{P(st.me).name}</b><small>{meK.label}</small></span>
          </button>
        </nav>
        <div className="main">
          <header className="ahead">
            <div>
              <h2>{titles[tab]}</h2>
              <p>{subs[tab].charAt(0).toUpperCase() + subs[tab].slice(1)}</p>
            </div>
            {tab === 'home' ? (
              <div className="ahead-btns">
                <button type="button" className="icon-btn" onClick={() => c.open('coloc')} aria-label="La coloc : code et habitants"><Icon n="users" s={19} /></button>
                <button type="button" className="me-btn" onClick={() => c.open('status')} aria-label="Changer mon statut"><Av p={P(st.me)} s={38} /></button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => c.open(tab === 'agenda' ? 'addEvent' : 'addIdea', tab === 'envies' && filter !== 'all' ? { kind: filter } : {})}>
                <Icon n="plus" s={18} />{tab === 'agenda' ? 'Proposer' : 'Ajouter'}
              </button>
            )}
          </header>
          <div className="scroll">
            {tab === 'home' ? <Home c={c} /> : tab === 'agenda' ? <Agenda c={c} /> : <Envies c={c} filter={filter} setFilter={setFilter} />}
          </div>
        </div>
      </div>
      <PushBanner c={c} />
      {sheet ? <Sheets c={c} sheet={sheet} /> : null}
      {flash ? <div className="toast" role="status">{flash}</div> : null}
    </div>
  )
}

/* ---------- Maison ---------- */
function Home({ c }) {
  const k = c.status(c.me).kind
  const away = k === 'out' || k === 'away'
  return (
    <div className="home">
      <div className="col">
        <MyStatus c={c} />
        {away ? <><Door c={c} /><Noise c={c} /></> : <><Noise c={c} /><Door c={c} /></>}
      </div>
      <div className="col">
        <PushCard c={c} />
        <Who c={c} />
        <Soon c={c} />
      </div>
    </div>
  )
}

function MyStatus({ c }) {
  const k = KINDS[c.status(c.me).kind]
  return (
    <button type="button" className={'mystatus tone-' + k.tone} onClick={() => c.open('status')}>
      <span className="ms-ic"><Icon n={k.icon} s={21} /></span>
      <span className="ms-txt"><small>Ton statut</small><b>{k.label}</b><em>{c.detail(c.me)}</em></span>
      <span className="ms-cta">Changer</span>
    </button>
  )
}

function Noise({ c }) {
  const { st, me, P, tz, now } = c
  const n = st.noise && (!st.noise.until || st.noise.until > now) ? st.noise : null
  const myKind = c.status(me).kind
  const others = c.members.filter((p) => p.id !== me)
  const calm = others.filter((p) => c.status(p.id).kind === 'calm')
  const here = others.filter((p) => ['home', 'calm'].includes(c.status(p.id).kind))
  const head = <div className="eyebrow"><Icon n="note" s={15} /> Bruit{n ? ' · en cours' : ''}</div>

  if (n) {
    const w = WHAT[n.what] || WHAT.autre
    const when = n.until ? 'Jusqu’à ' + hm(n.until, tz) + '.' : 'Depuis ' + hm(n.since, tz) + ', sans heure de fin.'
    if (n.by === me) {
      return (
        <section className="answer tone-brass">
          {head}
          <h3>{w.mine}</h3>
          <p>{when}{n.told.length ? ' Notif envoyée à ' + listNames(n.told.map((id) => P(id).name)) + '.' : ''}</p>
          {n.complaints.length ? (
            <ul className="replies">
              {n.complaints.map((x) => <li key={x.by}><Av p={P(x.by)} s={26} /><span><b>{P(x.by).name}</b> : {x.reason}</span></li>)}
            </ul>
          ) : <p className="hint">Personne ne s’est plaint pour l’instant.</p>}
          <div className="actions"><button type="button" className="btn btn-ink" disabled={c.busy} onClick={() => c.act({ type: 'noiseStop' })}>J’ai fini</button></div>
        </section>
      )
    }
    const mine = n.complaints.find((x) => x.by === me)
    const outside = myKind === 'out' || myKind === 'away'
    return (
      <section className="answer tone-brass">
        {head}
        <h3>{w.other(P(n.by).name)}</h3>
        <p>{when}{outside ? ' Tu es dehors, tu ne l’entends pas.' : ''}</p>
        {mine ? <p className="hint">Tu as répondu : « {mine.reason} »{mine.answer ? ' · ' + mine.answer : ''}</p> : null}
        {outside ? null : (
          <div className="actions">
            <button type="button" className="btn btn-stop" onClick={() => c.open('complain')}><Icon n="mute" s={18} />{mine ? 'Redire que ça dérange' : 'Ça me dérange'}</button>
          </div>
        )}
      </section>
    )
  }
  if (myKind === 'out' || myKind === 'away') {
    return <section className="answer tone-plain">{head}<h3>Calme à la coloc</h3><p>Personne ne fait de bruit en ce moment.</p></section>
  }
  if (calm.length) {
    const until = Math.max(...calm.map((p) => c.status(p.id).until))
    const lbl = untilLabel(until, now, tz)
    const sameDay = todayISO(until, tz) === c.today
    return (
      <section className="answer tone-stop">
        {head}
        <h3>{sameDay ? 'Plutôt après ' + lbl : 'Plutôt ' + lbl.split(' ')[0]}</h3>
        <p>{calm.map((p) => P(p.id).name + ' demande du calme (' + c.status(p.id).reason.toLowerCase() + ') jusqu’à ' + untilLabel(c.status(p.id).until, now, tz)).join('. ')}.</p>
        {st.waiting ? <p className="hint">Une notif t’arrivera dès que c’est calme.</p> : null}
        <div className="actions">
          {st.waiting ? null : <button type="button" className="btn btn-primary" disabled={c.busy} onClick={() => c.act({ type: 'waitCalm' })}><Icon n="bell" s={18} />Préviens-moi quand c’est calme</button>}
          <button type="button" className="btn btn-ghost" onClick={() => c.open('noise')}>Jouer quand même</button>
        </div>
      </section>
    )
  }
  return (
    <section className="answer tone-ok">
      {head}
      <h3>Feu vert</h3>
      <p>{here.length ? listNames(here.map((p) => p.name)) + (here.length > 1 ? ' sont' : ' est') + ' là, personne n’a demandé de calme.' : 'Personne d’autre n’est à la coloc.'}</p>
      <div className="actions"><button type="button" className="btn btn-primary" onClick={() => c.open('noise')}><Icon n="note" s={18} />Je joue maintenant</button></div>
    </section>
  )
}

function Door({ c }) {
  const { st, me, P } = c
  const d = st.door
  const out = c.members.filter((p) => p.id !== me && c.status(p.id).kind === 'out')
  const away = c.members.filter((p) => p.id !== me && c.status(p.id).kind === 'away')
  const iOut = c.status(me).kind === 'out'
  const head = <div className="eyebrow"><Icon n="door" s={15} /> Porte du bas</div>
  const by = d.closed ? 'Fermée par ' + (d.by === me ? 'toi' : P(d.by).name) + ', ' + c.sinceLabel(d.at) + '.' : ''
  const backHome = () => c.act({ type: 'status', kind: 'home' })
  if (iOut) {
    if (d.closed) {
      return (
        <section className="answer tone-cold">
          {head}<h3>Elle est fermée</h3><p>{by} En arrivant, préviens ceux qui sont à l’intérieur.</p>
          <div className="actions"><button type="button" className="btn btn-primary" disabled={c.busy} onClick={() => c.act({ type: 'knock' })}><Icon n="bell" s={18} />Je suis en bas, ouvrez-moi</button></div>
          <button type="button" className="linkish" onClick={backHome}>Je suis à la coloc</button>
        </section>
      )
    }
    return (
      <section className="answer tone-ok">
        {head}<h3>Elle reste ouverte</h3>
        <p>Tant que tu es dehors, l’appli conseille aux autres de ne pas la fermer. Si quelqu’un la ferme quand même, tu reçois une notif.</p>
        <div className="actions"><button type="button" className="btn btn-ghost" disabled={c.busy} onClick={backHome}><Icon n="home" s={18} />Je suis à la coloc</button></div>
      </section>
    )
  }
  if (d.closed) {
    return (
      <section className="answer tone-plain">
        {head}<h3>Elle est fermée</h3>
        <p>{by}{out.length ? ' ' + listNames(out.map((p) => p.name)) + (out.length > 1 ? ' sont dehors et pourront' : ' est dehors et pourra') + ' demander qu’on ouvre depuis l’appli.' : ''}</p>
        <div className="actions"><button type="button" className="btn btn-ghost" disabled={c.busy} onClick={() => c.act({ type: 'doorOpen' })}>Je l’ai rouverte</button></div>
        <button type="button" className="linkish" onClick={() => c.act({ type: 'knock' })}>Tu es devant ? Préviens ceux qui sont là</button>
      </section>
    )
  }
  if (!out.length) {
    return (
      <section className="answer tone-ok">
        {head}<h3>Tu peux la fermer</h3>
        <p>Personne n’est dehors.{away.length ? ' ' + listNames(away.map((p) => p.name)) + ' : en voyage, pas de retour ce soir.' : ''}</p>
        <div className="actions"><button type="button" className="btn btn-primary" disabled={c.busy} onClick={() => c.act({ type: 'doorClose' })}><Icon n="check" s={18} />Je l’ai fermée</button></div>
      </section>
    )
  }
  return (
    <section className="answer tone-cold">
      {head}<h3>Laisse-la ouverte</h3>
      <p>{out.map((p) => p.name + ' est dehors, retour ' + c.status(p.id).back).join('. ')}. Une notif te dira quand tout le monde est rentré.</p>
      <div className="actions"><button type="button" className="btn btn-ghost" disabled={c.busy} onClick={() => c.act({ type: 'doorClose' })}>Je la ferme quand même</button></div>
    </section>
  )
}

function PushCard({ c }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('chez-nous-push-hide') === '1' } catch { return false } })
  const [installEvt, setInstallEvt] = useState(() => window.__installPrompt || null)
  useEffect(() => {
    const on = () => setInstallEvt(window.__installPrompt || null)
    window.addEventListener('installable', on)
    return () => window.removeEventListener('installable', on)
  }, [])
  if (hidden || c.push === 'on' || c.push === 'unsupported') return null
  const hide = () => { try { localStorage.setItem('chez-nous-push-hide', '1') } catch { /* rien */ } setHidden(true) }
  const install = installEvt && !isStandalone() ? (
    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { installEvt.prompt(); await installEvt.userChoice; window.__installPrompt = null; setInstallEvt(null) }}>
      Installer l’appli
    </button>
  ) : null
  let title, text, action = null
  if (c.push === 'ios-browser') {
    title = 'Les notifs sur iPhone'
    text = 'Dans Safari : bouton Partager, puis « Sur l’écran d’accueil ». Ouvre ensuite l’appli depuis son icône pour activer les notifs.'
  } else if (c.push === 'denied') {
    title = 'Notifs bloquées'
    text = 'Réautorise-les pour ce site dans les réglages du navigateur, sinon tu ne sauras pas qui joue ou qui attend en bas.'
  } else {
    title = 'Active les notifs'
    text = 'C’est par là qu’on te dit que quelqu’un joue du sax, attend devant la porte ou propose un film.'
    action = <button type="button" className="btn btn-primary btn-sm" onClick={c.enable}><Icon n="bell" s={16} />Activer</button>
  }
  return (
    <section className="card push-card">
      <div className="card-head"><h4>{title}</h4><button type="button" className="card-link" onClick={hide}>Plus tard</button></div>
      <p className="muted">{text}</p>
      {action || install ? <div className="actions">{action}{install}</div> : null}
    </section>
  )
}

function Who({ c }) {
  const n = c.members.filter((p) => ['home', 'calm'].includes(c.status(p.id).kind)).length
  return (
    <section className="card">
      <div className="card-head"><h4>Qui est là</h4><span className="muted">{n} sur {c.members.length} à la coloc</span></div>
      <ul className="who">
        {c.members.map((p) => {
          const k = KINDS[c.status(p.id).kind]
          return (
            <li key={p.id}>
              <Av p={p} s={38} />
              <div className="who-txt"><b>{p.name}{p.id === c.me ? <span className="you">toi</span> : null}</b><span>{c.detail(p.id)}</span></div>
              <span className={'pill tone-' + k.tone}><Icon n={k.icon} s={14} />{k.label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const visibleEvents = (c) => {
  const order = { soir: 0, demain: 1, weekend: 2, semaine: 3, tard: 4 }
  const key = (e) => order[bucket(e, c.today)] * 1e4 + (e.when === 'jour' ? Math.max(0, (Date.parse(e.day) - Date.parse(c.today)) / 864e5) * 10 : 0) + (e.when === 'semaine' ? 1000 : 0) + (e.time ? parseInt(e.time, 10) / 24 : 0.99)
  return c.st.events.filter((e) => bucket(e, c.today) !== 'passe').sort((a, b) => key(a) - key(b))
}
const goingText = (n) => (n ? n + ' ' + (n > 1 ? 'viennent' : 'vient') : 'Personne pour l’instant')

function Soon({ c }) {
  const list = visibleEvents(c).slice(0, 3)
  return (
    <section className="card">
      <div className="card-head"><h4>Ce soir et après</h4><button type="button" className="card-link" onClick={() => c.setTab('agenda')}>Tout l’agenda</button></div>
      <ul className="soon">
        {list.length ? list.map((e) => (
          <li key={e.id}>
            <button type="button" className="soon-row" onClick={() => c.setTab('agenda')}>
              <span className="soon-date"><b>{whenShort(e, c.today)}</b><span>{e.time || ''}</span></span>
              <span className="soon-txt"><b>{e.title}</b><span>{(TYPES[e.type] || TYPES.autre).label}{e.going.length ? ' · ' + goingText(e.going.length) : ''}</span></span>
              <Avs people={e.going.slice(0, 4).map(c.P)} s={24} />
            </button>
          </li>
        )) : <li className="muted soon-empty">Rien de prévu pour l’instant.</li>}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm soon-add" onClick={() => c.open('addEvent', { when: 'soir' })}><Icon n="plus" s={16} />Proposer un truc pour ce soir</button>
    </section>
  )
}

/* ---------- Agenda ---------- */
function Agenda({ c }) {
  const evs = visibleEvents(c)
  if (!evs.length) {
    return (
      <div className="empty">
        <p>Rien de prévu. Propose un film ou une soirée pour ce soir.</p>
        <button type="button" className="btn btn-primary" onClick={() => c.open('addEvent', { when: 'soir' })}><Icon n="plus" s={18} />Proposer</button>
      </div>
    )
  }
  const groups = BUCKETS.map(([k, l]) => ({ k, l, list: evs.filter((e) => bucket(e, c.today) === k) })).filter((g) => g.list.length)
  return (
    <div className="agenda">
      {groups.map((g) => (
        <section key={g.k} className="day">
          <h4 className="day-h">{g.l}</h4>
          {g.list.map((e) => <EventCard key={e.id} c={c} e={e} />)}
        </section>
      ))}
    </div>
  )
}

function EventCard({ c, e }) {
  const T = TYPES[e.type] || TYPES.autre
  const b = bucket(e, c.today)
  const dayBit = e.when === 'jour' && (b === 'semaine' || b === 'tard') ? dayShort(e.day, c.today) + ' · ' : ''
  const mine = e.going.includes(c.me)
  const author = e.by === c.me ? 'toi' : c.P(e.by).name
  return (
    <article className="card ev">
      <div className="ev-top">
        <span className="ev-ic"><Icon n={T.icon} s={19} /></span>
        <div className="ev-meta">
          <span className="ev-time">{dayBit}{e.time ? e.time + ' · ' : ''}{T.label}</span>
          <h5>{e.title}</h5>
          <span className="muted">Par {author}{e.note ? ' · ' + e.note : e.time ? '' : ' · pas d’heure, on verra'}</span>
        </div>
      </div>
      <div className="ev-foot">
        <Avs people={e.going.map(c.P)} s={28} />
        <span className="muted">{goingText(e.going.length)}</span>
        <span className="grow" />
        {e.by === c.me ? <button type="button" className="inline-link" onClick={() => c.act({ type: 'eventDelete', id: e.id })}>Retirer</button> : null}
        <button type="button" className="chip" aria-pressed={mine} disabled={c.busy} onClick={() => c.act({ type: 'eventGoing', id: e.id })}>
          {mine ? <Icon n="check" s={15} /> : null}Je viens
        </button>
      </div>
    </article>
  )
}

/* ---------- Envies ---------- */
function Envies({ c, filter, setFilter }) {
  const F = [['all', 'Tout'], ['film', 'Films'], ['idee', 'Idées'], ['video', 'Vidéos']]
  const ideas = c.st.ideas
  const count = (k) => (k === 'all' ? ideas.length : ideas.filter((i) => i.kind === k).length)
  const list = ideas.filter((i) => filter === 'all' || i.kind === filter).slice().sort((a, b) => b.plus.length - a.plus.length)
  return (
    <>
      <div className="filters" role="group" aria-label="Filtrer">
        {F.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span>{count(k)}</span></button>)}
      </div>
      {list.length ? <div className="ideas">{list.map((i) => <IdeaCard key={i.id} c={c} i={i} />)}</div> : (
        <div className="empty">
          <p>Rien ici pour l’instant. Un film à voir, une sortie, une vidéo à tourner ?</p>
          <button type="button" className="btn btn-primary" onClick={() => c.open('addIdea', filter !== 'all' ? { kind: filter } : {})}><Icon n="plus" s={18} />Ajouter</button>
        </div>
      )}
    </>
  )
}

function IdeaCard({ c, i }) {
  const K = IKINDS[i.kind] || IKINDS.idee
  const plussed = i.plus.includes(c.me)
  const ev = i.planned && c.st.events.find((e) => e.id === i.planned && bucket(e, c.today) !== 'passe')
  const inCrew = (i.crew || []).includes(c.me)
  return (
    <article className="card idea">
      <div className="idea-top">
        <span className="ev-ic"><Icon n={K.icon} s={19} /></span>
        <div className="idea-meta">
          <span className="kind">{K.label}</span>
          <h5>{i.title}</h5>
          <span className="muted">
            Par {i.by === c.me ? 'toi' : c.P(i.by).name}
            {i.by === c.me ? <> · <button type="button" className="inline-link" onClick={() => c.act({ type: 'ideaDelete', id: i.id })}>retirer</button></> : null}
          </span>
        </div>
      </div>
      {i.kind === 'video' ? (
        <>
          <div className="stages" role="group" aria-label="Étape du projet">
            {STAGES.map((s, n) => (
              <button key={s} type="button" className="stage-b" aria-pressed={n <= i.stage} aria-label={s} title={s} onClick={() => c.act({ type: 'ideaStage', id: i.id, stage: n })}><span /></button>
            ))}
          </div>
          <div className="stage-l"><b>{STAGES[i.stage]}</b></div>
          <div className="crew">
            <Avs people={(i.crew || []).map(c.P)} s={28} />
            <span className="muted">{(i.crew || []).length} dans l’équipe</span>
            <span className="grow" />
            <button type="button" className="chip" aria-pressed={inCrew} onClick={() => c.act({ type: 'ideaCrew', id: i.id })}>{inCrew ? <Icon n="check" s={15} /> : null}J’en suis</button>
          </div>
        </>
      ) : null}
      <div className="idea-foot">
        <button type="button" className="plus" aria-pressed={plussed} aria-label={'Moi aussi, ' + i.plus.length + ' au total'} onClick={() => c.act({ type: 'ideaPlus', id: i.id })}>+1 <b>{i.plus.length}</b></button>
        <Avs people={i.plus.map(c.P)} s={24} />
        <span className="grow" />
        {ev ? (
          <button type="button" className="planned" onClick={() => c.setTab('agenda')}><Icon n="cal" s={15} />{whenShort(ev, c.today)}{ev.time ? ' · ' + ev.time : ''}</button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => c.open('plan', { idea: i.id })}>Proposer</button>
        )}
      </div>
    </article>
  )
}

/* ---------- Notification dans l'appli ---------- */
function PushBanner({ c }) {
  const list = c.st.notifs
  if (!list.length) return null
  const n = list[list.length - 1]
  const run = (a) => {
    const seenId = n.id
    switch (a.a) {
      case 'complain': c.act({ type: 'seen', seenId }); c.open('complain'); break
      case 'noise': c.act({ type: 'seen', seenId }); c.open('noise'); break
      case 'doorClose': c.act({ type: 'doorClose', seenId }); break
      case 'noiseStop': c.act({ type: 'noiseStop', seenId }); break
      case 'noiseTen': c.act({ type: 'noiseTen', seenId }); break
      case 'goDown': c.act({ type: 'goDown', who: a.v, seenId }); break
      case 'going': c.act({ type: 'eventGoing', id: a.v, yes: true, seenId }); break
      default: c.act({ type: 'seen', seenId })
    }
  }
  return (
    <div className="push" role="alert">
      <div className="push-head">
        <Logo s={13} />
        <span>Chez nous</span>
        <span className="muted">· {c.sinceLabel(n.at)}{list.length > 1 ? ' · ' + (list.length - 1) + ' autre' + (list.length > 2 ? 's' : '') : ''}</span>
        <button type="button" className="x" onClick={() => c.act({ type: 'seen', seenId: n.id })} aria-label="Masquer la notification"><Icon n="x" s={15} /></button>
      </div>
      <b className="push-t">{n.text}</b>
      {n.sub ? <p>{n.sub}</p> : null}
      {n.actions.length ? (
        <div className="push-actions">
          {n.actions.map((a, i) => <button key={i} type="button" className={'btn btn-sm ' + (i === 0 ? 'btn-primary' : 'btn-ghost')} onClick={() => run(a)}>{a.l}</button>)}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- Feuilles ---------- */
function Sheets({ c, sheet }) {
  const props = { c, sheet, done: async (a) => { const r = await c.act(a); if (r) c.close() } }
  switch (sheet.type) {
    case 'status': return <StatusSheet {...props} />
    case 'noise': return <NoiseSheet {...props} />
    case 'complain': return <ComplainSheet {...props} />
    case 'coloc': return <ColocSheet {...props} />
    case 'addIdea': return <IdeaSheet {...props} />
    case 'addEvent': return <EventSheet {...props} />
    case 'plan': return <PlanSheet {...props} />
    default: return null
  }
}

function StatusSheet({ c, done }) {
  const s = c.status(c.me)
  const untilOpts = calmUntilOptions(c.now)
  const outOpts = outBackOptions(c.now, c.tz)
  const awayOpts = AWAY_BACK.map((v) => ({ v, l: v.charAt(0).toUpperCase() + v.slice(1) }))
  const [kind, setKind] = useState(s.kind)
  const [reason, setReason] = useState(s.reason || 'Je bosse')
  const [until, setUntil] = useState('1h')
  const [back, setBack] = useState(s.back && s.kind === 'out' ? s.back : outOpts[Math.min(1, outOpts.length - 1)].v)
  const [awayBack, setAwayBack] = useState(s.back && s.kind === 'away' ? s.back : AWAY_BACK[0])
  const save = () => {
    const a = { type: 'status', kind }
    if (kind === 'calm') { a.reason = reason; a.until = (untilOpts.find((u) => u.v === until) || untilOpts[0]).ms }
    if (kind === 'out') a.back = back
    if (kind === 'away') a.back = awayBack
    done(a)
  }
  return (
    <Sheet title="Où en es-tu ?" onClose={c.close}>
      <div className="opts">
        {STATUS_OPTS.map(([k, l, d]) => (
          <button key={k} type="button" className={'opt tone-' + KINDS[k].tone} aria-pressed={kind === k} onClick={() => setKind(k)}>
            <span className="opt-ic"><Icon n={KINDS[k].icon} s={20} /></span><span><b>{l}</b><small>{d}</small></span>
          </button>
        ))}
      </div>
      {kind === 'calm' ? <>
        <Label>Pourquoi ?</Label><Chips value={reason} onChange={setReason} options={CALM_REASONS.map((r) => ({ v: r, l: r }))} />
        <Label>Jusqu’à quand ?</Label><Chips value={until} onChange={setUntil} options={untilOpts} />
      </> : null}
      {kind === 'out' ? <><Label>Retour</Label><Chips value={back} onChange={setBack} options={outOpts} /></> : null}
      {kind === 'away' ? <><Label>Retour</Label><Chips value={awayBack} onChange={setAwayBack} options={awayOpts} /></> : null}
      <button type="button" className="btn btn-primary btn-block" disabled={c.busy} onClick={save}>Enregistrer</button>
      {kind === 'calm' ? <p className="fine">Celui ou celle qui voudra faire du bruit verra ta demande et l’heure de fin.</p> : null}
    </Sheet>
  )
}

function NoiseSheet({ c, done }) {
  const [what, setWhat] = useState('sax')
  const [dur, setDur] = useState('')
  return (
    <Sheet title="Prévenir qu’on fait du bruit" onClose={c.close}>
      <Label>Quoi ?</Label>
      <Chips value={what} onChange={setWhat} options={Object.entries(WHAT).map(([v, w]) => ({ v, l: w.label }))} />
      <Label>Combien de temps ?</Label>
      <Chips value={dur} onChange={setDur} options={[{ v: '', l: 'Je sais pas' }, { v: '30', l: '~30 min' }, { v: '60', l: '~1 h' }, { v: '120', l: '~2 h' }]} />
      <button type="button" className="btn btn-primary btn-block" disabled={c.busy} onClick={() => done({ type: 'noiseStart', what, dur: Number(dur || 0) })}>
        <Icon n="bell" s={18} />Prévenir la coloc
      </button>
      <p className="fine">Ceux qui sont à la coloc reçoivent une notif et peuvent répondre « ça me dérange » en un geste.</p>
    </Sheet>
  )
}

function ComplainSheet({ c, done }) {
  const [reason, setReason] = useState('Je bosse')
  const who = c.st.noise ? c.P(c.st.noise.by).name : ''
  if (!c.st.noise) return <Sheet title="C’est déjà fini" onClose={c.close}><p className="muted">Plus personne ne fait de bruit.</p></Sheet>
  return (
    <Sheet title={'Dire à ' + who + ' que ça dérange'} onClose={c.close}>
      <Label>Pourquoi ?</Label>
      <Chips value={reason} onChange={setReason} options={COMPLAINTS.map((r) => ({ v: r, l: r }))} />
      <button type="button" className="btn btn-stop btn-block" disabled={c.busy} onClick={() => done({ type: 'complain', reason })}><Icon n="mute" s={18} />Envoyer</button>
      <p className="fine">{who} reçoit ta réponse tout de suite, avec « J’arrête » et « Encore 10 min ».</p>
    </Sheet>
  )
}

function WhenFields({ value, onChange, today }) {
  const days = Array.from({ length: 12 }, (_, k) => isoAdd(today, k + 2))
  return (
    <>
      <Label>Quand ?</Label>
      <Chips value={value.when} onChange={(when) => onChange({ ...value, when })} options={WHEN_OPTS} />
      {value.when === 'jour' ? <>
        <Label>Quel jour ?</Label>
        <Chips value={value.day || days[0]} onChange={(day) => onChange({ ...value, day })} options={days.map((d) => ({ v: d, l: dayShort(d, today) }))} />
      </> : null}
      <Label>Heure (si besoin)</Label>
      <Chips value={value.time} onChange={(time) => onChange({ ...value, time })} options={TIME_OPTS} />
    </>
  )
}

function EventSheet({ c, sheet, done }) {
  const [etype, setEtype] = useState(sheet.etype || 'soiree')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [when, setWhen] = useState({ when: sheet.when || 'soir', day: null, time: '' })
  const save = () => {
    if (!title.trim()) { c.flash('Dis ce que tu proposes'); return }
    done({ type: 'eventAdd', etype, title, note, when: when.when, day: when.day || isoAdd(c.today, 2), time: when.time })
  }
  return (
    <Sheet title="Proposer un truc" onClose={c.close}>
      <Label>Type</Label>
      <Chips value={etype} onChange={setEtype} options={TYPE_OPTS} />
      <Label htmlFor="f-title">C’est quoi ?</Label>
      <input id="f-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. : Soirée crêpes" autoComplete="off" maxLength={80} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      <WhenFields value={when} onChange={setWhen} today={c.today} />
      <Label htmlFor="f-note">Détail (facultatif)</Label>
      <input id="f-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. : chacun ramène un truc à boire" autoComplete="off" maxLength={120} />
      <button type="button" className="btn btn-primary btn-block" disabled={c.busy} onClick={save}>Proposer à la coloc</button>
      <p className="fine">Les autres reçoivent une notif avec « Je viens ». Pas besoin d’heure, on voit sur le moment.</p>
    </Sheet>
  )
}

function PlanSheet({ c, sheet, done }) {
  const i = c.st.ideas.find((x) => x.id === sheet.idea)
  const [when, setWhen] = useState({ when: 'soir', day: null, time: '' })
  if (!i) return null
  const verb = i.kind === 'film' ? 'On regarde' : i.kind === 'video' ? 'On tourne' : 'On fait'
  return (
    <Sheet title={verb + ' « ' + i.title + ' » quand ?'} onClose={c.close}>
      <WhenFields value={when} onChange={setWhen} today={c.today} />
      <button type="button" className="btn btn-primary btn-block" disabled={c.busy}
        onClick={() => done({ type: 'ideaPlan', id: i.id, when: when.when, day: when.day || isoAdd(c.today, 2), time: when.time })}>
        <Icon n="cal" s={18} />Proposer à la coloc
      </button>
      <p className="fine">Ça passe dans l’agenda avec un bouton « Je viens ».</p>
    </Sheet>
  )
}

function IdeaSheet({ c, sheet, done }) {
  const [kind, setKind] = useState(sheet.kind || 'film')
  const [title, setTitle] = useState('')
  const PH = { film: 'Ex. : Le Voyage de Chihiro', idee: 'Ex. : Brunch un dimanche', video: 'Ex. : Une semaine de coloc en accéléré' }
  const save = () => { if (!title.trim()) { c.flash('Donne-lui un titre'); return } done({ type: 'ideaAdd', kind, title }) }
  return (
    <Sheet title="Nouvelle envie" onClose={c.close}>
      <Label>C’est quoi ?</Label>
      <Chips value={kind} onChange={setKind} options={[{ v: 'film', l: 'Un film' }, { v: 'idee', l: 'Une idée de sortie' }, { v: 'video', l: 'Un projet vidéo' }]} />
      <Label htmlFor="f-title">Titre</Label>
      <input id="f-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={PH[kind]} autoComplete="off" maxLength={80} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      <button type="button" className="btn btn-primary btn-block" disabled={c.busy} onClick={save}>Ajouter aux envies</button>
    </Sheet>
  )
}

function ColocSheet({ c }) {
  const { st } = c
  const [confirm, setConfirm] = useState(null)
  const [copied, setCopied] = useState(false)
  const mem = c.members
  const free = st.max - mem.length
  const link = location.origin + '/?code=' + st.code
  const share = async () => {
    const text = 'Rejoins « ' + st.name + ' » sur Chez nous avec le code ' + fmtCode(st.code)
    try { await navigator.share({ title: 'Chez nous', text, url: link }) } catch { if (await copyText(text + ' : ' + link)) c.flash('Invitation copiée') }
  }
  const pushLine = { on: 'activées', off: 'pas activées', denied: 'bloquées dans le navigateur', 'ios-browser': 'à activer depuis l’écran d’accueil', unsupported: 'pas disponibles sur ce navigateur' }[c.push]
  return (
    <Sheet title={st.name} onClose={c.close}>
      <Label>Code pour inviter</Label>
      <div className="code-row">
        <span className="code-big sm">{fmtCode(st.code)}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={async () => setCopied(await copyText(st.code))}><Icon n={copied ? 'check' : 'copy'} s={16} />{copied ? 'Copié' : 'Copier'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={share}><Icon n="share" s={16} />Partager</button>
      </div>
      <p className="hint">À taper sur l’écran d’accueil de l’appli. Il ne marche que s’il reste de la place.</p>
      {confirm === 'code'
        ? <button type="button" className="linkish tone-stop" onClick={() => { setConfirm(null); c.act({ type: 'colocNewCode' }) }}>Oui, changer le code (l’ancien ne marchera plus)</button>
        : <button type="button" className="linkish tone-brass" onClick={() => setConfirm('code')}>Changer le code</button>}

      <Label>Habitants au maximum</Label>
      <div className="stepper-row">
        <Stepper value={st.max} min={Math.max(MIN_MEMBERS, mem.length)} max={MAX_MEMBERS} label="place" onChange={(d) => c.act({ type: 'colocMax', delta: d })} />
        <span className="muted">{mem.length} sur {st.max} · {free ? plural(free, 'place') + ' libre' + (free > 1 ? 's' : '') : 'complète'}</span>
      </div>

      <Label>Habitants</Label>
      <ul className="who">
        {mem.map((p) => (
          <li key={p.id}>
            <Av p={p} s={34} />
            <div className="who-txt"><b>{p.name}{p.id === c.me ? <span className="you">toi</span> : null}</b></div>
            {p.id === c.me ? null : confirm === p.id
              ? <button type="button" className="btn btn-stop btn-sm" disabled={c.busy} onClick={() => { setConfirm(null); c.act({ type: 'memberRemove', id: p.id }) }}>Oui, retirer</button>
              : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(p.id)}>Retirer</button>}
          </li>
        ))}
      </ul>

      <Label>Notifs sur ce téléphone</Label>
      <div className="code-row">
        <span className="muted">{pushLine}</span>
        {c.push === 'off' ? <button type="button" className="btn btn-primary btn-sm" onClick={c.enable}><Icon n="bell" s={16} />Activer</button> : null}
      </div>
      {c.push === 'ios-browser' ? <p className="hint">Sur iPhone : Partager → « Sur l’écran d’accueil », puis ouvre l’appli depuis son icône.</p> : null}

      {confirm === 'leave'
        ? <button type="button" className="btn btn-stop btn-block" disabled={c.busy} onClick={() => c.act({ type: 'leave' })}>Oui, quitter « {st.name} »</button>
        : <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirm('leave')}>Quitter la coloc</button>}
      <p className="fine">Tout le monde dans la coloc peut changer ces réglages.</p>
    </Sheet>
  )
}
