// Plantes : fiches d'entretien des plantes d'intérieur courantes, et calcul du prochain arrosage.
// Les fréquences sont des points de départ pour un appart chauffé : on touche toujours la terre avant d'arroser.
// Toxicité pour les chats et les chiens : d'après l'ASPCA (centre antipoison animal américain) et les fiches courantes
// (le Pilea peperomioides n'est pas dans la base de l'ASPCA, mais ses cousins Pilea y sont « non toxiques »).
import { todayISO, isoAdd, dayDiff } from './rules.js'

/** Repos de la plupart des plantes d'intérieur (octobre → février) : elles boivent moins, pas d'engrais. */
export const REST_MONTHS = [10, 11, 12, 1, 2]
export const isRest = (day) => REST_MONTHS.includes(Number(day.slice(5, 7)))

export const LIGHT = {
  soleil: { label: 'Plein soleil', sub: 'Quelques heures de soleil direct : fenêtre sud ou ouest.' },
  vive: { label: 'Lumière vive', sub: 'Près d’une fenêtre, sans soleil direct brûlant.' },
  douce: { label: 'Mi-ombre', sub: 'À 2 ou 3 m d’une fenêtre.' },
  ombre: { label: 'Peu de lumière', sub: 'Supporte un coin sombre (elle y pousse moins).' },
}
export const HUM = {
  sec: { label: 'Air sec', sub: 'L’air de l’appart lui va très bien.' },
  normal: { label: 'Normale', sub: 'Rien de spécial, mais loin des radiateurs.' },
  humide: { label: 'Air humide', sub: 'Brumise les feuilles ou pose le pot sur des billes d’argile mouillées. La salle de bain lui plaît.' },
}
export const FEEDS = [0, 15, 30, 60]
export const feedLabel = (d) => (!d ? 'Pas besoin' : d === 15 ? 'Tous les 15 jours' : d === 30 ? 'Une fois par mois' : 'Tous les 2 mois')

/** Ce qu'on note dans l'historique d'une plante. */
export const LOGS = {
  water: { label: 'Arrosée', icon: 'drop' },
  check: { label: 'Pas encore soif', icon: 'clock' },
  feed: { label: 'Engrais', icon: 'sprout' },
  repot: { label: 'Rempotée', icon: 'pot' },
  prune: { label: 'Taillée', icon: 'scissors' },
}

export const HOW = 'Arrose quand le dessus de la terre est sec : enfonce un doigt sur 2 ou 3 cm. Arrose bien, jusqu’à ce que l’eau coule par le trou du pot, puis vide la soucoupe au bout de 15 min. Eau à température de la pièce.'
export const SIGNS = [
  ['Trop d’eau', 'feuilles jaunes et molles, terre toujours mouillée, odeur de moisi. C’est ce qui tue le plus de plantes.'],
  ['Soif', 'feuilles qui pendent, sèchent ou s’enroulent, terre qui se décolle du bord du pot.'],
  ['Pas assez de lumière', 'tiges longues et molles, petites feuilles, la plante penche vers la fenêtre.'],
]

/* water : [jours entre deux arrosages au printemps-été, en automne-hiver]
   temp : température minimale (°C) · feed : jours entre deux engrais, de mars à septembre (0 = pas besoin)
   toxic : pour les chats et les chiens (null = ça dépend de l'espèce) */
export const PLANTS = {
  monstera: { n: 'Monstera', latin: 'Monstera deliciosa', water: [7, 14], light: 'vive', hum: 'normal', temp: 15, feed: 30, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Arrose quand les 3 premiers cm de terre sont secs. Des feuilles jaunes viennent souvent d’un excès d’eau. Un tuteur en mousse l’aide à grimper.' },
  pothos: { n: 'Pothos', latin: 'Epipremnum aureum', water: [7, 14], light: 'douce', hum: 'normal', temp: 15, feed: 30, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Il pardonne les oublis : ses feuilles pendent quand il a soif et se redressent après. Une tige coupée fait des racines dans un verre d’eau.' },
  philodendron: { n: 'Philodendron', latin: 'Philodendron', water: [7, 14], light: 'vive', hum: 'normal', temp: 15, feed: 30, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Laisse sécher le dessus de la terre entre deux arrosages. Pas de soleil direct : il brûle les feuilles.' },
  ficus: { n: 'Ficus benjamina', latin: 'Ficus benjamina', water: [7, 12], light: 'vive', hum: 'normal', temp: 15, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans, au printemps.',
    tip: 'Il déteste qu’on le déplace et les courants d’air : il perd ses feuilles. Trouve-lui une place lumineuse et n’y touche plus.' },
  caoutchouc: { n: 'Caoutchouc', latin: 'Ficus elastica', water: [10, 18], light: 'vive', hum: 'normal', temp: 13, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans, au printemps.',
    tip: 'Arrose quand la terre est sèche sur 3 ou 4 cm. Essuie ses grandes feuilles avec un chiffon humide pour qu’elles captent la lumière.' },
  lyrata: { n: 'Figuier lyre', latin: 'Ficus lyrata', water: [7, 14], light: 'vive', hum: 'normal', temp: 15, feed: 30, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Il veut beaucoup de lumière et une place fixe. Des taches brunes sur les feuilles : souvent trop d’eau.' },
  sansevieria: { n: 'Sansevieria', latin: 'Dracaena trifasciata (langue de belle-mère)', water: [14, 30], light: 'douce', hum: 'sec', temp: 10, feed: 30, toxic: true,
    repot: 'Tous les 3 ans, quand le pot est plein de racines.',
    tip: 'La plante des gens qui oublient : laisse sécher la terre complètement. Trop d’eau la fait pourrir à la base. Supporte aussi bien l’ombre que le soleil.' },
  zz: { n: 'Zamioculcas', latin: 'Zamioculcas zamiifolia (plante ZZ)', water: [14, 30], light: 'ombre', hum: 'sec', temp: 12, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans.',
    tip: 'Ses racines gonflées stockent l’eau : laisse sécher la terre complètement. Parfaite pour un coin sombre.' },
  spathiphyllum: { n: 'Fleur de lune', latin: 'Spathiphyllum', water: [5, 10], light: 'douce', hum: 'humide', temp: 15, feed: 15, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Elle prévient : ses feuilles s’affaissent quand elle a soif et se redressent quelques heures après l’arrosage. Terre légèrement humide, jamais d’eau dans la soucoupe.' },
  araignee: { n: 'Plante araignée', latin: 'Chlorophytum comosum', water: [7, 12], light: 'vive', hum: 'normal', temp: 10, feed: 30, toxic: false,
    repot: 'Tous les ans ou tous les 2 ans.',
    tip: 'Des bouts de feuilles bruns : souvent l’eau du robinet, trop calcaire ou chlorée. Laisse-la reposer une nuit. Ses bébés se replantent facilement.' },
  calathea: { n: 'Calathea', latin: 'Calathea (Goeppertia)', water: [5, 9], light: 'douce', hum: 'humide', temp: 16, feed: 30, toxic: false,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'La plus capricieuse : eau peu calcaire (pluie, filtrée ou reposée), terre toujours un peu humide, jamais de soleil direct. Feuilles qui s’enroulent : soif ou air trop sec.' },
  maranta: { n: 'Maranta', latin: 'Maranta leuconeura', water: [5, 9], light: 'douce', hum: 'humide', temp: 16, feed: 30, toxic: false,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Ses feuilles se replient le soir, c’est normal. Terre légèrement humide, eau peu calcaire.' },
  pilea: { n: 'Pilea', latin: 'Pilea peperomioides', water: [7, 12], light: 'vive', hum: 'normal', temp: 10, feed: 30, toxic: false,
    repot: 'Tous les ans, au printemps.',
    tip: 'Tourne le pot d’un quart de tour chaque semaine pour qu’elle pousse droite. Les petites pousses au pied se replantent.' },
  peperomia: { n: 'Peperomia', latin: 'Peperomia', water: [10, 18], light: 'douce', hum: 'normal', temp: 15, feed: 30, toxic: false,
    repot: 'Tous les 2 ou 3 ans : elle aime être à l’étroit.',
    tip: 'Ses feuilles épaisses gardent l’eau : laisse sécher la terre entre deux arrosages.' },
  hoya: { n: 'Hoya', latin: 'Hoya carnosa (fleur de porcelaine)', water: [10, 20], light: 'vive', hum: 'normal', temp: 12, feed: 30, toxic: false,
    repot: 'Rarement : elle fleurit mieux à l’étroit.',
    tip: 'Laisse sécher la terre entre deux arrosages. Ne coupe pas les tiges qui ont fleuri : les fleurs reviennent au même endroit.' },
  alocasia: { n: 'Alocasia', latin: 'Alocasia', water: [6, 12], light: 'vive', hum: 'humide', temp: 16, feed: 30, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Elle aime la chaleur et l’humidité. En hiver, elle peut perdre des feuilles et se mettre au repos : arrose moins, elle repart au printemps.' },
  dracaena: { n: 'Dragonnier', latin: 'Dracaena marginata', water: [10, 18], light: 'vive', hum: 'normal', temp: 15, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans.',
    tip: 'Laisse sécher la moitié de la terre. Des pointes brunes : air trop sec ou eau trop calcaire.' },
  yucca: { n: 'Yucca', latin: 'Yucca elephantipes', water: [14, 28], light: 'soleil', hum: 'sec', temp: 7, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans.',
    tip: 'Beaucoup de lumière, peu d’eau. Il peut passer l’été dehors.' },
  strelitzia: { n: 'Oiseau de paradis', latin: 'Strelitzia', water: [7, 14], light: 'soleil', hum: 'normal', temp: 12, feed: 15, toxic: true,
    repot: 'Tous les 2 ans, au printemps.',
    tip: 'Il lui faut beaucoup de lumière, même du soleil direct. Des feuilles qui se fendent, c’est normal.' },
  areca: { n: 'Palmier areca', latin: 'Dypsis lutescens', water: [5, 10], light: 'vive', hum: 'humide', temp: 15, feed: 30, toxic: false,
    repot: 'Tous les 2 ou 3 ans.',
    tip: 'Terre légèrement humide au printemps et en été. Des pointes sèches : brumise, ou éloigne-le du radiateur.' },
  orchidee: { n: 'Orchidée', latin: 'Phalaenopsis', water: [7, 12], light: 'vive', hum: 'humide', temp: 16, feed: 15, toxic: false,
    repot: 'Tous les 2 ans, après la floraison, dans un pot transparent.',
    tip: 'Arrose par trempage : 10 min dans une bassine d’eau tiède, puis laisse bien égoutter. Racines vertes : elle a bu ; grises : elle a soif. Jamais d’eau qui stagne dans le cache-pot.' },
  fougere: { n: 'Fougère', latin: 'Nephrolepis exaltata (fougère de Boston)', water: [3, 6], light: 'douce', hum: 'humide', temp: 12, feed: 30, toxic: false,
    repot: 'Tous les ans, au printemps.',
    tip: 'La terre ne doit jamais sécher complètement. Elle adore la salle de bain.' },
  aloe: { n: 'Aloe vera', latin: 'Aloe vera', water: [14, 30], light: 'soleil', hum: 'sec', temp: 10, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans, en terre à cactus.',
    tip: 'Arrose à fond puis laisse sécher complètement. Des feuilles molles et translucides : trop d’eau.' },
  cactus: { n: 'Cactus', latin: 'Cactacées', water: [14, 40], light: 'soleil', hum: 'sec', temp: 5, feed: 30, toxic: null,
    repot: 'Tous les 2 ou 3 ans, avec des gants.',
    tip: 'En hiver, presque pas d’eau et un endroit frais et lumineux : c’est ce qui le fait fleurir. Terre à cactus et pot percé.' },
  echeveria: { n: 'Echeveria', latin: 'Echeveria (succulente en rosette)', water: [10, 30], light: 'soleil', hum: 'sec', temp: 7, feed: 30, toxic: false,
    repot: 'Tous les 2 ans, en terre à cactus.',
    tip: 'Arrose la terre, pas le cœur de la rosette, puis laisse sécher complètement. Elle s’étire quand elle manque de lumière.' },
  jade: { n: 'Arbre de jade', latin: 'Crassula ovata', water: [14, 30], light: 'soleil', hum: 'sec', temp: 7, feed: 30, toxic: true,
    repot: 'Tous les 2 ou 3 ans.',
    tip: 'Laisse sécher la terre complètement. Des feuilles ridées : soif ; molles : trop d’eau.' },
  basilic: { n: 'Basilic', latin: 'Ocimum basilicum', water: [2, 3], light: 'soleil', hum: 'normal', temp: 15, feed: 15, toxic: false,
    repot: 'Celui du supermarché : sépare les pieds dans un pot plus grand.',
    tip: 'Terre toujours fraîche, arrose le matin au pied. Coupe les fleurs, et coupe au-dessus d’une paire de feuilles : il repousse plus touffu.' },
  menthe: { n: 'Menthe', latin: 'Mentha', water: [2, 4], light: 'douce', hum: 'normal', temp: 5, feed: 30, toxic: true,
    repot: 'Tous les ans : elle remplit vite le pot.',
    tip: 'Terre toujours fraîche. Coupe souvent pour qu’elle reste touffue.' },
  autre: { n: 'Autre plante', latin: '', water: [7, 14], light: 'vive', hum: 'normal', temp: null, feed: 30, toxic: null, repot: '', tip: '' },
}

export const ROOMS = ['Salon', 'Cuisine', 'Chambre', 'Salle de bain', 'Bureau', 'Balcon', 'Véranda']

/** Le dernier événement d'un type (l'historique est trié par date). */
export function lastLog(p, k) {
  for (let i = p.log.length - 1; i >= 0; i--) if (p.log[i].k === k) return p.log[i]
  return null
}

/** Prochain arrosage : dernier arrosage + fréquence de la saison, repoussé par « pas encore soif ». */
export function plantDue(p, today, tz) {
  const w = lastLog(p, 'water')
  const last = w ? todayISO(w.at, tz) : null
  const every = p.water[isRest(today) ? 1 : 0]
  let due = last ? isoAdd(last, every) : today
  if (p.snooze && p.snooze > due) due = p.snooze
  return { due, last, lastBy: w ? w.by : null, every, late: dayDiff(today, due) }
}

/** Engrais à donner : seulement de mars à septembre. */
export function feedDue(p, today, tz) {
  if (!p.feed || isRest(today)) return false
  const f = lastLog(p, 'feed')
  return !f || dayDiff(today, todayISO(f.at, tz)) >= p.feed
}

/** « Pas encore soif » : on revient voir dans quelques jours (un quart de la fréquence, entre 1 et 7 jours). */
export const snoozeDays = (every) => Math.min(7, Math.max(1, Math.round(every / 4)))
