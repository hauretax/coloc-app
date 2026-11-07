// Installer l'appli sur l'écran d'accueil.
// Android (et Chrome/Edge sur ordi) : on garde la proposition du navigateur pour un bouton « Installer ».
// iPhone : aucun navigateur ne sait proposer l'installation, on montre un tuto.
import { useEffect, useState } from 'react'
import { isIOS, isStandalone } from './push.js'

const LATER_KEY = 'chez-nous-install-later'
const DONE_KEY = 'chez-nous-installed'
const LATER_MS = 7 * 86400000

let promptEvt = null
const listeners = new Set()
const emit = () => listeners.forEach((f) => f())
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* rien */ } }
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    promptEvt = e
    store(DONE_KEY, null) // le navigateur la propose : elle n'est donc plus installée
    emit()
  })
  window.addEventListener('appinstalled', () => {
    promptEvt = null
    store(DONE_KEY, '1')
    emit()
  })
}

/** 'ios' | 'android' | 'desktop' */
export function platform() {
  if (isIOS()) return 'ios'
  if (/Android/i.test(navigator.userAgent)) return 'android'
  return 'desktop'
}

/** Ce qu'il faut montrer dans le tuto, selon l'appareil et le navigateur. */
export function browserInfo() {
  const ua = navigator.userAgent
  const p = platform()
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Snapchat|LinkedInApp|TikTok|\bLine\//.test(ua)
  if (p === 'ios') {
    const ipad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const other = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo/.test(ua)
    const v = /Version\/(\d+)/.exec(ua)
    return { p, ipad, inApp, browser: inApp ? 'inapp' : other ? 'other' : 'safari', safariV: v ? +v[1] : 0 }
  }
  if (p === 'android') {
    const browser = inApp || /; wv\)/.test(ua) ? 'inapp' : /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox\//.test(ua) ? 'firefox' : 'chrome'
    return { p, inApp, browser }
  }
  const browser = /Firefox\//.test(ua) ? 'firefox' : /Edg\/|Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other'
  return { p, inApp: false, browser }
}

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  const later = Number(read(LATER_KEY) || 0)
  return {
    platform: platform(),
    /** Déjà ouverte depuis l'icône, ou installée depuis ce navigateur. */
    installed: isStandalone() || read(DONE_KEY) === '1',
    canPrompt: !!promptEvt,
    later: Date.now() - later < LATER_MS,
    setLater: () => { store(LATER_KEY, String(Date.now())); emit() },
    /** Ouvre la fenêtre d'installation du navigateur : 'accepted' | 'dismissed' | 'none'. */
    async prompt() {
      const e = promptEvt
      if (!e) return 'none'
      promptEvt = null // elle ne sert qu'une fois
      try {
        await e.prompt()
        const r = await e.userChoice
        if (r.outcome === 'accepted') store(DONE_KEY, '1')
        return r.outcome
      } catch {
        return 'none'
      } finally {
        emit()
      }
    },
  }
}
