/**
 * Construction du bundle ZIP d'un chunk de trace.
 *
 * Même format que les traces pilotées depuis le BO (session_recorder) afin que
 * le lecteur du dashboard n'ait qu'une seule structure à connaître :
 *
 *   events.json    events rrweb du chunk (commence par un snapshot complet)
 *   network.json   métadonnées réseau (sans corps — voir trace_recorder)
 *   redux.json     actions Redux du chunk → chapitrage du replay
 *   meta.json      identité caisse, bornes temporelles, provenance
 *
 * La compression est faite ICI, au niveau du chunk entier (DEFLATE), et non
 * event par event via `packFn` de rrweb : le ratio est nettement meilleur sur
 * un corpus de plusieurs milliers d'events similaires, et le ZIP resterait
 * incapable de recompresser du base64 déjà deflaté.
 */

const JSZip = require("jszip");

/**
 * @param {object} args
 * @param {Array}  args.events   events rrweb
 * @param {Array}  args.net      events réseau (métadonnées)
 * @param {Array}  args.redux    actions Redux
 * @param {object} args.meta     meta.json
 * @returns {Promise<Buffer>}
 */
async function buildChunkZip({ events = [], net = [], redux = [], meta = {} }) {
  const zip = new JSZip();
  zip.file("events.json", JSON.stringify(events));
  zip.file("network.json", JSON.stringify(net));
  zip.file("redux.json", JSON.stringify(redux));
  zip.file("meta.json", JSON.stringify(meta));
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

module.exports = { buildChunkZip };
