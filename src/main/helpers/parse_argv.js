/**
 * Parsing des options de ligne de commande du launcher.
 *
 * Remplace `yargs`, retiré pour une raison d'empaquetage : `@isaacs/cliui`
 * (tiré par glob) déclare des ALIAS npm (`string-width-cjs:
 * npm:string-width@^4.2.0`), si bien que `string-width@4.2.3` existe à deux
 * chemins portant le même nom et la même version. electron-builder indexe par
 * nom@version, ne sait pas trancher, et omet le paquet de l'app.asar — le
 * launcher packagé mourait alors sur `Cannot find module 'string-width'` dès le
 * require de yargs. Contourner en copiant les modules à côté de l'asar échoue
 * aussi : un module hors asar ne voit pas le node_modules qui est dedans.
 *
 * yargs ne servait qu'à lire trois options. On les lit donc à la main, et tout
 * le sous-arbre (cliui, string-width, wrap-ansi, strip-ansi, emoji-regex…)
 * disparaît du bundle.
 *
 * Formes acceptées, identiques à ce que yargs acceptait ici :
 *   --config_path=/chemin    --config_path /chemin
 *   -c /chemin               -c=/chemin
 *
 * Les arguments inconnus sont ignorés : la ligne de commande contient aussi
 * les switches Chromium (`--no-sandbox`, `--user-data-dir=…`), qui ne doivent
 * ni être consommés ni faire échouer le parsing.
 */

// Équivalent de `hideBin` de yargs : en mode packagé, argv[0] est l'exécutable
// et il n'y a pas de chemin de script à sauter ; en dev, `electron .` ajoute
// l'exécutable ET le point d'entrée.
function hideBin(argv = process.argv, isDefaultApp = !!process.defaultApp) {
  return argv.slice(isDefaultApp ? 2 : 1);
}

function normalize(token) {
  return token.replace(/^--?/, "");
}

/**
 * @param {Array<string>} args   arguments déjà débarrassés du binaire
 * @param {object} spec          { nom: { alias?, type?: 'string'|'number', default } }
 * @returns {object} valeurs résolues (défauts inclus)
 */
function parseArgs(args, spec) {
  const out = {};
  const byFlag = new Map();
  for (const [name, opt] of Object.entries(spec)) {
    out[name] = opt.default;
    byFlag.set(name, name);
    if (opt.alias) byFlag.set(opt.alias, name);
  }

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (typeof token !== "string" || !token.startsWith("-")) continue;

    const eq = token.indexOf("=");
    const flag = normalize(eq >= 0 ? token.slice(0, eq) : token);
    const name = byFlag.get(flag);
    if (!name) continue; // switch Chromium ou option inconnue → on laisse passer

    let value;
    if (eq >= 0) {
      value = token.slice(eq + 1);
    } else {
      const next = args[i + 1];
      // `--url` sans valeur, ou suivi d'une autre option → on ne consomme rien.
      if (typeof next !== "string" || next.startsWith("-")) continue;
      value = next;
      i += 1;
    }

    if (spec[name].type === "number") {
      const n = Number(value);
      out[name] = Number.isFinite(n) ? n : spec[name].default;
    } else {
      out[name] = value;
    }
  }

  return out;
}

/** Parsing des options du launcher. */
function parseLauncherArgs(defaultConfigPath, argv = process.argv) {
  return parseArgs(hideBin(argv), {
    config_path: { alias: "c", type: "string", default: defaultConfigPath },
    screen: { alias: "s", type: "number", default: 0 },
    url: { alias: "u", type: "string", default: null },
  });
}

module.exports = { parseLauncherArgs, parseArgs, hideBin };
