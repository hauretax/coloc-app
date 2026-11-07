// Carte « Installe l'appli » et tuto d'installation (iPhone, ou Android quand Chrome ne propose rien).
import { Icon, Sheet, Logo } from './ui.jsx'
import { useInstall, browserInfo } from './pwa-install.js'
import { touchSession } from './api.js'
import { fmtCode } from '../shared/rules.js'

/** Un bouton du navigateur, dessiné comme à l'écran. */
const K = ({ i, children }) => (
  <span className="key">{i ? <Icon n={i} s={15} /> : null}{children}</span>
)

const OPEN = (
  <>Ouvre <b>Chez nous</b> depuis sa nouvelle icône <span className="key key-logo"><Logo s={11} /></span> sur ton écran d’accueil, puis active les notifs.</>
)

function tuto(info) {
  if (info.p === 'ios') {
    const add = <>Fais défiler la liste et touche <K i="addsq">Sur l’écran d’accueil</K>.</>
    const missing = 'Pas de « Sur l’écran d’accueil » dans la liste ? Tout en bas, touche « Modifier les actions » pour l’ajouter.'
    if (info.browser === 'inapp') {
      return {
        title: 'Installer sur iPhone',
        before: 'Tu es dans une autre appli : l’installation ne marche que depuis un vrai navigateur.',
        steps: [
          <>Touche <K i="dots" /> ou <K i="link">Ouvrir dans Safari</K>, en haut ou en bas de l’écran.</>,
          <>Dans Safari, touche <K i="share">Partager</K> puis <K i="addsq">Sur l’écran d’accueil</K>.</>,
          <>Touche <K>Ajouter</K>.</>,
          OPEN,
        ],
        after: missing,
      }
    }
    if (info.browser === 'other') {
      return {
        title: 'Installer sur iPhone',
        steps: [
          <>Touche <K i="share">Partager</K> dans la barre d’adresse (ou dans le menu <K i="dots" />).</>,
          add,
          <>Touche <K>Ajouter</K>.</>,
          OPEN,
        ],
        after: 'Tu ne le trouves pas ? Ouvre la page dans Safari et recommence : ça marche à tous les coups.',
      }
    }
    const first = info.ipad
      ? <>Touche <K i="share">Partager</K> en haut à droite de Safari.</>
      : info.safariV >= 26
        ? <>Touche <K i="dots" /> à droite de l’adresse, puis <K i="share">Partager</K>.</>
        : <>Touche <K i="share">Partager</K> en bas de l’écran.</>
    return {
      title: info.ipad ? 'Installer sur iPad' : 'Installer sur iPhone',
      steps: [
        first,
        add,
        info.safariV >= 26
          ? <>Laisse l’option <b>app web</b> activée et touche <K>Ajouter</K>.</>
          : <>Touche <K>Ajouter</K> en haut à droite.</>,
        OPEN,
      ],
      after: missing + ' Si la page s’est ouverte dans une autre appli (WhatsApp…), ouvre-la d’abord dans Safari.',
    }
  }
  if (info.p === 'android') {
    if (info.browser === 'inapp') {
      return {
        title: 'Installer sur Android',
        before: 'Tu es dans une autre appli : l’installation ne marche que depuis Chrome.',
        steps: [
          <>Touche <K i="dotsv" />, puis <K i="link">Ouvrir dans Chrome</K>.</>,
          <>Dans Chrome, touche <K i="dotsv" /> puis <K i="download">Installer l’appli</K>.</>,
          OPEN,
        ],
      }
    }
    return {
      title: 'Installer sur Android',
      steps: [
        info.browser === 'samsung'
          ? <>Touche <K i="menu" /> en bas à droite.</>
          : <>Touche <K i="dotsv" /> en haut à droite{info.browser === 'firefox' ? ' (ou en bas)' : ''}.</>,
        <>Touche <K i="download">Installer l’appli</K> ou <K i="addsq">Ajouter à l’écran d’accueil</K>.</>,
        <>Confirme avec <K>Installer</K>.</>,
        OPEN,
      ],
      after: 'Déjà installée ? Elle est sur ton écran d’accueil ou dans la liste de tes applis.',
    }
  }
  if (info.browser === 'safari') {
    return {
      title: 'Installer sur ton Mac',
      steps: [<>Dans la barre des menus, ouvre <K>Fichier</K> puis <K>Ajouter au Dock</K>.</>, <>Clique sur <K>Ajouter</K>.</>],
    }
  }
  if (info.browser === 'chrome') {
    return {
      title: 'Installer sur ton ordi',
      steps: [<>Clique sur l’icône <K i="download" /> à droite de la barre d’adresse.</>, <>Confirme avec <K>Installer</K>.</>],
      after: 'Pas d’icône ? Menu ⋮, puis « Caster, enregistrer et partager », puis « Installer la page en tant qu’appli ».',
    }
  }
  return {
    title: 'Installer l’appli',
    before: 'Ce navigateur ne sait pas installer les applis web. Ouvre Chez nous dans Chrome, Edge ou Safari.',
    steps: [],
  }
}

export function InstallSheet({ onClose, code }) {
  const info = browserInfo()
  const t = tuto(info)
  return (
    <Sheet title={t.title} onClose={onClose}>
      {t.before ? <p className="install-before">{t.before}</p> : null}
      {t.steps.length ? (
        <ol className="install-steps">
          {t.steps.map((s, i) => <li key={i}><span className="install-n">{i + 1}</span><div>{s}</div></li>)}
        </ol>
      ) : null}
      {t.after ? <p className="hint">{t.after}</p> : null}
      {code && info.p === 'ios' ? <p className="hint">Si l’appli installée te redemande le code : <b className="code-inline">{fmtCode(code)}</b>, puis « C’est moi ».</p> : null}
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>OK</button>
    </Sheet>
  )
}

/** Clic sur « Installer » : la fenêtre du navigateur si elle existe, sinon le tuto. */
export function useInstallAction({ onTuto, flash }) {
  const ins = useInstall()
  const run = async () => {
    touchSession() // l'iPhone recopie les cookies dans l'appli installée : la connexion suit
    if (ins.canPrompt) {
      const r = await ins.prompt()
      if (r === 'accepted') flash?.('C’est installé : retrouve Chez nous sur ton écran d’accueil')
      if (r !== 'none') return
    }
    onTuto()
  }
  return { ins, run }
}

/** Sur téléphone, tant que l'appli n'est pas installée. */
export function InstallCard({ onTuto, flash }) {
  const { ins, run } = useInstallAction({ onTuto, flash })
  if (ins.installed || ins.later || ins.platform === 'desktop') return null
  const ios = ins.platform === 'ios'
  return (
    <section className="card install-card">
      <div className="card-head">
        <h4>Installe l’appli</h4>
        <button type="button" className="card-link" onClick={ins.setLater}>Plus tard</button>
      </div>
      <p className="muted">
        {ios
          ? 'Sur iPhone, c’est le seul moyen d’avoir les notifs : qui joue du sax, qui attend en bas, les rappels poubelles.'
          : 'Une icône sur ton écran d’accueil, et Chez nous s’ouvre comme une vraie appli.'}
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={run}><Icon n="download" s={16} />Installer</button>
      </div>
    </section>
  )
}
