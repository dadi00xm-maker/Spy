# Spy 🕵️ — le traître est parmi vous

**Spy** est un jeu de déduction sociale (la grande famille du Loup-garou et de
Mafia) qui se joue entre amis avec **un seul téléphone** qui passe de main en
main. 4 à 15 joueurs : la majorité sont des Agents, mais des espions infiltrés
cherchent à saboter les missions… (À 4 joueurs : format court — 1 seul
espion, 3 manches, premier camp à 2 missions.)

C'est une **PWA** (application web) : elle s'installe sur l'écran d'accueil
d'un téléphone et fonctionne **entièrement hors ligne**. Aucun serveur, aucun
compte, aucune donnée collectée.

## ✨ Fonctionnalités

- **Distribution secrète des rôles** : chacun retourne sa carte d'un simple
  toucher (animation 3D) et la re-cache avant de passer le téléphone. Les
  espions découvrent leurs complices.
- **Mode Commandant (optionnel)** : le Commandant connaît les espions ; si les
  Agents réussissent 3 missions, l'Assassin des espions peut l'éliminer au
  dernier moment pour voler la victoire.
- **Suivi complet de la partie** : 5 missions, tailles d'équipe équilibrées,
  **chef d'équipe tiré au sort à chaque manche** (le même joueur peut être
  désigné plusieurs fois de suite — l'annonceur le nomme à voix haute),
  piste des votes rejetés (5 rejets = victoire des
  espions), règle des « 2 échecs » pour la mission 4 à partir de 7 joueurs.
- **Vote public** pour approuver ou rejeter chaque équipe.
- **Missions secrètes** : comme avec de vraies cartes, chaque membre de
  l'équipe joue sa carte en secret sur le téléphone, puis on retourne les
  cartes mélangées — impossible de savoir qui a saboté. Un Résistant reçoit
  **deux cartes Succès** (il ne peut pas saboter — et ne peut pas croire à
  tort qu'il serait un espion) ; seul un Spy reçoit Succès **et** Sabotage.
- **Anti-regards indiscrets** : fonds de cartes neutres illisibles à
  distance (seules les étiquettes sont colorées : Sabotage en rouge, Succès
  en bleu), rien n'est jamais désactivé, l'ordre des deux cartes du Spy est
  tiré au sort pour chaque joueur (la position du doigt ne révèle rien), et
  le rappel affiché sous les cartes est identique pour tous. Les cartes de
  rôle utilisent aussi un fond neutre.
- **Thème clair ou sombre** ☀️🌙 : bouton sur l'écran d'accueil, préférence
  mémorisée.
- **Mode TV (bêta)** 📺 : depuis un téléphone Android (Chrome), le bouton 📺
  du plateau envoie l'écran public du jeu (missions, votes, chef, résultats)
  sur Chromecast / Android TV / Google TV — les cartes secrètes restent sur
  le téléphone. La page `tv.html` peut aussi être ouverte sur un PC branché
  en HDMI (synchronisation locale entre onglets). Sur iPhone, la diffusion
  arrivera avec l'application native.
- **Mode en ligne (bêta, en cours d'activation)** 📱 : chacun sur son
  téléphone, où que vous soyez — compte joueur (e-mail + mot de passe),
  salon avec code à 4 lettres, carte secrète sur chaque écran, votes et
  missions joués simultanément. Deux façons de se connecter : compte
  e-mail + mot de passe, ou **connexion Google en un geste**. Le téléphone de l'hôte fait autorité et
  les rôles ne sont jamais envoyés aux autres téléphones avant la fin de
  la partie (documents privés par joueur). Invitation des amis par lien de
  partage (`?join=CODE`), rappel de son rôle 👁 à tout moment, rappel du
  camp sur l'écran de mission, et reprise de la partie en cours depuis
  l'écran d'accueil. Synchronisation Firebase (Auth + Firestore) chargée
  uniquement dans ce mode — le jeu à un téléphone reste 100 % hors ligne
  et sans dépendance.
- **Annonceur vocal** 🔊 : l'app annonce à voix haute à qui passer le
  téléphone, les résultats des votes et des missions, et le vainqueur
  (synthèse vocale du téléphone, FR/EN, bouton muet en cours de partie).
- **Cérémonie d'ouverture guidée** : posez le téléphone au centre, la voix
  mène le rituel — « Fermez tous les yeux… Espions, reconnaissez vos
  complices… » — avec tic-tac pendant les pauses, adaptée aux options
  (espions à l'aveugle, mode Commandant).
- **Options** : variante « espions à l'aveugle », mode Commandant, annonceur
  vocal, minuteur de discussion (3 / 5 / 10 min).
- **Trois langues** : français 🇫🇷 (par défaut), anglais 🇬🇧 et **arabe
  tunisien** 🇹🇳 (derja en écriture arabe, interface lue de droite à gauche,
  annonceur vocal en voix arabe). Le bouton 🌐 tourne entre les trois.
- **Voix enregistrées (optionnel)** : une annonce peut être remplacée par un
  enregistrement humain déposé dans `audio/<langue>/` (voir
  `audio/README.md`) ; à défaut, la synthèse vocale du téléphone prend le
  relais.
- **Reprise de partie** : la partie en cours est sauvegardée sur le téléphone.

## 📸 Aperçu

| Accueil | Rôle secret | Plateau | Mission |
|---|---|---|---|
| ![Accueil](docs/screenshots/01-accueil.png) | ![Rôle](docs/screenshots/03-role-espion.png) | ![Plateau](docs/screenshots/04-plateau-equipe.png) | ![Mission](docs/screenshots/07-mission-resultat.png) |

## 🚀 Jouer

### En ligne

**👉 https://spy.labelnou.com**

(l'ancienne adresse `dadi00xm-maker.github.io/Spy` redirige automatiquement)

À chaque push sur `main`, GitHub Actions relance les tests puis publie le
site sur la branche `gh-pages`, servie par GitHub Pages.

> Si le site ne répond pas, vérifier dans **Settings → Pages** que la source
> est **Deploy from a branch** avec la branche **gh-pages** (dossier `/`).

Sur téléphone, ouvrir le lien puis « **Ajouter à l'écran d'accueil** » :
l'app s'installe et fonctionne ensuite sans connexion.

### En local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

(ou simplement double-cliquer sur `index.html`)

## 🎲 Rappel des règles

| Joueurs | Espions | Équipes (missions 1→5) |
|:-------:|:-------:|:----------------------:|
| 4       | 1       | 3 · 2 · 3 *(3 manches)* |
| 5       | 2       | 2 · 3 · 2 · 3 · 3      |
| 6       | 2       | 2 · 3 · 4 · 3 · 4      |
| 7       | 3       | 2 · 3 · 3 · 4 · 4      |
| 8       | 3       | 3 · 4 · 4 · 5 · 5      |
| 9       | 3       | 3 · 4 · 4 · 5 · 5      |
| 10      | 4       | 3 · 4 · 4 · 5 · 5      |
| 11      | 4       | 4 · 5 · 5 · 6 · 6      |
| 12      | 4       | 4 · 5 · 6 · 6 · 7      |
| 13      | 5       | 5 · 6 · 6 · 7 · 7      |
| 14      | 5       | 5 · 6 · 6 · 7 · 8      |
| 15      | 6       | 5 · 6 · 7 · 8 · 8      |

*(11 à 15 joueurs : extension Spy, calibrée pour garder environ un tiers
d'espions.)*

Chaque manche : le chef propose une équipe → tout le monde vote → si l'équipe
est approuvée, ses membres jouent Succès/Sabotage en secret. Une carte
Sabotage suffit à faire échouer la mission (deux pour la mission 4 à partir
de 7 joueurs). Première
faction à 3 missions gagnées l'emporte ; 5 équipes rejetées d'affilée donnent
la victoire aux espions.

## 🛠️ Technique

- HTML / CSS / JavaScript pur, **aucune dépendance**, aucun build.
- `js/rules.js` : logique de jeu pure (testée), `js/app.js` : machine à états
  et interface, `js/i18n.js` : textes FR/EN.
- Service worker (`sw.js`) : cache hors ligne. `manifest.webmanifest` : installation PWA.

### Tests

```bash
node tests/test-rules.js
```

## 📁 Structure

```
index.html            Point d'entrée
tv.html               Écran TV (plateau public)
css/style.css         Thèmes sombre / clair
js/rules.js           Règles (pur, testable)
js/i18n.js            Textes FR / EN
js/app.js             États + interface (jeu à un téléphone)
js/online.js          Mode en ligne (comptes, salons, partie synchronisée)
js/net.js             Couche réseau (Firebase ou local pour les tests)
js/firebase-config.js Configuration du serveur (null = mode « bientôt »)
js/cast.js            Diffusion TV (API Presentation)
sw.js                 Hors ligne (service worker)
manifest.webmanifest  Installation PWA
icons/                Icônes de l'app
tests/                Tests (règles + bout en bout local et en ligne)
.github/workflows/    Déploiement GitHub Pages
```

## ⚖️ Mentions

**Spy** est un jeu original appartenant à la grande famille des jeux de
déduction sociale (Mafia, Loup-garou) — des mécaniques de genre librement
réutilisables. Tout le code, les textes et les visuels de ce dépôt sont des
créations originales (licence MIT).
