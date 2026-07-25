/*
 * Test de bout en bout : joue trois parties complètes dans un vrai navigateur
 * et prend les captures d'écran de la documentation.
 *
 * Prérequis : le paquet npm « playwright » et un Chromium.
 *   BASE_URL=http://127.0.0.1:8000 CHROMIUM=/chemin/vers/chrome node tests/e2e.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'docs', 'screenshots');

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const launchOpts = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM) launchOpts.executablePath = process.env.CHROMIUM;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
  const state = () => page.evaluate(() => window.RESISTANCE_DEBUG.getState());
  const click = (sel) => page.click(sel);

  // La face du rôle est-elle réellement montrée ? (carte retournée)
  const cardFlipped = () => page.evaluate(() => {
    const c = document.querySelector('.role-card');
    return !!c && c.classList.contains('flipped');
  });
  // Face cachée = carte non retournée ET face arrière du recto masquée en 3D.
  const frontConcealed = () => page.evaluate(() => {
    const c = document.querySelector('.role-card');
    const f = document.querySelector('.role-front');
    if (!c || !f) return false;
    const cs = getComputedStyle(f);
    const bf = cs.backfaceVisibility || cs.webkitBackfaceVisibility;
    return !c.classList.contains('flipped') && bf === 'hidden';
  });

  async function revealAll(shotSpy, checkCeremony) {
    const st = await state();
    const players = st.game.players;
    let spyShotDone = false;
    for (let i = 0; i < players.length; i++) {
      await click('[data-action="revealImHere"]');
      assert.strictEqual(await frontConcealed(), true, 'rôle caché avant le toucher');
      // Premier toucher : la carte se retourne et montre le rôle.
      await click('#hold-card');
      await page.waitForTimeout(650);
      assert.strictEqual(await cardFlipped(), true, 'carte retournée après le toucher');
      const isSpy = players[i].role === 'spy';
      if (isSpy && shotSpy && !spyShotDone) {
        await shot('03-role-espion');
        spyShotDone = true;
        // Les complices doivent être affichés (variante par défaut).
        const txt = await page.locator('.role-front').innerText();
        const others = players.filter((p, j) => p.role === 'spy' && j !== i);
        for (const o of others) assert.ok(txt.includes(o.name), 'complice affiché : ' + o.name);
      }
      // Second toucher : la carte se cache à nouveau.
      await click('#hold-card');
      await page.waitForTimeout(650);
      assert.strictEqual(await cardFlipped(), false, 'carte cachée après le second toucher');
      await click('#reveal-next:not([disabled])');
    }
    // Avec l'annonceur vocal (défaut), la cérémonie d'ouverture s'intercale.
    const after = await state();
    if (after.screen === 'ceremony') {
      if (checkCeremony) {
        await click('[data-action="cerStart"]');
        await page.waitForTimeout(400);
        const stepText = await page.locator('.cer-step').innerText();
        assert.ok(stepText.length > 5, 'étape de cérémonie affichée');
        await shot('13-ceremonie');
      }
      await click('[data-action="cerSkip"]');
      const afterSkip = await state();
      assert.strictEqual(afterSkip.screen, 'board', 'plateau après la cérémonie');
    }
  }

  async function pickTeam(indices) {
    for (const i of indices) await click(`[data-action="togglePlayer"][data-idx="${i}"]`);
    await click('[data-action="proposeTeam"]:not([disabled])');
  }

  async function voteAll(v, expectApproved) {
    const st = await state();
    for (let i = 0; i < st.game.players.length; i++) {
      await click(`[data-action="vote"][data-idx="${i}"][data-v="${v}"]`);
    }
    await click('[data-action="voteResult"]:not([disabled])');
    const after = await state();
    assert.strictEqual(after.game.lastVote.approved, expectApproved, 'résultat du vote');
    await click('[data-action="afterVote"]');
  }

  // Joue la mission : les espions sabotent si `spiesFail` ; si
  // `resTapFail`, les résistants TOUCHENT aussi Échec (qui doit être
  // compté comme Succès par la règle officielle).
  async function runMission(spiesFail, resTapFail) {
    let st = await state();
    const teamLen = st.game.team.length;
    for (let k = 0; k < teamLen; k++) {
      st = await state();
      const member = st.game.players[st.game.team[st.game.missionIdx]];
      await click('[data-action="missionImHere"]');
      const tapFail = member.role === 'spy' ? spiesFail : !!resTapFail;
      await click(tapFail ? '[data-action="pickFail"]' : '[data-action="pickSuccess"]');
      await click('[data-action="pickConfirm"]');
    }
    // Révélation des cartes.
    while (await page.locator('[data-action="flipCard"]').count() > 0) {
      await page.locator('[data-action="flipCard"]').first().click();
    }
  }

  /* ---------------------------------------------------------------- */

  console.log('Ouverture de ' + BASE_URL);
  await page.goto(BASE_URL);
  await page.waitForSelector('[data-action="toSetup"]');
  await shot('01-accueil');

  // Le titre est « SPY » dans les deux langues ; la bascule FR/EN se vérifie
  // sur un libellé traduit.
  assert.ok((await page.locator('.title').innerText()).includes('SPY'), 'titre Spy');
  await click('[data-action="toggleLang"]');
  assert.ok((await page.locator('[data-action="rules"]').innerText()).includes('How to play'), 'interface anglaise');
  await click('[data-action="toggleLang"]');
  assert.ok((await page.locator('[data-action="rules"]').innerText()).includes('Règles du jeu'), 'interface française');
  console.log('  ✓ bascule FR/EN');

  // Bascule de thème clair/sombre.
  await click('[data-action="toggleTheme"]');
  assert.ok(await page.evaluate(() => document.body.classList.contains('theme-light')), 'thème clair appliqué');
  await shot('14-mode-clair');
  await click('[data-action="toggleTheme"]');
  assert.ok(await page.evaluate(() => !document.body.classList.contains('theme-light')), 'retour au thème sombre');
  console.log('  ✓ bascule thème clair/sombre');

  // Écran des règles modernisé : deux camps, trois étapes, pièges.
  await click('[data-action="rules"]');
  assert.strictEqual(await page.locator('.camp-card').count(), 2, 'cartes des deux camps');
  assert.strictEqual(await page.locator('.step-num').count(), 3, '3 étapes');
  assert.ok(await page.locator('.trap').count() >= 4, 'pièges listés');
  await shot('16-regles');
  await click('[data-action="rulesBack"]');
  console.log('  ✓ écran des règles');

  // --- Partie A : 5 joueurs, les espions sabotent 3 missions --------
  await click('[data-action="toSetup"]');
  // Le compteur monte jusqu'à 15 joueurs (extension) puis revient à 5.
  for (let i = 0; i < 10; i++) await click('[data-action="countPlus"]');
  assert.strictEqual((await page.locator('.counter-value').innerText()).trim(), '15', 'compteur à 15');
  assert.ok((await page.locator('.setup .hint').first().innerText()).includes('6'), '6 espions à 15 joueurs');
  for (let i = 0; i < 10; i++) await click('[data-action="countMinus"]');
  assert.strictEqual((await page.locator('.counter-value').innerText()).trim(), '5', 'retour à 5');
  const names = ['Ana', 'Bilal', 'Chloé', 'Dario', 'Emna'];
  for (let i = 0; i < names.length; i++) {
    await page.fill(`[data-name-idx="${i}"]`, names[i]);
  }
  await click('[data-action="cycleTimer"]'); // minuteur 3 min (visuel)
  await shot('02-configuration');
  await click('[data-action="startGame"]');

  let st = await state();
  assert.strictEqual(st.game.players.length, 5);
  assert.strictEqual(st.game.players.filter(p => p.role === 'spy').length, 2, '2 espions à 5 joueurs');
  console.log('  ✓ partie créée (5 joueurs, 2 espions)');

  await revealAll(true);
  st = await state();
  assert.strictEqual(st.screen, 'board');
  assert.strictEqual(st.game.phase, 'team');
  await shot('04-plateau-equipe');
  console.log('  ✓ distribution des rôles terminée');

  const spyIdx = st.game.players.map((p, i) => p.role === 'spy' ? i : -1).filter(i => i !== -1);
  const resIdx = st.game.players.map((p, i) => p.role === 'res' ? i : -1).filter(i => i !== -1);
  const sizes = [2, 3, 2]; // équipes des missions 1 à 3 (5 joueurs)

  for (let round = 0; round < 3; round++) {
    st = await state();
    assert.strictEqual(st.game.round, round);
    // Un espion + des résistants pour compléter.
    const team = [spyIdx[0], ...resIdx.slice(0, sizes[round] - 1)];
    await pickTeam(team);
    if (round === 0) await shot('05-vote');
    await voteAll('up', true);
    if (round === 0) {
      // Membre 1 : l'espion sabote (avec test du bouton « changer »).
      await click('[data-action="missionImHere"]');
      await shot('06-mission-choix');
      // Écran identique pour tous : aucune carte ne doit être désactivée.
      assert.strictEqual(await page.locator('.mcard[disabled]').count(), 0, 'aucune carte désactivée');
      await click('[data-action="pickSuccess"]');
      await click('[data-action="pickChange"]');
      await click('[data-action="pickFail"]');
      await click('[data-action="pickConfirm"]');
      // Membre 2 : le résistant TOUCHE Échec — c'est la carte Succès qui
      // doit se sélectionner (il ne peut pas saboter).
      await click('[data-action="missionImHere"]');
      await click('[data-action="pickFail"]');
      let s2 = await state();
      assert.strictEqual(s2.game.missionPick, true,
        'le geste Échec d’un résistant sélectionne Succès');
      await click('[data-action="pickConfirm"]');
      let s3 = await state();
      assert.deepStrictEqual(s3.game.missionChoices, [false, true],
        'seul l’espion a réellement saboté');
      // Les membres restants (aucun pour une équipe de 2).
      while (s3.game.phase === 'mission') {
        const m = s3.game.players[s3.game.team[s3.game.missionIdx]];
        await click('[data-action="missionImHere"]');
        await click(m.role === 'spy' ? '[data-action="pickFail"]' : '[data-action="pickSuccess"]');
        await click('[data-action="pickConfirm"]');
        s3 = await state();
      }
      while (await page.locator('[data-action="flipCard"]').count() > 0) {
        await page.locator('[data-action="flipCard"]').first().click();
      }
      await shot('07-mission-resultat');
    } else {
      await runMission(true);
    }
    // Le clic « Continuer » enregistre le résultat de la mission.
    await click('[data-action="missionDone"]');
    st = await state();
    assert.strictEqual(st.game.missions[round].result, 'fail', 'mission ' + (round + 1) + ' sabotée');
  }

  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'spy');
  assert.strictEqual(st.game.winReason, 'missions');
  await shot('08-fin-espions');
  console.log('  ✓ partie A : victoire des espions (3 sabotages)');

  // --- Partie B : 5 rejets de vote consécutifs → espions ------------
  await click('[data-action="replaySame"]');
  await revealAll(false);
  st = await state();
  const leaders = [st.game.leader];
  for (let r = 0; r < 5; r++) {
    st = await state();
    assert.strictEqual(st.game.voteTrack, r, 'piste des votes = ' + r);
    await pickTeam([0, 1]);
    await voteAll('down', false);
    st = await state();
    if (!st.game.winner) leaders.push(st.game.leader);
  }
  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'spy');
  assert.strictEqual(st.game.winReason, 'votes');
  // Le chef doit avoir tourné à chaque rejet.
  for (let i = 1; i < leaders.length; i++) {
    assert.strictEqual(leaders[i], (leaders[i - 1] + 1) % 5, 'rotation du chef');
  }
  console.log('  ✓ partie B : victoire des espions (5 équipes rejetées)');

  // --- Partie C : la Résistance gagne 3 missions --------------------
  await click('[data-action="replaySame"]');
  await revealAll(false);
  st = await state();
  const resOnly = st.game.players.map((p, i) => p.role === 'res' ? i : -1).filter(i => i !== -1);
  for (let round = 0; round < 3; round++) {
    await pickTeam(resOnly.slice(0, [2, 3, 2][round]));
    await voteAll('up', true);
    // Équipe 100 % résistante qui TOUCHE Échec : la règle officielle doit
    // compter chaque carte comme un Succès.
    await runMission(true, true);
    await click('[data-action="missionDone"]');
    st = await state();
    assert.strictEqual(st.game.missions[round].result, 'success',
      'mission réussie malgré des gestes Échec résistants');
  }
  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'res');
  await shot('09-fin-resistance');
  console.log('  ✓ partie C : victoire des Agents (3 succès)');

  // --- Partie D : mode Commandant, l'Assassin vise juste ------------
  await click('[data-action="toSetup"]');
  await click('[data-action="toggleCommander"]');
  await click('[data-action="startGame"]');
  await revealAll(false, true); // vérifie aussi la cérémonie d'ouverture
  st = await state();
  assert.strictEqual(st.game.commanderMode, true);
  const cmdIdx = st.game.players.findIndex(p => p.special === 'commander');
  const assIdx = st.game.players.findIndex(p => p.special === 'assassin');
  assert.ok(cmdIdx !== -1 && st.game.players[cmdIdx].role === 'res', 'le Commandant est un résistant');
  assert.ok(assIdx !== -1 && st.game.players[assIdx].role === 'spy', 'l’Assassin est un espion');
  let resD = st.game.players.map((p, i) => p.role === 'res' ? i : -1).filter(i => i !== -1);
  for (let round = 0; round < 3; round++) {
    await pickTeam(resD.slice(0, [2, 3, 2][round]));
    await voteAll('up', true);
    await runMission(true);
    await click('[data-action="missionDone"]');
  }
  st = await state();
  assert.strictEqual(st.game.phase, 'assassin', 'phase d’assassinat après 3 succès');
  assert.strictEqual(st.game.winner, null, 'pas encore de vainqueur');
  await shot('10-assassinat');
  await click(`[data-action="assassinPick"][data-idx="${cmdIdx}"]`);
  await click('[data-action="assassinConfirm"]');
  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'spy');
  assert.strictEqual(st.game.winReason, 'assassin');
  await shot('11-fin-assassinat');
  console.log('  ✓ partie D : Commandant éliminé, les espions volent la victoire');

  // --- Partie E : l'Assassin se trompe → la Résistance gagne --------
  await click('[data-action="replaySame"]');
  await revealAll(false);
  st = await state();
  assert.strictEqual(st.game.commanderMode, true, 'mode Commandant conservé au rejeu');
  const cmdE = st.game.players.findIndex(p => p.special === 'commander');
  const resE = st.game.players.map((p, i) => p.role === 'res' ? i : -1).filter(i => i !== -1);
  for (let round = 0; round < 3; round++) {
    await pickTeam(resE.slice(0, [2, 3, 2][round]));
    await voteAll('up', true);
    await runMission(true);
    await click('[data-action="missionDone"]');
  }
  const wrongTarget = resE.find(i => i !== cmdE);
  await click(`[data-action="assassinPick"][data-idx="${wrongTarget}"]`);
  await click('[data-action="assassinConfirm"]');
  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'res');
  assert.ok(st.game.assassination && !st.game.assassination.wasCommander);
  console.log('  ✓ partie E : l’Assassin se trompe, les Agents l’emportent');

  // --- Partie F : finale décisive à 2-2 (2 sabotages requis) --------
  await click('[data-action="toSetup"]');
  await click('[data-action="toggleCommander"]'); // repasse le mode Commandant sur OFF
  await click('[data-action="startGame"]');
  await revealAll(false);
  st = await state();
  assert.strictEqual(st.game.commanderMode, false);
  const spyF = st.game.players.map((p, i) => p.role === 'spy' ? i : -1).filter(i => i !== -1);
  const resF = st.game.players.map((p, i) => p.role === 'res' ? i : -1).filter(i => i !== -1);
  // Deux sabotages, puis deux succès → égalité 2-2.
  const teamsF = [
    [spyF[0], resF[0]],            // mission 1 (k=2) → sabotée
    [spyF[0], resF[0], resF[1]],   // mission 2 (k=3) → sabotée
    [resF[0], resF[1]],            // mission 3 (k=2) → réussie
    [resF[0], resF[1], resF[2]]    // mission 4 (k=3) → réussie
  ];
  for (const team of teamsF) {
    await pickTeam(team);
    await voteAll('up', true);
    await runMission(true);
    await click('[data-action="missionDone"]');
  }
  st = await state();
  assert.strictEqual(st.game.round, 4, 'manche 5 atteinte');
  assert.strictEqual(st.game.phase, 'team');
  // Bandeau décisif + badge « 2 ✗ » sur la 5e mission.
  const warnText = await page.locator('.phase .warn').innerText();
  assert.ok(warnText.length > 10, 'bandeau de finale décisive affiché');
  assert.strictEqual(await page.locator('.mbadge').count(), 1, 'badge décisif sur la mission 5');
  await shot('15-finale-decisive');
  // Finale : l'espion sabote SEUL → 1 sabotage < 2 requis → mission réussie.
  await pickTeam([spyF[0], resF[0], resF[1]]);
  await voteAll('up', true);
  await runMission(true);
  await click('[data-action="missionDone"]');
  st = await state();
  assert.strictEqual(st.game.missions[4].result, 'success',
    'finale réussie malgré 1 sabotage (2 requis)');
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'res');
  console.log('  ✓ partie F : finale décisive à 2-2 — 1 sabotage ne suffit plus');

  // --- Partie G : format court à 4 joueurs (1 espion, 3 manches) ----
  await click('[data-action="toSetup"]');
  await click('[data-action="countMinus"]'); // 5 → 4
  assert.strictEqual((await page.locator('.counter-value').innerText()).trim(), '4', 'compteur à 4');
  await click('[data-action="startGame"]');
  await revealAll(false); // pas de cérémonie : un seul espion, pas de Commandant
  st = await state();
  assert.strictEqual(st.game.players.length, 4);
  assert.strictEqual(st.game.missions.length, 3, '3 manches en format court');
  const spyG = st.game.players.findIndex(p => p.role === 'spy');
  const resG = st.game.players.map((p, i) => p.role === 'res' ? i : -1).filter(i => i !== -1);
  assert.strictEqual(resG.length, 3, 'un seul espion à 4 joueurs');
  // Manche 1 (k=3) : l'espion sabote.
  await pickTeam([spyG, resG[0], resG[1]]);
  await voteAll('up', true);
  await runMission(true);
  await click('[data-action="missionDone"]');
  // Manche 2 (k=2) : agents seuls → succès. Score 1-1.
  await pickTeam([resG[0], resG[1]]);
  await voteAll('up', true);
  await runMission(true);
  await click('[data-action="missionDone"]');
  st = await state();
  assert.strictEqual(st.game.round, 2);
  // Pas de finale décisive en format court (1 sabotage doit suffire).
  assert.strictEqual(await page.locator('.phase .warn').count(), 0, 'pas de bandeau décisif à 4');
  assert.strictEqual(await page.locator('.mnode').count(), 3, 'piste de 3 missions');
  // Manche 3 (k=3) : l'espion sabote seul → mission échouée → 2e victoire espionne.
  await pickTeam([spyG, resG[0], resG[1]]);
  await voteAll('up', true);
  await runMission(true);
  await click('[data-action="missionDone"]');
  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'spy');
  console.log('  ✓ partie G : format court à 4 joueurs — l’espion l’emporte 2-1');

  // --- Reprise de partie (sauvegarde locale) ------------------------
  await click('[data-action="toSetup"]');
  await click('[data-action="startGame"]');
  await revealAll(false);
  await page.reload();
  await page.waitForSelector('[data-action="resume"]');
  await click('[data-action="resume"]');
  st = await state();
  assert.strictEqual(st.screen, 'board');
  assert.strictEqual(st.game.phase, 'team');
  console.log('  ✓ reprise de partie après rechargement');

  await browser.close();

  if (errors.length) {
    console.error('\nErreurs JavaScript détectées :');
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\nBout en bout : tout est OK ✔');
}

main().catch((e) => { console.error(e); process.exit(1); });
