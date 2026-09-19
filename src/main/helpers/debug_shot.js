const fs = require("node:fs");
const path = require("node:path");
const { desktopCapturer, screen } = require("electron");

const log = require("./electron_log");

/**
 * Capture de diagnostic : une image par ecran physique.
 *
 * Existe parce qu'un ecran client mal place est indiagnosticable a distance.
 * Le launcher peut confirmer une position, une taille et un ordre
 * d'empilement tout en n'affichant rien de visible — c'est arrive, et sans
 * image il n'y avait aucun moyen de trancher entre « la fenetre n'est pas la »
 * et « la fenetre est la mais ne rend rien ».
 *
 * Desactive par defaut. `EL_DEBUG_SHOT=/chemin/dossier` l'active.
 */
async function debugShot(dossier) {
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const ecrans = screen.getAllDisplays();
    // La vignette est demandee a la taille reelle du plus grand ecran : en
    // dessous, desktopCapturer redimensionne et on perd le detail qu'on
    // cherche justement a lire.
    const w = Math.max(...ecrans.map((e) => e.size.width));
    const h = Math.max(...ecrans.map((e) => e.size.height));

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: w, height: h },
    });

    for (const [i, src] of sources.entries()) {
      const img = src.thumbnail;
      if (!img || img.isEmpty()) {
        log.warn(`[SHOT] ecran ${i} (${src.name}) : image vide`);
        continue;
      }
      const cible = path.join(dossier, `ecran-${i}.png`);
      fs.writeFileSync(cible, img.toPNG());
      const t = img.getSize();
      log.info(`[SHOT] ecran ${i} (${src.name}) -> ${cible} ${t.width}x${t.height}`);
    }
    log.info(`[SHOT] ${sources.length} source(s) capturee(s)`);
  } catch (err) {
    log.error(`[SHOT] capture KO: ${err.message}`);
  }
}

module.exports = debugShot;
