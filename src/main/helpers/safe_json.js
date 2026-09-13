/**
 * Sérialisation JSON défensive.
 *
 * Les charges utiles capturées dans la page POS (events rrweb, actions Redux,
 * events réseau) ou reçues du WPT / du central n'ont pas une forme maîtrisée :
 * `JSON.stringify` peut y buter sur une référence circulaire, un BigInt ou un
 * `toJSON` qui throw. Dans une ligne de log ou un handler d'event socket, ce
 * throw remonte non capturé et fait tomber l'appelant — pour une trace de
 * confort. On renvoie donc un marqueur exploitable à la place.
 *
 * @param {*} value      valeur à sérialiser
 * @param {string} what  nom de l'entrée, repris dans le marqueur
 * @param {number} [space] indentation, comme le 3e argument de JSON.stringify
 * @returns {string}     JSON valide dans tous les cas
 */
function jsonOrMarker(value, what, space) {
  try {
    return JSON.stringify(value, null, space);
  } catch (err) {
    // Le marqueur ne contient que des chaînes : cette sérialisation-ci ne peut
    // pas échouer à son tour.
    return JSON.stringify({
      error: `${what} non sérialisable`,
      detail: String(err.message),
    });
  }
}

module.exports = { jsonOrMarker };
