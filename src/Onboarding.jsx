// Écran d'accueil : rejoindre une coloc avec son code, ou en créer une.
// Déjà dans la coloc ? On choisit son prénom et on valide depuis un appareil déjà connecté.
import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { InstallSheet, useInstallAction } from './Install.jsx'
import { Icon, Av, Avs, Label, Stepper, Logo, copyText } from './ui.jsx'
import { cleanCode, fmtCode, PALETTE, MAX_MEMBERS, MIN_MEMBERS, plural } from '../shared/rules.js'

const CODE_HINT = 'Pas de 0, O, 1, I, L ni d’autres caractères qui se confondent.'

function codeFromUrl() {
  try { return cleanCode(new URLSearchParams(location.search).get('code') || '').code } catch { return '' }
}

/** Pour le message « Connexion sur un Mac : c'est toi ? ». */
function deviceKind() {
  const ua = navigator.userAgent
  if (/iPhone|iPod/.test(ua)) return 'iphone'
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ipad'
  if (/Android/.test(ua)) return 'android'
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux/.test(ua)) return 'linux'
  return 'autre'
}

function Swatches({ value, onChange, taken = [] }) {
  return (
    <div className="swatches">
      {PALETTE.filter((c) => !taken.includes(c)).map((c) => (
        <button key={c} type="button" className="swatch" style={{ '--c': c }} aria-pressed={c === value} aria-label="Choisir cette couleur" onClick={() => onChange(c)} />
      ))}
    </div>
  )
}

export default function Onboarding({ msg, onDone }) {
  const [step, setStep] = useState('welcome')
  const [code, setCode] = useState(codeFromUrl)
  const [bad, setBad] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [colocName, setColocName] = useState('')
  const [max, setMax] = useState(4)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const [claim, setClaim] = useState(null)
  const [claimErr, setClaimErr] = useState('')
  const [tuto, setTuto] = useState(false)
  const { ins, run: install } = useInstallAction({ onTuto: () => setTuto(true) })
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  // En attente de validation : on demande au serveur toutes les 2,5 s si c'est bon.
  useEffect(() => {
    if (step !== 'claim' || !claim) return undefined
    let stop = false
    let timer = 0
    const poll = async () => {
      try {
        const r = await api.claim({ colocId: claim.colocId, id: claim.id, secret: claim.secret })
        if (stop) return
        if (r.session) { doneRef.current(r.session, r.state); return }
      } catch (e) {
        if (stop) return
        if (e.status) { setStep('who'); setClaim(null); setClaimErr(e.message); return }
        // pas de réseau : on réessaie
      }
      timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 2500)
    return () => { stop = true; clearTimeout(timer) }
  }, [step, claim])

  const go = (s) => { setStep(s); setError(''); setClaimErr('') }
  const run = async (fn) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const join = () => run(async () => {
    if (code.length !== 6) throw new Error('Il manque ' + plural(6 - code.length, 'caractère') + '.')
    const r = await api.join({ code })
    setPreview(r.coloc)
    setColor(r.coloc.color)
    go('who')
  })
  const enter = () => run(async () => {
    if (!name.trim()) throw new Error('Dis-nous ton prénom.')
    const r = await api.join({ code, memberName: name.trim(), color })
    onDone(r.session, r.state)
  })
  const startClaim = async (m) => {
    setBusy(true)
    setClaimErr('')
    try {
      const r = await api.claim({ code, member: m.id, device: deviceKind() })
      setClaim({ ...r.claim, name: r.name, color: m.color, asked: false })
      go('claim')
    } catch (e) {
      setClaimErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const askColoc = () => run(async () => {
    const r = await api.claim({ colocId: claim.colocId, id: claim.id, secret: claim.secret, ask: true })
    if (r.session) { onDone(r.session, r.state); return }
    setClaim((c) => ({ ...c, asked: true }))
  })
  const create = () => run(async () => {
    if (!colocName.trim()) throw new Error('Donne un nom à la coloc.')
    if (!name.trim()) throw new Error('Dis-nous ton prénom.')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const r = await api.create({ name: colocName.trim(), max, memberName: name.trim(), color, tz })
    setCreated(r)
    go('created')
  })

  const err = error ? <p className="code-hint err" role="alert">{error}</p> : null
  const back = <button type="button" className="back" onClick={() => go('welcome')}><Icon n="back" s={18} />Retour</button>
  let inner

  if (step === 'welcome') {
    inner = (
      <>
        <div className="ob-hero">
          <Logo s={30} cls="xl" />
          <h2>Chez nous</h2>
          <p>L’appli de la coloc : qui est là, qui fait du bruit, la porte du bas, les soirées.</p>
        </div>
        {msg ? <p className="ob-msg">{msg}</p> : null}
        <section className="card ob-card">
          <h3>Rejoindre une coloc</h3>
          <p className="muted">Tape le code à 6 caractères que tes colocs t’ont donné.</p>
          <label className="code-wrap" htmlFor="f-code">
            <input
              id="f-code" className="code-input" value={code} maxLength={12}
              autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck="false" aria-label="Code de la coloc"
              onChange={(e) => { const r = cleanCode(e.target.value); setCode(r.code); setBad(r.bad); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') join() }}
            />
            <span className="code-boxes" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={'code-box' + (code[i] ? ' full' : '') + (i === code.length ? ' next' : '')}>{code[i] || ''}</span>
              ))}
            </span>
          </label>
          <p className={'code-hint' + (error || bad ? ' err' : '')} role={error ? 'alert' : undefined}>
            {error || (bad ? '« ' + bad + ' » n’existe pas dans les codes : on a retiré les caractères qui se confondent.' : CODE_HINT)}
          </p>
          <button type="button" className="btn btn-primary btn-block" disabled={code.length !== 6 || busy} onClick={join}>
            {busy ? 'Recherche…' : 'Rejoindre'}
          </button>
        </section>
        <div className="ob-or">ou</div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => go('create')}><Icon n="plus" s={18} />Créer une coloc</button>
        {!ins.installed && ins.platform !== 'desktop' ? (
          <div className="ob-install">
            <span className="ob-install-ic"><Icon n="phone" s={19} /></span>
            <p><b>Installe l’appli</b><span>{ins.platform === 'ios' ? 'Sur iPhone, les notifs ne marchent qu’une fois installée.' : 'Une icône sur ton écran d’accueil, comme une vraie appli.'}</span></p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={install}><Icon n="download" s={16} />Installer</button>
          </div>
        ) : null}
      </>
    )
  } else if (step === 'who') {
    const taken = preview.members.map((m) => m.color)
    const again = (
      <section className="card ob-card">
        <h3>Déjà dans la coloc ?</h3>
        <p className="muted">Nouveau téléphone, ordi… Choisis ton prénom, puis valide depuis l’appareil où tu utilises déjà l’appli.</p>
        <ul className="claim-list">
          {preview.members.map((m) => (
            <li key={m.id}>
              <button type="button" className="claim-row" disabled={busy} onClick={() => startClaim(m)}>
                <Av p={m} s={34} /><b>{m.name}</b><span>C’est moi</span>
              </button>
            </li>
          ))}
        </ul>
        {claimErr ? <p className="code-hint err" role="alert">{claimErr}</p> : null}
      </section>
    )
    inner = (
      <>
        {back}
        <div className="ob-head">
          <p className="ob-eyebrow">Code {fmtCode(preview.code)}</p>
          <h2>Bienvenue chez « {preview.name} »</h2>
          <p className="muted">
            {plural(preview.members.length, 'habitant')} sur {preview.max} · {preview.full ? 'complète' : plural(preview.free, 'place') + ' libre' + (preview.free > 1 ? 's' : '')}
          </p>
          <span style={{ '--ring': 'var(--app)' }}><Avs people={preview.members} s={36} /></span>
        </div>
        {preview.full ? (
          <>
            {again}
            <p className="ob-msg">Plus de place pour quelqu’un de nouveau. Quelqu’un de la coloc peut en ajouter une dans ses réglages.</p>
          </>
        ) : (
          <>
            <section className="card ob-card">
              <h3>Première fois ici ?</h3>
              <Label htmlFor="f-name">Ton prénom</Label>
              <input id="f-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. : Alex" autoComplete="given-name" maxLength={20}
                onKeyDown={(e) => { if (e.key === 'Enter') enter() }} />
              <Label>Ta couleur</Label>
              <Swatches value={color} onChange={setColor} taken={taken} />
              {err}
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={enter}>Entrer dans la coloc</button>
            </section>
            {preview.members.length ? again : null}
          </>
        )}
      </>
    )
  } else if (step === 'claim') {
    inner = (
      <>
        <button type="button" className="back" onClick={() => { setClaim(null); go('who') }}><Icon n="back" s={18} />Annuler</button>
        <div className="ob-head center">
          <span style={{ '--ring': 'var(--app)' }}><Av p={{ name: claim.name, color: claim.color }} s={64} /></span>
          <h2>{claim.asked ? 'Demandé à la coloc' : 'Valide sur ton téléphone'}</h2>
          <p className="muted">
            {claim.asked
              ? 'Les autres ont reçu une notif. Dès que quelqu’un valide, tu entres.'
              : 'Ouvre Chez nous là où tu l’utilises d’habitude : une notif te demande « c’est toi ? ». Appuie sur « Oui, c’est moi ».'}
          </p>
          <p className="waiting">En attente</p>
        </div>
        {claim.asked ? null : (
          <section className="card ob-card">
            <h3>Pas ton téléphone sous la main ?</h3>
            <p className="muted">Quelqu’un de la coloc peut valider à ta place.</p>
            <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={askColoc}><Icon n="users" s={18} />Demander à la coloc</button>
          </section>
        )}
        {err}
        <p className="fine">La demande expire au bout de 10 minutes.</p>
      </>
    )
  } else if (step === 'create') {
    inner = (
      <>
        {back}
        <div className="ob-head">
          <h2>Créer une coloc</h2>
          <p className="muted">Tu recevras un code à donner à tes colocs.</p>
        </div>
        <section className="card ob-card">
          <Label htmlFor="f-coloc">Nom de la coloc</Label>
          <input id="f-coloc" className="input" value={colocName} onChange={(e) => setColocName(e.target.value)} placeholder="Ex. : Les Lilas" autoComplete="off" maxLength={30} />
          <Label>Combien d’habitants au maximum ?</Label>
          <Stepper value={max} min={MIN_MEMBERS} max={MAX_MEMBERS} label="place" onChange={(d) => setMax((m) => Math.min(MAX_MEMBERS, Math.max(MIN_MEMBERS, m + d)))} />
          <p className="hint">Une fois la coloc pleine, le code ne laisse plus entrer personne. Modifiable plus tard.</p>
          <Label htmlFor="f-name">Ton prénom</Label>
          <input id="f-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. : Alex" autoComplete="given-name" maxLength={20} />
          <Label>Ta couleur</Label>
          <Swatches value={color} onChange={setColor} />
          {err}
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={create}>{busy ? 'Création…' : 'Créer la coloc'}</button>
        </section>
      </>
    )
  } else {
    const st = created.state
    inner = (
      <>
        <div className="ob-head center">
          <Logo s={30} n="check" cls="xl" />
          <h2>« {st.name} » est prête</h2>
          <p className="muted">Donne ce code à tes colocs : ils ouvrent l’appli et le tapent sur l’écran d’accueil.</p>
        </div>
        <section className="card ob-card center">
          <p className="f-l">Code de la coloc</p>
          <div className="code-big">{fmtCode(st.code)}</div>
          <button type="button" className="btn btn-ghost" onClick={async () => setCopied(await copyText(st.code))}>
            <Icon n={copied ? 'check' : 'copy'} s={18} />{copied ? 'Code copié' : 'Copier le code'}
          </button>
          <p className="hint">1 habitant sur {st.max} pour l’instant. Tu retrouves le code dans l’icône des habitants.</p>
        </section>
        <button type="button" className="btn btn-primary btn-block" onClick={() => onDone(created.session, created.state)}>Entrer dans la coloc</button>
      </>
    )
  }

  return (
    <div className="shell">
      <div className="ob"><div className="ob-inner">{inner}</div></div>
      {tuto ? <InstallSheet onClose={() => setTuto(false)} /> : null}
    </div>
  )
}
