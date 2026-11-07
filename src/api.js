// Appels au serveur et session enregistrée sur ce téléphone.
const KEY = 'chez-nous-session'

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    return s && s.colocId && s.memberId && s.token ? s : null
  } catch {
    return null
  }
}
export function saveSession(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch { /* stockage indisponible : la session ne survivra pas au rechargement */ }
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
  photo: (session, data) => call('photo', { method: 'POST', body: { data }, session }),
}
