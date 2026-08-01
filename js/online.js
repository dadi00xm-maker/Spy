/*
 * Mode en ligne — chaque joueur sur SON téléphone, avec son compte.
 *
 * Déroulé : compte (e-mail + mot de passe) → salon avec code à 4 lettres →
 * l'hôte lance → chacun voit SA carte sur SON écran → équipes, votes et
 * missions se jouent simultanément sur tous les téléphones.
 *
 * Architecture : l'HÔTE fait autorité. Les joueurs envoient des actions via
 * SPYNET ; seul l'hôte les applique (mêmes règles RULES que le mode local)
 * puis publie l'état PUBLIC. Les rôles vivent dans des documents privés —
 * le téléphone d'un joueur ne reçoit jamais le rôle d'un autre avant la fin.
 */
var ONLINE = (function () {
  'use strict';

  var params = new URLSearchParams(location.search);

  /* État local de CE téléphone (jamais partagé). */
  var S = {
    view: 'idle',   // idle | loading | menu | register | login | lobby | game
    error: null,    // clé i18n d'erreur à afficher
    info: null,     // clé i18n d'information
    busy: false,
    code: null,     // code du salon rejoint
    room: null,     // dernier instantané public du salon
    priv: null,     // mon document privé ({ role, mates, host? })
    hostData: null, // bookkeeping de l'hôte ({ roles, votes, choices })
    flipped: false, // ma carte de rôle est-elle retournée ?
    readySent: false,
    peek: false,    // revoir ma carte de rôle en cours de partie
    pendingJoin: (params.get('join') || '').toUpperCase(), // lien d'invitation
    pick: [],       // sélection d'équipe (si je suis chef)
    mpick: null,    // index de la carte de mission touchée
    lastPhase: null,
    unRoom: null,
    unPriv: null
  };

  var fields = { name: '', email: '', pass: '', code: '' };
  if (/^[A-Z]{4}$/.test(S.pendingJoin)) fields.code = S.pendingJoin;
  else S.pendingJoin = '';

  function UI() { return window.SPY_UI; }
  function t(k, v) { return UI().t(k, v); }
  function esc(s) { return UI().esc(s); }
  function B() { return SPYNET.backend(); }
  function me() { return B() && B().user(); }
  function rr() { UI().rerender(); }

  function setErr(key) { S.error = key; S.info = null; S.busy = false; }

  function errKey(e) {
    var c = (e && e.code) || '';
    // Sélecteur Google refermé par le joueur : ce n'est pas une erreur.
    if (c.indexOf('popup-closed-by-user') !== -1 ||
        c.indexOf('cancelled-popup-request') !== -1 ||
        c.indexOf('user-cancelled') !== -1) return '';
    if (c.indexOf('unauthorized-domain') !== -1) return 'ol.errDomain';
    if (c.indexOf('email-already-in-use') !== -1) return 'ol.errEmailUsed';
    if (c.indexOf('weak-password') !== -1) return 'ol.errWeakPass';
    if (c.indexOf('invalid-email') !== -1) return 'ol.errBadEmail';
    if (c.indexOf('user-not-found') !== -1 || c.indexOf('wrong-password') !== -1 ||
        c.indexOf('invalid-credential') !== -1 || c.indexOf('invalid-login') !== -1) {
      return 'ol.errBadLogin';
    }
    if (c === 'room/not-found') return 'ol.errRoomNotFound';
    if (c === 'room/closed') return 'ol.errRoomClosed';
    return 'ol.errNet';
  }

  /* ------------------------------------------------------------------ */
  /* Abonnements au salon                                                */
  /* ------------------------------------------------------------------ */

  function unsubscribe() {
    if (S.unRoom) { try { S.unRoom(); } catch (e) {} S.unRoom = null; }
    if (S.unPriv) { try { S.unPriv(); } catch (e) {} S.unPriv = null; }
  }

  function attach(code) {
    unsubscribe();
    S.code = code;
    S.pendingJoin = '';
    // localStorage (et pas sessionStorage) : on peut fermer l'app et
    // reprendre la partie en ligne plus tard depuis l'écran d'accueil.
    try { localStorage.setItem('spy-online-code', code); } catch (e) {}
    S.unRoom = B().watchRoom(code, onRoom);
    S.unPriv = B().watchPrivate(code, me().uid, onPriv);
    if (isHost()) B().onActions(code, hostApply);
  }

  function detach(toView) {
    unsubscribe();
    try { localStorage.removeItem('spy-online-code'); } catch (e) {}
    S.code = null; S.room = null; S.priv = null; S.hostData = null;
    S.flipped = false; S.readySent = false; S.pick = []; S.mpick = null;
    S.peek = false; S.lastPhase = null; S.error = null; S.info = null;
    S.busy = false;
    S.view = toView || 'menu';
  }

  function isHost() {
    return !!(S.room && me() && S.room.host === me().uid);
  }

  function st() { return S.room && S.room.state; }

  function onRoom(room) {
    var hadRoom = !!S.room;
    S.room = room;
    // L'hôte (re)branche le traitement des actions dès qu'il se reconnaît.
    if (isHost() && !hadRoom) B().onActions(S.code, hostApply);
    var phase = room.state ? room.state.phase : 'lobby';
    if (phase !== S.lastPhase) {
      // Nouvelle phase : on nettoie les sélections locales.
      S.lastPhase = phase;
      S.pick = [];
      S.mpick = null;
      S.peek = false;
      if (phase === 'reveal') { S.flipped = false; S.readySent = false; }
    }
    S.view = room.state ? 'game' : 'lobby';
    rr();
  }

  function onPriv(data) {
    S.priv = data || null;
    if (data && data.host) S.hostData = data.host;
    rr();
  }

  /* ------------------------------------------------------------------ */
  /* Réducteur de l'hôte : seule autorité qui fait avancer la partie.    */
  /* ------------------------------------------------------------------ */

  function saveHost() {
    if (!S.hostData || !S.priv) return;
    var doc = { role: S.priv.role, host: S.hostData };
    if (S.priv.mates) doc.mates = S.priv.mates;
    B().setPrivate(S.code, me().uid, doc);
  }

  // Publie explicitement l'objet d'état : S.room peut être remplacé par un
  // nouvel instantané pendant le traitement (diffusion synchrone en local).
  function push(nextState) {
    if (S.room) S.room.state = nextState;
    B().setState(S.code, nextState);
  }

  // Les deux cartes de mission de CE joueur : un résistant reçoit deux
  // cartes Succès ; un spy reçoit Succès + Sabotage dans un ordre stable
  // mais imprévisible (dérivé de son identifiant et de la manche).
  function myMissionTypes() {
    var role = S.priv ? S.priv.role : 'res';
    if (role === 'res') return ['success', 'success'];
    var h = 0;
    var seed = me().uid + ':' + st().round;
    for (var c = 0; c < seed.length; c++) h = (h * 31 + seed.charCodeAt(c)) % 997;
    return (h % 2 === 0) ? ['success', 'fail'] : ['fail', 'success'];
  }

  function endGame(state, winnerSide, reason) {
    state.winner = winnerSide;
    state.winReason = reason;
    state.phase = 'gameover';
    state.roles = S.hostData.roles; // les identités ne sortent qu'ici
  }

  function hostApply(a) {
    var room = S.room;
    if (!room || !a || room.host !== me().uid) return;
    var state = room.state;

    if (a.type === 'start') {
      if (a.uid !== room.host) return;
      if (state && state.phase !== 'gameover') return;
      var uids = Object.keys(room.players);
      var n = uids.length;
      if (n < RULES.MIN_PLAYERS || n > RULES.MAX_PLAYERS) return;
      var order = RULES.shuffle(uids);
      var roles = RULES.assignRoles(n);
      var rolesMap = {};
      var names = {};
      order.forEach(function (uid, i) {
        rolesMap[uid] = roles[i];
        names[uid] = room.players[uid].name;
      });
      S.hostData = { roles: rolesMap, votes: {}, choices: [] };
      var spyNames = order.filter(function (u) { return rolesMap[u] === 'spy'; })
        .map(function (u) { return names[u]; });
      state = {
        phase: 'reveal', order: order, names: names, n: n,
        round: 0, leader: Math.floor(Math.random() * n), voteTrack: 0,
        missions: RULES.teamSizes(n).map(function () { return null; }),
        team: [], ready: {}, voted: {}, votes: null, approved: null,
        played: {}, revealCards: null, pending: null,
        decisive: false, winner: null, winReason: null, roles: null
      };
      B().setOpen(S.code, false);
      order.forEach(function (uid) {
        var doc = { role: rolesMap[uid] };
        if (rolesMap[uid] === 'spy') {
          doc.mates = spyNames.filter(function (nm) { return nm !== names[uid]; });
        }
        if (uid === me().uid) doc.host = S.hostData;
        B().setPrivate(S.code, uid, doc);
      });
      push(state);
      return;
    }

    if (!state) return;

    switch (a.type) {
      case 'ready':
        if (state.phase !== 'reveal' || !state.names[a.uid]) return;
        state.ready[a.uid] = true;
        if (Object.keys(state.ready).length >= state.n) {
          state.phase = 'team';
          state.team = [];
        }
        push(state);
        break;

      case 'team':
        if (state.phase !== 'team' || a.uid !== state.order[state.leader]) return;
        var k = RULES.teamSizes(state.n)[state.round];
        if (!Array.isArray(a.team) || a.team.length !== k) return;
        var valid = a.team.every(function (uid) { return !!state.names[uid]; });
        if (!valid) return;
        state.team = a.team;
        state.voted = {};
        state.votes = null;
        state.approved = null;
        S.hostData.votes = {};
        saveHost();
        state.phase = 'vote';
        push(state);
        break;

      case 'vote':
        if (state.phase !== 'vote' || !state.names[a.uid] || state.voted[a.uid]) return;
        S.hostData.votes[a.uid] = !!a.up;
        state.voted[a.uid] = true;
        saveHost();
        if (Object.keys(state.voted).length >= state.n) {
          state.votes = S.hostData.votes;
          var ups = 0;
          Object.keys(state.votes).forEach(function (u) { if (state.votes[u]) ups++; });
          state.approved = RULES.voteApproved(ups, state.n - ups);
          state.phase = 'voteResult';
        }
        push(state);
        break;

      case 'voteNext':
        if (state.phase !== 'voteResult' || a.uid !== room.host) return;
        if (state.approved) {
          state.voteTrack = 0;
          state.played = {};
          S.hostData.choices = [];
          saveHost();
          state.phase = 'mission';
        } else {
          state.voteTrack++;
          if (state.voteTrack >= RULES.MAX_REJECTIONS) {
            endGame(state, 'spy', 'votes');
          } else {
            state.leader = (state.leader + 1) % state.n;
            state.team = [];
            state.phase = 'team';
          }
        }
        push(state);
        break;

      case 'mcard':
        if (state.phase !== 'mission') return;
        if (state.team.indexOf(a.uid) === -1 || state.played[a.uid]) return;
        // Règle du jeu : un résistant joue toujours Succès (son écran ne
        // propose d'ailleurs que des cartes Succès).
        var success = S.hostData.roles[a.uid] === 'res' ? true : !!a.success;
        S.hostData.choices.push(success);
        state.played[a.uid] = true;
        saveHost();
        if (S.hostData.choices.length >= state.team.length) {
          var fails = S.hostData.choices.filter(function (c) { return !c; }).length;
          var decisive = RULES.isDecisive(state.missions, state.round, state.n);
          state.pending = {
            result: RULES.missionResult(state.n, state.round, fails, decisive),
            fails: fails,
            needed: RULES.failsNeeded(state.n, state.round, decisive)
          };
          state.revealCards = RULES.shuffle(
            S.hostData.choices.map(function (c) { return c ? 'S' : 'F'; })
          ).map(function (c) { return { card: c, flipped: false }; });
          state.phase = 'missionReveal';
        }
        push(state);
        break;

      case 'flip':
        if (state.phase !== 'missionReveal' || a.uid !== room.host) return;
        if (!state.revealCards || !state.revealCards[a.i]) return;
        state.revealCards[a.i].flipped = true;
        push(state);
        break;

      case 'missionNext':
        if (state.phase !== 'missionReveal' || a.uid !== room.host) return;
        if (!state.revealCards.every(function (c) { return c.flipped; })) return;
        state.missions[state.round] = { result: state.pending.result, fails: state.pending.fails };
        state.pending = null;
        state.revealCards = null;
        var w = RULES.winner(state.missions, state.n);
        if (w) {
          endGame(state, w, 'missions');
        } else {
          state.round++;
          state.leader = (state.leader + 1) % state.n;
          state.team = [];
          state.phase = 'team';
          state.decisive = RULES.isDecisive(state.missions, state.round, state.n);
        }
        push(state);
        break;

      case 'again':
        if (state.phase !== 'gameover' || a.uid !== room.host) return;
        S.hostData = null;
        B().setOpen(S.code, true);
        push(null);
        break;
    }
  }

  function send(action) {
    B().sendAction(S.code, action);
  }

  // Rejoint un salon (bouton, lien d'invitation ou reprise de partie).
  function doJoin(code) {
    S.busy = true; S.error = null;
    B().joinRoom(code).then(function () {
      S.busy = false;
      attach(code);
      S.view = 'lobby';
      rr();
    }, function (e) {
      S.pendingJoin = '';
      try { localStorage.removeItem('spy-online-code'); } catch (err) {}
      setErr(errKey(e));
      S.view = 'menu';
      rr();
    });
  }

  // Après connexion/inscription : on file au salon si un lien d'invitation
  // (ou une partie à reprendre) attend, sinon au menu.
  function afterAuth() {
    S.busy = false;
    if (S.pendingJoin) { doJoin(S.pendingJoin); return; }
    S.view = 'menu';
    rr();
  }

  /* ------------------------------------------------------------------ */
  /* Vues                                                                */
  /* ------------------------------------------------------------------ */

  function errLine() {
    if (S.error) return '<p class="ol-error">' + t(S.error) + '</p>';
    if (S.info) return '<p class="ol-info">' + t(S.info) + '</p>';
    return '';
  }

  function screenWrap(inner) {
    return '<div class="screen online">' + inner + '</div>';
  }

  function topbar(back) {
    return '<header class="topbar">' +
      '<button class="btn btn-link" data-action="' + (back || 'ol_home') + '">✕ ' + t('ol.back') + '</button>' +
      '<h2>' + t('app.title') + '</h2>' +
      '<span class="progress">' + (S.code ? esc(S.code) : t('ol.beta')) + '</span>' +
      '</header>';
  }

  function field(type, name, phKey, value) {
    return '<input class="name-input ol-field" type="' + type + '" data-ol-field="' + name + '"' +
      ' placeholder="' + esc(t(phKey)) + '" value="' + esc(value || '') + '"' +
      (name === 'code' ? ' maxlength="4" autocapitalize="characters"' : '') +
      (name === 'email' ? ' autocomplete="email" inputmode="email"' : '') +
      (name === 'pass' ? ' autocomplete="current-password"' : '') + '>';
  }

  function busyBtn(label, action, disabled) {
    return '<button class="btn btn-primary btn-big" data-action="' + action + '"' +
      ((S.busy || disabled) ? ' disabled' : '') + '>' + label + '</button>';
  }

  // Le « G » officiel de Google, dessiné en SVG (aucune image externe).
  var GOOGLE_G = '<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"/>' +
    '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>' +
    '<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>' +
    '<path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/>' +
    '</svg>';

  // La connexion Google n'est proposée que si le domaine du site est
  // autorisé côté Firebase (voir js/firebase-config.js) — sinon Google
  // refuserait et le joueur n'aurait qu'un message d'erreur.
  function googleEnabled() {
    var b = B();
    if (!b) return false;
    if (b.kind === 'local') return true; // backend de test
    return typeof SPY_GOOGLE_SIGNIN !== 'undefined' && !!SPY_GOOGLE_SIGNIN;
  }

  // Bouton « Continuer avec Google » (affiché sur les trois écrans d'accès).
  function googleBtn() {
    if (!googleEnabled()) return '';
    return '<button class="btn btn-google" data-action="ol_google"' +
      (S.busy ? ' disabled' : '') + '>' + GOOGLE_G + t('ol.google') + '</button>' +
      '<div class="ol-sep"><span>' + t('ol.or') + '</span></div>';
  }

  function viewLoading() {
    return screenWrap(topbar() +
      '<section class="phase center-phase"><p class="hint center">' + t('ol.loading') + '</p></section>');
  }

  function viewMenu() {
    var u = me();
    var body;
    if (!u) {
      body =
        '<h3 class="ol-h">🌐 ' + t('ol.title') + '</h3>' +
        '<p class="hint center">' + t('ol.intro') + '</p>' +
        errLine() +
        '<div class="stack">' +
        googleBtn() +
        '<button class="btn btn-primary btn-big" data-action="ol_toRegister">' + t('ol.register') + '</button>' +
        '<button class="btn btn-ghost" data-action="ol_toLogin">' + t('ol.login') + '</button>' +
        '</div>';
    } else {
      body =
        '<h3 class="ol-h">' + t('ol.hello', { name: esc(u.name) }) + '</h3>' +
        errLine() +
        '<div class="stack">' +
        busyBtn(t('ol.createRoom'), 'ol_create') +
        '<div class="ol-join">' + field('text', 'code', 'ol.codePh', fields.code) +
        '<button class="btn btn-ghost" data-action="ol_join"' + (S.busy ? ' disabled' : '') + '>' +
        t('ol.joinRoom') + '</button></div>' +
        '<button class="btn btn-link" data-action="ol_logout">' + t('ol.logout') + '</button>' +
        '</div>';
    }
    return screenWrap(topbar() + '<section class="phase center-phase online-menu">' + body + '</section>');
  }

  function viewRegister() {
    return screenWrap(topbar() +
      '<section class="phase center-phase online-menu">' +
      '<h3 class="ol-h">' + t('ol.register') + '</h3>' +
      errLine() +
      '<div class="stack">' +
      googleBtn() +
      field('text', 'name', 'ol.name', fields.name) +
      field('email', 'email', 'ol.email', fields.email) +
      field('password', 'pass', 'ol.pass', fields.pass) +
      busyBtn(t('ol.doRegister'), 'ol_register') +
      '<button class="btn btn-link" data-action="ol_toLogin">' + t('ol.haveAccount') + '</button>' +
      '</div></section>');
  }

  function viewLogin() {
    return screenWrap(topbar() +
      '<section class="phase center-phase online-menu">' +
      '<h3 class="ol-h">' + t('ol.login') + '</h3>' +
      errLine() +
      '<div class="stack">' +
      googleBtn() +
      field('email', 'email', 'ol.email', fields.email) +
      field('password', 'pass', 'ol.pass', fields.pass) +
      busyBtn(t('ol.doLogin'), 'ol_login') +
      '<button class="btn btn-link" data-action="ol_forgot">' + t('ol.forgot') + '</button>' +
      '<button class="btn btn-link" data-action="ol_toRegister">' + t('ol.noAccount') + '</button>' +
      '</div></section>');
  }

  function viewLobby() {
    var room = S.room;
    var uids = Object.keys(room.players);
    var rows = uids.map(function (uid) {
      var host = uid === room.host ? ' <span class="star">★</span>' : '';
      return '<div class="pchip">' + esc(room.players[uid].name) + host + '</div>';
    }).join('');
    var n = uids.length;
    var hostPart;
    if (isHost()) {
      hostPart = n < RULES.MIN_PLAYERS
        ? '<p class="hint center">' + t('ol.needPlayers', { n: RULES.MIN_PLAYERS }) + '</p>' +
          '<button class="btn btn-primary btn-big" disabled>' + t('ol.start') + '</button>'
        : '<button class="btn btn-primary btn-big" data-action="ol_start">' + t('ol.start') + '</button>';
    } else {
      hostPart = '<p class="hint center">' + t('ol.waitHost') + '</p>';
    }
    return screenWrap(topbar('ol_leave') +
      '<section class="phase">' +
      '<h3 class="ol-h center">' + t('ol.lobbyTitle') + '</h3>' +
      '<p class="hint center">' + t('ol.shareCode') + '</p>' +
      '<div class="ol-code">' + esc(S.code) + '</div>' +
      '<button class="btn btn-ghost" data-action="ol_invite">📤 ' + t('ol.invite') + '</button>' +
      '<p class="hint center">' + t('ol.players', { x: n }) + '</p>' +
      '<div class="pgrid">' + rows + '</div>' +
      errLine() + hostPart +
      '</section>');
  }

  /* --- Vues de la partie ------------------------------------------- */

  function header() {
    var state = st();
    var sizes = RULES.teamSizes(state.n);
    var track = '<div class="mtrack">';
    for (var i = 0; i < state.missions.length; i++) {
      var m = state.missions[i];
      var cls = 'mnode';
      var label = sizes[i];
      if (m && m.result === 'success') { cls += ' ok'; label = '✓'; }
      else if (m && m.result === 'fail') { cls += ' ko'; label = '✗'; }
      else if (i === state.round) { cls += ' now'; }
      var badge = '';
      if (i === 3 && state.n >= 7) {
        badge = '<span class="mbadge">' + t('board.twoFails') + '</span>';
      } else if (RULES.isDecisive(state.missions, i, state.n)) {
        badge = '<span class="mbadge">🔥 ' + t('board.twoFails') + '</span>';
      }
      track += '<div class="mslot"><div class="' + cls + '">' + label + '</div>' + badge + '</div>';
    }
    track += '</div>';
    var pips = '';
    for (var v = 0; v < RULES.MAX_REJECTIONS; v++) {
      pips += '<span class="pip' + (v < state.voteTrack ? ' on' : '') + '"></span>';
    }
    // Bouton 👁 : revoir sa carte à tout moment (sauf pendant la
    // distribution, où elle est déjà à l'écran).
    var peekBtn = (state.phase !== 'reveal' && state.phase !== 'gameover' && S.priv)
      ? '<button class="btn btn-link" data-action="ol_peek" title="' + esc(t('ol.myRole')) + '">👁</button>'
      : '';
    return '<header class="topbar">' +
      '<button class="btn btn-link" data-action="ol_leave">✕ ' + t('ol.back') + '</button>' +
      '<h2>' + t('app.title') + '</h2>' +
      '<span class="topbar-right">' + peekBtn +
      '<span class="progress">' + esc(S.code) + '</span></span>' +
      '</header>' + track +
      '<div class="vtrack"><span class="vtrack-label">' + t('board.voteTrack') + '</span>' + pips + '</div>';
  }

  // Ma carte de rôle (même dessin que le mode local). `flipped` contrôle la
  // face visible ; `action` est le data-action posé sur la carte.
  function roleCardHtml(flipped, action) {
    var p = S.priv;
    var isSpy = p.role === 'spy';
    var roleTitle = isSpy ? t('reveal.youAreSpy') : t('reveal.youAreRes');
    var roleHint = isSpy ? t('reveal.spyHint') : t('reveal.resHint');
    var icon = isSpy ? UI().icons.spy : UI().icons.fist;
    var extra = '';
    if (isSpy) {
      extra = (p.mates && p.mates.length)
        ? '<p class="accomplices-label">' + t('reveal.accomplices') + '</p>' +
          '<p class="accomplices">' + p.mates.map(esc).join(' · ') + '</p>'
        : '<p class="accomplices-label">' + t('reveal.soloSpy') + '</p>';
    }
    return '' +
      '<div class="role-card-wrap">' +
      '<div class="role-card' + (flipped ? ' flipped' : '') + '" data-action="' + action + '" role="button" tabindex="0">' +
      '<div class="role-inner">' +
      '<div class="role-back"><div class="role-back-stamp">' + t('reveal.secret') + '</div></div>' +
      '<div class="role-front ' + (isSpy ? 'spy' : 'res') + '">' +
      '<div class="role-title">' + roleTitle + '</div>' +
      '<div class="role-icon">' + icon + '</div>' +
      '<p class="role-hint">' + roleHint + '</p>' + extra +
      '</div></div></div></div>';
  }

  // Revoir sa carte en cours de partie (un joueur peut oublier son camp).
  function peekModal() {
    if (!S.peek || !S.priv) return '';
    return '<div class="modal-back peek-back" data-action="ol_peekClose">' +
      roleCardHtml(true, 'ol_peekClose') +
      '<p class="hint center">' + t('ol.peekClose') + '</p>' +
      '</div>';
  }

  function gReveal() {
    var state = st();
    var readyCount = Object.keys(state.ready).length;
    var progress = '<p class="hint center">' + t('ol.readyCount', { x: readyCount, n: state.n }) + '</p>';
    if (!S.priv) {
      return '<section class="phase center-phase"><p class="hint center">' + t('ol.loading') + '</p></section>';
    }
    var btn = S.readySent
      ? '<button class="btn btn-primary btn-big" disabled>✓ ' + t('ol.readySent') + '</button>'
      : '<button class="btn btn-primary btn-big" data-action="ol_ready">' + t('ol.ready') + '</button>';
    return '' +
      '<section class="phase center-phase">' +
      '<p class="hint center">' + t('ol.yourCard') + '</p>' +
      roleCardHtml(S.flipped, 'ol_flip') +
      progress + btn +
      '</section>';
  }

  function gTeam() {
    var state = st();
    var k = RULES.teamSizes(state.n)[state.round];
    var leaderUid = state.order[state.leader];
    var decisiveBanner = RULES.isDecisive(state.missions, state.round, state.n)
      ? '<p class="warn">🔥 ' + t('decisive.hint') + '</p>' : '';
    if (leaderUid === me().uid) {
      var chips = state.order.map(function (uid) {
        var sel = S.pick.indexOf(uid) !== -1;
        var star = uid === leaderUid ? '<span class="star">★</span>' : '';
        return '<button class="pchip' + (sel ? ' sel' : '') + '" data-action="ol_pick" data-uid="' + esc(uid) + '">' +
          star + esc(state.names[uid]) + (sel ? '<span class="check">✓</span>' : '') + '</button>';
      }).join('');
      return '<section class="phase">' +
        '<h3>' + t('ol.leaderYou', { k: k }) + '</h3>' +
        decisiveBanner +
        '<div class="pgrid">' + chips + '</div>' +
        '<p class="hint center">' + t('team.selected', { x: S.pick.length, k: k }) + '</p>' +
        '<button class="btn btn-primary btn-big" data-action="ol_team"' +
        (S.pick.length === k ? '' : ' disabled') + '>' + t('team.propose') + '</button>' +
        '</section>';
    }
    return '<section class="phase center-phase">' +
      '<h3>' + t('ol.leaderOther', { name: esc(state.names[leaderUid]), k: k }) + '</h3>' +
      decisiveBanner +
      '<p class="hint center">' + t('ol.leaderWait') + '</p>' +
      '</section>';
  }

  function teamNamesLine() {
    var state = st();
    return '<p class="team-line"><span class="hint">' + t('vote.team') + '</span> <b>' +
      state.team.map(function (uid) { return esc(state.names[uid]); }).join(' · ') + '</b></p>';
  }

  function gVote() {
    var state = st();
    var votedCount = Object.keys(state.voted).length;
    var progress = '<p class="hint center">' + t('ol.votedCount', { x: votedCount, n: state.n }) + '</p>';
    var body;
    if (state.voted[me().uid]) {
      body = '<p class="verdict neutral">✓ ' + t('ol.voted') + '</p>' + progress;
    } else {
      body =
        '<div class="ol-votebtns">' +
        '<button class="btn btn-primary btn-big" data-action="ol_vote" data-v="up">👍 ' + t('ol.voteUp') + '</button>' +
        '<button class="btn btn-danger btn-big" data-action="ol_vote" data-v="down">👎 ' + t('ol.voteDown') + '</button>' +
        '</div>' + progress;
    }
    return '<section class="phase center-phase">' +
      '<h3>' + t('ol.voteTitle') + '</h3>' + teamNamesLine() + body +
      '</section>';
  }

  function gVoteResult() {
    var state = st();
    var up = 0, down = 0;
    var tags = state.order.map(function (uid) {
      var v = state.votes[uid];
      if (v) up++; else down++;
      return '<span class="vote-tag ' + (v ? 'up' : 'down') + '">' + esc(state.names[uid]) + ' ' + (v ? '👍' : '👎') + '</span>';
    }).join('');
    var verdict = state.approved
      ? '<p class="verdict ok">' + t('vote.approved') + '</p>'
      : '<p class="verdict ko">' + t('vote.rejected') + '</p>';
    var next = isHost()
      ? '<button class="btn btn-primary btn-big" data-action="ol_voteNext">' +
        t(state.approved ? 'vote.goMission' : 'vote.continue') + '</button>'
      : '<p class="hint center">' + t('ol.hostNext') + '</p>';
    return '<section class="phase center-phase">' +
      '<h3>' + t('ol.voteTitle') + '</h3>' + teamNamesLine() + verdict +
      '<p class="big-count"><b>' + up + '</b> 👍 · <b>' + down + '</b> 👎</p>' +
      '<div class="vote-tags">' + tags + '</div>' + next +
      '</section>';
  }

  function gMission() {
    var state = st();
    var playedCount = Object.keys(state.played).length;
    var k = state.team.length;
    var progress = '<p class="hint center">' + t('ol.playedCount', { x: playedCount, k: k }) + '</p>';
    var inTeam = state.team.indexOf(me().uid) !== -1;
    if (!inTeam) {
      return '<section class="phase center-phase"><h3>' + t('ol.missionTitle', { i: state.round + 1 }) + '</h3>' +
        teamNamesLine() + '<p class="hint center">' + t('ol.notInTeam') + '</p>' + progress + '</section>';
    }
    if (state.played[me().uid]) {
      return '<section class="phase center-phase"><h3>' + t('ol.missionTitle', { i: state.round + 1 }) + '</h3>' +
        '<p class="verdict neutral">✓ ' + t('ol.cardPlayed') + '</p>' + progress + '</section>';
    }
    // Rappel du camp : ici chaque téléphone est personnel, on peut le dire
    // en clair (un joueur distrait peut avoir oublié son rôle).
    var campLine = '<p class="camp-line">' +
      t(S.priv && S.priv.role === 'spy' ? 'mission.youSpy' : 'mission.youRes') + '</p>';
    // Mêmes règles d'affichage que le mode local : un résistant reçoit DEUX
    // cartes Succès ; un spy reçoit Succès + Sabotage (ordre imprévisible).
    var types = myMissionTypes();
    var hasPick = typeof S.mpick === 'number';
    var cards = types.map(function (type, i) {
      var sel = hasPick ? (S.mpick === i ? ' picked' : ' dim') : '';
      return '<button class="mcard neutral ' + type + sel + '" data-action="ol_mcard" data-idx="' + i + '">' +
        '<span class="mcard-icon">' + (type === 'success' ? UI().icons.fist : UI().icons.spy) + '</span>' +
        t(type === 'success' ? 'mission.success' : 'mission.fail') + '</button>';
    }).join('');
    var confirmBar = hasPick
      ? '<div class="confirm-bar">' +
        '<button class="btn btn-ghost" data-action="ol_mchange">' + t('mission.change') + '</button>' +
        '<button class="btn btn-primary" data-action="ol_mconfirm">' + t('mission.confirm') + '</button>' +
        '</div>'
      : '';
    return '<section class="phase center-phase">' +
      '<h3>' + t('mission.pick') + '</h3>' +
      campLine +
      '<div class="mission-cards">' + cards + '</div>' +
      '<p class="hint center">' + t('mission.rule') + '</p>' +
      confirmBar + progress +
      '</section>';
  }

  function gMissionReveal() {
    var state = st();
    var allFlipped = state.revealCards.every(function (c) { return c.flipped; });
    var host = isHost();
    var cards = state.revealCards.map(function (c, i) {
      if (!c.flipped) {
        return host
          ? '<button class="rcard back" data-action="ol_rflip" data-idx="' + i + '">?</button>'
          : '<div class="rcard back">?</div>';
      }
      return '<div class="rcard ' + (c.card === 'S' ? 'ok' : 'ko') + '">' +
        (c.card === 'S' ? UI().icons.fist : UI().icons.spy) + '</div>';
    }).join('');
    var outcome;
    if (allFlipped) {
      var out = state.pending;
      var note = '';
      if (out.result === 'success' && out.fails > 0) {
        note = '<p class="hint center">' + t('mission.notEnough', { f: out.fails, need: out.needed }) + '</p>';
      } else if (out.result === 'fail') {
        note = '<p class="hint center">' + t('mission.failsCount', { f: out.fails }) + '</p>';
      }
      outcome = '<div class="verdict ' + (out.result === 'success' ? 'ok' : 'ko') + '">' +
        t(out.result === 'success' ? 'mission.successResult' : 'mission.failResult') + '</div>' + note +
        (host
          ? '<button class="btn btn-primary btn-big" data-action="ol_missionNext">' + t('mission.continue') + '</button>'
          : '<p class="hint center">' + t('ol.hostNext') + '</p>');
    } else {
      outcome = '<p class="hint center">' + t(host ? 'mission.revealHint' : 'ol.hostFlips') + '</p>';
    }
    return '<section class="phase center-phase">' +
      '<h3>' + t('mission.revealTitle', { i: state.round + 1 }) + '</h3>' +
      '<div class="rcards">' + cards + '</div>' + outcome +
      '</section>';
  }

  function gGameover() {
    var state = st();
    var tal = RULES.tally(state.missions);
    var resWin = state.winner === 'res';
    var reason = state.winReason === 'votes' ? '<p class="hint center">' + t('over.byVotes') + '</p>' : '';
    var roles = state.order.map(function (uid) {
      var r = state.roles[uid];
      return '<span class="vote-tag ' + (r === 'spy' ? 'down' : 'up') + '">' +
        esc(state.names[uid]) + ' — ' + t(r === 'spy' ? 'role.spy' : 'role.res') + '</span>';
    }).join('');
    var btns = (isHost()
      ? '<button class="btn btn-primary btn-big" data-action="ol_again">' + t('ol.again') + '</button>'
      : '<p class="hint center">' + t('ol.hostNext') + '</p>') +
      '<button class="btn btn-ghost" data-action="ol_leave">' + t('ol.leave') + '</button>';
    return '<section class="phase center-phase">' +
      '<div class="verdict ' + (resWin ? 'ok' : 'ko') + '">' +
      t(resWin ? 'over.resWin' : 'over.spyWin') + '</div>' + reason +
      '<p class="big-count">' + t('over.score', { s: tal.success, f: tal.fail }) + '</p>' +
      '<p class="hint center">' + t('over.roles') + '</p>' +
      '<div class="vote-tags">' + roles + '</div>' +
      '<div class="stack">' + btns + '</div>' +
      '</section>';
  }

  function viewGame() {
    var state = st();
    var body;
    switch (state.phase) {
      case 'reveal': body = gReveal(); break;
      case 'team': body = gTeam(); break;
      case 'vote': body = gVote(); break;
      case 'voteResult': body = gVoteResult(); break;
      case 'mission': body = gMission(); break;
      case 'missionReveal': body = gMissionReveal(); break;
      case 'gameover': body = gGameover(); break;
      default: body = '<p class="hint center">' + t('ol.loading') + '</p>';
    }
    return screenWrap(header() + body + peekModal());
  }

  /* ------------------------------------------------------------------ */
  /* Actions (préfixe ol_) déclenchées par l'interface                   */
  /* ------------------------------------------------------------------ */

  var actions = {
    ol_home: function () { detach('idle'); UI().goHome(); },
    ol_leave: function () {
      var code = S.code;
      if (code) B().leaveRoom(code);
      detach('menu');
    },
    ol_toRegister: function () { S.view = 'register'; S.error = null; },
    ol_toLogin: function () { S.view = 'login'; S.error = null; },

    ol_register: function () {
      if (S.busy) return;
      var name = fields.name.trim();
      if (name.length < 2) { setErr('ol.errName'); return; }
      if (fields.email.indexOf('@') === -1) { setErr('ol.errBadEmail'); return; }
      if (fields.pass.length < 6) { setErr('ol.errWeakPass'); return; }
      S.busy = true; S.error = null;
      B().signUp(name, fields.email, fields.pass).then(afterAuth,
        function (e) { setErr(errKey(e)); rr(); });
    },

    ol_login: function () {
      if (S.busy) return;
      if (fields.email.indexOf('@') === -1) { setErr('ol.errBadEmail'); return; }
      S.busy = true; S.error = null;
      B().signIn(fields.email, fields.pass).then(afterAuth,
        function (e) { setErr(errKey(e)); rr(); });
    },

    ol_google: function () {
      if (S.busy) return;
      S.busy = true; S.error = null;
      B().signInGoogle().then(function (u) {
        // u vaut null quand le navigateur part sur une redirection : la
        // page va se recharger, il n'y a rien à faire ici.
        if (u) afterAuth();
        else { S.busy = false; rr(); }
      }, function (e) { setErr(errKey(e)); rr(); });
    },

    ol_forgot: function () {
      if (fields.email.indexOf('@') === -1) { setErr('ol.errBadEmail'); return; }
      B().resetPass(fields.email).then(function () {
        S.info = 'ol.resetSent'; S.error = null; rr();
      }, function (e) { setErr(errKey(e)); rr(); });
    },

    ol_logout: function () {
      B().signOut();
      detach('menu');
    },

    ol_create: function () {
      if (S.busy) return;
      S.busy = true; S.error = null;
      B().createRoom().then(function (code) {
        S.busy = false;
        attach(code);
        S.view = 'lobby';
        rr();
      }, function (e) { setErr(errKey(e)); rr(); });
    },

    ol_join: function () {
      if (S.busy) return;
      var code = fields.code.trim().toUpperCase();
      if (code.length !== 4) { setErr('ol.errRoomNotFound'); return; }
      doJoin(code);
    },

    ol_invite: function () {
      var url = location.origin + location.pathname + '?join=' + S.code;
      var text = t('ol.inviteText', { code: S.code });
      if (navigator.share) {
        navigator.share({ title: 'Spy', text: text, url: url }).catch(function () {});
        return 'noRender';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text + ' ' + url).catch(function () {});
      }
      S.info = 'ol.linkCopied';
      S.error = null;
    },
    ol_peek: function () { S.peek = true; },
    ol_peekClose: function () { S.peek = false; },
    ol_start: function () { send({ type: 'start' }); },
    ol_flip: function () { S.flipped = !S.flipped; },
    ol_ready: function () {
      S.flipped = false;
      S.readySent = true;
      send({ type: 'ready' });
    },
    ol_pick: function (el) {
      var uid = el.getAttribute('data-uid');
      var i = S.pick.indexOf(uid);
      var k = RULES.teamSizes(st().n)[st().round];
      if (i !== -1) S.pick.splice(i, 1);
      else if (S.pick.length < k) S.pick.push(uid);
    },
    ol_team: function () { send({ type: 'team', team: S.pick.slice() }); },
    ol_vote: function (el) { send({ type: 'vote', up: el.getAttribute('data-v') === 'up' }); },
    ol_voteNext: function () { send({ type: 'voteNext' }); },
    ol_mcard: function (el) { S.mpick = parseInt(el.getAttribute('data-idx'), 10); },
    ol_mchange: function () { S.mpick = null; },
    ol_mconfirm: function () {
      if (typeof S.mpick !== 'number') return;
      var success = myMissionTypes()[S.mpick] === 'success';
      S.mpick = null;
      send({ type: 'mcard', success: success });
    },
    ol_rflip: function (el) { send({ type: 'flip', i: parseInt(el.getAttribute('data-idx'), 10) }); },
    ol_missionNext: function () { send({ type: 'missionNext' }); },
    ol_again: function () { send({ type: 'again' }); }
  };

  /* ------------------------------------------------------------------ */
  /* API publique                                                        */
  /* ------------------------------------------------------------------ */

  return {
    // Le mode en ligne est-il configuré (Firebase rempli ou ?localnet) ?
    available: function () { return SPYNET.available(); },

    open: function () {
      S.view = 'loading';
      B().ready().then(function () {
        // Lien d'invitation ou partie à reprendre ? On y va directement.
        var saved = null;
        try { saved = localStorage.getItem('spy-online-code'); } catch (e) {}
        var target = S.pendingJoin || saved;
        if (me() && target) {
          S.pendingJoin = '';
          doJoin(target);
        } else {
          S.view = 'menu';
          rr();
        }
      }, function () {
        S.view = 'menu';
        setErr('ol.errNet');
        rr();
      });
    },

    // Une partie en ligne enregistrée à reprendre ? (bouton de l'accueil)
    savedRoom: function () {
      try { return localStorage.getItem('spy-online-code'); } catch (e) { return null; }
    },

    view: function () {
      switch (S.view) {
        case 'loading': return viewLoading();
        case 'register': return viewRegister();
        case 'login': return viewLogin();
        case 'lobby': return viewLobby();
        case 'game': return viewGame();
        default: return viewMenu();
      }
    },

    action: function (name, el) {
      var fn = actions[name];
      if (fn) return fn(el);
    },

    input: function (name, value) {
      if (name in fields) fields[name] = value;
    },

    // Accès de debug pour les tests automatisés.
    debug: function () {
      return JSON.parse(JSON.stringify({
        view: S.view,
        code: S.code,
        error: S.error,
        user: me() || null,
        room: S.room || null,
        priv: S.priv || null
      }));
    }
  };
})();
