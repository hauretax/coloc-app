// Appels au serveur et session enregistrée sur ce téléphone.
// La session est aussi copiée dans un cookie : quand on installe l'appli sur iPhone,
// Safari recopie ses cookies (pas le localStorage) dans l'appli installée, qui reste ainsi connectée.
const KEY = 'chez-nous-session'
const COOKIE = 'chez_nous_s'
const COOKIE_DAYS = 400

const valid = (s) => (s && s.colocId && s.memberId && s.token ? { colocId: s.colocId, memberId: s.memberId, token: s.token } : null)

function readCookie() {
  try {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'))
    return m ? valid(JSON.parse(decodeURIComponent(m[1]))) : null
  } catch {
    return null
  }
}
function writeCookie(s) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    const val = s ? encodeURIComponent(JSON.stringify(s)) : ''
    document.cookie = COOKIE + '=' + val + '; Path=/; SameSite=Strict' + secure + '; Max-Age=' + (s ? COOKIE_DAYS * 86400 : 0)
  } catch { /* cookies bloqués : tant pis */ }
}

export function loadSession() {
  let s = null
  try { s = valid(JSON.parse(localStorage.getItem(KEY))) } catch { /* rien */ }
  if (!s) {
    s = readCookie()
    if (s) try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* rien */ }
  }
  if (s) writeCookie(s) // Safari efface au bout de 7 jours les cookies posés en JS : on le repose à chaque ouverture
  return s
}
export function saveSession(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch { /* stockage indisponible : la session ne survivra pas au rechargement */ }
  writeCookie(valid(s))
}
/** Repose le cookie juste avant une installation. */
export function touchSession() {
  loadSession()
}

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function call(path, { method = 'GET', body, session } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (session) headers.Authorization = `Bearer ${session.colocId}.${session.memberId}.${session.token}`
  let res
  try {
    res = await fetch('/api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  } catch {
    throw new ApiError('Pas de connexion. Réessaie quand le réseau revient.', 0)
  }
  let json = {}
  try { json = await res.json() } catch { /* réponse vide */ }
  if (!res.ok) throw new ApiError(json.error === 'gone' ? json.message : json.error || 'Erreur ' + res.status, res.status, json)
  return json
}

export const api = {
  create: (body) => call('create', { method: 'POST', body }),
  join: (body) => call('join', { method: 'POST', body }),
  state: (session) => call('state', { session }),
  action: (session, body) => call('action', { method: 'POST', body, session }),
  vapid: () => call('vapid'),
  claim: (body) => call('claim', { method: 'POST', body }),
  pair: (session) => call('pair', { method: 'POST', body: {}, session }),
  photo: (session, data) => call('photo', { method: 'POST', body: { data }, session }),
}
