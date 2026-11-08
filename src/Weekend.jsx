// Le week-end : chacun dit s'il est là le vendredi soir, le samedi, le dimanche (ce week-end et les 3 suivants).
import { useState } from 'react'
import { Icon, Av, Chips, Label, Sheet } from './ui.jsx'
import { weekendOf, weekendList, parseISO, isoAdd, MO_SHORT, listNames } from '../shared/rules.js'

const DAYS = ['Ven. soir', 'Sam.', 'Dim.']
const DAYS_LONG = ['Vendredi soir', 'Samedi', 'Dimanche']
const DAYS_LOW = ['vendredi soir', 'samedi', 'dimanche']
const NONE = [null, null, null]
const CHOICES = [{ v: 'true', l: 'Là' }, { v: 'false', l: 'Pas là' }, { v: 'null', l: 'Je sais pas' }]

const answer = (c, sat, id) => ((c.st.weekends[sat] || {})[id] || { days: NONE }).days
const said = (days) => days.some((v) => v !== null)
const dayNum = (d) => (d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate()))

/** « Sam. 14 – dim. 15 nov. » */
function range(sat) {
  const a = parseISO(sat)
  const b = parseISO(isoAdd(sat, 1))
  const same = a.getUTCMonth() === b.getUTCMonth()
  return 'Sam. ' + dayNum(a) + (same ? '' : ' ' + MO_SHORT[a.getUTCMonth()]) + ' – dim. ' + dayNum(b) + ' ' + MO_SHORT[b.getUTCMonth()]
}
/** « 21-22 nov. » */
function short(sat) {
  const a = parseISO(sat)
  const b = parseISO(isoAdd(sat, 1))
  return a.getUTCMonth() === b.getUTCMonth()
    ? dayNum(a) + '-' + dayNum(b) + ' ' + MO_SHORT[b.getUTCMonth()]
    : dayNum(a) + ' ' + MO_SHORT[a.getUTCMonth()] + '-' + dayNum(b) + ' ' + MO_SHORT[b.getUTCMonth()]
}

function Cell({ v, day }) {
  if (v === true) return <span className="wk-cell yes"><Icon n="check" s={14} /><span className="sr">{day} : là</span></span>
  if (v === false) return <span className="wk-cell no"><Icon n="x" s={13} /><span className="sr">{day} : pas là</span></span>
  return <span className="wk-cell unk"><span aria-hidden="true">?</span><span className="sr">{day} : pas encore dit</span></span>
}

function Grid({ c, sat, people }) {
  return (
    <table className="wk">
      <thead>
        <tr><th scope="col"><span className="sr">Qui</span></th>{DAYS.map((d) => <th key={d} scope="col">{d}</th>)}</tr>
      </thead>
      <tbody>
        {people.map((p) => (
          <tr key={p.id}>
            <th scope="row"><Av p={p} s={26} /><span>{p.id === c.me ? 'Toi' : p.name}</span></th>
            {answer(c, sat, p.id).map((v, i) => <td key={i}><Cell v={v} day={DAYS_LONG[i]} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** « Léa, Sam (dimanche) » : ceux qui ne sont pas là, et quand si ce n'est pas tout le week-end. */
function awayText(c, sat) {
  const list = c.members.map((p) => {
    const d = answer(c, sat, p.id)
    if (!d.includes(false)) return null
    const name = p.id === c.me ? 'toi' : p.name
    return d.every((v) => v === false) ? name : name + ' (' + listNames(DAYS_LOW.filter((_, i) => d[i] === false)) + ')'
  }).filter(Boolean)
  return list.length ? 'Pas là : ' + list.join(', ') : ''
}

/* ---------- Sur Maison ---------- */
export function Weekend({ c }) {
  const [sat, ...next] = weekendList(c.today)
  const mine = answer(c, sat, c.me)
  const later = next.map((s) => ({ s, t: awayText(c, s) })).filter((x) => x.t)
  return (
    <section className="card wk-card">
      <div className="card-head">
        <h4>Ce week-end</h4>
        <button type="button" className="card-link" onClick={() => c.open('weekend', { sat })}>{said(mine) ? 'Modifier' : 'Préciser'}</button>
      </div>
      <p className="muted">{range(sat)} · qui est là ?</p>
      <Grid c={c} sat={sat} people={c.members} />
      {said(mine) ? null : (
        <div className="actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={c.busy} onClick={() => c.act({ type: 'weekend', sat, days: [true, true, true] })}><Icon n="home" s={16} />Je suis là</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={c.busy} onClick={() => c.act({ type: 'weekend', sat, days: [false, false, false] })}><Icon n="bag" s={16} />Pas là</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => c.open('weekend', { sat })}>Selon les jours</button>
        </div>
      )}
      {later.length ? (
        <ul className="wk-later">
          {later.map((x) => (
            <li key={x.s}><button type="button" onClick={() => c.open('weekend', { sat: x.s })}><b>{short(x.s)}</b><span>{x.t}</span></button></li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="linkish" onClick={() => c.open('weekend', { sat: next[0] })}>Dire pour les week-ends suivants</button>
    </section>
  )
}

/* ---------- La feuille : mon week-end, jour par jour ---------- */
export function WeekendSheet({ c, sheet, done }) {
  const list = weekendList(c.today)
  const [sat, setSat] = useState(list.includes(sheet.sat) ? sheet.sat : list[0])
  const [days, setDays] = useState(() => answer(c, sat, c.me))
  const pick = (s) => { setSat(s); setDays(answer(c, s, c.me)) }
  const setDay = (i, v) => setDays((d) => d.map((x, j) => (j === i ? v : x)))
  const others = c.members.filter((p) => p.id !== c.me)
  return (
    <Sheet title="Là ce week-end ?" onClose={c.close}>
      <div className="chips" role="group" aria-label="Quel week-end">
        {list.map((s, i) => (
          <button key={s} type="button" className="chip" aria-pressed={s === sat} onClick={() => pick(s)}>
            {i === 0 ? 'Ce week-end' : short(s)}{said(answer(c, s, c.me)) ? <Icon n="check" s={14} /> : null}
          </button>
        ))}
      </div>
      <p className="hint days-h">{range(sat)}</p>
      <div className="chips sugg">
        <button type="button" className="chip" aria-pressed={days.every((v) => v === true)} onClick={() => setDays([true, true, true])}>Là tout le week-end</button>
        <button type="button" className="chip" aria-pressed={days.every((v) => v === false)} onClick={() => setDays([false, false, false])}>Pas là du tout</button>
      </div>
      {DAYS_LONG.map((l, i) => (
        <div key={l}>
          <Label>{l}</Label>
          <Chips value={String(days[i])} onChange={(v) => setDay(i, v === 'true' ? true : v === 'false' ? false : null)} options={CHOICES} />
        </div>
      ))}
      <button type="button" className="btn btn-primary btn-block" disabled={c.busy} onClick={() => done({ type: 'weekend', sat, days })}>Enregistrer</button>
      {others.length ? <><Label>Les autres</Label><Grid c={c} sat={sat} people={others} /></> : null}
      <p className="fine">Un soir où tu n’es pas là, tu ne reçois pas les rappels (poubelles…) ni « … a soif » : ils vont aux autres.</p>
    </Sheet>
  )
}
