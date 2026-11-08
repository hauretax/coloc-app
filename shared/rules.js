// Règles et libellés partagés entre l'appli (navigateur) et le serveur (fonctions Vercel).

/* Codes de coloc : 6 caractères en majuscules. On a retiré tout ce qui se confond :
   0 O Q, 1 I L, 2 Z, 5 S, 8 B, U V. */
export const ALPHABET = 'ACDEFGHJKMNPRTWXY34679'
export const CODE_LENGTH = 6
export const MAX_MEMBERS = 12
export const MIN_MEMBERS = 2

export function cleanCode(raw) {
  let code = ''
  let bad = ''
  for (const ch of String(raw || '').toUpperCase().replace(/[\s\-.]/g, '')) {
    if (ALPHABET.includes(ch)) code += ch
    else bad = ch
  }
  return { code: code.slice(0, CODE_LENGTH), bad }
}

export const fmtCode = (c) => (c || '').slice(0, 3) + ' ' + (c || '').slice(3)

export const PALETTE = [
  '#EBB13A', '#6CC0B8', '#A88CEA', '#F0977B', '#7FB3E8', '#9AD07B',
  '#E58FB6', '#B9A6F5', '#F2C14E', '#8FD3C9', '#D9A3F0', '#F5B38A',
]

export const KINDS = {
  home: { label: 'À la coloc', icon: 'home', tone: 'ok' },
  calm: { label: 'Au calme', icon: 'moon', tone: 'stop' },
  out: { label: 'Dehors', icon: 'pin', tone: 'cold' },
  away: { label: 'En voyage', icon: 'bag', tone: 'muted' },
}

export const WHAT = {
  sax: { label: 'Saxophone', mine: 'Tu joues du saxophone', other: (n) => n + ' joue du saxophone' },
  musique: { label: 'Musique', mine: 'Tu mets de la musique', other: (n) => n + ' met de la musique fort' },
  travaux: { label: 'Bricolage', mine: 'Tu bricoles', other: (n) => n + ' bricole (ça peut taper)' },
  autre: { label: 'Autre bruit', mine: 'Tu fais du bruit', other: (n) => n + ' fait du bruit' },
}

export const TYPES = {
  soiree: { label: 'Soirée', icon: 'glass' },
  film: { label: 'Film', icon: 'film' },
  video: { label: 'Tournage', icon: 'cam' },
  sortie: { label: 'Sortie', icon: 'bulb' },
  autre: { label: 'Autre', icon: 'cal' },
}

export const IKINDS = {
  film: { label: 'Film', icon: 'film' },
  idee: { label: 'Idée de sortie', icon: 'bulb' },
  video: { label: 'Projet vidéo', icon: 'cam' },
}

export const STAGES = ['Idée', 'Écriture', 'Tournage', 'Montage', 'Publiée']

export const WHEN_KEYS = ['soir', 'demain', 'weekend', 'semaine', 'jour']
export const MAX_AHEAD = 366 // on peut proposer un truc jusqu'à un an à l'avance

/* Listes partagées : courses et choses à faire. */
export const LISTS = {
  courses: { label: 'À acheter', empty: 'Rien à acheter. Il manque de la lessive, du PQ ?', ph: 'Ex. : PQ, lessive, huile…' },
  todo: { label: 'À faire', empty: 'Rien à faire pour l’instant.', ph: 'Ex. : appeler le proprio pour le radiateur' },
}

/* Appareils, pour « quelqu'un se connecte en tant que toi sur … ». */
export const DEVICES = {
  iphone: 'un iPhone', ipad: 'un iPad', android: 'un téléphone Android',
  mac: 'un Mac', windows: 'un PC Windows', linux: 'un ordi Linux', autre: 'un nouvel appareil',
}

/* Rappels : jours de la semaine (0 = dimanche), affichés du lundi au dimanche. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0]
export const WD_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

/* ---------- Dates (jours au format AAAA-MM-JJ, heure locale de la coloc) ---------- */
const pad = (n) => String(n).padStart(2, '0')
export const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
export const MO_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
export const MO = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
export function isoAdd(s, n) {
  const d = parseISO(s)
  d.setUTCDate(d.getUTCDate() + n)
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
}
export const dayDiff = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5) // a - b, en jours
export const weekday = (s) => parseISO(s).getUTCDay()
/** Le samedi du week-end en cours (du lundi au samedi : celui qui vient ; le dimanche : la veille). */
export const weekendOf = (today) => (weekday(today) === 0 ? isoAdd(today, -1) : isoAdd(today, 6 - weekday(today)))
export const WEEKENDS_AHEAD = 4
/** Les week-ends pour lesquels on peut dire si on est là : celui-ci et les 3 suivants (leur samedi). */
export const weekendList = (today) => Array.from({ length: WEEKENDS_AHEAD }, (_, i) => isoAdd(weekendOf(today), 7 * i))
/** Vendredi soir, samedi, dimanche : 0, 1, 2 (sinon -1). */
export const weekendSlot = (day) => ({ 5: 0, 6: 1, 0: 2 })[weekday(day)] ?? -1
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Jour courant (AAAA-MM-JJ) dans le fuseau donné. */
export function todayISO(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
}
/** « 17h » ou « 17h20 ». */
export function hm(ms, tz) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: tz || 'Europe/Paris', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms)
  const h = Number(parts.find((p) => p.type === 'hour').value)
  const m = parts.find((p) => p.type === 'minute').value
  return h + 'h' + (m === '00' ? '' : m)
}
/** Libellé d'une heure de fin : « 17h20 », « demain 9h », « lundi 9h ». */
export function untilLabel(ms, nowMs, tz) {
  const d = todayISO(ms, tz)
  const t = todayISO(nowMs, tz)
  if (d === t) return hm(ms, tz)
  if (d === isoAdd(t, 1)) return 'demain ' + hm(ms, tz)
  return WD[weekday(d)] + ' ' + hm(ms, tz)
}

export function dayLong(s, today) {
  const n = dayDiff(s, today)
  if (n === 0) return 'Aujourd’hui'
  if (n === 1) return 'Demain'
  const d = parseISO(s)
  return cap(WD[d.getUTCDay()]) + ' ' + d.getUTCDate() + ' ' + MO[d.getUTCMonth()]
}
export function dayShort(s, today) {
  const n = dayDiff(s, today)
  if (n === 0) return 'Auj.'
  if (n === 1) return 'Demain'
  const d = parseISO(s)
  // Au-delà d'une semaine, on ajoute le mois (on peut proposer jusqu'à un an à l'avance).
  return cap(WD[d.getUTCDay()].slice(0, 3)) + '. ' + d.getUTCDate() + (n > 7 ? ' ' + MO_SHORT[d.getUTCMonth()] : '')
}

/** Transforme un choix « quand » en période {day, until}. */
export function whenRange(when, today, pickedDay) {
  if (when === 'soir') return { day: today, until: today }
  if (when === 'demain') { const t = isoAdd(today, 1); return { day: t, until: t } }
  if (when === 'weekend') {
    const wd = weekday(today)
    if (wd === 6) return { day: today, until: isoAdd(today, 1) }
    if (wd === 0) return { day: today, until: today }
    const sat = isoAdd(today, 6 - wd)
    return { day: sat, until: isoAdd(sat, 1) }
  }
  if (when === 'semaine') return { day: today, until: isoAdd(today, 6) }
  const d = isISO(pickedDay) ? pickedDay : isoAdd(today, 2)
  return { day: d, until: d }
}

/** Rangement d'un événement par rapport à aujourd'hui : soir, demain, weekend, semaine, tard ou passe. */
export function bucket(e, today) {
  if (dayDiff(e.until, today) < 0) return 'passe'
  if (e.when === 'weekend') return 'weekend'
  if (e.when === 'semaine') return 'semaine'
  const n = dayDiff(e.day, today)
  if (n <= 0) return 'soir'
  if (n === 1) return 'demain'
  return n <= 7 ? 'semaine' : 'tard'
}
export const BUCKETS = [['soir', 'Ce soir'], ['demain', 'Demain'], ['weekend', 'Ce week-end'], ['semaine', 'Dans les prochains jours'], ['tard', 'Plus tard']]

export function whenShort(e, today) {
  const b = bucket(e, today)
  if (b === 'weekend') return 'Week-end'
  if (e.when === 'semaine') return 'Bientôt'
  if (b === 'soir') return 'Ce soir'
  if (b === 'demain') return 'Demain'
  return dayShort(e.day, today)
}
export function whenPhrase(e, today) {
  const b = bucket(e, today)
  if (b === 'weekend') return 'ce week-end'
  if (e.when === 'semaine') return 'dans la semaine'
  if (b === 'soir') return 'ce soir'
  if (b === 'demain') return 'demain'
  return dayLong(e.day, today).toLowerCase()
}

/** « le mardi », « le lundi et le jeudi », « tous les jours ». */
export function daysLabel(days) {
  const sorted = WEEK.filter((d) => days.includes(d))
  if (sorted.length === 7) return 'tous les jours'
  return 'le ' + listNames(sorted.map((d) => WD[d]))
}

export function listNames(names) {
  if (names.length <= 1) return names.join('')
  return names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1]
}
export const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '')

/** Adresse d'une photo « à qui est-ce ? ». Les identifiants sont longs et aléatoires : impossibles à deviner. */
export const photoUrl = (colocId, photoId) => '/api/photo?c=' + colocId + '&p=' + photoId
