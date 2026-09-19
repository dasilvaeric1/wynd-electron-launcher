/**
 * Base HTTP de WPT, sans slash final.
 *
 * Le retrait des slashes se fait par boucle et NON par `/\/+$/`. Ce motif est
 * super-lineaire : sur une chaine terminee par une longue serie de slashes
 * qui ne matche finalement pas, le moteur repart en arriere depuis chaque
 * position. L'url vient de la configuration, editee par l'exploitant — ce
 * n'est pas une entree hostile, mais une boucle lineaire coute moins cher a
 * lire qu'un motif a prouver sur.
 *
 * Extrait parce que trois appelants en avaient chacun leur copie. Pas de
 * try/catch ni de logger : le chainage optionnel ne leve pas, et une fonction
 * pure se teste sans mocker Electron.
 *
 * @param {object} store
 * @param {string} defaut Adresse de repli si la conf ne porte pas d'url.
 * @returns {string}
 */
module.exports = function wptBaseUrl(store, defaut = "http://127.0.0.1:9963") {
  const href = store?.conf?.wpt?.url?.href;
  if (!href) return defaut;

  let fin = href.length;
  while (fin > 0 && href[fin - 1] === "/") fin--;
  return href.slice(0, fin);
};
