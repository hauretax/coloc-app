// Onglet Plantes : la liste (qui a soif en premier), la fiche d'une plante, le formulaire.
import { useState } from 'react'
import { api } from './api.js'
import { Icon, Av, Chips, Label, Sheet } from './ui.jsx'
import { shrinkPhoto } from './photo.js'
import { WD, MO, MO_SHORT, todayISO, dayDiff, dayShort, parseISO, listNames, plural } from '../shared/rules.js'
import { PLANTS, LIGHT, HUM, FEEDS, LOGS, HOW, SIGNS, ROOMS, isRest, plantDue, feedDue, feedLabel } from '../shared/plants.js'

const PHOTO_PX = 1080
const due = (c, p) => plantDue(p, c.today, c.tz)
const toneOf = (d) => (d.late > 0 ? 'stop' : d.late === 0 ? 'brass' : 'muted')
const who = (c, id) => (id === c.me ? 'toi' : c.P(id).name)
const species = (p) => PLANTS[p.sp] || PLANTS.autre

function dueText(d, today) {
  if (d.late > 0) return 'À arroser depuis ' + plural(d.late, 'jour')
  if (d.late === 0) return d.last ? 'À arroser aujourd’hui' : 'Pas encore d’arrosage noté'
  if (d.late === -1) return 'À arroser demain'
  return 'Dans ' + -d.late + ' jours · ' + dayShort(d.due, today).toLowerCase()
}
const ago = (day, today) => {
  const n = dayDiff(today, day)
  return n <= 0 ? 'aujourd’hui' : n === 1 ? 'hier' : 'il y a ' + n + ' jours'
}
const lastText = (c, d) => (d.last ? 'Arrosée ' + ago(d.last, c.today) + (d.lastBy ? ' par ' + who(c, d.lastBy) : '') : null)
function pastDay(day, today) {
  const n = dayDiff(today, day)
  if (n === 0) return 'aujourd’hui'
  if (n === 1) return 'hier'
  const d = parseISO(day)
  return WD[d.getUTCDay()].slice(0, 3) + '. ' + d.getUTCDate() + ' ' + MO_SHORT[d.getUTCMonth()]
}
function longDay(day, today) {
  const n = dayDiff(day, today)
  if (n === 0) return 'Aujourd’hui'
  if (n === 1) return 'Demain'
  const d = parseISO(day)
  return WD[d.getUTCDay()].charAt(0).toUpperCase() + WD[d.getUTCDay()].slice(1) + ' ' + d.getUTCDate() + ' ' + MO[d.getUTCMonth()]
}
/** La plante concerne-t-elle cette personne ? (pas de responsable, c'est elle, ou le responsable est en voyage) */
const mine = (c, p) => !p.owner || p.owner === c.me || c.status(p.owner).kind === 'away'

function PlantPic({ p, s = 56 }) {
  return p.url
    ? <img className="plant-pic" src={p.url} alt="" loading="lazy" style={{ '--s': s + 'px' }} />
    : <span className="plant-pic ph" style={{ '--s': s + 'px' }}><Icon n="leaf" s={Math.round(s * 0.42)} /></span>
}

/* ---------- La liste ---------- */
export function Plantes({ c }) {
  const list = c.st.plants
    .map((p) => ({ p, d: due(c, p) }))
    .sort((a, b) => a.d.due.localeCompare(b.d.due) || a.p.name.localeCompare(b.p.name, 'fr'))
  if (!list.length) {
    return (
      <div className="empty">
        <p>Pas encore de plante. Ajoute la première : l’appli dit quand l’arroser, où la mettre, si elle est toxique pour un chat, et qui l’a arrosée en dernier.</p>
        <button type="button" className="btn btn-primary" onClick={() => c.open('plantForm')}><Icon n="plus" s={18} />Ajouter une plante</button>
      </div>
    )
  }
  const thirsty = list.filter((x) => x.d.late >= 0)
  const later = list.filter((x) => x.d.late < 0)
  const rest = isRest(c.today)
  return (
    <div className="plants">
      <p className="season">
        <Icon n={rest ? 'moon' : 'sun'} s={16} />
        {rest
          ? 'Automne-hiver : elles poussent peu et boivent moins. Arrosages espacés jusqu’à fin février, pas d’engrais.'
          : 'Printemps-été : elles poussent et boivent plus. Engrais de mars à septembre.'}
      </p>
      {thirsty.length ? (
        <section className="day">
          <div className="plants-h">
            <h4 className="day-h">À arroser</h4>
            {thirsty.length > 1 ? (
              <button type="button" className="card-link" disabled={c.busy}
                onClick={() => c.act({ type: 'plantLog', ids: thirsty.map((x) => x.p.id), kind: 'water' })}>J’ai tout arrosé</button>
            ) : null}
          </div>
          <div className="plant-grid">{thirsty.map((x) => <PlantCard key={x.p.id} c={c} p={x.p} d={x.d} />)}</div>
        </section>
      ) : <p className="plants-ok"><Icon n="check" s={17} />Rien à arroser aujourd’hui.</p>}
      {later.length ? (
        <section className="day">
          <h4 className="day-h">Plus tard</h4>
          <div className="plant-grid">{later.map((x) => <PlantCard key={x.p.id} c={c} p={x.p} d={x.d} />)}</div>
        </section>
      ) : null}
      <p className="fine">Avant d’arroser, touche la terre : si elle est encore humide, attends. Une plante meurt plus souvent d’avoir trop bu que de soif.</p>
    </div>
  )
}

function PlantCard({ c, p, d }) {
  const [ask, setAsk] = useState(false)
  const sp = species(p)
  const sub = [p.sp !== 'autre' && p.name !== sp.n ? sp.n : null, p.room].filter(Boolean).join(' · ')
  const last = lastText(c, d)
  // Pas encore prévue : on demande avant (deux colocs qui arrosent la même plante, c'est trop d'eau).
  const water = () => {
    if (d.late < 0 && !ask) { setAsk(true); return }
    setAsk(false)
    c.act({ type: 'plantLog', id: p.id, kind: 'water' })
  }
  return (
    <article className={'card plant tone-' + toneOf(d)}>
      <button type="button" className="plant-main" onClick={() => c.open('plant', { id: p.id })}>
        <PlantPic p={p} />
        <span className="plant-txt">
          <b>{p.name}</b>
          {sub ? <small>{sub}</small> : null}
          <span className="plant-due"><Icon n="drop" s={14} />{dueText(d, c.today)}</span>
          {last ? <small>{last}</small> : null}
        </span>
      </button>
      <div className="plant-side">
        {p.owner ? <Av p={c.P(p.owner)} s={24} /> : null}
        {feedDue(p, c.today, c.tz) ? <span className="pill tone-ok" title="Engrais à donner"><Icon n="sprout" s={13} /></span> : null}
        <button type="button" className="water-b" aria-label={'J’ai arrosé ' + p.name} disabled={c.busy} onClick={water}><Icon n="drop" s={20} /></button>
      </div>
      {ask ? (
        <div className="plant-ask" role="alert">
          <p>{last ? last + '. ' : ''}Prochain arrosage prévu {longDay(d.due, c.today).toLowerCase()}. Tu l’as quand même arrosée ?</p>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={water}>Oui, arrosée</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsk(false)}>Non</button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

/** Sur Maison : les plantes qui ont soif (celles dont je m'occupe, ou tout le monde). */
export function PlantNudge({ c }) {
  const list = c.st.plants.filter((p) => mine(c, p) && due(c, p).late >= 0)
  if (!list.length) return null
  const pic = list.find((p) => p.url)
  return (
    <button type="button" className="card nudge" onClick={() => c.setTab('plantes')}>
      {pic ? <img src={pic.url} alt="" /> : <span className="nudge-ic"><Icon n="drop" s={22} /></span>}
      <span>
        <b>{list.length > 1 ? list.length + ' plantes ont soif' : list[0].name + ' a soif'}</b>
        <small>{list.length > 1 ? listNames(list.map((p) => p.name)) : 'À arroser aujourd’hui'}</small>
      </span>
      <Icon n="next" s={18} />
    </button>
  )
}

/* ---------- La fiche d'une plante ---------- */
function Care({ i, t, v, s, tone }) {
  return (
    <li className={tone ? 'tone-' + tone : undefined}>
      <span className="care-ic"><Icon n={i} s={17} /></span>
      <div><small>{t}</small><b>{v}</b>{s ? <p>{s}</p> : null}</div>
    </li>
  )
}

export function PlantSheet({ c, sheet }) {
  const p = c.st.plants.find((x) => x.id === sheet.id)
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  if (!p) return null
  const sp = species(p)
  const d = due(c, p)
  const rest = isRest(c.today)
  const tone = toneOf(d)
  const log = p.log.slice().reverse()
  const days = p.log.filter((l) => l.k === 'water').map((l) => todayISO(l.at, c.tz))
  const avg = days.length >= 3 ? Math.round(dayDiff(days[days.length - 1], days[0]) / (days.length - 1)) : 0
  const big = d.late > 0 ? 'En retard de ' + plural(d.late, 'jour') : d.late === 0 ? 'À arroser aujourd’hui' : longDay(d.due, c.today)
  const changePhoto = async (e) => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    setSending(true)
    try {
      const { id } = await api.photo(c.session, await shrinkPhoto(f, PHOTO_PX))
      await c.act({ type: 'plantEdit', id: p.id, photo: id })
    } catch (err) {
      c.flash(err.message || 'Photo illisible, essaie avec une autre')
    } finally {
      setSending(false)
    }
  }
  return (
    <Sheet title={p.name} onClose={c.close}>
      <label className={'plant-hero' + (p.url ? ' has' : '')}>
        <input type="file" accept="image/*" onChange={changePhoto} aria-label={p.url ? 'Changer la photo' : 'Ajouter une photo'} disabled={sending} />
        {p.url ? <img src={p.url} alt={p.name} /> : <span><Icon n="photo" s={26} />{sending ? 'Envoi…' : 'Ajouter une photo'}</span>}
      </label>
      <p className="plant-id">
        {sp.latin ? <i>{sp.latin}</i> : <span>{sp.n}</span>}
        {p.room ? <span> · {p.room}</span> : null}
      </p>
      <p className="plant-owner">
        {p.owner ? <><Av p={c.P(p.owner)} s={22} />{p.owner === c.me ? 'Tu t’en occupes' : c.P(p.owner).name + ' s’en occupe'}</> : 'Tout le monde s’en occupe'}
      </p>

      <section className={'answer tone-' + (tone === 'muted' ? 'ok' : tone)}>
        <div className="eyebrow"><Icon n="drop" s={15} /> Prochain arrosage</div>
        <h3>{big}</h3>
        <p>{lastText(c, d) ? lastText(c, d) + '.' : 'Pas encore d’arrosage noté.'}</p>
        <p className="hint">En ce moment : tous les {d.every} jours ({rest ? 'automne-hiver' : 'printemps-été'}).</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" disabled={c.busy} onClick={() => c.act({ type: 'plantLog', id: p.id, kind: 'water' })}>
            <Icon n="drop" s={18} />Je l’ai arrosée
          </button>
          {d.late >= -1 ? (
            <button type="button" className="btn btn-ghost" disabled={c.busy} onClick={() => c.act({ type: 'plantLog', id: p.id, kind: 'check' })}>
              <Icon n="clock" s={18} />Terre encore humide
            </button>
          ) : null}
        </div>
        <button type="button" className="linkish" onClick={() => c.act({ type: 'plantLog', id: p.id, kind: 'water', ago: 1 })}>Oublié de le noter ? Arrosée hier</button>
      </section>

      <Label>Noter aussi</Label>
      <div className="chips">
        {['feed', 'repot', 'prune'].map((k) => (
          <button key={k} type="button" className="chip" disabled={c.busy} onClick={() => c.act({ type: 'plantLog', id: p.id, kind: k })}>
            <Icon n={LOGS[k].icon} s={15} />{LOGS[k].label}
          </button>
        ))}
      </div>
      {feedDue(p, c.today, c.tz) ? <p className="hint days-h">C’est la saison : un peu d’engrais dans l’eau d’arrosage, {feedLabel(p.feed).toLowerCase()}.</p> : null}

      <Label>Entretien</Label>
      <ul className="care">
        <Care i="drop" t="Arrosage" v={'Tous les ' + p.water[0] + ' jours au printemps-été, ' + p.water[1] + ' en automne-hiver'} s={HOW} />
        <Care i="sun" t="Lumière" v={LIGHT[p.light].label} s={LIGHT[p.light].sub} />
        <Care i="drops" t="Humidité de l’air" v={HUM[p.hum].label} s={HUM[p.hum].sub} />
        {sp.temp ? <Care i="thermo" t="Température" v={'Pas en dessous de ' + sp.temp + ' °C'} s="Loin des courants d’air froid et des fenêtres ouvertes en hiver." /> : null}
        <Care i="sprout" t="Engrais" v={p.feed ? feedLabel(p.feed) + ', de mars à septembre' : 'Pas besoin'} s={p.feed ? 'Rien en automne-hiver : elle se repose.' : null} />
        {sp.repot ? <Care i="pot" t="Rempotage" v={sp.repot} s="Dans un pot à peine plus grand (2 à 3 cm de plus), percé au fond." /> : null}
        <Care i="paw" t="Chats et chiens" tone={p.toxic ? 'stop' : null}
          v={p.toxic === true ? 'Toxique s’ils la mâchent' : p.toxic === false ? 'Sans danger' : 'Ça dépend de l’espèce'}
          s={p.toxic === true ? 'Mets-la hors de portée. D’après l’ASPCA et les fiches courantes ; au moindre doute, appelle un véto.'
            : p.toxic === false ? 'D’après l’ASPCA et les fiches courantes.' : null} />
        {sp.tip ? <Care i="bulb" t="Le conseil" v={sp.tip} /> : null}
        {p.notes ? <Care i="edit" t="Notes de la coloc" v={p.notes} /> : null}
      </ul>
      <details className="signs">
        <summary>Elle a l’air d’aller mal ?</summary>
        <ul>{SIGNS.map(([t, s]) => <li key={t}><b>{t}</b> : {s}</li>)}</ul>
      </details>

      <Label>Historique</Label>
      {log.length ? (
        <ul className="who plant-log">
          {log.map((l) => (
            <li key={l.id}>
              <span className="ev-ic sm"><Icon n={LOGS[l.k].icon} s={16} /></span>
              <div className="who-txt"><b>{LOGS[l.k].label}</b><span>{pastDay(todayISO(l.at, c.tz), c.today)} · {who(c, l.by)}</span></div>
              <button type="button" className="item-x" aria-label={'Retirer « ' + LOGS[l.k].label + ' » de l’historique'} onClick={() => c.act({ type: 'plantLogDelete', id: p.id, log: l.id })}>
                <Icon n="x" s={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Rien de noté pour l’instant.</p>}
      {avg ? <p className="hint days-h">En moyenne, arrosée tous les {avg} jours.</p> : null}

      <div className="actions plant-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => c.open('plantForm', { id: p.id })}><Icon n="edit" s={16} />Modifier</button>
        {confirm
          ? <button type="button" className="btn btn-stop btn-sm" disabled={c.busy} onClick={() => { c.close(); c.act({ type: 'plantDelete', id: p.id }) }}>Oui, retirer {p.name}</button>
          : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)}><Icon n="trash" s={16} />Retirer</button>}
      </div>
    </Sheet>
  )
}

/* ---------- Ajouter ou modifier ---------- */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const CATALOG = Object.entries(PLANTS).filter(([k]) => k !== 'autre').sort((a, b) => a[1].n.localeCompare(b[1].n, 'fr'))
const AGO = [{ v: 0, l: 'Aujourd’hui' }, { v: 1, l: 'Hier' }, { v: 3, l: 'Il y a 3 jours' }, { v: 7, l: 'Il y a une semaine' }, { v: '', l: 'Je ne sais pas' }]

// Jours entre deux arrosages : de 1 en 1 jusqu'à 2 semaines, puis par paliers.
const LADDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 60, 75, 90]

function DayStep({ value, onChange, max, label }) {
  const by = (dir) => {
    const next = dir > 0 ? LADDER.find((n) => n > value) : LADDER.slice().reverse().find((n) => n < value)
    if (next) onChange(Math.min(max, next))
  }
  return (
    <div className="stepper-row">
      <div className="stepper">
        <button type="button" className="step-b" disabled={value <= 1} onClick={() => by(-1)} aria-label={label + ' : plus souvent'}><Icon n="minus" s={18} /></button>
        <b>{value}</b>
        <button type="button" className="step-b" disabled={value >= max} onClick={() => by(1)} aria-label={label + ' : moins souvent'}><Icon n="plus" s={18} /></button>
      </div>
      <span className="muted">{value === 1 ? 'tous les jours' : 'jours entre deux arrosages'}</span>
    </div>
  )
}

export function PlantForm({ c, sheet }) {
  const cur = sheet.id ? c.st.plants.find((x) => x.id === sheet.id) : null
  const [step, setStep] = useState(cur ? 'form' : 'pick')
  const [q, setQ] = useState('')
  const [f, setF] = useState(() => (cur ? {
    sp: cur.sp, name: cur.name === species(cur).n ? '' : cur.name, room: cur.room, water: cur.water.slice(),
    light: cur.light, hum: cur.hum, feed: cur.feed, toxic: cur.toxic, owner: cur.owner, notes: cur.notes,
  } : null))
  const [agoDays, setAgoDays] = useState('')
  const [photo, setPhoto] = useState(null) // nouvelle photo (data URL), ou false pour la retirer
  const [care, setCare] = useState(false)
  const [sending, setSending] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  const pick = (key) => {
    const b = PLANTS[key]
    setF((x) => ({
      name: '', room: '', owner: null, notes: '', ...x,
      sp: key, water: b.water.slice(), light: b.light, hum: b.hum, feed: b.feed, toxic: b.toxic,
    }))
    setCare(key === 'autre')
    setStep('form')
  }

  if (step === 'pick') {
    const t = fold(q.trim())
    const found = CATALOG.filter(([, s]) => !t || fold(s.n + ' ' + s.latin).includes(t))
    return (
      <Sheet title={cur ? 'Quelle plante ?' : 'Nouvelle plante'} onClose={cur ? () => setStep('form') : c.close}>
        <div className="search">
          <Icon n="search" s={18} />
          <input id="f-sp" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. : monstera, cactus, basilic"
            autoComplete="off" aria-label="Chercher une plante" />
        </div>
        <ul className="sp-list">
          {found.map(([k, s]) => (
            <li key={k}>
              <button type="button" className="sp-row" onClick={() => pick(k)}>
                <span className="sp-txt"><b>{s.n}</b><small>{s.latin}</small></span>
                <span className="sp-tags">
                  <span title="Arrosage au printemps-été"><Icon n="drop" s={13} />{s.water[0]} j</span>
                  {s.toxic ? <span className="tone-stop" title="Toxique pour les chats et les chiens"><Icon n="paw" s={13} /></span> : null}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="sp-row sp-other" onClick={() => pick('autre')}>
              <span className="sp-txt"><b>{found.length ? 'Elle n’est pas dans la liste' : 'Pas trouvée : l’ajouter quand même'}</b><small>Tu règles l’arrosage et la lumière toi-même</small></span>
              <Icon n="next" s={18} />
            </button>
          </li>
        </ul>
      </Sheet>
    )
  }

  const base = PLANTS[f.sp] || PLANTS.autre
  const shown = photo === false ? null : photo || (cur && cur.url)
  const rooms = [...new Set(c.st.plants.map((p) => p.room).filter(Boolean).concat(ROOMS))].slice(0, 9)
  const owner = f.owner && c.members.find((m) => m.id === f.owner)
  const choosePhoto = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    try { setPhoto(await shrinkPhoto(file, PHOTO_PX)) } catch { c.flash('Photo illisible, essaie avec une autre') }
  }
  const save = async () => {
    if (f.sp === 'autre' && !f.name.trim()) { c.flash('Donne-lui un nom'); return }
    setSending(true)
    try {
      const body = { type: cur ? 'plantEdit' : 'plantAdd', ...f }
      if (cur) body.id = cur.id
      else body.ago = agoDays === '' ? null : agoDays
      if (photo === false) body.photo = null
      else if (photo) body.photo = (await api.photo(c.session, photo)).id
      const r = await c.act(body)
      if (r) c.open('plant', { id: cur ? cur.id : r.state.plants[r.state.plants.length - 1].id })
    } catch (e) {
      c.flash(e.message)
    } finally {
      setSending(false)
    }
  }
  const summary = 'Arrosage tous les ' + f.water[0] + ' j (' + f.water[1] + ' en hiver) · ' + LIGHT[f.light].label
    + (f.toxic ? ' · toxique pour les animaux' : '')
  return (
    <Sheet title={cur ? 'Modifier ' + cur.name : 'Nouvelle plante'} onClose={cur ? () => c.open('plant', { id: cur.id }) : c.close}>
      <div className="sp-picked">
        <span className="ev-ic sm"><Icon n="leaf" s={17} /></span>
        <div className="who-txt"><b>{base.n}</b><span>{base.latin || 'Entretien réglé par toi'}</span></div>
        <button type="button" className="card-link" onClick={() => setStep('pick')}>Changer</button>
      </div>

      <label className={'photo-pick sm' + (shown ? ' has' : '')}>
        <input type="file" accept="image/*" onChange={choosePhoto} aria-label="Prendre ou choisir une photo" />
        {shown ? <img src={shown} alt="Aperçu" /> : <span><Icon n="photo" s={26} />Une photo (facultatif)</span>}
      </label>
      {shown ? <button type="button" className="linkish tone-stop" onClick={() => setPhoto(false)}>Retirer la photo</button> : null}

      <Label htmlFor="f-pname">{f.sp === 'autre' ? 'Son nom' : 'Un petit nom ? (facultatif)'}</Label>
      <input id="f-pname" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={30} autoComplete="off"
        placeholder={f.sp === 'autre' ? 'Ex. : la plante de mamie' : base.n} />

      <Label htmlFor="f-room">Où est-elle ?</Label>
      <input id="f-room" className="input" value={f.room} onChange={(e) => set('room', e.target.value)} maxLength={30} autoComplete="off" placeholder="Ex. : rebord de la fenêtre du salon" />
      <div className="chips sugg">
        {rooms.map((r) => <button key={r} type="button" className="chip" aria-pressed={f.room === r} onClick={() => set('room', r)}>{r}</button>)}
      </div>

      <Label>Qui s’en occupe ?</Label>
      <Chips value={f.owner || ''} onChange={(v) => set('owner', v || null)}
        options={[{ v: '', l: 'Tout le monde' }, ...c.members.map((m) => ({ v: m.id, l: m.id === c.me ? 'Moi' : m.name }))]} />
      <p className="hint days-h">
        {owner
          ? 'La notif « elle a soif » ira à ' + (owner.id === c.me ? 'toi' : owner.name) + ', et aux autres pendant ses voyages.'
          : 'La notif « elle a soif » ira à tous ceux qui sont à la coloc.'}
      </p>

      {cur ? null : (
        <>
          <Label>Dernier arrosage</Label>
          <Chips value={agoDays} onChange={setAgoDays} options={AGO} />
        </>
      )}

      <button type="button" className="care-toggle" aria-expanded={care} onClick={() => setCare(!care)}>
        <span><b>Entretien</b><small>{summary}</small></span>
        <Icon n={care ? 'minus' : 'plus'} s={18} />
      </button>
      {care ? (
        <div className="care-form">
          {f.sp !== 'autre' ? <p className="hint">Réglé d’après la fiche « {base.n} ». Change si ta plante n’est pas d’accord.</p> : null}
          <Label>Arrosage au printemps-été</Label>
          <DayStep value={f.water[0]} max={60} label="Printemps-été" onChange={(v) => set('water', [v, Math.max(v, f.water[1])])} />
          <Label>Arrosage en automne-hiver</Label>
          <DayStep value={f.water[1]} max={90} label="Automne-hiver" onChange={(v) => set('water', [f.water[0], v])} />
          <Label>Lumière</Label>
          <Chips value={f.light} onChange={(v) => set('light', v)} options={Object.entries(LIGHT).map(([v, L]) => ({ v, l: L.label }))} />
          <p className="hint days-h">{LIGHT[f.light].sub}</p>
          <Label>Humidité de l’air</Label>
          <Chips value={f.hum} onChange={(v) => set('hum', v)} options={Object.entries(HUM).map(([v, H]) => ({ v, l: H.label }))} />
          <Label>Engrais, de mars à septembre</Label>
          <Chips value={f.feed} onChange={(v) => set('feed', v)} options={FEEDS.map((v) => ({ v, l: feedLabel(v) }))} />
          <Label>Toxique pour les chats et les chiens ?</Label>
          <Chips value={String(f.toxic)} onChange={(v) => set('toxic', v === 'true' ? true : v === 'false' ? false : null)}
            options={[{ v: 'true', l: 'Oui' }, { v: 'false', l: 'Non' }, { v: 'null', l: 'Je ne sais pas' }]} />
        </div>
      ) : null}

      <Label htmlFor="f-notes">Notes (facultatif)</Label>
      <textarea id="f-notes" className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={400}
        placeholder="Ex. : eau de pluie seulement, cadeau de Léa" />

      <button type="button" className="btn btn-primary btn-block" disabled={sending || c.busy} onClick={save}>
        {sending ? 'Envoi…' : cur ? 'Enregistrer' : 'Ajouter la plante'}
      </button>
      {cur ? null : <p className="fine">Le soir où elle a soif, une notif part avec son nom. L’historique dit qui l’a arrosée en dernier.</p>}
    </Sheet>
  )
}
