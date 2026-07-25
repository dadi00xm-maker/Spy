/*
 * Règles du jeu — constantes et logique pure (testable avec Node).
 * 5 à 10 joueurs, deux camps : la Résistance et les Espions.
 */
var RULES = (function () {
  'use strict';

  var SPY_COUNT = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

  var TEAM_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
  };

  function spyCount(nPlayers) {
    return SPY_COUNT[nPlayers];
  }

  function teamSizes(nPlayers) {
    return TEAM_SIZES[nPlayers];
  }

  // La 4e mission (index 3) demande 2 sabotages à partir de 7 joueurs.
  function failsNeeded(nPlayers, missionIndex) {
    return (missionIndex === 3 && nPlayers >= 7) ? 2 : 1;
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

  // Résout une mission à partir du nombre de cartes Échec jouées.
  function missionResult(nPlayers, missionIndex, failCards) {
    var needed = failsNeeded(nPlayers, missionIndex);
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
  function winner(missions) {
    var t = tally(missions);
    if (t.success >= MISSIONS_TO_WIN) return 'res';
    if (t.fail >= MISSIONS_TO_WIN) return 'spy';
    return null;
  }

  var MIN_PLAYERS = 5;
  var MAX_PLAYERS = 10;
  var MISSIONS_TO_WIN = 3;
  var MAX_REJECTIONS = 5;

  return {
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    MISSIONS_TO_WIN: MISSIONS_TO_WIN,
    MAX_REJECTIONS: MAX_REJECTIONS,
    spyCount: spyCount,
    teamSizes: teamSizes,
    failsNeeded: failsNeeded,
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
