/* Tests de la logique de jeu — lancer avec : node tests/test-rules.js */
'use strict';

const assert = require('assert');
const RULES = require('../js/rules.js');

let count = 0;
function check(label, fn) {
  fn();
  count++;
  console.log('  ✓ ' + label);
}

console.log('Règles :');

check('nombre d’espions par nombre de joueurs (4 à 15)', () => {
  assert.deepStrictEqual(
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(RULES.spyCount),
    [1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6]
  );
});

check('format court à 4 joueurs : 3 manches, premier camp à 2', () => {
  assert.deepStrictEqual(RULES.teamSizes(4), [3, 2, 3]);
  assert.strictEqual(RULES.missionsCount(4), 3);
  assert.strictEqual(RULES.winsNeeded(4), 2);
  assert.strictEqual(RULES.missionsCount(10), 5);
  assert.strictEqual(RULES.winsNeeded(10), 3);
});

check('tailles d’équipe par nombre de joueurs (5 à 15)', () => {
  assert.deepStrictEqual(RULES.teamSizes(5), [2, 3, 2, 3, 3]);
  assert.deepStrictEqual(RULES.teamSizes(6), [2, 3, 4, 3, 4]);
  assert.deepStrictEqual(RULES.teamSizes(7), [2, 3, 3, 4, 4]);
  assert.deepStrictEqual(RULES.teamSizes(8), [3, 4, 4, 5, 5]);
  assert.deepStrictEqual(RULES.teamSizes(9), [3, 4, 4, 5, 5]);
  assert.deepStrictEqual(RULES.teamSizes(10), [3, 4, 4, 5, 5]);
  assert.deepStrictEqual(RULES.teamSizes(11), [4, 5, 5, 6, 6]);
  assert.deepStrictEqual(RULES.teamSizes(12), [4, 5, 6, 6, 7]);
  assert.deepStrictEqual(RULES.teamSizes(13), [5, 6, 6, 7, 7]);
  assert.deepStrictEqual(RULES.teamSizes(14), [5, 6, 6, 7, 8]);
  assert.deepStrictEqual(RULES.teamSizes(15), [5, 6, 7, 8, 8]);
  // Cohérence : une équipe ne dépasse jamais le nombre de joueurs, et
  // les espions seuls ne suffisent jamais à remplir une équipe.
  for (let n = 4; n <= 15; n++) {
    for (const k of RULES.teamSizes(n)) {
      assert.ok(k < n, 'équipe < joueurs');
      assert.ok(k > RULES.spyCount(n) - 2, 'tailles plausibles');
    }
  }
});

check('la mission 4 demande 2 échecs à partir de 7 joueurs', () => {
  for (let n = 5; n <= 15; n++) {
    for (let m = 0; m < 5; m++) {
      const expected = (m === 3 && n >= 7) ? 2 : 1;
      assert.strictEqual(RULES.failsNeeded(n, m), expected, n + ' joueurs, mission ' + (m + 1));
    }
  }
});

check('résolution de mission selon les cartes Échec', () => {
  assert.strictEqual(RULES.missionResult(5, 0, 0), 'success');
  assert.strictEqual(RULES.missionResult(5, 0, 1), 'fail');
  assert.strictEqual(RULES.missionResult(7, 3, 1), 'success'); // 1 seul échec : insuffisant
  assert.strictEqual(RULES.missionResult(7, 3, 2), 'fail');
  assert.strictEqual(RULES.missionResult(10, 3, 3), 'fail');
});

check('vote approuvé à la majorité stricte (égalité = rejet)', () => {
  assert.strictEqual(RULES.voteApproved(3, 2), true);
  assert.strictEqual(RULES.voteApproved(2, 3), false);
  assert.strictEqual(RULES.voteApproved(3, 3), false);
});

check('distribution des rôles : bons effectifs, mélange stable avec rng injecté', () => {
  for (let n = 4; n <= 15; n++) {
    const roles = RULES.assignRoles(n);
    assert.strictEqual(roles.length, n);
    assert.strictEqual(roles.filter(r => r === 'spy').length, RULES.spyCount(n));
    assert.strictEqual(roles.filter(r => r === 'res').length, n - RULES.spyCount(n));
  }
  // rng déterministe → résultat déterministe
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  i = 0; const a = RULES.assignRoles(7, rng);
  i = 0; const b = RULES.assignRoles(7, rng);
  assert.deepStrictEqual(a, b);
});

check('rôles spéciaux : Commandant résistant, Assassin espion', () => {
  const roles = ['spy', 'res', 'spy', 'res', 'res', 'res', 'res'];
  for (let k = 0; k < 25; k++) {
    const sp = RULES.specialRoles(roles);
    assert.strictEqual(roles[sp.commander], 'res');
    assert.strictEqual(roles[sp.assassin], 'spy');
  }
  // rng déterministe → choix déterministe
  const a = RULES.specialRoles(roles, () => 0.99);
  const b = RULES.specialRoles(roles, () => 0.99);
  assert.deepStrictEqual(a, b);
});

check('shuffle conserve les éléments', () => {
  const arr = [1, 2, 3, 4, 5, 6];
  const out = RULES.shuffle(arr);
  assert.strictEqual(out.length, arr.length);
  assert.deepStrictEqual(out.slice().sort(), arr.slice().sort());
  assert.deepStrictEqual(arr, [1, 2, 3, 4, 5, 6]); // pas de mutation
});

check('finale décisive (égalité 2-2) : 2 sabotages requis', () => {
  const S = { result: 'success' }, F = { result: 'fail' };
  assert.strictEqual(RULES.isDecisive([S, F, S, F, null], 4, 5), true);
  assert.strictEqual(RULES.isDecisive([S, S, F, S, null], 4, 5), false);
  assert.strictEqual(RULES.isDecisive([S, F, S, F, null], 3, 5), false);
  // Jamais de finale décisive en format court (1 seul espion).
  assert.strictEqual(RULES.isDecisive([S, F, null], 2, 4), false);
  assert.strictEqual(RULES.failsNeeded(5, 4, true), 2);
  assert.strictEqual(RULES.failsNeeded(5, 4, false), 1);
  assert.strictEqual(RULES.failsNeeded(15, 4, true), 2);
  assert.strictEqual(RULES.missionResult(5, 4, 1, true), 'success'); // 1 sabotage : insuffisant
  assert.strictEqual(RULES.missionResult(5, 4, 2, true), 'fail');
  assert.strictEqual(RULES.missionResult(5, 4, 1, false), 'fail');
});

check('décompte et détection du vainqueur', () => {
  const S = { result: 'success' }, F = { result: 'fail' };
  assert.deepStrictEqual(RULES.tally([S, F, null, null, null]), { success: 1, fail: 1 });
  assert.strictEqual(RULES.winner([S, S, F, S, null], 5), 'res');
  assert.strictEqual(RULES.winner([F, S, F, F, null], 5), 'spy');
  assert.strictEqual(RULES.winner([S, F, S, null, null], 5), null);
  // Format court : premier camp à 2 missions.
  assert.strictEqual(RULES.winner([S, S, null], 4), 'res');
  assert.strictEqual(RULES.winner([F, S, F], 4), 'spy');
  assert.strictEqual(RULES.winner([S, F, null], 4), null);
});

console.log('\n' + count + ' tests OK ✔');
