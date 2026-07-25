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

check('nombre d’espions par nombre de joueurs', () => {
  assert.deepStrictEqual(
    [5, 6, 7, 8, 9, 10].map(RULES.spyCount),
    [2, 2, 3, 3, 3, 4]
  );
});

check('tailles d’équipe par nombre de joueurs', () => {
  assert.deepStrictEqual(RULES.teamSizes(5), [2, 3, 2, 3, 3]);
  assert.deepStrictEqual(RULES.teamSizes(6), [2, 3, 4, 3, 4]);
  assert.deepStrictEqual(RULES.teamSizes(7), [2, 3, 3, 4, 4]);
  assert.deepStrictEqual(RULES.teamSizes(8), [3, 4, 4, 5, 5]);
  assert.deepStrictEqual(RULES.teamSizes(9), [3, 4, 4, 5, 5]);
  assert.deepStrictEqual(RULES.teamSizes(10), [3, 4, 4, 5, 5]);
});

check('la mission 4 demande 2 échecs à partir de 7 joueurs', () => {
  for (let n = 5; n <= 10; n++) {
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
  for (let n = 5; n <= 10; n++) {
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

check('shuffle conserve les éléments', () => {
  const arr = [1, 2, 3, 4, 5, 6];
  const out = RULES.shuffle(arr);
  assert.strictEqual(out.length, arr.length);
  assert.deepStrictEqual(out.slice().sort(), arr.slice().sort());
  assert.deepStrictEqual(arr, [1, 2, 3, 4, 5, 6]); // pas de mutation
});

check('décompte et détection du vainqueur', () => {
  const S = { result: 'success' }, F = { result: 'fail' };
  assert.deepStrictEqual(RULES.tally([S, F, null, null, null]), { success: 1, fail: 1 });
  assert.strictEqual(RULES.winner([S, S, F, S, null]), 'res');
  assert.strictEqual(RULES.winner([F, S, F, F, null]), 'spy');
  assert.strictEqual(RULES.winner([S, F, S, null, null]), null);
});

console.log('\n' + count + ' tests OK ✔');
