/**
 * Dépilage FIFO du spool vers le central.
 *
 * Réutilise la chaîne d'upload existante des traces pilotées :
 *
 *   POST {baseUrl}/api/traces/presign        → { traceId, uploadUrl }
 *   PUT  uploadUrl                           → le ZIP part EN DIRECT vers le
 *                                              stockage objet (pas d'egress
 *                                              central)
 *   POST {baseUrl}/api/traces/{id}/complete  → taille, durée, meta
 *
 * Le corps du presign garde exactement la forme utilisée par session_recorder
 * (`{caisseSerial, startedAt}`) : aucun changement d'API n'est requis côté
 * dashboard pour accepter les traces continues. Ce qui les distingue est
 * porté par `meta` au /complete (`kind: "continuous"`).
 *
 * Un seul chunk en vol à la fois, du plus ancien au plus récent : en sortie de
 * panne réseau on rattrape dans l'ordre chronologique sans saturer le lien.
 */

const axios = require("axios");
const JSZip = require("jszip");
const log = require("./electron_log");

/**
 * Relit le meta.json depuis le ZIP du chunk.
 *
 * Les bornes temporelles reelles (debut, fin, duree) sont ecrites dans le
 * bundle au moment de la fermeture du chunk ; l'uploader, lui, tourne plus
 * tard. Les renvoyer telles quelles au `/complete` est indispensable : sinon
 * le dashboard affiche une duree de 0 ms et une heure de fin egale a l'heure
 * d'upload, ce qui rend les traces illisibles (constate en production).
 */
async function readChunkMeta(buf) {
  try {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file("meta.json");
    if (!f) return null;
    return JSON.parse(await f.async("string"));
  } catch (err) {
    log.debug(`[TRACE] meta.json illisible: ${err.message}`);
    return null;
  }
}

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 60_000];

function createUploader({ spool, getConfig, launcherInfo }) {
  let inFlight = false;
  let failures = 0;
  let nextAttemptAt = 0;

  async function uploadOne(chunk, cfg) {
    const buf = spool.readChunk(chunk.name);
    if (!buf) {
      spool.removeChunk(chunk.name);
      return true; // illisible → on ne bloque pas la file
    }
    const startedAt = new Date(chunk.startedAtMs).toISOString();

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

    // Bornes reelles du chunk, pas celles de l'upload.
    const chunkMeta = await readChunkMeta(buf);
    const stoppedAt = chunkMeta?.stoppedAt || new Date().toISOString();
    const durationMs =
      typeof chunkMeta?.durationMs === "number"
        ? chunkMeta.durationMs
        : Math.max(0, Date.parse(stoppedAt) - chunk.startedAtMs);

    await axios.post(
      `${cfg.baseUrl}/api/traces/${traceId}/complete`,
      {
        sizeBytes: buf.length,
        stoppedAt,
        durationMs,
        meta: {
          ...(chunkMeta || {}),
          kind: "continuous",
          caisseSerial: cfg.serial,
          startedAt,
          stoppedAt,
          durationMs,
          launcherVersion: launcherInfo.version,
          platform: launcherInfo.platform,
        },
      },
      { headers: { "x-api-key": cfg.apiKey }, timeout: 15_000 },
    );

    spool.removeChunk(chunk.name);
    log.debug(
      `[TRACE] chunk ${chunk.name} uploadé (${Math.round(buf.length / 1024)} Ko) → ${traceId}`,
    );
    return true;
  }

  /** Un tour de dépilage. Ne throw jamais. */
  async function tick() {
    if (inFlight) return;
    if (Date.now() < nextAttemptAt) return;

    const pending = spool.listChunks();
    if (pending.length === 0) return;

    const cfg = await getConfig();
    if (!cfg) return; // caisse pas enrôlée → les chunks attendent sur disque

    inFlight = true;
    try {
      await uploadOne(pending[0], cfg);
      failures = 0;
      nextAttemptAt = 0;
    } catch (err) {
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
      failures += 1;
      nextAttemptAt = Date.now() + wait;
      log.warn(
        `[TRACE] upload ${pending[0].name} KO (${err.message}) → retry dans ${wait / 1000}s, ${pending.length} en attente`,
      );
    } finally {
      inFlight = false;
    }
  }

  return { tick, pending: () => spool.listChunks().length };
}

module.exports = { createUploader, BACKOFF_MS, readChunkMeta };
