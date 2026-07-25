/*
 * La Résistance — compagnon de jeu (PWA hors ligne, un seul téléphone).
 * Machine à états : home → setup → reveal → board (team / vote / mission /
 * missionReveal) → gameover.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'resistance.save.v1';
  var LANG_KEY = 'resistance.lang';

  var app = document.getElementById('app');

  /* Icônes vectorielles du jeu (dessins originaux). Elles héritent de la
     couleur du texte via currentColor. */
  var ICONS = {
    spy: '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<ellipse cx="50" cy="34" rx="31" ry="6" fill="currentColor"/>' +
      '<path d="M30 33 Q30 11 50 11 Q70 11 70 33 Z" fill="currentColor"/>' +
      '<path d="M35 38 h30 v9 q0 9 -15 9 q-15 0 -15 -9 Z" fill="currentColor"/>' +
      '<rect x="34" y="40" width="32" height="8" rx="4" fill="#0b0f1c"/>' +
      '<circle cx="43" cy="44" r="3.4" fill="#fff" opacity="0.92"/>' +
      '<circle cx="57" cy="44" r="3.4" fill="#fff" opacity="0.92"/>' +
      '<path d="M18 88 Q22 61 40 57 L50 65 L60 57 Q78 61 82 88 Z" fill="currentColor"/>' +
      '<path d="M40 57 L50 65 L45 79 L37 63 Z" fill="#0b0f1c" opacity="0.3"/>' +
      '<path d="M60 57 L50 65 L55 79 L63 63 Z" fill="#0b0f1c" opacity="0.3"/>' +
      '</svg>',
    fist: '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<rect x="29" y="16" width="12" height="32" rx="6" fill="currentColor"/>' +
      '<rect x="43" y="11" width="12" height="37" rx="6" fill="currentColor"/>' +
      '<rect x="57" y="16" width="12" height="32" rx="6" fill="currentColor"/>' +
      '<rect x="70" y="24" width="11" height="24" rx="5.5" fill="currentColor"/>' +
      '<rect x="15" y="36" width="13" height="27" rx="6.5" fill="currentColor"/>' +
      '<path d="M26 46 h49 q8 0 8 10 v6 q0 20 -21 26 h-25 q-19 -5 -19 -25 v-9 q0 -8 8 -8 Z" fill="currentColor"/>' +
      '</svg>',
    commander: '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="43" fill="#12172b"/>' +
      '<circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-width="5"/>' +
      '<path d="M50 15 L57 36 L79 36 L61 49 L68 71 L50 58 L32 71 L39 49 L21 36 L43 36 Z" fill="currentColor"/>' +
      '<path d="M35 66 L50 56 L65 66 v8 L50 64 L35 74 Z" fill="#fff" opacity="0.95"/>' +
      '<path d="M35 78 L50 68 L65 78 v8 L50 76 L35 86 Z" fill="#fff" opacity="0.7"/>' +
      '</svg>'
  };

  /* ------------------------------------------------------------------ */
  /* État                                                                */
  /* ------------------------------------------------------------------ */

  var state = {
    lang: localStorage.getItem(LANG_KEY) || 'fr',
    screen: 'home', // home | setup | reveal | board | gameover | rules
    rulesReturn: 'home',
    setup: {
      count: 5,
      names: [],
      knownSpies: true,
      commander: false,
      voice: true,
      timerMin: 0
    },
    game: null,
    quitAsk: false
  };

  var timer = { left: 0, running: false, handle: null, finished: false };

  function newGame(names, options) {
    var n = names.length;
    var roles = RULES.assignRoles(n);
    var players = names.map(function (name, i) {
      return { name: name, role: roles[i], special: null };
    });
    if (options.commander) {
      var sp = RULES.specialRoles(roles);
      players[sp.commander].special = 'commander';
      players[sp.assassin].special = 'assassin';
    }
    return {
      players: players,
      knownSpies: options.knownSpies,
      commanderMode: !!options.commander,
      voice: options.voice !== false,
      timerMin: options.timerMin,
      round: 0,
      leader: Math.floor(Math.random() * n),
      voteTrack: 0,
      missions: [null, null, null, null, null],
      phase: 'reveal', // reveal | team | vote | voteResult | mission | missionReveal | assassin
      revealIdx: 0,
      revealStage: 'pass', // pass | card
      revealSeen: false,
      revealFlipped: false,
      team: [],
      votes: [],
      lastVote: null,
      missionIdx: 0,
      missionStage: 'pass', // pass | pick
      missionPick: null,
      missionSwap: false, // ordre aléatoire des deux cartes (anti-observation)
      missionChoices: [],
      revealCards: [],
      assassinPick: null,
      assassination: null,
      winner: null,
      winReason: null
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        setup: state.setup,
        game: state.game,
        screen: state.screen
      }));
    } catch (e) { /* stockage indisponible : on joue sans sauvegarde */ }
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearGame() {
    state.game = null;
    save();
  }

  function hasResumableGame() {
    var s = loadSave();
    return !!(s && s.game && !s.game.winner &&
      (s.screen === 'board' || s.screen === 'reveal' || s.screen === 'ceremony'));
  }

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

  function t(key, vars) {
    var dict = I18N[state.lang] || I18N.fr;
    var str = dict[key] || I18N.fr[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        str = str.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return str;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      osc.onended = function () { ctx.close(); };
    } catch (e) { /* silencieux si l'audio est bloqué */ }
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ------------------------------------------------------------------ */
  /* Annonceur vocal (synthèse vocale du téléphone)                      */
  /* ------------------------------------------------------------------ */

  function voiceSupported() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  // Parle si l'annonceur est activé pour la partie en cours. `onend` est
  // toujours appelé (aussi en cas d'échec ou de synthèse indisponible),
  // avec un garde-fou temporel pour ne jamais bloquer le jeu.
  function speak(text, onend) {
    var enabled = voiceSupported() && g() && g().voice;
    if (!enabled) { if (onend) onend(); return; }
    var done = false;
    var finish = function () { if (!done) { done = true; if (onend) onend(); } };
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = state.lang === 'fr' ? 'fr-FR' : 'en-US';
      var voices = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].lang && voices[i].lang.indexOf(state.lang) === 0) {
          u.voice = voices[i];
          break;
        }
      }
      u.rate = 0.95;
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setTimeout(finish, Math.max(3000, text.length * 100));
    } catch (e) {
      finish();
    }
  }

  function voiceStop() {
    if (voiceSupported()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  }

  /* Tic-tac discret pendant les pauses de la cérémonie. */
  var tickCtx = null;
  var tickInt = null;

  function tickStart() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!tickCtx) tickCtx = new Ctx();
      if (tickCtx.state === 'suspended') tickCtx.resume();
      tickStop();
      tickInt = setInterval(function () {
        var o = tickCtx.createOscillator();
        var gn = tickCtx.createGain();
        o.connect(gn);
        gn.connect(tickCtx.destination);
        o.frequency.value = 1250;
        gn.gain.setValueAtTime(0.05, tickCtx.currentTime);
        gn.gain.exponentialRampToValueAtTime(0.0001, tickCtx.currentTime + 0.06);
        o.start();
        o.stop(tickCtx.currentTime + 0.07);
      }, 600);
    } catch (e) { /* pas de son : la cérémonie reste lisible à l'écran */ }
  }

  function tickStop() {
    if (tickInt) { clearInterval(tickInt); tickInt = null; }
  }

  /* Cérémonie d'ouverture : étapes lues à voix haute, avec pauses. */
  var cer = { running: false, idx: 0, timer: null };

  function ceremonySteps() {
    var s = [{ text: t('cer.close'), wait: 3000, tick: true }];
    if (g().knownSpies) {
      s.push({ text: t('cer.spiesOpen'), wait: 5000, tick: true });
      s.push({ text: t('cer.spiesClose'), wait: 2000, tick: true });
    }
    if (g().commanderMode) {
      s.push({ text: t('cer.thumbs'), wait: 3000, tick: true });
      s.push({ text: t('cer.cmdOpen'), wait: 4000, tick: true });
      s.push({ text: t('cer.cmdClose'), wait: 3000, tick: true });
    }
    s.push({ text: t('cer.openAll'), wait: 600, tick: false });
    return s;
  }

  function cerStop() {
    cer.running = false;
    cer.idx = 0;
    if (cer.timer) { clearTimeout(cer.timer); cer.timer = null; }
    tickStop();
    voiceStop();
  }

  function cerRun(i) {
    if (!cer.running) return;
    var steps = ceremonySteps();
    if (i >= steps.length) {
      cerStop();
      enterBoard();
      render();
      return;
    }
    cer.idx = i;
    render();
    var st = steps[i];
    speak(st.text, function () {
      if (!cer.running) return;
      if (st.tick) tickStart();
      cer.timer = setTimeout(function () {
        tickStop();
        cerRun(i + 1);
      }, st.wait);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Minuteur de discussion                                              */
  /* ------------------------------------------------------------------ */

  function timerStop() {
    if (timer.handle) { clearInterval(timer.handle); timer.handle = null; }
    timer.running = false;
  }

  function timerResetTo(minutes) {
    timerStop();
    timer.left = minutes * 60;
    timer.finished = false;
  }

  function timerToggle() {
    if (timer.running) {
      timerStop();
    } else if (timer.left > 0) {
      timer.running = true;
      timer.handle = setInterval(function () {
        timer.left--;
        if (timer.left <= 0) {
          timerStop();
          timer.finished = true;
          beep();
          vibrate([200, 100, 200]);
          speak(t('timer.done'));
        }
        updateTimerChip();
      }, 1000);
    }
    updateTimerChip();
  }

  function updateTimerChip() {
    var el = document.getElementById('timer-chip');
    if (!el) return;
    var label = document.getElementById('timer-left');
    var btn = document.getElementById('timer-toggle');
    if (label) label.textContent = timer.finished ? t('timer.done') : fmtTime(timer.left);
    if (btn) btn.textContent = timer.running ? t('timer.pause') : t('timer.start');
    el.classList.toggle('timer-done', timer.finished);
  }

  /* ------------------------------------------------------------------ */
  /* Logique de partie                                                   */
  /* ------------------------------------------------------------------ */

  function g() { return state.game; }

  function nPlayers() { return g().players.length; }

  function enterBoard() {
    g().phase = 'team';
    g().team = [];
    state.screen = 'board';
    timerResetTo(g().timerMin);
    save();
  }

  function teamSize() {
    return RULES.teamSizes(nPlayers())[g().round];
  }

  function spiesOf(playerIdx) {
    return g().players
      .map(function (p, i) { return { p: p, i: i }; })
      .filter(function (x) { return x.p.role === 'spy' && x.i !== playerIdx; })
      .map(function (x) { return x.p.name; });
  }

  function spyNames() {
    return g().players
      .filter(function (p) { return p.role === 'spy'; })
      .map(function (p) { return p.name; });
  }

  function startVote() {
    g().phase = 'vote';
    g().votes = g().players.map(function () { return null; });
  }

  function resolveVote() {
    var up = g().votes.filter(function (v) { return v === 'up'; }).length;
    var down = g().votes.filter(function (v) { return v === 'down'; }).length;
    var approved = RULES.voteApproved(up, down);
    g().lastVote = { votes: g().votes.slice(), approved: approved };
    g().phase = 'voteResult';
    if (approved) {
      g().voteTrack = 0;
    } else {
      g().voteTrack++;
      if (g().voteTrack >= RULES.MAX_REJECTIONS) {
        g().winner = 'spy';
        g().winReason = 'votes';
      }
    }
    save();
  }

  function afterVoteResult() {
    if (g().winner) {
      state.screen = 'gameover';
    } else if (g().lastVote.approved) {
      g().phase = 'mission';
      g().missionIdx = 0;
      g().missionStage = 'pass';
      g().missionPick = null;
      g().missionChoices = [];
    } else {
      g().leader = (g().leader + 1) % nPlayers();
      g().team = [];
      g().phase = 'team';
      timerResetTo(g().timerMin);
    }
    save();
  }

  function recordMissionChoice(success) {
    g().missionChoices.push(!!success);
    g().missionPick = null;
    if (g().missionChoices.length >= g().team.length) {
      // Toutes les cartes sont jouées : préparer la révélation mélangée.
      var cards = g().missionChoices.map(function (ok) { return ok ? 'S' : 'F'; });
      g().revealCards = RULES.shuffle(cards).map(function (c) {
        return { card: c, flipped: false };
      });
      g().phase = 'missionReveal';
    } else {
      g().missionIdx++;
      g().missionStage = 'pass';
      speak(t('mission.pass') + ' ' + g().players[g().team[g().missionIdx]].name);
    }
    save();
  }

  function missionOutcome() {
    var fails = g().missionChoices.filter(function (ok) { return !ok; }).length;
    var result = RULES.missionResult(nPlayers(), g().round, fails);
    return { fails: fails, result: result, needed: RULES.failsNeeded(nPlayers(), g().round) };
  }

  function finishMission() {
    var out = missionOutcome();
    g().missions[g().round] = {
      result: out.result,
      fails: out.fails,
      team: g().team.slice(),
      leader: g().leader
    };
    var w = RULES.winner(g().missions);
    if (w === 'res' && g().commanderMode) {
      // Dernière chance des espions : tenter d'éliminer le Commandant.
      g().assassinPick = null;
      g().phase = 'assassin';
    } else if (w) {
      g().winner = w;
      g().winReason = 'missions';
      state.screen = 'gameover';
    } else {
      g().round++;
      g().leader = (g().leader + 1) % nPlayers();
      g().team = [];
      g().phase = 'team';
      timerResetTo(g().timerMin);
    }
    save();
  }

  /* ------------------------------------------------------------------ */
  /* Rendu                                                               */
  /* ------------------------------------------------------------------ */

  function render() {
    switch (state.screen) {
      case 'home': app.innerHTML = viewHome(); break;
      case 'setup': app.innerHTML = viewSetup(); break;
      case 'reveal': app.innerHTML = viewReveal(); break;
      case 'ceremony': app.innerHTML = viewCeremony(); break;
      case 'board': app.innerHTML = viewBoard(); break;
      case 'gameover': app.innerHTML = viewGameOver(); break;
      case 'rules': app.innerHTML = viewRules(); break;
    }
    updateTimerChip();
  }

  function viewHome() {
    var resume = hasResumableGame()
      ? '<button class="btn btn-ghost" data-action="resume">' + t('home.resume') + '</button>'
      : '';
    return '' +
      '<div class="screen home">' +
      '  <div class="home-emblem" aria-hidden="true">' +
      '    <svg viewBox="0 0 100 100" width="110" height="110">' +
      '      <circle cx="50" cy="50" r="46" fill="none" stroke="var(--red)" stroke-width="4"/>' +
      '      <path d="M50 14 L58 40 L86 40 L63 56 L72 84 L50 66 L28 84 L37 56 L14 40 L42 40 Z" fill="var(--red)"/>' +
      '      <circle cx="50" cy="52" r="10" fill="var(--bg)"/>' +
      '      <circle cx="50" cy="52" r="10" fill="none" stroke="var(--blue)" stroke-width="3"/>' +
      '      <circle cx="50" cy="52" r="3.5" fill="var(--blue)"/>' +
      '    </svg>' +
      '  </div>' +
      '  <h1 class="title">' + t('app.title') + '</h1>' +
      '  <p class="tagline">' + t('app.tagline') + '</p>' +
      '  <div class="stack">' +
      resume +
      '    <button class="btn btn-primary" data-action="toSetup">' + t('home.newGame') + '</button>' +
      '    <button class="btn btn-ghost" data-action="rules">' + t('home.rules') + '</button>' +
      '    <button class="btn btn-link" data-action="toggleLang">🌐 ' + t('home.lang') + '</button>' +
      '  </div>' +
      '  <p class="unofficial">' + t('app.unofficial') + '</p>' +
      '</div>';
  }

  function viewSetup() {
    var c = state.setup.count;
    var spies = RULES.spyCount(c);
    var inputs = '';
    for (var i = 0; i < c; i++) {
      var val = state.setup.names[i] || '';
      inputs +=
        '<input class="name-input" type="text" maxlength="14" data-name-idx="' + i + '" ' +
        'placeholder="' + esc(t('setup.namePlaceholder', { i: i + 1 })) + '" value="' + esc(val) + '">';
    }
    var timerLabel = state.setup.timerMin === 0
      ? t('setup.timerOff')
      : t('setup.timerMin', { m: state.setup.timerMin });
    return '' +
      '<div class="screen setup">' +
      '  <header class="topbar">' +
      '    <button class="btn btn-link" data-action="goHome">' + t('common.back') + '</button>' +
      '    <h2>' + t('setup.title') + '</h2><span></span>' +
      '  </header>' +
      '  <section class="card-panel">' +
      '    <label class="field-label">' + t('setup.playerCount') + '</label>' +
      '    <div class="counter">' +
      '      <button class="btn btn-round" data-action="countMinus"' + (c <= RULES.MIN_PLAYERS ? ' disabled' : '') + '>−</button>' +
      '      <div class="counter-value">' + c + '</div>' +
      '      <button class="btn btn-round" data-action="countPlus"' + (c >= RULES.MAX_PLAYERS ? ' disabled' : '') + '>+</button>' +
      '    </div>' +
      '    <p class="hint center">' + t('setup.spiesInfo', { res: c - spies, spy: spies }) + '</p>' +
      '    <div class="names">' + inputs + '</div>' +
      '  </section>' +
      '  <section class="card-panel">' +
      '    <label class="field-label">' + t('setup.options') + '</label>' +
      '    <button class="opt-row" data-action="toggleKnownSpies">' +
      '      <span>' + t('setup.knownSpies') + '<small>' + t('setup.knownSpiesHint') + '</small></span>' +
      '      <span class="switch' + (state.setup.knownSpies ? ' on' : '') + '"></span>' +
      '    </button>' +
      '    <button class="opt-row" data-action="toggleCommander">' +
      '      <span>★ ' + t('setup.commander') + '<small>' + t('setup.commanderHint') + '</small></span>' +
      '      <span class="switch' + (state.setup.commander ? ' on' : '') + '"></span>' +
      '    </button>' +
      '    <button class="opt-row" data-action="toggleVoiceSetup">' +
      '      <span>🔊 ' + t('setup.voice') + '<small>' + t('setup.voiceHint') + '</small></span>' +
      '      <span class="switch' + (state.setup.voice ? ' on' : '') + '"></span>' +
      '    </button>' +
      '    <button class="opt-row" data-action="cycleTimer">' +
      '      <span>' + t('setup.timer') + '</span>' +
      '      <span class="opt-value">' + timerLabel + '</span>' +
      '    </button>' +
      '  </section>' +
      '  <button class="btn btn-primary btn-big" data-action="startGame">' + t('setup.start') + '</button>' +
      '</div>';
  }

  function viewReveal() {
    var game = g();
    var p = game.players[game.revealIdx];
    var progress = t('reveal.progress', { i: game.revealIdx + 1, n: nPlayers() });

    if (game.revealStage === 'pass') {
      return '' +
        '<div class="screen reveal">' +
        '  <header class="topbar"><span></span><h2>' + t('reveal.title') + '</h2>' +
        '    <span class="progress">' + progress + '</span></header>' +
        '  <div class="pass-box">' +
        '    <p class="pass-label">' + t('reveal.pass') + '</p>' +
        '    <p class="pass-name">' + esc(p.name) + '</p>' +
        '    <button class="btn btn-primary btn-big" data-action="revealImHere">' + t('reveal.imHere') + '</button>' +
        '  </div>' +
        '</div>';
    }

    // Stage « card » : toucher la carte pour la retourner (animation 3D).
    var isSpy = p.role === 'spy';
    var isCommander = p.special === 'commander';
    var faceCls = isSpy ? 'spy' : (isCommander ? 'commander' : 'res');
    var roleTitle = isSpy ? t('reveal.youAreSpy')
      : (isCommander ? t('reveal.youAreCommander') : t('reveal.youAreRes'));
    var roleHint = isSpy ? t('reveal.spyHint')
      : (isCommander ? t('reveal.commanderHint') : t('reveal.resHint'));
    var icon = isSpy ? ICONS.spy : (isCommander ? ICONS.commander : ICONS.fist);
    var badge = (p.special === 'assassin')
      ? '<span class="role-badge">🗡 ' + t('reveal.assassinBadge') + '</span>' : '';
    var extra = '';
    if (isSpy) {
      if (game.knownSpies) {
        var others = spiesOf(game.revealIdx);
        extra = '<p class="accomplices-label">' + t('reveal.accomplices') + '</p>' +
          '<p class="accomplices">' + others.map(esc).join(' · ') + '</p>';
      } else {
        extra = '<p class="accomplices-label">' + t('reveal.blindSpies') + '</p>';
      }
      if (p.special === 'assassin') {
        extra += '<p class="accomplices-label">' + t('reveal.assassinHint') + '</p>';
      }
    } else if (isCommander) {
      extra = '<p class="accomplices-label">' + t('reveal.spiesAre') + '</p>' +
        '<p class="accomplices">' + spyNames().map(esc).join(' · ') + '</p>';
    }
    var nextLabel = game.revealIdx + 1 >= nPlayers() ? t('reveal.startGame') : t('reveal.next');
    var nextBtn = '<button class="btn btn-primary btn-big" id="reveal-next" data-action="revealNext"' +
      (game.revealSeen ? '' : ' disabled') + '>' + nextLabel + ' →</button>';

    return '' +
      '<div class="screen reveal">' +
      '  <header class="topbar"><span></span><h2>' + esc(p.name) + '</h2>' +
      '    <span class="progress">' + progress + '</span></header>' +
      '  <p class="hint center">' + t('reveal.tapHint') + '</p>' +
      '  <div class="role-card-wrap">' +
      '    <div class="role-card' + (game.revealFlipped ? ' flipped' : '') + '" id="hold-card"' +
      '         data-action="flipRole" role="button" tabindex="0">' +
      '      <div class="role-inner">' +
      '        <div class="role-back">' +
      '          <div class="role-back-stamp">' + t('reveal.secret') + '</div>' +
      '        </div>' +
      '        <div class="role-front ' + faceCls + '">' +
      '          <div class="role-title">' + roleTitle + '</div>' +
      badge +
      '          <div class="role-icon">' + icon + '</div>' +
      '          <p class="role-hint">' + roleHint + '</p>' +
      extra +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  ' + nextBtn +
      '</div>';
  }

  function viewCeremony() {
    var body;
    if (!cer.running) {
      body = '' +
        '<div class="pass-box">' +
        '  <div class="cer-icon" aria-hidden="true">🔊</div>' +
        '  <p class="hint center">' + t('cer.intro') + '</p>' +
        '  <button class="btn btn-primary btn-big" data-action="cerStart">' + t('cer.start') + '</button>' +
        '  <button class="btn btn-link" data-action="cerSkip">' + t('cer.skip') + '</button>' +
        '</div>';
    } else {
      var steps = ceremonySteps();
      var dots = steps.map(function (_, i) {
        return '<span class="pip' + (i <= cer.idx ? ' on' : '') + '"></span>';
      }).join('');
      body = '' +
        '<div class="pass-box">' +
        '  <p class="cer-step">' + steps[cer.idx].text + '</p>' +
        '  <div class="cer-dots">' + dots + '</div>' +
        '  <button class="btn btn-link" data-action="cerSkip">' + t('cer.skip') + '</button>' +
        '</div>';
    }
    return '' +
      '<div class="screen reveal">' +
      '  <header class="topbar"><span></span><h2>' + t('cer.title') + '</h2><span></span></header>' +
      body +
      '</div>';
  }

  function missionTrack() {
    var game = g();
    var sizes = RULES.teamSizes(nPlayers());
    var html = '<div class="mtrack">';
    for (var i = 0; i < 5; i++) {
      var m = game.missions[i];
      var cls = 'mnode';
      var label = sizes[i];
      if (m && m.result === 'success') { cls += ' ok'; label = '✓'; }
      else if (m && m.result === 'fail') { cls += ' ko'; label = '✗'; }
      else if (i === game.round) { cls += ' now'; }
      var badge = (i === 3 && nPlayers() >= 7)
        ? '<span class="mbadge">' + t('board.twoFails') + '</span>' : '';
      html += '<div class="mslot"><div class="' + cls + '">' + label + '</div>' + badge + '</div>';
    }
    html += '</div>';
    return html;
  }

  function voteTrackBar() {
    var game = g();
    var pips = '';
    for (var i = 0; i < RULES.MAX_REJECTIONS; i++) {
      pips += '<span class="pip' + (i < game.voteTrack ? ' on' : '') + '"></span>';
    }
    return '<div class="vtrack"><span class="vtrack-label">' + t('board.voteTrack') + '</span>' + pips + '</div>';
  }

  function boardHeader() {
    return '' +
      '<header class="topbar">' +
      '  <button class="btn btn-link" data-action="askQuit">✕ ' + t('board.quit') + '</button>' +
      '  <h2>' + t('app.title') + '</h2>' +
      '  <span class="topbar-right">' +
      '    <button class="btn btn-link" data-action="toggleVoice">' + (g().voice ? '🔊' : '🔇') + '</button>' +
      '    <button class="btn btn-link" data-action="rules">?</button>' +
      '  </span>' +
      '</header>' +
      missionTrack() + voteTrackBar();
  }

  function quitModal() {
    if (!state.quitAsk) return '';
    return '' +
      '<div class="modal-back">' +
      '  <div class="modal">' +
      '    <p>' + t('quit.confirm') + '</p>' +
      '    <div class="modal-btns">' +
      '      <button class="btn btn-ghost" data-action="quitNo">' + t('quit.no') + '</button>' +
      '      <button class="btn btn-danger" data-action="quitYes">' + t('quit.yes') + '</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function viewBoard() {
    var game = g();
    var html = '<div class="screen board">' + boardHeader();
    switch (game.phase) {
      case 'team': html += viewTeam(); break;
      case 'vote': html += viewVote(); break;
      case 'voteResult': html += viewVoteResult(); break;
      case 'mission': html += viewMission(); break;
      case 'missionReveal': html += viewMissionReveal(); break;
      case 'assassin': html += viewAssassin(); break;
    }
    html += quitModal() + '</div>';
    return html;
  }

  function viewAssassin() {
    var game = g();
    var pick = game.assassinPick;
    var chips = game.players.map(function (p, i) {
      if (p.role === 'spy') return ''; // le Commandant est forcément un résistant
      var sel = pick === i;
      return '<button class="pchip' + (sel ? ' sel danger' : '') + '" data-action="assassinPick" data-idx="' + i + '">' +
        esc(p.name) + (sel ? '<span class="check">🗡</span>' : '') + '</button>';
    }).join('');
    var confirmBtn = pick === null
      ? '<button class="btn btn-danger btn-big" disabled>' + t('assassin.choose') + '</button>'
      : '<button class="btn btn-danger btn-big" data-action="assassinConfirm">' +
        t('assassin.pick', { name: esc(game.players[pick].name) }) + '</button>';
    return '' +
      '<section class="phase">' +
      '  <h3>🗡 ' + t('assassin.title') + '</h3>' +
      '  <p class="hint">' + t('assassin.hint') + '</p>' +
      '  <div class="pgrid">' + chips + '</div>' +
      confirmBtn +
      '</section>';
  }

  function viewTeam() {
    var game = g();
    var k = teamSize();
    var leaderName = game.players[game.leader].name;
    var chips = game.players.map(function (p, i) {
      var sel = game.team.indexOf(i) !== -1;
      var cls = 'pchip' + (sel ? ' sel' : '') + (i === game.leader ? ' leader' : '');
      var star = i === game.leader ? '<span class="star">★</span>' : '';
      return '<button class="' + cls + '" data-action="togglePlayer" data-idx="' + i + '">' +
        star + esc(p.name) + (sel ? '<span class="check">✓</span>' : '') + '</button>';
    }).join('');
    var ready = game.team.length === k;
    var timerChip = game.timerMin > 0
      ? '<div class="timer-chip" id="timer-chip">' +
        '  <span class="timer-label">⏱ ' + t('timer.label') + '</span>' +
        '  <span class="timer-left" id="timer-left">' + fmtTime(timer.left) + '</span>' +
        '  <button class="btn btn-mini" id="timer-toggle" data-action="timerToggle">' + t('timer.start') + '</button>' +
        '  <button class="btn btn-mini" data-action="timerReset">' + t('timer.reset') + '</button>' +
        '</div>'
      : '';
    return '' +
      '<section class="phase">' +
      '  <h3>' + t('team.title', { i: game.round + 1, k: k }) + '</h3>' +
      '  <p class="hint">' + t('team.hint', { leader: '<b>' + esc(leaderName) + '</b>', k: k }) + '</p>' +
      timerChip +
      '  <div class="pgrid">' + chips + '</div>' +
      '  <p class="hint center">' + t('team.selected', { x: game.team.length, k: k }) + '</p>' +
      '  <button class="btn btn-primary btn-big" data-action="proposeTeam"' + (ready ? '' : ' disabled') + '>' +
      t('team.propose') + '</button>' +
      '</section>';
  }

  function viewVote() {
    var game = g();
    var teamNames = game.team.map(function (i) { return esc(game.players[i].name); }).join(' · ');
    var rows = game.players.map(function (p, i) {
      var v = game.votes[i];
      return '' +
        '<div class="vote-row">' +
        '  <span class="vote-name">' + (i === game.leader ? '★ ' : '') + esc(p.name) + '</span>' +
        '  <span class="vote-btns">' +
        '    <button class="vbtn up' + (v === 'up' ? ' on' : '') + '" data-action="vote" data-idx="' + i + '" data-v="up">👍</button>' +
        '    <button class="vbtn down' + (v === 'down' ? ' on' : '') + '" data-action="vote" data-idx="' + i + '" data-v="down">👎</button>' +
        '  </span>' +
        '</div>';
    }).join('');
    var allVoted = game.votes.every(function (v) { return v !== null; });
    return '' +
      '<section class="phase">' +
      '  <h3>' + t('vote.title') + '</h3>' +
      '  <p class="hint">' + t('vote.hint') + '</p>' +
      '  <p class="team-line"><span class="hint">' + t('vote.team') + '</span> <b>' + teamNames + '</b></p>' +
      '  <div class="vote-list">' + rows + '</div>' +
      '  <button class="btn btn-primary btn-big" data-action="voteResult"' + (allVoted ? '' : ' disabled') + '>' +
      t('vote.result') + '</button>' +
      '</section>';
  }

  function viewVoteResult() {
    var game = g();
    var lv = game.lastVote;
    var up = lv.votes.filter(function (v) { return v === 'up'; }).length;
    var down = lv.votes.length - up;
    var rows = game.players.map(function (p, i) {
      var v = lv.votes[i];
      return '<span class="vote-tag ' + (v === 'up' ? 'up' : 'down') + '">' +
        esc(p.name) + ' ' + (v === 'up' ? '👍' : '👎') + '</span>';
    }).join('');
    var html = '<section class="phase center-phase">';
    if (lv.approved) {
      html += '<div class="verdict ok">' + t('vote.approved') + '</div>' +
        '<p class="big-count"><b>' + up + '</b> 👍 · <b>' + down + '</b> 👎</p>' +
        '<div class="vote-tags">' + rows + '</div>' +
        '<button class="btn btn-primary btn-big" data-action="afterVote">' + t('vote.goMission') + '</button>';
    } else {
      var warn = (!game.winner && game.voteTrack === RULES.MAX_REJECTIONS - 1)
        ? '<p class="warn">' + t('vote.lastChance') + '</p>' : '';
      html += '<div class="verdict ko">' + t('vote.rejected') + '</div>' +
        '<p class="big-count"><b>' + up + '</b> 👍 · <b>' + down + '</b> 👎</p>' +
        '<div class="vote-tags">' + rows + '</div>' +
        '<p class="hint center">' + t('vote.rejectedHint', { v: game.voteTrack, max: RULES.MAX_REJECTIONS }) + '</p>' +
        warn +
        '<button class="btn btn-primary btn-big" data-action="afterVote">' + t('vote.continue') + '</button>';
    }
    html += '</section>';
    return html;
  }

  function viewMission() {
    var game = g();
    var memberIdx = game.team[game.missionIdx];
    var p = game.players[memberIdx];
    var pos = t('mission.member', { i: game.missionIdx + 1, k: game.team.length });

    if (game.missionStage === 'pass') {
      return '' +
        '<section class="phase center-phase">' +
        '  <p class="progress">' + pos + '</p>' +
        '  <div class="pass-box">' +
        '    <p class="pass-label">' + t('mission.pass') + '</p>' +
        '    <p class="pass-name">' + esc(p.name) + '</p>' +
        '    <button class="btn btn-primary btn-big" data-action="missionImHere">' + t('reveal.imHere') + '</button>' +
        '  </div>' +
        '</section>';
    }

    // Stage « pick ». L'écran est STRICTEMENT identique quel que soit le
    // rôle : mêmes cartes neutres pour tous, ordre mélangé par joueur, et
    // aucun état désactivé — un Échec joué par un résistant sera simplement
    // compté comme un Succès (règle officielle). Impossible de deviner le
    // camp de quelqu'un en le regardant jouer.
    var pick = game.missionPick; // null | true (succès) | false (échec)
    var confirmBar = pick === null ? '' :
      '<div class="confirm-bar">' +
      '  <button class="btn btn-ghost" data-action="pickChange">' + t('mission.change') + '</button>' +
      '  <button class="btn btn-primary" data-action="pickConfirm">' + t('mission.confirm') + '</button>' +
      '</div>';
    var successCard =
      '<button class="mcard neutral' + (pick === true ? ' picked' : '') + (pick === false ? ' dim' : '') + '"' +
      '  data-action="pickSuccess">' +
      '  <span class="mcard-icon">' + ICONS.fist + '</span>' + t('mission.success') + '</button>';
    var failCard =
      '<button class="mcard neutral' + (pick === false ? ' picked' : '') + (pick === true ? ' dim' : '') + '"' +
      '  data-action="pickFail">' +
      '  <span class="mcard-icon">' + ICONS.spy + '</span>' + t('mission.fail') + '</button>';
    return '' +
      '<section class="phase center-phase">' +
      '  <p class="progress">' + pos + ' — ' + esc(p.name) + '</p>' +
      '  <h3>' + t('mission.pick') + '</h3>' +
      '  <p class="hint center">' + t('mission.pickHint') + '</p>' +
      '  <div class="mission-cards">' +
      (game.missionSwap ? failCard + successCard : successCard + failCard) +
      '  </div>' +
      '  <p class="hint center">' + t('mission.rule') + '</p>' +
      confirmBar +
      '</section>';
  }

  function viewMissionReveal() {
    var game = g();
    var allFlipped = game.revealCards.every(function (c) { return c.flipped; });
    var cards = game.revealCards.map(function (c, i) {
      if (!c.flipped) {
        return '<button class="rcard back" data-action="flipCard" data-idx="' + i + '">?</button>';
      }
      return '<div class="rcard ' + (c.card === 'S' ? 'ok' : 'ko') + '">' +
        (c.card === 'S' ? ICONS.fist : ICONS.spy) + '</div>';
    }).join('');

    var outcomeHtml = '';
    if (allFlipped) {
      var out = missionOutcome();
      var failNote = '';
      if (out.result === 'success' && out.fails > 0) {
        failNote = '<p class="hint center">' + t('mission.notEnough', { f: out.fails, need: out.needed }) + '</p>';
      } else if (out.result === 'fail') {
        failNote = '<p class="hint center">' + t('mission.failsCount', { f: out.fails }) + '</p>';
      }
      outcomeHtml =
        '<div class="verdict ' + (out.result === 'success' ? 'ok' : 'ko') + '">' +
        (out.result === 'success' ? t('mission.successResult') : t('mission.failResult')) +
        '</div>' + failNote +
        '<button class="btn btn-primary btn-big" data-action="missionDone">' + t('mission.continue') + '</button>';
    } else {
      outcomeHtml = '<p class="hint center">' + t('mission.revealHint') + '</p>';
    }

    return '' +
      '<section class="phase center-phase">' +
      '  <h3>' + t('mission.revealTitle', { i: game.round + 1 }) + '</h3>' +
      '  <div class="rcards">' + cards + '</div>' +
      outcomeHtml +
      '</section>';
  }

  function viewGameOver() {
    var game = g();
    var tal = RULES.tally(game.missions);
    var resWin = game.winner === 'res';
    var reason = '';
    if (game.winReason === 'votes') {
      reason = '<p class="hint center">' + t('over.byVotes') + '</p>';
    }
    if (game.assassination) {
      reason += '<p class="hint center">🗡 ' +
        t(game.assassination.wasCommander ? 'over.assassinated' : 'over.survived',
          { name: esc(game.assassination.name) }) + '</p>';
    }
    var roles = game.players.map(function (p) {
      var isSpy = p.role === 'spy';
      var label = isSpy ? t('role.spy') : t('role.res');
      if (p.special === 'commander') label = '★ ' + t('role.commander');
      if (p.special === 'assassin') label += ' · 🗡 ' + t('role.assassin');
      return '<div class="role-row ' + (isSpy ? 'spy' : 'res') +
        (p.special === 'commander' ? ' commander' : '') + '">' +
        '<span>' + esc(p.name) + '</span>' +
        '<span>' + label + '</span></div>';
    }).join('');
    return '' +
      '<div class="screen gameover ' + (resWin ? 'res-bg' : 'spy-bg') + '">' +
      '  <div class="over-banner ' + (resWin ? 'res' : 'spy') + '">' +
      '    <div class="over-icon">' + (resWin ? ICONS.fist : ICONS.spy) + '</div>' +
      '    <h1>' + (resWin ? t('over.resWin') : t('over.spyWin')) + '</h1>' +
      '    <p class="hint center">' + t('over.score', { s: tal.success, f: tal.fail }) + '</p>' +
      reason +
      '  </div>' +
      '  <section class="card-panel">' +
      '    <label class="field-label">' + t('over.roles') + '</label>' +
      '    <div class="role-list">' + roles + '</div>' +
      '  </section>' +
      '  <div class="stack">' +
      '    <button class="btn btn-primary" data-action="replaySame">' + t('over.replay') + '</button>' +
      '    <button class="btn btn-ghost" data-action="toSetup">' + t('over.newSetup') + '</button>' +
      '    <button class="btn btn-link" data-action="goHome">' + t('over.home') + '</button>' +
      '  </div>' +
      '</div>';
  }

  function viewRules() {
    var rows = '';
    for (var n = RULES.MIN_PLAYERS; n <= RULES.MAX_PLAYERS; n++) {
      rows += '<tr><td>' + n + '</td><td>' + RULES.spyCount(n) + '</td><td>' +
        RULES.teamSizes(n).join(' · ') + '</td></tr>';
    }
    return '' +
      '<div class="screen rules">' +
      '  <header class="topbar">' +
      '    <button class="btn btn-link" data-action="rulesBack">' + t('common.back') + '</button>' +
      '    <h2>' + t('rules.title') + '</h2><span></span>' +
      '  </header>' +
      '  <section class="card-panel">' +
      '    <h3>' + t('rules.goal.h') + '</h3><p>' + t('rules.goal.p') + '</p>' +
      '    <h3>' + t('rules.turn.h') + '</h3>' +
      '    <p>' + t('rules.turn.p1') + '</p><p>' + t('rules.turn.p2') + '</p><p>' + t('rules.turn.p3') + '</p>' +
      '    <h3>' + t('rules.spies.h') + '</h3><p>' + t('rules.spies.p') + '</p>' +
      '    <h3>' + t('rules.table.h') + '</h3>' +
      '    <table class="rtable"><thead><tr><th>' + t('rules.table.players') + '</th><th>' +
      t('rules.table.spies') + '</th><th>' + t('rules.table.teams') + '</th></tr></thead>' +
      '    <tbody>' + rows + '</tbody></table>' +
      '    <h3>' + t('rules.tips.h') + '</h3><p>' + t('rules.tips.p') + '</p>' +
      '  </section>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  var actions = {
    toggleLang: function () {
      state.lang = state.lang === 'fr' ? 'en' : 'fr';
      localStorage.setItem(LANG_KEY, state.lang);
    },
    goHome: function () { state.screen = 'home'; state.quitAsk = false; },
    rules: function () { state.rulesReturn = state.screen; state.screen = 'rules'; },
    rulesBack: function () { state.screen = state.rulesReturn || 'home'; },
    toSetup: function () {
      var saved = loadSave();
      if (saved && saved.setup) {
        state.setup = saved.setup;
        if (!state.setup.names) state.setup.names = [];
      }
      state.screen = 'setup';
    },
    resume: function () {
      var saved = loadSave();
      if (saved && saved.game && !saved.game.winner) {
        state.setup = saved.setup || state.setup;
        state.game = saved.game;
        state.screen = (saved.screen === 'reveal' || saved.screen === 'ceremony')
          ? saved.screen : 'board';
        timerResetTo(state.game.timerMin || 0);
      }
    },

    countMinus: function () { if (state.setup.count > RULES.MIN_PLAYERS) state.setup.count--; },
    countPlus: function () { if (state.setup.count < RULES.MAX_PLAYERS) state.setup.count++; },
    toggleKnownSpies: function () { state.setup.knownSpies = !state.setup.knownSpies; },
    toggleCommander: function () { state.setup.commander = !state.setup.commander; },
    cycleTimer: function () {
      var opts = [0, 3, 5, 10];
      var i = opts.indexOf(state.setup.timerMin);
      state.setup.timerMin = opts[(i + 1) % opts.length];
    },
    startGame: function () {
      var names = [];
      for (var i = 0; i < state.setup.count; i++) {
        var v = (state.setup.names[i] || '').trim();
        names.push(v || t('setup.namePlaceholder', { i: i + 1 }));
      }
      state.game = newGame(names, {
        knownSpies: state.setup.knownSpies,
        commander: state.setup.commander,
        voice: state.setup.voice,
        timerMin: state.setup.timerMin
      });
      state.screen = 'reveal';
      save();
      speak(t('reveal.pass') + ' ' + state.game.players[0].name);
    },

    revealImHere: function () {
      g().revealStage = 'card';
      g().revealSeen = false;
      g().revealFlipped = false;
      save();
    },
    flipRole: function (el) {
      var game = g();
      game.revealFlipped = !game.revealFlipped;
      if (game.revealFlipped) game.revealSeen = true;
      save();
      // Pas de re-rendu : on laisse l'animation CSS jouer.
      el.classList.toggle('flipped', game.revealFlipped);
      var btn = document.getElementById('reveal-next');
      if (btn && game.revealSeen) btn.disabled = false;
      vibrate(20);
      return 'noRender';
    },
    revealNext: function () {
      var game = g();
      if (!game.revealSeen) return;
      if (game.revealIdx + 1 >= nPlayers()) {
        // Cérémonie d'ouverture si l'annonceur est actif et qu'il y a
        // quelque chose à mettre en scène (complices ou Commandant).
        if (game.voice && (game.knownSpies || game.commanderMode)) {
          state.screen = 'ceremony';
          save();
        } else {
          enterBoard();
        }
      } else {
        game.revealIdx++;
        game.revealStage = 'pass';
        game.revealSeen = false;
        game.revealFlipped = false;
        save();
        speak(t('reveal.pass') + ' ' + game.players[game.revealIdx].name);
      }
    },

    cerStart: function () {
      cer.running = true;
      cerRun(0);
      return 'noRender';
    },
    cerSkip: function () {
      cerStop();
      enterBoard();
    },
    toggleVoice: function () {
      g().voice = !g().voice;
      if (!g().voice) voiceStop();
      save();
    },
    toggleVoiceSetup: function () { state.setup.voice = !state.setup.voice; },

    togglePlayer: function (el) {
      var game = g();
      var i = parseInt(el.getAttribute('data-idx'), 10);
      var pos = game.team.indexOf(i);
      if (pos !== -1) game.team.splice(pos, 1);
      else if (game.team.length < teamSize()) game.team.push(i);
      save();
    },
    proposeTeam: function () {
      if (g().team.length !== teamSize()) return;
      timerStop();
      startVote();
      save();
    },
    timerToggle: function () { timerToggle(); return 'noRender'; },
    timerReset: function () { timerResetTo(g().timerMin); updateTimerChip(); return 'noRender'; },

    vote: function (el) {
      var i = parseInt(el.getAttribute('data-idx'), 10);
      var v = el.getAttribute('data-v');
      g().votes[i] = (g().votes[i] === v) ? null : v;
    },
    voteResult: function () {
      if (!g().votes.every(function (v) { return v !== null; })) return;
      resolveVote();
      vibrate(g().lastVote.approved ? 40 : [60, 60, 60]);
      speak(t(g().lastVote.approved ? 'vote.approved' : 'vote.rejected'));
    },
    afterVote: function () {
      afterVoteResult();
      if (state.screen === 'gameover') {
        speak(t(g().winner === 'res' ? 'over.resWin' : 'over.spyWin'));
      } else if (g().phase === 'mission') {
        speak(t('mission.pass') + ' ' + g().players[g().team[0]].name);
      }
    },

    missionImHere: function () {
      g().missionStage = 'pick';
      g().missionPick = null;
      // Ordre des deux cartes tiré au sort pour ce joueur : la position du
      // doigt ne révèle rien à ceux qui regardent.
      g().missionSwap = Math.random() < 0.5;
      save();
    },
    pickSuccess: function () { g().missionPick = true; },
    pickFail: function () { g().missionPick = false; },
    pickChange: function () { g().missionPick = null; },
    pickConfirm: function () {
      var game = g();
      if (game.missionPick === null) return;
      var member = game.players[game.team[game.missionIdx]];
      // Règle officielle appliquée en silence : un résistant joue toujours
      // Succès, quel que soit son geste — écran identique pour tous.
      var success = member.role === 'res' ? true : game.missionPick;
      recordMissionChoice(success);
    },
    flipCard: function (el) {
      var i = parseInt(el.getAttribute('data-idx'), 10);
      g().revealCards[i].flipped = true;
      vibrate(20);
      save();
      if (g().revealCards.every(function (c) { return c.flipped; })) {
        var out = missionOutcome();
        speak(t(out.result === 'success' ? 'mission.successResult' : 'mission.failResult'));
      }
    },
    missionDone: function () {
      finishMission();
      if (state.screen === 'gameover') {
        speak(t(g().winner === 'res' ? 'over.resWin' : 'over.spyWin'));
      } else if (g().phase === 'assassin') {
        speak(t('assassin.title'));
      }
    },

    assassinPick: function (el) {
      g().assassinPick = parseInt(el.getAttribute('data-idx'), 10);
      save();
    },
    assassinConfirm: function () {
      var game = g();
      if (game.assassinPick === null) return;
      var target = game.players[game.assassinPick];
      var wasCommander = target.special === 'commander';
      game.assassination = { name: target.name, wasCommander: wasCommander };
      game.winner = wasCommander ? 'spy' : 'res';
      game.winReason = wasCommander ? 'assassin' : 'missions';
      state.screen = 'gameover';
      vibrate(wasCommander ? [80, 60, 80] : 40);
      save();
      speak(t(wasCommander ? 'over.spyWin' : 'over.resWin'));
    },

    replaySame: function () {
      var names = g().players.map(function (p) { return p.name; });
      state.game = newGame(names, {
        knownSpies: g().knownSpies,
        commander: g().commanderMode,
        voice: g().voice,
        timerMin: g().timerMin
      });
      state.screen = 'reveal';
      save();
      speak(t('reveal.pass') + ' ' + state.game.players[0].name);
    },

    askQuit: function () { state.quitAsk = true; },
    quitNo: function () { state.quitAsk = false; },
    quitYes: function () {
      state.quitAsk = false;
      timerStop();
      clearGame();
      state.screen = 'home';
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = actions[el.getAttribute('data-action')];
    if (!fn) return;
    var out = fn(el);
    if (out !== 'noRender') render();
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.matches && el.matches('[data-name-idx]')) {
      state.setup.names[parseInt(el.getAttribute('data-name-idx'), 10)] = el.value;
    }
  });

  // Empêche le menu contextuel sur appui long (révélation des cartes).
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest && e.target.closest('.role-card')) e.preventDefault();
  });

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  document.documentElement.setAttribute('lang', state.lang);
  render();

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* hors ligne indisponible */ });
    });
  }

  // Petit accès de debug pour les tests automatisés.
  window.RESISTANCE_DEBUG = {
    getState: function () { return JSON.parse(JSON.stringify({ screen: state.screen, game: state.game })); },
    version: 1
  };
})();
