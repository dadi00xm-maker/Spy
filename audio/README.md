# Voix enregistrées de l'annonceur

Ce dossier accueille les annonces enregistrées (voix humaine) qui remplacent
la synthèse vocale du téléphone.

- Un sous-dossier par langue : `audio/tn/` pour l'arabe tunisien.
- Formats conseillés : `.mp3` ou `.m4a` (mémo vocal d'iPhone), mono, court.
- Un fichier = une annonce.

Pour activer un fichier, l'ajouter dans `VOICE_CLIPS` (dans `js/app.js`) :

```js
var VOICE_CLIPS = {
  tn: {
    'mission.successResult': 'mission-nejhet.mp3'
  }
};
```

Si le fichier est absent ou illisible, l'app retombe automatiquement sur la
synthèse vocale — le jeu n'est jamais bloqué.

## Annonces attendues (clé → contenu)

| Clé | Contenu |
|---|---|
| `cer.close` | Fermez tous les yeux |
| `cer.spiesOpen` | Espions, ouvrez les yeux et reconnaissez-vous |
| `cer.spiesClose` | Espions, refermez les yeux |
| `cer.thumbs` | Espions, levez le pouce |
| `cer.cmdOpen` | Commandant, ouvre les yeux |
| `cer.cmdClose` | Commandant referme ; espions baissez le pouce |
| `cer.openAll` | Ouvrez tous les yeux, la partie commence |
| `reveal.pass` | Passe le téléphone au joueur suivant (sans prénom) |
| `mission.pass` | Passe le téléphone au joueur suivant (mission) |
| `vote.approved` / `vote.rejected` | Équipe approuvée / rejetée |
| `mission.successResult` / `mission.failResult` | Mission réussie / sabotée |
| `over.resWin` / `over.spyWin` | Les Résistants / les Espions gagnent |
| `decisive.hint` | Mission décisive : 2 sabotages requis |
| `assassin.title` | La dernière chance des espions |
| `timer.done` | Le temps est écoulé |
