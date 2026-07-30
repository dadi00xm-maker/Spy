/*
 * Configuration Firebase du mode en ligne (projet « spy-labelnou »).
 *
 * Ce bloc n'est pas un secret : il identifie le projet et il est visible par
 * tous les navigateurs qui ouvrent le jeu. La sécurité vient des règles
 * Firestore (firestore.rules) et de l'authentification par e-mail.
 *
 * Mettre SPY_FIREBASE_CONFIG à null désactive proprement le mode en ligne
 * (le bouton affiche alors « bientôt »).
 */
var SPY_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDDimbRdL0Ct4mw6n1gNr6q4wxxcPbvljk',
  authDomain: 'spy-labelnou.firebaseapp.com',
  projectId: 'spy-labelnou',
  storageBucket: 'spy-labelnou.firebasestorage.app',
  messagingSenderId: '691264780541',
  appId: '1:691264780541:web:0d2ae744e5b3c5fcf62694'
};
