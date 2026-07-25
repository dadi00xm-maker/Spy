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

  // Visibilité RÉELLE de la face du rôle (display calculé, pas l'attribut :
  // une régression CSS peut écraser [hidden] avec display:flex).
  const frontVisible = () => page.evaluate(() => {
    const el = document.querySelector('.role-front');
    return !!el && getComputedStyle(el).display !== 'none';
  });

  // Maintient la carte de rôle appuyée, vérifie le contenu, relâche.
  async function holdCard(checkFn) {
    const box = await page.locator('#hold-card').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    if (checkFn) await checkFn();
    await page.mouse.up();
  }

  async function revealAll(shotSpy) {
    const st = await state();
    const players = st.game.players;
    let spyShotDone = false;
    for (let i = 0; i < players.length; i++) {
      await click('[data-action="revealImHere"]');
      assert.strictEqual(await frontVisible(), false, 'rôle invisible AVANT l’appui');
      const isSpy = players[i].role === 'spy';
      await holdCard(async () => {
        assert.strictEqual(await frontVisible(), true, 'rôle visible pendant l’appui');
        if (isSpy && shotSpy && !spyShotDone) {
          await shot('03-role-espion');
          spyShotDone = true;
          // Les complices doivent être affichés (variante par défaut).
          const txt = await page.locator('.role-front').innerText();
          const others = players.filter((p, j) => p.role === 'spy' && j !== i);
          for (const o of others) assert.ok(txt.includes(o.name), 'complice affiché : ' + o.name);
        }
      });
      // Relâchée → cachée, et le bouton est déverrouillé.
      assert.strictEqual(await frontVisible(), false, 'rôle invisible après relâchement');
      await click('#reveal-next:not([disabled])');
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

  // Joue la mission : les espions de l'équipe sabotent si `spiesFail`.
  async function runMission(spiesFail) {
    let st = await state();
    const teamLen = st.game.team.length;
    for (let k = 0; k < teamLen; k++) {
      st = await state();
      const member = st.game.players[st.game.team[st.game.missionIdx]];
      await click('[data-action="missionImHere"]');
      if (member.role === 'spy' && spiesFail) {
        await click('[data-action="pickFail"]');
      } else {
        await click('[data-action="pickSuccess"]');
      }
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

  // Bascule de langue FR → EN → FR.
  await click('[data-action="toggleLang"]');
  assert.ok((await page.locator('.title').innerText()).includes('RESISTANCE'), 'titre anglais');
  await click('[data-action="toggleLang"]');
  assert.ok((await page.locator('.title').innerText()).includes('RÉSISTANCE'), 'titre français');
  console.log('  ✓ bascule FR/EN');

  // --- Partie A : 5 joueurs, les espions sabotent 3 missions --------
  await click('[data-action="toSetup"]');
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
      await click('[data-action="missionImHere"]');
      await shot('06-mission-choix');
      // La carte Échec doit être inerte pour un résistant.
      const member = st.game.players[team[0]];
      if (member.role === 'res') {
        await click('[data-action="pickFail"]');
        const s2 = await state();
        assert.strictEqual(s2.game.missionPick, null, 'un résistant ne peut pas saboter');
      }
      await click('[data-action="pickSuccess"]');
      await click('[data-action="pickChange"]');   // test du bouton « changer »
      if (member.role === 'spy') await click('[data-action="pickFail"]');
      else await click('[data-action="pickSuccess"]');
      await click('[data-action="pickConfirm"]');
      // Les membres restants.
      let s3 = await state();
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
    await runMission(true); // aucun espion dans l'équipe → succès garanti
    await click('[data-action="missionDone"]');
    st = await state();
    assert.strictEqual(st.game.missions[round].result, 'success');
  }
  st = await state();
  assert.strictEqual(st.screen, 'gameover');
  assert.strictEqual(st.game.winner, 'res');
  await shot('09-fin-resistance');
  console.log('  ✓ partie C : victoire de la Résistance (3 succès)');

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
