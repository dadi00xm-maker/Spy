/*
 * Test de bout en bout du MODE EN LIGNE : cinq « téléphones » (cinq pages
 * du même navigateur) jouent une partie complète via le backend local
 * (?localnet=1 — BroadcastChannel, la page de l'hôte est le serveur).
 *
 *   BASE_URL=http://127.0.0.1:8000 CHROMIUM=/chemin/chrome node tests/e2e-online.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'docs', 'screenshots');
const URL = BASE_URL + '/?localnet=1&nocast=1';

const NAMES = ['Host', 'Ana', 'Bilal', 'Chadi', 'Dora'];

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const launchOpts = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM) launchOpts.executablePath = process.env.CHROMIUM;
  const browser = await chromium.launch(launchOpts);
  // Un seul contexte : BroadcastChannel ne traverse pas les profils.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  const errors = [];
  const pages = [];
  for (let i = 0; i < NAMES.length; i++) {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(NAMES[i] + ': ' + String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(NAMES[i] + ': ' + m.text()); });
    pages.push(p);
  }
  const host = pages[0];

  const dbg = (p) => p.evaluate(() => ONLINE.debug());
  const shot = (p, name) => p.screenshot({ path: path.join(SHOT_DIR, name + '.png') });

  async function waitFor(p, test, what) {
    for (let i = 0; i < 80; i++) {
      const d = await dbg(p);
      if (test(d)) return d;
      await p.waitForTimeout(100);
    }
    throw new Error('délai dépassé : ' + what);
  }

  async function register(p, name, email) {
    await p.goto(URL);
    await p.waitForSelector('[data-action="toSetup"]');
    await p.click('[data-action="onlineBtn"]');
    await p.waitForSelector('[data-action="ol_toRegister"]');
    await p.click('[data-action="ol_toRegister"]');
    await p.fill('[data-ol-field="name"]', name);
    await p.fill('[data-ol-field="email"]', email);
    await p.fill('[data-ol-field="pass"]', 'secret' + name);
    await p.click('[data-action="ol_register"]');
    await p.waitForSelector('[data-action="ol_create"]');
  }

  /* --- Comptes ------------------------------------------------------ */

  for (let i = 0; i < pages.length; i++) {
    await register(pages[i], NAMES[i], NAMES[i].toLowerCase() + '@spy.tn');
  }
  console.log('  ✓ 5 comptes créés (e-mail + mot de passe)');

  // E-mail déjà utilisé → erreur affichée.
  const extra = await context.newPage();
  await extra.goto(URL);
  await extra.waitForSelector('[data-action="toSetup"]');
  await extra.click('[data-action="onlineBtn"]');
  await extra.waitForSelector('[data-action="ol_toRegister"]');
  await extra.click('[data-action="ol_toRegister"]');
  await extra.fill('[data-ol-field="name"]', 'Emna');
  await extra.fill('[data-ol-field="email"]', 'ana@spy.tn');
  await extra.fill('[data-ol-field="pass"]', 'secretEmna');
  await extra.click('[data-action="ol_register"]');
  await extra.waitForSelector('.ol-error');
  // Mauvais mot de passe → erreur affichée.
  await extra.click('[data-action="ol_toLogin"]');
  await extra.fill('[data-ol-field="email"]', 'ana@spy.tn');
  await extra.fill('[data-ol-field="pass"]', 'mauvais');
  await extra.click('[data-action="ol_login"]');
  await extra.waitForSelector('.ol-error');
  await extra.close();
  console.log('  ✓ erreurs de compte affichées (e-mail pris, mauvais mot de passe)');

  /* --- Salon -------------------------------------------------------- */

  await host.click('[data-action="ol_create"]');
  await host.waitForSelector('.ol-code');
  const code = (await dbg(host)).code;
  assert.match(code, /^[A-Z]{4}$/, 'code de salon à 4 lettres');

  for (let i = 1; i < pages.length; i++) {
    await pages[i].fill('[data-ol-field="code"]', code);
    await pages[i].click('[data-action="ol_join"]');
    await pages[i].waitForSelector('.ol-code');
  }
  const lobby = await waitFor(host, (d) => d.room && Object.keys(d.room.players).length === 5,
    'les 5 joueurs dans le salon');
  for (const n of NAMES) {
    assert.ok(JSON.stringify(lobby.room.players).includes(n), 'joueur présent : ' + n);
  }
  await shot(host, '18-salon-en-ligne');
  // Bouton d'invitation : confirmation affichée (partage ou copie du lien).
  await host.click('[data-action="ol_invite"]');
  await host.waitForSelector('.ol-info');
  console.log('  ✓ salon ' + code + ' : 5 joueurs connectés + bouton d’invitation');

  /* --- Distribution des rôles --------------------------------------- */

  await host.click('[data-action="ol_start"]');
  const uidOf = {};
  const roleOf = {};
  for (const p of pages) {
    const d = await waitFor(p, (x) => x.room && x.room.state && x.room.state.phase === 'reveal' && x.priv,
      'phase reveal + rôle privé');
    assert.strictEqual(d.room.state.roles, null, 'aucun rôle dans l’état public');
    uidOf[NAMES[pages.indexOf(p)]] = d.user.uid;
    roleOf[d.user.uid] = d.priv.role;
  }
  const spies = Object.keys(roleOf).filter((u) => roleOf[u] === 'spy');
  assert.strictEqual(spies.length, 2, '2 espions sur 5 joueurs');

  // Chaque téléphone retourne SA carte puis confirme.
  let spyShot = false;
  for (const p of pages) {
    await p.click('.role-card');
    await p.waitForTimeout(400);
    const d = await dbg(p);
    if (d.priv.role === 'spy' && !spyShot) {
      const txt = await p.locator('.role-front').innerText();
      const mateUid = spies.find((u) => u !== d.user.uid);
      const mateName = Object.keys(uidOf).find((n) => uidOf[n] === mateUid);
      assert.ok(txt.includes(mateName), 'le spy voit son complice : ' + mateName);
      await shot(p, '19-role-en-ligne');
      spyShot = true;
    }
    await p.click('[data-action="ol_ready"]');
  }
  await waitFor(host, (d) => d.room.state.phase === 'team', 'phase équipe après les rôles');
  console.log('  ✓ rôles distribués : chaque téléphone ne voit que SA carte');

  /* --- Trois manches sabotées : victoire des espions ----------------- */

  const pageByUid = (uid) => pages[NAMES.indexOf(Object.keys(uidOf).find((n) => uidOf[n] === uid))];
  const sizes = [2, 3, 2];

  for (let round = 0; round < 3; round++) {
    let d = await waitFor(host, (x) => x.room.state.phase === 'team', 'phase équipe');
    const state = d.room.state;
    assert.strictEqual(state.round, round, 'manche ' + (round + 1));
    const leaderUid = state.order[state.leader];
    const leaderPage = pageByUid(leaderUid);

    if (round === 0) {
      // Bouton 👁 : revoir SA carte de rôle à tout moment.
      const p1 = pages[1];
      await p1.click('[data-action="ol_peek"]');
      await p1.waitForSelector('.peek-back .role-card.flipped');
      const peekTxt = await p1.locator('.peek-back .role-front').innerText();
      const expected = roleOf[uidOf['Ana']] === 'spy' ? 'SPY' : 'RÉSISTANT';
      assert.ok(peekTxt.includes(expected), 'la carte revue montre le bon camp');
      await p1.click('.peek-back');
      assert.strictEqual(await p1.locator('.peek-back').count(), 0, 'carte recachée');
      console.log('  ✓ bouton 👁 : chacun peut revoir son rôle en cours de partie');
    }

    // Le chef compose : 1 espion + des résistants.
    const resUids = state.order.filter((u) => roleOf[u] === 'res');
    const team = [spies[0]].concat(resUids.filter((u) => u !== spies[0]).slice(0, sizes[round] - 1));
    await leaderPage.waitForSelector('[data-action="ol_pick"]');
    for (const uid of team) {
      await leaderPage.click('[data-action="ol_pick"][data-uid="' + uid + '"]');
    }
    await leaderPage.click('[data-action="ol_team"]:not([disabled])');

    // Tout le monde vote OUI depuis son téléphone.
    for (const p of pages) {
      await p.waitForSelector('[data-action="ol_vote"][data-v="up"]');
      await p.click('[data-action="ol_vote"][data-v="up"]');
    }
    d = await waitFor(host, (x) => x.room.state.phase === 'voteResult', 'résultat du vote');
    assert.strictEqual(d.room.state.approved, true, 'équipe approuvée');
    if (round === 0) await shot(pages[1], '20-vote-en-ligne');
    await host.click('[data-action="ol_voteNext"]');

    // Les membres jouent leur carte : l'espion sabote.
    await waitFor(host, (x) => x.room.state.phase === 'mission', 'phase mission');
    for (const uid of team) {
      const p = pageByUid(uid);
      await p.waitForSelector('.mcard');
      // Rappel du camp affiché sur l'écran de mission (téléphone personnel).
      assert.strictEqual(await p.locator('.camp-line').count(), 1, 'rappel du camp affiché');
      if (roleOf[uid] === 'res') {
        assert.strictEqual(await p.locator('.mcard.fail').count(), 0, 'aucune carte Sabotage pour un résistant');
        assert.strictEqual(await p.locator('.mcard.success').count(), 2, 'deux cartes Succès pour un résistant');
        await p.locator('.mcard.success').nth(1).click();
      } else {
        assert.strictEqual(await p.locator('.mcard.success').count(), 1, 'une carte Succès pour le spy');
        assert.strictEqual(await p.locator('.mcard.fail').count(), 1, 'une carte Sabotage pour le spy');
        await p.locator('.mcard.fail').click();
      }
      await p.click('[data-action="ol_mconfirm"]');
    }

    // L'hôte retourne les cartes, tout le monde voit le résultat.
    await waitFor(host, (x) => x.room.state.phase === 'missionReveal', 'révélation');
    while (await host.locator('[data-action="ol_rflip"]').count() > 0) {
      await host.locator('[data-action="ol_rflip"]').first().click();
      await host.waitForTimeout(120);
    }
    await pages[2].waitForSelector('.verdict.ko');
    await host.click('[data-action="ol_missionNext"]');
    await waitFor(host, (x) => {
      const s = x.room.state;
      return s.missions[round] && s.missions[round].result === 'fail';
    }, 'mission ' + (round + 1) + ' sabotée');
  }

  const over = await waitFor(host, (d) => d.room.state.phase === 'gameover', 'fin de partie');
  assert.strictEqual(over.room.state.winner, 'spy', 'victoire des espions');
  assert.strictEqual(over.room.state.winReason, 'missions');
  assert.ok(over.room.state.roles, 'identités révélées à la fin');
  for (const p of pages) {
    await p.waitForSelector('.verdict.ko');
  }
  await shot(pages[3], '21-fin-en-ligne');
  console.log('  ✓ partie en ligne complète : 3 sabotages, victoire des espions');

  /* --- Rejouer + quitter --------------------------------------------- */

  await host.click('[data-action="ol_again"]');
  await waitFor(host, (d) => d.room && !d.room.state, 'retour au salon');
  await pages[4].waitForSelector('[data-action="ol_start"], .ol-code');
  await pages[4].click('[data-action="ol_leave"]');
  await pages[4].waitForSelector('[data-action="ol_create"]');
  console.log('  ✓ rejouer dans le même salon + quitter le salon');

  /* --- Lien d'invitation : ?join=CODE -------------------------------- */

  const invited = await context.newPage();
  await invited.goto(URL + '&join=' + code);
  // Le lien ouvre directement le mode en ligne ; après l'inscription, le
  // joueur atterrit dans le salon sans taper le code.
  await invited.waitForSelector('[data-action="ol_toRegister"]');
  await invited.click('[data-action="ol_toRegister"]');
  await invited.fill('[data-ol-field="name"]', 'Fadi');
  await invited.fill('[data-ol-field="email"]', 'fadi@spy.tn');
  await invited.fill('[data-ol-field="pass"]', 'secretFadi');
  await invited.click('[data-action="ol_register"]');
  await invited.waitForSelector('.ol-code');
  const inv = await dbg(invited);
  assert.strictEqual(inv.code, code, 'le lien d’invitation mène au bon salon');
  await invited.click('[data-action="ol_leave"]');
  await invited.close();
  console.log('  ✓ lien d’invitation : inscription puis salon rejoint automatiquement');

  /* --- Sans serveur : modale « bientôt » ------------------------------ */

  const plain = await context.newPage();
  await plain.goto(BASE_URL + '/?nocast=1');
  await plain.waitForSelector('[data-action="toSetup"]');
  await plain.click('[data-action="onlineBtn"]');
  await plain.waitForSelector('.modal');
  const modalTxt = await plain.locator('.modal').innerText();
  assert.ok(modalTxt.length > 30, 'modale explicative affichée');
  await plain.click('[data-action="onlineOk"]');
  assert.strictEqual(await plain.locator('.modal').count(), 0, 'modale fermée');
  await plain.close();
  console.log('  ✓ sans serveur configuré : modale « bientôt » sur le site public');

  if (errors.length) {
    throw new Error('Erreurs de page :\n' + errors.join('\n'));
  }

  await browser.close();
  console.log('\nMode en ligne : tout est OK ✔');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
