/*
 * Diffusion du plateau public vers une TV.
 * - API Presentation (Chrome Android/desktop → Chromecast, Android TV) ;
 * - BroadcastChannel en miroir (second onglet local, PC branché en HDMI,
 *   et tests automatisés).
 * Seul l'état PUBLIC transite : jamais les rôles ni les choix secrets.
 */
var SPYCAST = (function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var supported = ('PresentationRequest' in window) && !params.has('nocast');
  var request = null;
  var connection = null;
  var channel = null;
  var lastState = null;
  var listeners = [];

  try {
    channel = ('BroadcastChannel' in window) ? new BroadcastChannel('spy-tv') : null;
  } catch (e) { channel = null; }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* sans conséquence */ }
    }
  }

  function send(obj) {
    var msg = JSON.stringify(obj);
    if (connection && connection.state === 'connected') {
      try { connection.send(msg); } catch (e) {}
    }
    if (channel) {
      try { channel.postMessage(msg); } catch (e) {}
    }
  }

  function sync(pub) {
    if (!pub) return;
    lastState = pub;
    send({ type: 'state', state: pub });
  }

  function bindConnection(conn) {
    connection = conn;
    conn.onconnect = function () {
      if (lastState) send({ type: 'state', state: lastState });
      notify();
    };
    conn.onclose = function () { connection = null; notify(); };
    conn.onterminate = function () { connection = null; notify(); };
    if (lastState) send({ type: 'state', state: lastState });
    notify();
  }

  function start() {
    if (!supported) return Promise.reject(new Error('cast non supporté'));
    if (!request) request = new PresentationRequest(['tv.html']);
    return request.start().then(function (conn) {
      bindConnection(conn);
      return conn;
    });
  }

  function stop() {
    if (connection) {
      try { connection.terminate(); } catch (e) {}
      connection = null;
      notify();
    }
  }

  function connected() {
    return !!(connection && connection.state === 'connected');
  }

  return {
    supported: supported,
    start: start,
    stop: stop,
    sync: sync,
    connected: connected,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
