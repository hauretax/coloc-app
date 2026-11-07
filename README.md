# Chez nous

L'appli de la coloc, en PWA (téléphone et ordi) : qui est là, qui fait du bruit (sax !), la porte du bas,
les propositions pour ce soir, les envies (films, sorties, projets vidéo).

- **Rejoindre ou créer une coloc** : code de 6 caractères en majuscules, sans 0 O Q, 1 I L, 2 Z, 5 S, 8 B, U V.
  Nombre max d'habitants fixé à la création (modifiable). Une fois pleine, le code ne fait plus entrer personne.
- **Pas de compte** : chaque téléphone reçoit sa propre clé en rejoignant ; le code ne sert qu'à entrer.
- **Notifs** : Web Push (clés VAPID), sans Firebase. Sur iPhone, il faut ajouter l'appli à l'écran d'accueil.

## Structure

- `src/` : l'appli React (Vite + vite-plugin-pwa, service worker maison dans `src/sw.js`).
- `api/` : fonctions Vercel, une par route (`create`, `join`, `state`, `action`, `vapid`).
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

Sans Redis sur Vercel, l'API répond 503 plutôt que de perdre des données.
