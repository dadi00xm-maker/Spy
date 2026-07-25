/*
 * Règles du jeu — constantes et logique pure (testable avec Node).
 * 5 à 15 joueurs, deux camps : les Agents et les Espions.
 */
var RULES = (function () {
  'use strict';

  /* 5-10 joueurs : répartition classique du genre. 11-15 joueurs :
     extension Spy (~1/3 d'espions). 4 joueurs : « format court » Spy —
     1 seul espion, 3 manches (premier camp à 2 missions), équipes
     [3, 2, 3] pour ne pas démasquer l'espion dès la première équipe. */
  var SPY_COUNT = { 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4, 11: 4, 12: 4, 13: 5, 14: 5, 15: 6 };

  var TEAM_SIZES = {
    4: [3, 2, 3],
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
    11: [4, 5, 5, 6, 6],
    12: [4, 5, 6, 6, 7],
    13: [5, 6, 6, 7, 7],
    14: [5, 6, 6, 7, 8],
    15: [5, 6, 7, 8, 8]
  };

  function spyCount(nPlayers) {
    return SPY_COUNT[nPlayers];
  }

  function teamSizes(nPlayers) {
    return TEAM_SIZES[nPlayers];
  }

  // Nombre de manches de la partie (3 en format court, 5 sinon).
  function missionsCount(nPlayers) {
    return TEAM_SIZES[nPlayers].length;
  }

  // Missions à gagner : la majorité des manches (2 sur 3, 3 sur 5).
  function winsNeeded(nPlayers) {
    return Math.floor(missionsCount(nPlayers) / 2) + 1;
  }

  // La 4e mission (index 3) demande 2 sabotages à partir de 7 joueurs.
  // La finale « décisive » (jouée à égalité 2-2) en demande toujours 2.
  function failsNeeded(nPlayers, missionIndex, decisive) {
    if (decisive) return 2;
    return (missionIndex === 3 && nPlayers >= 7) ? 2 : 1;
  }

  // Vrai si la DERNIÈRE mission se joue à égalité parfaite (2-2 sur 5
  // manches). Jamais en format court : avec un seul espion, exiger deux
  // sabotages rendrait la finale ingagnable pour lui.
  function isDecisive(missions, missionIndex, nPlayers) {
    if (spyCount(nPlayers) < 2) return false;
    if (missionIndex !== missionsCount(nPlayers) - 1) return false;
    var t = tally(missions);
    var w = winsNeeded(nPlayers);
    return t.success === w - 1 && t.fail === w - 1;
  }

  // Mélange de Fisher-Yates ; rng injectable pour les tests.
  function shuffle(arr, rng) {
    var random = rng || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  // Retourne un tableau de rôles mélangés : 'spy' ou 'res'.
  function assignRoles(nPlayers, rng) {
    var roles = [];
    var spies = spyCount(nPlayers);
    for (var i = 0; i < nPlayers; i++) {
      roles.push(i < spies ? 'spy' : 'res');
    }
    return shuffle(roles, rng);
  }

  // Mode Commandant : un résistant devient Commandant (il connaît les
  // espions), un espion devient Assassin (il peut l'éliminer en fin de
  // partie pour voler la victoire).
  function specialRoles(roles, rng) {
    var random = rng || Math.random;
    var resIdx = [];
    var spyIdx = [];
    for (var i = 0; i < roles.length; i++) {
      (roles[i] === 'spy' ? spyIdx : resIdx).push(i);
    }
    return {
      commander: resIdx[Math.floor(random() * resIdx.length)],
      assassin: spyIdx[Math.floor(random() * spyIdx.length)]
    };
  }

  // Résout une mission à partir du nombre de cartes Sabotage jouées.
  function missionResult(nPlayers, missionIndex, failCards, decisive) {
    var needed = failsNeeded(nPlayers, missionIndex, decisive);
    return failCards >= needed ? 'fail' : 'success';
  }

  // Un vote est approuvé à la majorité stricte (égalité = rejet).
  function voteApproved(upVotes, downVotes) {
    return upVotes > downVotes;
  }

  function tally(missions) {
    var s = 0, f = 0;
    for (var i = 0; i < missions.length; i++) {
      if (!missions[i]) continue;
      if (missions[i].result === 'success') s++;
      else if (missions[i].result === 'fail') f++;
    }
    return { success: s, fail: f };
  }

  // 'res', 'spy' ou null si la partie continue.
  function winner(missions, nPlayers) {
    var t = tally(missions);
    var w = winsNeeded(nPlayers);
    if (t.success >= w) return 'res';
    if (t.fail >= w) return 'spy';
    return null;
  }

  var MIN_PLAYERS = 4;
  var MAX_PLAYERS = 15;
  var MAX_REJECTIONS = 5;

  return {
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    MAX_REJECTIONS: MAX_REJECTIONS,
    spyCount: spyCount,
    teamSizes: teamSizes,
    missionsCount: missionsCount,
    winsNeeded: winsNeeded,
    failsNeeded: failsNeeded,
    isDecisive: isDecisive,
    shuffle: shuffle,
    assignRoles: assignRoles,
    specialRoles: specialRoles,
    missionResult: missionResult,
    voteApproved: voteApproved,
    tally: tally,
    winner: winner
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RULES;
}
