// Le chat de la coloc. On peut y parler d'un élément précis (objet trouvé, soirée, envie, course, plante) :
// « En parler » à côté de l'élément l'ajoute au message, et il s'affiche avec lui.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, Av } from './ui.jsx'
import { todayISO, hm, isoAdd, parseISO, WD, MO_SHORT, LISTS, IKINDS, plural } from '../shared/rules.js'

export const REFS = {
  lost: { l: 'À qui est-ce ?', icon: 'photo', list: 'lost' },
  event: { l: 'Agenda', icon: 'cal', list: 'events' },
  idea: { l: 'Envie', icon: 'bulb', list: 'ideas' },
  item: { l: 'Liste', icon: 'cart', list: 'items' },
  plant: { l: 'Plante', icon: 'leaf', list: 'plants' },
}
const GROUP_MS = 5 * 60e3 // deux messages de la même personne à moins de 5 min : un seul nom

/** L'élément cité, s'il est encore dans sa liste. */
const live = (st, r) => (st[REFS[r.t].list] || []).find((x) => x.id === r.id) || null
const kindLabel = (r) =>
  r.t === 'item' && LISTS[r.list] ? LISTS[r.list].label : r.t === 'idea' && IKINDS[r.kind] ? IKINDS[r.kind].label : REFS[r.t].l
/** Ce que montre le message en cours d'écriture : tiré de l'élément lui-même. */
function snapOf(st, r) {
  const el = live(st, r)
  if (!el) return { ...r, title: r.title || '', gone: true }
  const title = { lost: el.note || 'Objet trouvé', event: el.title, idea: el.title, item: el.text, plant: el.name }[r.t]
  return { t: r.t, id: r.id, title, url: el.url || null, list: el.list, kind: el.kind }
}
export const unreadCount = (st) => st.chat.filter((m) => m.by !== st.me && m.at > st.chatRead).length
const about = (st, t, id) => st.chat.filter((m) => m.ref && m.ref.t === t && m.ref.id === id)

function openRef(c, r, el, url) {
  if (r.t === 'lost') return c.open('photo', el ? { id: r.id } : { url, title: r.title })
  if (!el) return
  if (r.t === 'plant') return c.open('plant', { id: r.id })
  c.setTab(r.t === 'event' ? 'agenda' : r.t === 'idea' ? 'envies' : 'commun')
}

function RefCard({ c, r }) {
  const el = live(c.st, r)
  const [broken, setBroken] = useState(false)
  const url = (el && el.url) || r.url
  const pic = url && !broken
  const body = (
    <>
      {pic ? <img src={url} alt="" onError={() => setBroken(true)} /> : <span className="ref-ic"><Icon n={REFS[r.t].icon} s={18} /></span>}
      <span className="ref-txt"><small>{kindLabel(r)}{el ? '' : ' · plus dans la liste'}</small><b>{r.title}</b></span>
    </>
  )
  if (!el && !(r.t === 'lost' && pic)) return <div className="ref is-gone">{body}</div>
  return <button type="button" className="ref" onClick={(e) => { e.stopPropagation(); openRef(c, r, el, url) }}>{body}</button>
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"»])/
function Linked({ text }) {
  return text.split(URL_RE).map((p, i) => (i % 2
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{p}</a>
    : p))
}

function dayLabel(day, today) {
  if (day === today) return 'Aujourd’hui'
  if (day === isoAdd(today, -1)) return 'Hier'
  const d = parseISO(day)
  const wd = WD[d.getUTCDay()]
  return wd.charAt(0).toUpperCase() + wd.slice(1, 3) + '. ' + d.getUTCDate() + ' ' + MO_SHORT[d.getUTCMonth()] +
    (day.slice(0, 4) !== today.slice(0, 4) ? ' ' + day.slice(0, 4) : '')
}

/* ---------- L'onglet ---------- */
export function Chat({ c }) {
  const box = useRef(null)
  const atBottom = useRef(true)
  const readSent = useRef(0)
  const [pending, setPending] = useState([])
  const [sel, setSel] = useState(null)
  const [vis, setVis] = useState(() => document.visibilityState !== 'hidden')
  const msgs = c.st.chat
  const last = msgs[msgs.length - 1]
  const unread = unreadCount(c.st)
  const { refresh, quiet } = c

  const stick = () => { const b = box.current; if (b && atBottom.current) b.scrollTop = b.scrollHeight }

  // Le chat ouvert demande les nouveaux messages toutes les 3 s (la réponse est vide si rien n'a changé).
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') refresh() }, 3000)
    const v = () => setVis(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', v)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', v) }
  }, [refresh])

  // Lu : la pastille disparaît (sur tous les appareils), et les notifs du chat aussi.
  useEffect(() => {
    if (!vis || !last) return
    if (unread && readSent.current < last.at) {
      readSent.current = last.at
      quiet({ type: 'chatRead', at: last.at })
    }
    try {
      navigator.serviceWorker?.ready
        ?.then((r) => r.getNotifications({ tag: 'chat' }))
        .then((l) => { for (const n of l || []) n.close() })
        .catch(() => {})
    } catch { /* pas de service worker */ }
  }, [vis, last, unread, quiet])

  // Clavier du téléphone : l'appli prend la hauteur qui reste au-dessus, le champ reste visible.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const root = document.documentElement
    const fit = () => {
      if (Math.abs(vv.scale - 1) > 0.01) { root.style.removeProperty('--vvh'); return }
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px')
      if (window.scrollY) window.scrollTo(0, 0)
      stick()
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
      root.style.removeProperty('--vvh')
    }
  }, [])

  useLayoutEffect(stick, [msgs.length, pending.length])

  const send = async (text, ref) => {
    const key = Date.now() + Math.random()
    atBottom.current = true
    setPending((p) => p.concat({ key, text, ref: ref ? snapOf(c.st, ref) : null }))
    c.setDraft({ text: '', ref: null })
    const r = await c.act({ type: 'chatSend', text, ref })
    setPending((p) => p.filter((x) => x.key !== key))
    if (!r) c.setDraft((d) => (d.text ? d : { text, ref }))
  }

  const rows = []
  let prev = null
  let prevDay = null
  for (const m of msgs) {
    const day = todayISO(m.at, c.tz)
    if (day !== prevDay) rows.push(<li key={'d' + day} className="msg-day"><span>{dayLabel(day, c.today)}</span></li>)
    const first = !prev || prev.by !== m.by || day !== prevDay || m.at - prev.at > GROUP_MS
    const mine = m.by === c.me
    const p = c.P(m.by)
    const open = sel === m.id
    rows.push(
      <li key={m.id} className={'msg' + (mine ? ' mine' : '') + (first ? ' first' : '')}>
        {mine ? null : <span className="msg-av">{first ? <Av p={p} s={30} /> : null}</span>}
        <div className="msg-col">
          {first && !mine ? <span className="msg-name">{p.name}</span> : null}
          <div className="bubble" tabIndex={mine ? 0 : undefined} aria-expanded={mine ? open : undefined}
            onClick={mine ? () => setSel(open ? null : m.id) : undefined}
            onKeyDown={mine ? (e) => { if (e.key === 'Enter') setSel(open ? null : m.id) } : undefined}>
            {m.ref ? <RefCard c={c} r={m.ref} /> : null}
            <p><Linked text={m.text} /><span className="msg-time">{hm(m.at, c.tz)}</span></p>
          </div>
          {open ? (
            <button type="button" className="msg-del" disabled={c.busy} onClick={() => { setSel(null); c.act({ type: 'chatDelete', id: m.id }) }}>
              <Icon n="trash" s={14} />Supprimer ce message
            </button>
          ) : null}
        </div>
      </li>,
    )
    prev = m
    prevDay = day
  }
  for (const x of pending) {
    rows.push(
      <li key={x.key} className="msg mine first is-pending">
        <div className="msg-col">
          <div className="bubble">
            {x.ref ? <RefCard c={c} r={x.ref} /> : null}
            <p>{x.text}<span className="msg-time">Envoi…</span></p>
          </div>
        </div>
      </li>,
    )
  }

  return (
    <>
      <div className="scroll chat-scroll" ref={box} onScroll={() => {
        const b = box.current
        atBottom.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80
      }}>
        {rows.length ? <ul className="msgs" aria-label="Messages">{rows}</ul> : (
          <div className="empty chat-empty">
            <span className="chat-empty-ic"><Icon n="chat" s={26} /></span>
            <p>Le chat de toute la coloc. Pour parler d’un truc précis (un objet trouvé, une soirée, une plante…), appuie sur « En parler » à côté : il s’affichera avec ton message.</p>
          </div>
        )}
      </div>
      <Composer c={c} onSend={send} />
    </>
  )
}

function Composer({ c, onSend }) {
  const { draft, setDraft } = c
  const ta = useRef(null)
  const ref = draft.ref ? snapOf(c.st, draft.ref) : null
  const [fine] = useState(() => { try { return matchMedia('(pointer: fine)').matches } catch { return false } })
  const refKey = draft.ref ? draft.ref.t + draft.ref.id : ''

  useEffect(() => { if (refKey) ta.current?.focus() }, [refKey])
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    if (el.scrollHeight) el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [draft.text])

  const go = (e) => {
    if (e) e.preventDefault()
    const text = draft.text.trim()
    if (!text) return
    onSend(text, draft.ref)
    ta.current?.focus()
  }
  return (
    <form className="composer" onSubmit={go}>
      {ref ? (
        <div className={'composer-ref' + (ref.gone ? ' is-gone' : '')}>
          {ref.url ? <img src={ref.url} alt="" /> : <span className="ref-ic"><Icon n={REFS[ref.t].icon} s={16} /></span>}
          <span className="ref-txt">
            <small>{ref.gone ? 'N’est plus dans la liste' : 'À propos de · ' + kindLabel(ref)}</small>
            <b>{ref.title || '…'}</b>
          </span>
          <button type="button" className="x" aria-label="Ne plus en parler dans ce message" onClick={() => setDraft((d) => ({ ...d, ref: null }))}><Icon n="x" s={15} /></button>
        </div>
      ) : null}
      <div className="composer-row">
        <textarea ref={ta} className="input" rows={1} value={draft.text} maxLength={1000}
          placeholder={ref ? 'Ton message à propos de « ' + (ref.title || '…') + ' »' : 'Message à la coloc'}
          aria-label="Message" enterKeyHint={fine ? 'send' : 'enter'}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          onKeyDown={(e) => { if (fine && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) go(e) }} />
        {/* Le bouton ne prend pas le focus : le clavier du téléphone reste ouvert entre deux messages. */}
        <button type="submit" className="send-b" aria-label="Envoyer" disabled={!draft.text.trim()} onPointerDown={(e) => e.preventDefault()}>
          <Icon n="send" s={20} />
        </button>
      </div>
    </form>
  )
}

/* ---------- « En parler » sur les éléments ---------- */
export function TalkChip({ c, t, id, name }) {
  const n = about(c.st, t, id).length
  return (
    <button type="button" className="chip talk-chip" onClick={() => c.talk(t, id)}
      aria-label={'En parler dans le chat' + (name ? ' : ' + name : '') + (n ? ', ' + plural(n, 'message') : '')}>
      <Icon n="chat" s={15} />{n || 'En parler'}
    </button>
  )
}

/** Le dernier message à propos d'un élément, sous l'élément (par ex. la réponse à « à qui est-ce ? »). */
export function TalkLast({ c, t, id }) {
  const list = about(c.st, t, id)
  if (!list.length) return null
  const m = list[list.length - 1]
  return (
    <button type="button" className="talk-last" onClick={() => c.talk(t, id)}>
      <Av p={c.P(m.by)} s={20} />
      <span className="talk-txt"><b>{m.by === c.me ? 'Toi' : c.P(m.by).name}</b> {m.text}</span>
      {list.length > 1 ? <small>{plural(list.length, 'message')}</small> : null}
    </button>
  )
}
