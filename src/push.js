// Notifications sur ce téléphone : état, activation, et réabonnement si le serveur a perdu l'abonnement.
import { api } from './api.js'

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** 'on' | 'off' | 'denied' | 'ios-browser' (iPhone hors écran d'accueil) | 'unsupported' */
export async function pushStatus() {
  if (!supported()) return isIOS() && !isStandalone() ? 'ios-browser' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg && (await reg.pushManager.getSubscription())
    if (sub && Notification.permission === 'granted') return 'on'
  } catch { /* pas encore de service worker */ }
  return 'off'
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function enablePush(session) {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    throw new Error(perm === 'denied' ? 'Notifs refusées. Réautorise-les dans les réglages du navigateur.' : 'Notifs pas activées.')
  }
  const { key } = await api.vapid()
  if (!key) throw new Error('Les notifs ne sont pas encore configurées sur le serveur.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  return api.action(session, { type: 'pushSubscribe', sub: sub.toJSON() })
}

/** Si ce téléphone est abonné mais que le serveur ne le sait plus, on renvoie l'abonnement. */
export async function resyncPush(session, serverCount) {
  if (serverCount > 0 || !supported() || Notification.permission !== 'granted') return null
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg && (await reg.pushManager.getSubscription())
  if (!sub) return null
  return api.action(session, { type: 'pushSubscribe', sub: sub.toJSON() })
}
