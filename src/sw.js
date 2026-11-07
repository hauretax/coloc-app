/* Service worker : appli disponible hors connexion + notifications push. */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

async function tellClients() {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const c of list) c.postMessage({ type: 'refresh' })
  return list
}

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: event.data && event.data.text() } }
  const options = { body: d.body || '', icon: '/icon-192.png', badge: '/badge-96.png', data: { id: d.id } }
  if (d.tag) { options.tag = d.tag; options.renotify = true }
  event.waitUntil(Promise.all([self.registration.showNotification(d.title || 'Chez nous', options), tellClients()]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const list = await tellClients()
    for (const c of list) if ('focus' in c) return c.focus()
    return self.clients.openWindow('/')
  })())
})
