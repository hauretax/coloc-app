# Chez nous

L'appli de la coloc, en PWA (téléphone et ordi) : qui est là, qui fait du bruit (sax !), la porte du bas,
les propositions pour ce soir (ou dans plusieurs mois), les envies (films, sorties, projets vidéo),
et l'onglet Commun : courses et choses à faire, lien Tricount, rappels (poubelles), « à qui est-ce ? » avec photo.

- **Rejoindre ou créer une coloc** : code de 6 caractères en majuscules, sans 0 O Q, 1 I L, 2 Z, 5 S, 8 B, U V.
  Nombre max d'habitants fixé à la création (modifiable). Une fois pleine, le code ne fait plus entrer personne.
- **Pas de compte** : chaque appareil reçoit sa propre clé ; le code ne sert qu'à entrer.
  Pour retrouver son compte sur un autre appareil : code de la coloc, « C'est moi », puis validation depuis un
  appareil déjà connecté (ou par un coloc). On peut déconnecter ses autres appareils dans les réglages.
- **Notifs** : Web Push (clés VAPID), sans Firebase. Sur iPhone, il faut ajouter l'appli à l'écran d'accueil.

## Structure

- `src/` : l'appli React (Vite + vite-plugin-pwa, service worker maison dans `src/sw.js`).
- `api/` : fonctions Vercel, une par route (`create`, `join`, `state`, `action`, `vapid`, `claim`, `photo`, `cron`).
- `vercel.json` : la tâche du soir (`/api/cron`, tous les jours à 17 h UTC) qui envoie les rappels.
- `server/` : logique de la coloc (`reduce.js`), routes (`handlers.js`), stockage Redis/mémoire (`store.js`), push.
- `shared/rules.js` : règles et libellés communs (codes, dates « ce soir / ce week-end », statuts).

## Développement

```
npm install
npm run dev     # l'API tourne dans Vite avec un stockage en mémoire
npm test        # tests de la logique et de l'API
```

## Prod (Vercel)

Variables d'environnement :
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` : base Upstash Redis (intégration Vercel « Upstash for Redis »).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` : notifications (`npx web-push generate-vapid-keys`).
- `CRON_SECRET` : Vercel l'envoie à `/api/cron` ; sans lui, la tâche des rappels est refusée.

Les photos « à qui est-ce ? » sont dans Redis (`photo:<coloc>:<id>`, 120 jours au plus, effacées dès que l'objet
est réclamé). Leur adresse contient un identifiant aléatoire de 128 bits, impossible à deviner.

Sans Redis sur Vercel, l'API répond 503 plutôt que de perdre des données.
