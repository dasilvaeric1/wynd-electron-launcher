const fs = require("node:fs");
const path = require("node:path");

const axios = require("axios");
const JSZip = require("jszip");

const log = require("./electron_log");

/**
 * Signalement d'anomalie declenche par le caissier depuis le panneau lateral.
 *
 * Reutilise exactement la chaine d'envoi des traces :
 *   POST {baseUrl}/api/traces/presign        -> { traceId, uploadUrl }
 *   PUT  {uploadUrl}                          -> le ZIP, en direct vers le
 *                                                stockage objet (aucun egress
 *                                                central)
 *   POST {baseUrl}/api/traces/{id}/complete  -> taille, duree, meta
 *
 * Seul `meta.kind` change ("incident" au lieu de "continuous"), donc aucune
 * nouvelle route cote dashboard.
 */

/** Taille max de queue de log embarquee, par fichier. */
const LOG_TAIL_BYTES = 256 * 1024;
/** Longueur max du commentaire saisi par le caissier. */
const MAX_COMMENT = 2000;

/**
 * Metadonnees du signalement. Fonction PURE : ni disque, ni reseau.
 * @param {object} store
 * @param {string} comment
 * @param {number} now
 */
function buildReportMeta(store, comment, now) {
  const infos = (store && store.infos) || {};
  const conf = (store && store.conf) || {};
  const wpt = (store && store.wpt) || {};
  const text = typeof comment === "string" ? comment.slice(0, MAX_COMMENT).trim() : "";

  return {
    kind: "incident",
    comment: text,
    reportedAt: new Date(now).toISOString(),
    launcherVersion: infos.version || null,
    platform: infos.os ? infos.os.platform : null,
    osVersion: infos.os ? infos.os.version : null,
    electron: infos.stack ? infos.stack.electron : null,
    title: conf.title || null,
    view: conf.view || null,
    url: conf.url?.href ? conf.url.href : null,
    wpt: {
      enabled: !!(conf.wpt?.enable),
      connected: !!wpt.connect,
      version: wpt.version || null,
      plugins: Array.isArray(wpt.plugins)
        ? wpt.plugins.map((p) => ({ name: p.name, enabled: !!p.enabled }))
        : null,
    },
  };
}

/**
 * Derniers octets d'un fichier texte. Renvoie null si illisible : un
 * signalement ne doit jamais echouer parce qu'un log manque.
 */
function tailFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    try {
      const length = size - start;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    log.debug(`[INCIDENT] log illisible ${filePath}: ${err.message}`);
    return null;
  }
}

/** Fichier de log le plus recent d'un dossier (rotation quotidienne winston). */
function latestLogFile(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files.length ? path.join(dir, files[0].f) : null;
  } catch (err) {
    log.debug(`[INCIDENT] dossier de logs illisible ${dir}: ${err.message}`);
    return null;
  }
}

/**
 * Dossier du journal de demarrage de la stack, ecrit par anycommerce.bat
 * (redemarrages WSL et apiupdater, rotation quotidienne).
 *
 * C'est souvent le journal qui MANQUE au support : quand WSL ne repart pas, le
 * launcher n'a rien a dire — il n'a meme pas demarre dans de bonnes
 * conditions. Le joindre au signalement evite l'aller-retour « pouvez-vous
 * nous envoyer aussi... ».
 *
 * Renvoie null hors Windows : le script qui alimente ce journal est un .bat,
 * et rien ne l'ecrit ailleurs. Inventer un chemin Linux ferait echouer une
 * lecture a chaque signalement pour rien. `EL_STACK_LOG_DIR` reste la porte de
 * sortie le jour ou un equivalent existera.
 */
function stackLogDir() {
  if (process.env.EL_STACK_LOG_DIR) return process.env.EL_STACK_LOG_DIR;
  if (process.platform !== "win32") return null;
  return String.raw`C:\Retail\ANYCOMMERCE\logs`;
}

/** Construit le ZIP du signalement. */
async function buildIncidentZip(store, comment, now) {
  const zip = new JSZip();
  const meta = buildReportMeta(store, comment, now);
  zip.file("report.json", JSON.stringify(meta, null, 2));

  const logs = (store?.logs) || {};
  const sources = [
    ["main", logs.main],
    ["app", logs.app],
    // Ecrit hors du launcher, avant meme son demarrage — d'ou un chemin
    // resolu et non lu depuis store.logs.
    ["stack", stackLogDir()],
  ];
  for (const [name, dir] of sources) {
    if (!dir) continue;
    const file = latestLogFile(dir);
    if (!file) continue;
    const tail = tailFile(file, LOG_TAIL_BYTES);
    if (tail) zip.file(`logs/${name}.log`, tail);
  }

  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { buf, meta };
}

/**
 * Envoie le signalement.
 * @param {object} store
 * @param {string} comment
 * @param {{getConfig: function}} deps  getConfig -> {baseUrl, apiKey, serial}
 * @returns {Promise<{ok: boolean, traceId?: string, reason?: string}>}
 */
async function sendIncident(store, comment, deps) {
  const cfg = await deps.getConfig();
  if (!cfg) {
    // Caisse pas enrolee : rien a joindre, et surtout rien a promettre au
    // caissier. On le dit plutot que d'echouer en silence.
    return { ok: false, reason: "NOT_ENROLLED" };
  }

  const now = Date.now();
  const { buf, meta } = await buildIncidentZip(store, comment, now);
  const startedAt = new Date(now).toISOString();

  const pres = await axios.post(
    `${cfg.baseUrl}/api/traces/presign`,
    { caisseSerial: cfg.serial, startedAt },
    { headers: { "x-api-key": cfg.apiKey }, timeout: 15_000 },
  );
  const { traceId, uploadUrl } = pres.data || {};
  if (!traceId || !uploadUrl) throw new Error("presign incomplet");

  await axios.put(uploadUrl, buf, {
    headers: { "content-type": "application/zip" },
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  await axios.post(
    `${cfg.baseUrl}/api/traces/${traceId}/complete`,
    {
      sizeBytes: buf.length,
      stoppedAt: startedAt,
      durationMs: 0,
      meta: { ...meta, caisseSerial: cfg.serial, startedAt, stoppedAt: startedAt },
    },
    { headers: { "x-api-key": cfg.apiKey }, timeout: 15_000 },
  );

  log.info(`[INCIDENT] signalement envoye (${Math.round(buf.length / 1024)} Ko) → ${traceId}`);
  return { ok: true, traceId };
}

module.exports = {
  sendIncident,
  buildIncidentZip,
  buildReportMeta,
  tailFile,
  latestLogFile,
  stackLogDir,
  LOG_TAIL_BYTES,
  MAX_COMMENT,
};
