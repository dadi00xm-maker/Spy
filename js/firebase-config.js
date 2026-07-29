/*
 * Configuration Firebase du mode en ligne.
 *
 * Tant que SPY_FIREBASE_CONFIG est null, le bouton « Jouer en ligne »
 * affiche « bientôt disponible ». Pour activer : remplacer null par le bloc
 * de configuration Web fourni par la console Firebase, par exemple :
 *
 *   var SPY_FIREBASE_CONFIG = {
 *     apiKey: '…', authDomain: '…', projectId: '…',
 *     storageBucket: '…', messagingSenderId: '…', appId: '…'
 *   };
 *
 * Ce bloc n'est pas un secret (il est visible par tous les navigateurs) :
 * la sécurité vient des règles Firestore et de l'authentification.
 */
var SPY_FIREBASE_CONFIG = null;
