/*
 * Couche réseau du mode en ligne — deux implémentations derrière la même
 * interface :
 *
 *  - FirebaseBackend : comptes e-mail / mot de passe (Firebase Auth) et
 *    salons temps réel (Firestore). Activé quand SPY_FIREBASE_CONFIG est
 *    rempli. Le SDK n'est chargé QUE si le joueur entre dans le mode en
 *    ligne : le jeu local reste 100 % hors ligne et sans dépendance.
 *
 *  - LocalBackend (?localnet=1) : même API, mais tout se passe dans le
 *    navigateur via BroadcastChannel — la page de l'hôte joue le rôle du
 *    serveur. Sert aux tests automatisés et aux démonstrations.
 *
 * Principe commun : l'HÔTE fait autorité. Les autres joueurs n'écrivent
 * jamais l'état du jeu — ils envoient des « actions » que l'hôte applique,
 * puis l'hôte publie le nouvel état public. Les rôles restent dans des
 * documents privés lisibles uniquement par leur propriétaire.
 */
var SPYNET = (function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sans I, L, O (ambigus)

  function makeCode() {
    var c = '';
    for (var i = 0; i < 4; i++) {
      c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* Backend local : BroadcastChannel, l'hôte est le serveur.            */
  /* ------------------------------------------------------------------ */

  function LocalBackend() {
    var channel = new BroadcastChannel('spy-net');
    var user = null;
    var authCbs = [];
    var roomCbs = {};    // code -> [cb]
    var privCbs = {};    // code|uid -> [cb]
    var actionCbs = {};  // code -> cb (hôte)
    var served = {};     // salons hébergés par CETTE page : code -> data
    var lastRooms = {};  // derniers instantanés reçus : code -> room

    function accounts() {
      try { return JSON.parse(localStorage.getItem('spy-net-accounts') || '{}'); }
      catch (e) { return {}; }
    }
    function saveAccounts(a) {
      try { localStorage.setItem('spy-net-accounts', JSON.stringify(a)); } catch (e) {}
    }

    function post(msg) { channel.postMessage(JSON.stringify(msg)); }

    function publicRoom(code) {
      var r = served[code];
      return {
        code: code, host: r.host, open: r.open,
        players: r.players, state: r.state, v: r.v
      };
    }

    function broadcastRoom(code) {
      if (!served[code]) return;
      var snap = publicRoom(code);
      post({ t: 'room', code: code, room: snap });
      deliverRoom(code, snap); // la page hôte s'écoute aussi elle-même
    }

    function deliverRoom(code, room) {
      lastRooms[code] = room;
      (roomCbs[code] || []).forEach(function (cb) {
        try { cb(room); } catch (e) {}
      });
    }

    function deliverPrivate(code, uid, data) {
      ((privCbs[code + '|' + uid]) || []).forEach(function (cb) {
        try { cb(data); } catch (e) {}
      });
    }

    channel.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      // Messages traités par la page HÔTE du salon visé.
      if (served[msg.code]) {
        var r = served[msg.code];
        if (msg.t === 'join') {
          if (r.open && !r.players[msg.uid]) r.players[msg.uid] = { name: msg.name };
          r.v++;
          broadcastRoom(msg.code);
          // Rejoue les documents privés au nouvel arrivant (reconnexion).
          if (r.privates[msg.uid]) {
            post({ t: 'private', code: msg.code, uid: msg.uid, data: r.privates[msg.uid] });
          }
        } else if (msg.t === 'leave') {
          delete r.players[msg.uid];
          r.v++;
          broadcastRoom(msg.code);
        } else if (msg.t === 'action' && actionCbs[msg.code]) {
          try { actionCbs[msg.code](msg.action); } catch (e) {}
        } else if (msg.t === 'getRoom') {
          broadcastRoom(msg.code);
          Object.keys(r.privates).forEach(function (uid) {
            post({ t: 'private', code: msg.code, uid: uid, data: r.privates[uid] });
          });
        }
      }

      // Messages reçus par toutes les pages (invités).
      if (msg.t === 'room' && !served[msg.code]) deliverRoom(msg.code, msg.room);
      if (msg.t === 'private' && user && msg.uid === user.uid) {
        deliverPrivate(msg.code, msg.uid, msg.data);
      }
    };

    return {
      kind: 'local',
      available: function () { return true; },
      ready: function () { return Promise.resolve(); },

      user: function () { return user; },
      onAuth: function (cb) { authCbs.push(cb); },

      signUp: function (name, email, pass) {
        var a = accounts();
        var key = email.trim().toLowerCase();
        if (a[key]) return Promise.reject({ code: 'auth/email-already-in-use' });
        a[key] = { pass: pass, name: name, uid: 'u' + Math.random().toString(36).slice(2, 10) };
        saveAccounts(a);
        user = { uid: a[key].uid, name: name, email: key };
        authCbs.forEach(function (cb) { cb(user); });
        return Promise.resolve(user);
      },
      signIn: function (email, pass) {
        var a = accounts();
        var key = email.trim().toLowerCase();
        if (!a[key] || a[key].pass !== pass) {
          return Promise.reject({ code: 'auth/invalid-credential' });
        }
        user = { uid: a[key].uid, name: a[key].name, email: key };
        authCbs.forEach(function (cb) { cb(user); });
        return Promise.resolve(user);
      },
      signOut: function () {
        user = null;
        authCbs.forEach(function (cb) { cb(null); });
        return Promise.resolve();
      },
      resetPass: function () { return Promise.resolve(); },

      createRoom: function () {
        var code = makeCode();
        served[code] = {
          host: user.uid, open: true, v: 1,
          players: {}, state: null, privates: {}
        };
        served[code].players[user.uid] = { name: user.name };
        broadcastRoom(code);
        return Promise.resolve(code);
      },
      joinRoom: function (code) {
        code = code.toUpperCase();
        var self = this;
        return new Promise(function (resolve, reject) {
          var tries = 0;
          var iv = setInterval(function () {
            if (lastRooms[code] && lastRooms[code].players[user.uid]) {
              clearInterval(iv);
              resolve(code);
              return;
            }
            if (lastRooms[code] && !lastRooms[code].open) {
              clearInterval(iv);
              reject({ code: 'room/closed' });
              return;
            }
            if (++tries > 40) {
              clearInterval(iv);
              reject({ code: 'room/not-found' });
              return;
            }
            post({ t: 'join', code: code, uid: user.uid, name: user.name });
          }, 120);
        });
      },
      leaveRoom: function (code) {
        post({ t: 'leave', code: code, uid: user.uid });
        return Promise.resolve();
      },
      watchRoom: function (code, cb) {
        (roomCbs[code] = roomCbs[code] || []).push(cb);
        if (served[code]) broadcastRoom(code);
        else { post({ t: 'getRoom', code: code }); if (lastRooms[code]) cb(lastRooms[code]); }
        return function () {
          roomCbs[code] = (roomCbs[code] || []).filter(function (f) { return f !== cb; });
        };
      },
      setState: function (code, state) {
        var r = served[code];
        if (!r) return Promise.reject({ code: 'room/not-host' });
        r.state = state;
        r.v++;
        broadcastRoom(code);
        return Promise.resolve();
      },
      setOpen: function (code, open) {
        var r = served[code];
        if (!r) return Promise.reject({ code: 'room/not-host' });
        r.open = open;
        r.v++;
        broadcastRoom(code);
        return Promise.resolve();
      },
      setPrivate: function (code, uid, data) {
        var r = served[code];
        if (!r) return Promise.reject({ code: 'room/not-host' });
        r.privates[uid] = data;
        post({ t: 'private', code: code, uid: uid, data: data });
        if (user && uid === user.uid) deliverPrivate(code, uid, data);
        return Promise.resolve();
      },
      watchPrivate: function (code, uid, cb) {
        (privCbs[code + '|' + uid] = privCbs[code + '|' + uid] || []).push(cb);
        post({ t: 'getRoom', code: code });
        return function () {
          var k = code + '|' + uid;
          privCbs[k] = (privCbs[k] || []).filter(function (f) { return f !== cb; });
        };
      },
      sendAction: function (code, action) {
        action.uid = user.uid;
        if (served[code] && actionCbs[code]) {
          // L'hôte s'envoie ses propres actions sans passer par le canal.
          try { actionCbs[code](action); } catch (e) {}
        } else {
          post({ t: 'action', code: code, action: action });
        }
        return Promise.resolve();
      },
      onActions: function (code, cb) { actionCbs[code] = cb; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Backend Firebase : Auth (e-mail/mot de passe) + Firestore.          */
  /* ------------------------------------------------------------------ */

  function FirebaseBackend(config) {
    var SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
    var FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
    var loadP = null;
    var user = null;
    var authCbs = [];
    var db = null, auth = null;

    function loadScript(src) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { reject(new Error('chargement impossible : ' + src)); };
        document.head.appendChild(s);
      });
    }

    function ready() {
      if (loadP) return loadP;
      loadP = FILES.reduce(function (p, f) {
        return p.then(function () { return loadScript(SDK + f); });
      }, Promise.resolve()).then(function () {
        var app = window.firebase.initializeApp(config);
        auth = window.firebase.auth(app);
        db = window.firebase.firestore(app);
        auth.onAuthStateChanged(function (u) {
          user = u ? { uid: u.uid, name: u.displayName || (u.email || '').split('@')[0], email: u.email } : null;
          authCbs.forEach(function (cb) { cb(user); });
        });
      });
      return loadP;
    }

    function roomRef(code) { return db.collection('rooms').doc(code); }

    function assembleRoom(code, doc, playersSnap) {
      var players = {};
      playersSnap.forEach(function (p) { players[p.id] = p.data(); });
      var d = doc.data() || {};
      return { code: code, host: d.host, open: d.open, state: d.state || null, players: players, v: d.v || 0 };
    }

    return {
      kind: 'firebase',
      available: function () { return true; },
      ready: ready,

      user: function () { return user; },
      onAuth: function (cb) { authCbs.push(cb); },

      signUp: function (name, email, pass) {
        return auth.createUserWithEmailAndPassword(email.trim(), pass).then(function (cred) {
          return cred.user.updateProfile({ displayName: name }).then(function () {
            user = { uid: cred.user.uid, name: name, email: cred.user.email };
            authCbs.forEach(function (cb) { cb(user); });
            return user;
          });
        });
      },
      signIn: function (email, pass) {
        return auth.signInWithEmailAndPassword(email.trim(), pass).then(function (cred) {
          user = { uid: cred.user.uid, name: cred.user.displayName || email.split('@')[0], email: cred.user.email };
          return user;
        });
      },
      signOut: function () { return auth.signOut(); },
      resetPass: function (email) { return auth.sendPasswordResetEmail(email.trim()); },

      createRoom: function () {
        var code = makeCode();
        var ref = roomRef(code);
        return db.runTransaction(function (tx) {
          return tx.get(ref).then(function (doc) {
            if (doc.exists) throw { code: 'room/exists' };
            tx.set(ref, { host: user.uid, open: true, state: null, v: 1, created: Date.now() });
            tx.set(ref.collection('players').doc(user.uid), { name: user.name });
          });
        }).then(function () { return code; }, function (err) {
          if (err && err.code === 'room/exists') return this.createRoom();
          throw err;
        }.bind(this));
      },
      joinRoom: function (code) {
        code = code.toUpperCase();
        var ref = roomRef(code);
        return ref.get().then(function (doc) {
          if (!doc.exists) throw { code: 'room/not-found' };
          if (!doc.data().open) throw { code: 'room/closed' };
          return ref.collection('players').doc(user.uid).set({ name: user.name });
        }).then(function () { return code; });
      },
      leaveRoom: function (code) {
        return roomRef(code).collection('players').doc(user.uid).delete();
      },
      watchRoom: function (code, cb) {
        var ref = roomRef(code);
        var lastDoc = null, lastPlayers = null;
        function emit() {
          if (lastDoc && lastPlayers) cb(assembleRoom(code, lastDoc, lastPlayers));
        }
        var u1 = ref.onSnapshot(function (doc) { lastDoc = doc; emit(); });
        var u2 = ref.collection('players').onSnapshot(function (snap) { lastPlayers = snap; emit(); });
        return function () { u1(); u2(); };
      },
      setState: function (code, state) {
        return roomRef(code).update({ state: state, v: window.firebase.firestore.FieldValue.increment(1) });
      },
      setOpen: function (code, open) {
        return roomRef(code).update({ open: open, v: window.firebase.firestore.FieldValue.increment(1) });
      },
      setPrivate: function (code, uid, data) {
        return roomRef(code).collection('private').doc(uid).set(data);
      },
      watchPrivate: function (code, uid, cb) {
        return roomRef(code).collection('private').doc(uid).onSnapshot(function (doc) {
          if (doc.exists) cb(doc.data());
        });
      },
      sendAction: function (code, action) {
        action.uid = user.uid;
        action.t = Date.now();
        return roomRef(code).collection('actions').add(action);
      },
      onActions: function (code, cb) {
        return roomRef(code).collection('actions').orderBy('t').onSnapshot(function (snap) {
          snap.docChanges().forEach(function (ch) {
            if (ch.type !== 'added') return;
            var action = ch.doc.data();
            ch.doc.ref.delete();
            try { cb(action); } catch (e) {}
          });
        });
      }
    };
  }

  /* ------------------------------------------------------------------ */

  var backend = null;
  if (params.has('localnet') && 'BroadcastChannel' in window) {
    backend = LocalBackend();
  } else if (typeof SPY_FIREBASE_CONFIG !== 'undefined' && SPY_FIREBASE_CONFIG) {
    backend = FirebaseBackend(SPY_FIREBASE_CONFIG);
  }

  return {
    available: function () { return !!backend; },
    backend: function () { return backend; }
  };
})();
