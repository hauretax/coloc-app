// Notifications push du web (norme Web Push, clés VAPID). Marche sur Android et sur iPhone
// (appli ajoutée à l'écran d'accueil), sans Firebase.
import webpush from 'web-push'

export function makePush(env) {
  const publicKey = env.VAPID_PUBLIC_KEY
  const privateKey = env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    return { publicKey: null, async send() { return [] } }
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT || 'https://chez-nous.vercel.app', publicKey, privateKey)
  return {
    publicKey,
    /** Envoie chaque notification à tous les téléphones abonnés de son destinataire. Renvoie les abonnements morts. */
    async send(doc, out) {
      const gone = []
      const jobs = []
      for (const { to, n } of out) {
        for (const sub of doc.push?.[to] || []) {
          const payload = JSON.stringify({
            title: n.text, body: n.sub || '', tag: n.key || n.id, id: n.id, quiet: !!n.quiet, image: n.image || null,
            open: n.open || null, badge: typeof n.badge === 'number' ? n.badge : null,
          })
          jobs.push(
            webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'high', timeout: 5000 }).catch((err) => {
              if (err && (err.statusCode === 404 || err.statusCode === 410)) gone.push({ to, endpoint: sub.endpoint })
              else console.error('push', err && (err.statusCode || err.message))
            }),
          )
        }
      }
      await Promise.all(jobs)
      return gone
    },
  }
}
