const axios = require("axios");

const log = require("./electron_log");

/**
 * Etat des taches planifiees du service RetailScheduler, mis en forme pour le
 * panneau lateral de la caisse.
 *
 * ⚠️ EN DORMANCE — le RetailScheduler n'expose PAS encore ces routes.
 *
 * Ce module attend du service, sur la loopback :
 *   GET  {base}/api/tasks              -> ScheduledTaskStatus[]
 *   POST {base}/api/tasks/{name}/run   -> declenchement manuel (x-api-key)
 *
 * Aujourd'hui elles renvoient 404 : fetchTasks() renvoie null, le composant
 * SchedulerTasks ne rend rien, et le panneau lateral est inchange. Le code
 * s'activera tout seul le jour ou le service les exposera — decision qui lui
 * appartient, cf docs/SUJETS-DE-FOND.md.
 *
 * A savoir si la question revient : `IsRunning` vit dans un dictionnaire EN
 * MEMOIRE de TaskHistoryService (SetTaskRunning), il n'est jamais ecrit dans
 * history.db. Lire la base ne dira donc JAMAIS ce qui tourne — seul le service
 * peut le repondre. C'est pour cela qu'il n'existe pas de contournement.
 *
 * La vue est volontairement PAUVRE : un caissier n'a pas besoin de
 * l'historique, des compteurs ni des expressions cron. Il a besoin de savoir
 * ce qui tourne, ce qui vient d'echouer, et quand ca repasse.
 */

/** Port par defaut du RetailScheduler (cf appsettings UiPort). */
const DEFAULT_PORT = 5088;
/** Au-dela, un echec ne justifie plus d'alerter : il reste visible, sans rougir. */
const FRESH_FAILURE_MS = 12 * 60 * 60 * 1000;

const baseUrl = () =>
  `http://127.0.0.1:${process.env.EL_SCHEDULER_PORT || DEFAULT_PORT}`;

/** Le service C# serialise en PascalCase ; on accepte les deux graphies. */
function champ(obj, nom) {
  const bas = nom.charAt(0).toLowerCase() + nom.slice(1);
  const haut = nom.charAt(0).toUpperCase() + nom.slice(1);
  return obj[bas] !== undefined ? obj[bas] : obj[haut];
}

const horodatage = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/**
 * Trie et filtre les taches pour l'affichage caissier. Fonction PURE.
 *
 * Ordre : ce qui tourne, puis ce qui vient d'echouer, puis la prochaine
 * echeance. Les taches en cours ne sont JAMAIS evincees par le plafond : une
 * tache qui tourne est l'information la plus utile de l'ecran.
 *
 * @param {Array|null} statuses  reponse brute de /api/tasks
 * @param {number} now
 * @returns {Array<{name:string,description:string,etat:'running'|'failed'|'ok',lastRunUtc:string|null,nextRunUtc:string|null}>}
 */
function shapeForCashier(statuses, now) {
  if (!Array.isArray(statuses)) return [];

  const lignes = [];
  for (const brut of statuses) {
    if (!brut || typeof brut !== "object") continue;

    const name = champ(brut, "name");
    if (typeof name !== "string" || !name) continue;

    const active = champ(brut, "enabled") !== false;
    const running = champ(brut, "isRunning") === true;
    const lastRunUtc = champ(brut, "lastRunUtc") || null;
    const nextRunUtc = champ(brut, "nextRunUtc") || null;
    const success = champ(brut, "lastRunSuccess");
    const lastRunAt = horodatage(lastRunUtc);

    // Un echec reste un echec quel que soit son age : le masquer donnait une
    // liste plus courte que ce qui est configure, ce qui fait douter de l'outil.
    // C'est `recent` qui decide si on alerte, pas la presence dans la liste.
    let etat = "ok";
    let recent = false;
    if (!active) {
      etat = "disabled";
    } else if (running) {
      etat = "running";
    } else if (success === false) {
      etat = "failed";
      recent = lastRunAt !== null && now - lastRunAt <= FRESH_FAILURE_MS;
    }

    lignes.push({
      name,
      description: champ(brut, "description") || "",
      etat,
      recent,
      lastRunUtc,
      nextRunUtc,
    });
  }

  // Ce qui demande une action d'abord, ce qui ne tournera pas en dernier.
  const rang = { running: 0, failed: 1, ok: 2, disabled: 3 };
  lignes.sort((a, b) => {
    if (rang[a.etat] !== rang[b.etat]) return rang[a.etat] - rang[b.etat];
    // Entre deux echecs, le plus recent est le plus actionnable.
    if (a.etat === "failed" && a.recent !== b.recent) return a.recent ? -1 : 1;
    const na = horodatage(a.nextRunUtc);
    const nb = horodatage(b.nextRunUtc);
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  });

  // Aucun plafond : la modale de detail doit montrer TOUT ce qui est configure.
  // Le panneau lateral n'affiche qu'une ligne de synthese, il n'a plus besoin
  // qu'on tronque pour lui.
  return lignes;
}

/** Lit l'etat des taches. Renvoie null si le service est absent. */
async function fetchTasks(now) {
  try {
    const r = await axios.get(`${baseUrl()}/api/tasks`, { timeout: 4000 });
    return shapeForCashier(r.data, typeof now === "number" ? now : Date.now());
  } catch (err) {
    // Service absent ou arrete : la caisse fonctionne sans, on n'affiche rien.
    log.debug(`[SCHEDULER] /api/tasks indisponible: ${err.message}`);
    return null;
  }
}

/**
 * Declenche une tache. L'api-key est celle de l'appsettings du service, lue
 * par le meme chemin que le screen-session.
 * @returns {Promise<{ok:boolean, reason?:string, message?:string}>}
 */
async function runTask(name, apiKey) {
  if (!apiKey) {
    return { ok: false, reason: "NOT_ENROLLED" };
  }
  try {
    const r = await axios.post(
      `${baseUrl()}/api/tasks/${encodeURIComponent(name)}/run`,
      {},
      { headers: { "x-api-key": apiKey }, timeout: 120000 },
    );
    const data = r.data || {};
    const ok = champ(data, "success") !== false;
    return ok ? { ok: true } : { ok: false, reason: "FAILED", message: champ(data, "error") || "" };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) return { ok: false, reason: "UNAUTHORIZED" };
    log.error(`[SCHEDULER] run ${name}: ${err.message}`);
    return { ok: false, reason: "UNREACHABLE", message: err.message };
  }
}

module.exports = {
  shapeForCashier,
  fetchTasks,
  runTask,
  FRESH_FAILURE_MS,
  DEFAULT_PORT,
};
