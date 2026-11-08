# Chez nous

L'appli de la coloc, en PWA (téléphone et ordi) : qui est là, qui fait du bruit (sax !), la porte du bas,
les propositions pour ce soir (ou dans plusieurs mois), les envies (films, sorties, projets vidéo),
l'onglet Commun : courses et choses à faire, lien Tricount, rappels (poubelles), « à qui est-ce ? » avec photo,
l'onglet Plantes et un chat.

- **Rejoindre ou créer une coloc** : code de 6 caractères en majuscules, sans 0 O Q, 1 I L, 2 Z, 5 S, 8 B, U V.
  Nombre max d'habitants fixé à la création (modifiable). Une fois pleine, le code ne fait plus entrer personne.
- **Pas de compte** : chaque appareil reçoit sa propre clé ; le code ne sert qu'à entrer.
  Pour retrouver son compte sur un autre appareil (ordi + téléphone), deux façons :
  - **code de connexion** : sur l'appareil connecté, réglages → « Connecter un appareil » affiche un code
    (10 min, une seule fois) à taper sur l'autre appareil, dans la même case que le code de la coloc (route `pair`).
    Il partage l'espace `code:` de Redis avec les codes de coloc, donc jamais de doublon ;
  - **« C'est moi »** : code de la coloc, choix de son prénom, puis validation depuis un appareil déjà connecté
    (carte « c'est toi ? » sur Maison, et notif) ou par un coloc.
  On peut déconnecter ses autres appareils dans les réglages.
- **Plantes** : on choisit l'espèce dans un catalogue d'une trentaine de plantes d'intérieur (`shared/plants.js`) qui préremplit
  la fiche : arrosage (printemps-été / automne-hiver, d'octobre à février on espace), lumière, humidité, température minimale,
  engrais (de mars à septembre), rempotage, toxicité pour les chats et les chiens, un conseil. Photo, pièce, qui s'en occupe, notes.
  « Je l'ai arrosée » note qui et quand (historique), « terre encore humide » repousse le prochain arrosage. Arroser une plante
  pas encore prévue demande confirmation (deux colocs qui arrosent, c'est trop d'eau). La tâche du soir envoie « … a soif »
  à la personne qui s'en occupe (aux autres si elle est en voyage), sinon à tous ceux qui sont là, puis tous les 3 jours si rien ne bouge.
- **Chat** : un chat pour toute la coloc (200 derniers messages, dans le document de la coloc). « En parler » sur un objet
  trouvé, une soirée, une envie, une course ou une plante ouvre le chat avec l'élément au-dessus du message ; il s'affiche
  avec le message (copie du titre et de la photo au moment de l'envoi), et le dernier message apparaît sous l'élément.
  Une photo encore montrée dans le chat n'est pas effacée quand l'élément disparaît : elle expire au bout de 120 jours.
  Notifs : une seule à la fois par téléphone (« 3 nouveaux messages »), sans sonner pour qui a lu le chat il y a moins de 45 s,
  jamais dans les bannières de l'appli. Pastille « non lu » sur l'onglet et sur l'icône de l'appli. Chat ouvert : il demande
  l'état toutes les 3 s avec `?v=<version>`, et le serveur répond `{ same: true }` si rien n'a changé.
- **Notifs** : Web Push (clés VAPID), sans Firebase. Sur iPhone, il faut ajouter l'appli à l'écran d'accueil.
- **Installation** : sur Android (et Chrome/Edge sur ordi), le bouton « Installer » ouvre la fenêtre d'installation du navigateur ; sur iPhone, il ouvre un tuto adapté au navigateur (`src/Install.jsx`). La session est aussi gardée dans un cookie, car Safari recopie ses cookies (pas le localStorage) dans l'appli installée : on reste connecté après l'installation.

## Structure

- `src/` : l'appli React (Vite + vite-plugin-pwa, service worker maison dans `src/sw.js`).
- `api/` : fonctions Vercel, une par route (`create`, `join`, `state`, `action`, `vapid`, `claim`, `pair`, `photo`, `cron`).
- `vercel.json` : la tâche du soir (`/api/cron`, tous les jours à 17 h UTC) qui envoie les rappels et « … a soif ».
- `server/` : logique de la coloc (`reduce.js`), routes (`handlers.js`), stockage Redis/mémoire (`store.js`), push.
- `shared/rules.js` : règles et libellés communs (codes, dates « ce soir / ce week-end », statuts).
- `shared/plants.js` : fiches des plantes et calcul du prochain arrosage (partagé par l'appli et le serveur).

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

Les photos sont dans Redis (`photo:<coloc>:<id>`). Celles d'« à qui est-ce ? » vivent 120 jours au plus et sont effacées
dès que l'objet est réclamé ; celles des plantes sont gardées (PERSIST) tant que la plante existe. Leur adresse contient un identifiant aléatoire de 128 bits, impossible à deviner.

Sans Redis sur Vercel, l'API répond 503 plutôt que de perdre des données.
