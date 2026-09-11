/**
 * Spool disque des chunks de trace.
 *
 * En upload continu, le spool EST le tampon : les chunks s'y accumulent et
 * sont dépilés en FIFO par l'uploader. Si le lien magasin tombe, ils
 * s'empilent ; quand le plafond est atteint, on jette les PLUS ANCIENS
 * (garder le récent est ce qui a de la valeur pour diagnostiquer).
 *
 * Layout dans <userData>/logs/trace/ :
 *
 *   current.ndjson        chunk en cours d'écriture (1 event JSON par ligne)
 *   current.json          méta du chunk en cours (startedAt, posUrl…)
 *   <startedAtMs>.zip     chunks finalisés, prêts à uploader
 *
 * Le chunk en cours est écrit en NDJSON au fil de l'eau (drain toutes les
 * 2 s) et non gardé en mémoire : un crash du launcher ne coûte que le dernier
 * drain, et le fichier partiel reste rejouable puisqu'il commence par un
 * snapshot complet.
 *
 * `fsImpl` est injectable pour les tests.
 */

const nodeFs = require("fs");
const { join } = require("path");

const PARTIAL_EVENTS = "current.ndjson";
const PARTIAL_META = "current.json";
const CHUNK_RE = /^(\d+)\.zip$/;

function createSpool({ dir, maxBytes, fsImpl = nodeFs, logger } = {}) {
  const log = logger || { debug() {}, info() {}, warn() {}, error() {} };
  const eventsPath = join(dir, PARTIAL_EVENTS);
  const metaPath = join(dir, PARTIAL_META);

  function ensureDir() {
    try {
      fsImpl.mkdirSync(dir, { recursive: true });
      return true;
    } catch (err) {
      log.error(`[TRACE] spool mkdir KO (${dir}): ${err.message}`);
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Chunk partiel (en cours)                                           */
  /* ------------------------------------------------------------------ */

  function openPartial(meta) {
    ensureDir();
    try {
      fsImpl.writeFileSync(metaPath, JSON.stringify(meta), "utf8");
      fsImpl.writeFileSync(eventsPath, "", "utf8");
      return true;
    } catch (err) {
      log.error(`[TRACE] openPartial KO: ${err.message}`);
      return false;
    }
  }

  /** @param {Array} records events rrweb (1 ligne JSON chacun) */
  function appendPartial(records) {
    if (!records || records.length === 0) return 0;
    let payload = "";
    for (const rec of records) {
      try {
        payload += JSON.stringify(rec) + "\n";
      } catch (_) {
        // event non sérialisable (référence circulaire) → on le saute plutôt
        // que de perdre tout le batch.
      }
    }
    if (!payload) return 0;
    try {
      fsImpl.appendFileSync(eventsPath, payload, "utf8");
      return records.length;
    } catch (err) {
      log.warn(`[TRACE] appendPartial KO: ${err.message}`);
      return 0;
    }
  }

  function readPartial() {
    let meta = null;
    try {
      meta = JSON.parse(fsImpl.readFileSync(metaPath, "utf8"));
    } catch (_) {
      return null;
    }
    let events = [];
    try {
      const raw = fsImpl.readFileSync(eventsPath, "utf8");
      events = raw
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter((e) => e !== null);
    } catch (_) {
      // pas encore de ligne écrite → chunk vide, meta seule
    }
    return { meta, events };
  }

  function dropPartial() {
    for (const p of [eventsPath, metaPath]) {
      try {
        fsImpl.rmSync(p, { force: true });
      } catch (_) {
        /* déjà absent */
      }
    }
  }

  function partialSize() {
    try {
      return fsImpl.statSync(eventsPath).size;
    } catch (_) {
      return 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Chunks finalisés                                                   */
  /* ------------------------------------------------------------------ */

  /** @returns {Array<{name: string, startedAtMs: number, size: number}>} tri chronologique */
  function listChunks() {
    let names = [];
    try {
      names = fsImpl.readdirSync(dir);
    } catch (_) {
      return [];
    }
    const out = [];
    for (const name of names) {
      const m = CHUNK_RE.exec(name);
      if (!m) continue;
      let size = 0;
      try {
        size = fsImpl.statSync(join(dir, name)).size;
      } catch (_) {
        continue; // supprimé entre readdir et stat
      }
      out.push({ name, startedAtMs: Number(m[1]), size });
    }
    return out.sort((a, b) => a.startedAtMs - b.startedAtMs);
  }

  function chunkPath(name) {
    return join(dir, name);
  }

  function removeChunk(name) {
    try {
      fsImpl.rmSync(join(dir, name), { force: true });
      return true;
    } catch (err) {
      log.warn(`[TRACE] removeChunk ${name} KO: ${err.message}`);
      return false;
    }
  }

  function readChunk(name) {
    try {
      return fsImpl.readFileSync(join(dir, name));
    } catch (err) {
      log.warn(`[TRACE] readChunk ${name} KO: ${err.message}`);
      return null;
    }
  }

  /**
   * Applique le plafond disque en supprimant les chunks les plus anciens.
   * @returns {{dropped: number, bytes: number}}
   */
  function enforceCap() {
    const chunks = listChunks();
    let bytes = chunks.reduce((sum, c) => sum + c.size, 0) + partialSize();
    let dropped = 0;
    // Deux intouchables :
    //   - le chunk partiel, qu'on est en train d'écrire ;
    //   - le DERNIER chunk finalisé (`slice(0, -1)`), sinon un plafond réglé
    //     plus petit qu'un seul chunk effacerait la trace au fil de l'eau et
    //     ne laisserait jamais rien à diagnostiquer. Le plafond est une garde
    //     disque, pas une raison de ne plus rien avoir.
    for (const c of chunks.slice(0, -1)) {
      if (bytes <= maxBytes) break;
      if (removeChunk(c.name)) {
        bytes -= c.size;
        dropped += 1;
      }
    }
    if (dropped > 0) {
      log.warn(
        `[TRACE] plafond spool atteint (${Math.round(maxBytes / 1048576)} Mo) → ${dropped} chunk(s) le(s) plus ancien(s) supprimé(s)`,
      );
    }
    return { dropped, bytes };
  }

  function putChunk(startedAtMs, buffer) {
    ensureDir();
    const name = `${startedAtMs}.zip`;
    try {
      fsImpl.writeFileSync(join(dir, name), buffer);
    } catch (err) {
      log.error(`[TRACE] putChunk KO: ${err.message}`);
      return null;
    }
    enforceCap();
    return name;
  }

  function stats() {
    const chunks = listChunks();
    return {
      chunks: chunks.length,
      bytes: chunks.reduce((sum, c) => sum + c.size, 0),
      partialBytes: partialSize(),
      maxBytes,
    };
  }

  return {
    dir,
    ensureDir,
    openPartial,
    appendPartial,
    readPartial,
    dropPartial,
    listChunks,
    chunkPath,
    readChunk,
    removeChunk,
    putChunk,
    enforceCap,
    stats,
  };
}

module.exports = { createSpool, PARTIAL_EVENTS, PARTIAL_META };
