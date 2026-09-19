import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  PrinterOutlined,
  CreditCardOutlined,
  ScanOutlined,
  WalletOutlined,
  InboxOutlined,
  ApiOutlined,
  ReloadOutlined,
  BulbOutlined,
  BarcodeOutlined,
  DesktopOutlined,
  CloseOutlined,
} from "@ant-design/icons";

import { IRootState, IDiagnostics, IWPT, TWPTPluginState } from "../interface";

// Events WPT requêtés au reload — réponses stockées dans le slice diagnostics.
// 'plugins' (instantané) peuple wpt.plugins → status fiable par plugin activé,
// indépendamment du scan matériel (lent/faillible) des requêtes device.
// NB : fastprinter.printerdata (status live d'UNE imprimante) n'est pas ici —
// il exige un payload {type,address} et est émis par le dashboard quand
// l'imprimante par défaut est connue (voir effet ci-dessous).
export const DIAGNOSTIC_EVENTS = [
  "plugins",
  "fastprinter.defaultprinterdata",
  "fastprinter.printers",
  "universalterminal.plugin",
  "universalterminal.isinitialized",
  "lights.devices",
];

export interface IDiagnosticsDashboardProps {
  // Déclenche les requêtes WPT (une par event de diagnostic).
  onReload: () => void;
  // Ferme le panneau (clic sur le fond du dashboard, hors cards/actions).
  onClose: () => void;
  // Émet une action WPT arbitraire (ex. test d'impression, printerdata).
  onAction: (event: string, ...datas: any[]) => void;
}

// `degraded` : le périphérique répond, mais il ne peut pas rendre son
// service (imprimante avec capot ouvert ou sans papier). Ni vert ni rouge —
// l'opérateur doit voir qu'il y a une action à faire sur la machine.
type TStatus =
  | "online"
  | "offline"
  | "initializing"
  | "degraded"
  | "unknown";
type TRowState = "ok" | "warn" | "bad" | "muted";

interface IRow {
  label: string;
  value: string;
  state?: TRowState;
}

interface ICard {
  key: string;
  label: string;
  icon: React.ReactNode;
  status: TStatus;
  category: string;
  rows: IRow[];
  footer?: string;
  action?: { label: string; onClick: () => void };
}

// Ligne de test de l'afficheur client.
//
// Le plugin WPT REFUSE toute ligne plus longue que l'afficheur
// (`LINE_TOO_LONG`) : il ne tronque pas. L'ancienne valeur
// « *** TEST AFFICHEUR *** » faisait 22 caractères et échouait donc sur un
// afficheur 20 colonnes, qui est la géométrie par défaut du plugin.
//
// 16 caractères, et pas 20 : les afficheurs 2x16 sont courants en caisse, et
// le launcher ne connaît pas la géométrie réelle — le plugin l'expose bien
// (`linedisplay.geometry`) mais l'émet en push à la connexion socket, or le
// launcher n'écoute que des événements nommés par plugin. Tant que ce
// câblage n'existe pas, tenir dans le plus étroit est ce qui marche partout.
const TEST_LINE1 = "*** TEST ***";

// HH:MM:SS explicite plutôt que toLocaleTimeString() : selon la locale du
// poste, ce dernier peut rendre « 3:24:07 PM » (10 car.) et déborder d'un
// afficheur étroit.
const hhmmss = (d: Date): string =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

const STATUS_META: Record<TStatus, { label: string; cls: string }> = {
  online: { label: "Connecté", cls: "online" },
  offline: { label: "Déconnecté", cls: "offline" },
  initializing: { label: "Initialisation", cls: "initializing" },
  degraded: { label: "Intervention", cls: "degraded" },
  unknown: { label: "Inconnu", cls: "unknown" },
};

// Libellé + icône + catégorie par clé de plugin connue.
const PLUGIN_META: Record<
  string,
  { label: string; icon: React.ReactNode; category: string }
> = {
  fastprinter: {
    label: "Imprimante",
    icon: <PrinterOutlined />,
    category: "Encaissement",
  },
  cashdrawer: {
    label: "Tiroir-caisse",
    icon: <InboxOutlined />,
    category: "Encaissement",
  },
  universalterminal: {
    label: "TPE / Paiement",
    icon: <CreditCardOutlined />,
    category: "Paiement",
  },
  rfidupos: {
    label: "Lecteur RFID",
    icon: <ScanOutlined />,
    category: "Système",
  },
  balance: { label: "Balance", icon: <WalletOutlined />, category: "Système" },
  lights: { label: "Lights", icon: <BulbOutlined />, category: "Système" },
  linedisplay: {
    label: "Afficheur client",
    icon: <DesktopOutlined />,
    category: "Encaissement",
  },
  barcodereadersopos: {
    label: "Scanner code-barres",
    icon: <BarcodeOutlined />,
    category: "Encaissement",
  },
};

// Plugins additionnels à afficher SI présents côté WPT (clé normalisée).
const OPTIONAL_PLUGIN_KEYS = ["lights", "linedisplay", "barcodereadersopos"];

// Clé normalisée : "barcode-readers-opos" → "barcodereadersopos" — fait le
// pont entre les clés de config (display_plugin_state), les noms de plugins
// WPT et nos clés PLUGIN_META.
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z]/g, "");

const metaFor = (key: string) =>
  PLUGIN_META[norm(key)] || {
    label: key,
    icon: <ApiOutlined />,
    category: "Autres",
  };

const fmtTime = (ts: number | null) =>
  ts ? new Date(ts).toLocaleTimeString() : "—";

const TYPE_LABEL: Record<string, string> = {
  usb: "USB",
  serial: "Série",
  network: "Réseau",
};

/**
 * Dashboard "Périphériques" — mur d'état dense affiché à droite du panneau
 * latéral. Une seule grille de cards compactes (catégorie en chip), chaque
 * card = pastille d'icône + nom + pill de statut + lignes label/valeur avec
 * point coloré (capot, papier, tiroir…). Pour l'imprimante, le status live
 * est garanti en interrogeant directement le device (fastprinter.printerdata)
 * quand la liste ne fournit pas les champs live.
 */
const DiagnosticsDashboard: React.FunctionComponent<IDiagnosticsDashboardProps> = ({
  onReload,
  onClose,
  onAction,
}) => {
  const diagnostics = useSelector<IRootState, IDiagnostics>(
    (s) => s.diagnostics
  );
  const pluginState = useSelector<IRootState, TWPTPluginState | null>(
    (s) => s.pluginState
  );
  const wpt = useSelector<IRootState, IWPT>((s) => s.wpt);

  // Horloge live (tick chaque seconde).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);

  // Reload à l'ouverture + auto-refresh périodique (données fraîches).
  // `reloadTick` marque chaque cycle : c'est lui qui redéclenche la sonde
  // imprimante plus bas. On ne peut pas se caler sur `diagnostics.lastUpdate`,
  // que la réponse de la sonde met justement à jour — ça boucle.
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    const run = () => {
      onReload();
      setReloadTick((t) => t + 1);
    };
    run();
    const i = window.setInterval(run, 30000);
    return () => window.clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byEvent = diagnostics.byEvent || {};
  const byError = diagnostics.byError || {};

  // Imprimante par défaut : la `registered` de la liste, sinon la 1ère
  // détectée, sinon la config defaultprinterdata.
  const defaultPrinter = useMemo(() => {
    const list = byEvent["fastprinter.printers"];
    const cfg = byEvent["fastprinter.defaultprinterdata"];
    const fromList = Array.isArray(list)
      ? list.find((x: any) => x?.registered) ||
        list.find((x: any) => x?.detected) ||
        list[0]
      : null;
    return fromList || cfg || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    byEvent["fastprinter.printers"],
    byEvent["fastprinter.defaultprinterdata"],
  ]);

  // Status live du device : la réponse printerdata prime (fraîche, complète),
  // sinon les champs éventuellement présents dans la liste.
  const printerLive = byEvent["fastprinter.printerdata"] || defaultPrinter;

  // Interroge le device à CHAQUE cycle de refresh, et pas seulement quand les
  // champs live manquent.
  //
  // L'ancienne version sortait dès que online/cover_opened étaient connus :
  // le premier relevé était donc figé pour toute la session. Ouvrir le capot
  // ne changeait rien, « Actualiser » non plus — `fastprinter.printerdata`
  // n'est pas dans DIAGNOSTIC_EVENTS (il exige type/address/name, il ne peut
  // pas être une requête sans argument). Or FastPrinter ne pousse AUCUN
  // événement sur changement d'état : re-sonder est la seule façon de voir
  // capot, papier et liaison bouger.
  useEffect(() => {
    // `name` EST obligatoire, en plus de type/address.
    //
    // Mesuré sur la caisse, dans le journal de WPT : sondée sans nom, la
    // requête revient `registered: false` et sans état exploitable — WPT ne
    // sait pas à quelle imprimante configurée la rattacher.
    //
    //   => printerdata({type, address, name})   <= registered:true,  online:true, cover_opened:false
    //   => printerdata({address, encoding, …})  <= registered:false  (inexploitable)
    //
    // Or `defaultPrinter` se rabat sur la réponse de `defaultprinterdata`,
    // qui ne porte PAS de nom, tant que `fastprinter.printers` n'a pas
    // répondu — les deux partent au même cycle. Les deux sondes partaient
    // donc, et la mauvaise réponse écrasait la bonne dans `byEvent`.
    // Sans nom : on attend la liste plutôt que de sonder pour rien.
    if (!defaultPrinter?.type || !defaultPrinter.name) return;
    onAction("fastprinter.printerdata", {
      type: defaultPrinter.type,
      address: defaultPrinter.address,
      name: defaultPrinter.name,
    });
    // Dépendances : le cycle de refresh, et l'IDENTITÉ de l'imprimante en
    // primitives — `defaultPrinter` est un objet re-créé à chaque réponse
    // WPT, s'en servir relancerait la sonde sur sa propre réponse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reloadTick,
    defaultPrinter?.type,
    defaultPrinter?.address,
    defaultPrinter?.name,
  ]);

  // Sous-titre : poste · serial (depuis wpt.infos).
  const subtitle = useMemo(() => {
    const i = wpt.infos || {};
    const host = i.hostname || i.host || null;
    const serial = i.hardwareserial || i.serial || null;
    return [host, serial].filter(Boolean).join("  ·  ");
  }, [wpt.infos]);

  const cards = useMemo<ICard[]>(() => {
    const plugins = wpt.plugins || [];
    const findPlugin = (key: string) =>
      plugins.find((p) => norm(p?.name || "") === norm(key));

    // Clés à afficher, dédupliquées par clé normalisée : celles suivies en
    // live (pluginState, clés de la config) + les 3 principales toujours +
    // les optionnelles (lights, linedisplay, barcode opos) si le plugin est
    // présent côté WPT.
    const keyByNorm = new Map<string, string>();
    Object.keys(pluginState || {}).forEach((k) => keyByNorm.set(norm(k), k));
    ["fastprinter", "universalterminal"].forEach((k) => {
      if (!keyByNorm.has(k)) keyByNorm.set(k, k);
    });
    OPTIONAL_PLUGIN_KEYS.forEach((k) => {
      if (!keyByNorm.has(k) && findPlugin(k)) keyByNorm.set(k, k);
    });

    // Cartes pour lesquelles « plugin chargé » ne vaut PAS « périphérique en
    // ordre de marche » : on exige des données du device, sinon "unknown".
    //
    // Uniquement l'imprimante, et c'est délibéré. Le repli « plugin activé =>
    // vert » lui faisait afficher « Connectée » capot ouvert, alors que
    // `fastprinter.printerdata` sait dire l'inverse.
    //
    // L'afficheur client en est EXCLU : le launcher n'a aucune source d'état
    // pour lui (le plugin pousse `linedisplay.geometry` / `.list` à la
    // connexion socket, que le launcher n'écoute pas). L'y mettre le figeait
    // en gris pour toujours — moins informatif que l'imparfait « plugin
    // chargé », alors que le test d'affichage, lui, prouve qu'il fonctionne.
    //
    // Les lights n'en ont pas besoin : leur branche calcule déjà le statut à
    // partir des devices réels (`lights.devices`).
    const DEVICE_KEYS = ["fastprinter"];

    const statusOf = (key: string): TStatus => {
      const s = pluginState?.[key]?.status;
      if (s === "online" || s === "offline" || s === "initializing") return s;
      const pl = findPlugin(key);
      if (pl) {
        if (!pl.enabled) return "offline";
        return DEVICE_KEYS.includes(key) ? "unknown" : "online";
      }
      return "unknown";
    };

    return Array.from(keyByNorm.entries()).map(([nk, key]) => {
      const meta = metaFor(key);
      let status = statusOf(key);
      const rows: IRow[] = [];
      let footer: string | undefined;
      let action: ICard["action"];
      const pl = findPlugin(key);
      if (pl?.version) footer = `v${pl.version}`;

      if (nk === "fastprinter") {
        const d = printerLive;
        // L'imprimante a cessé de répondre à la requête d'état.
        //
        // Mesuré sur la caisse : capot ouvert, le plugin part en
        // `Error: no_response` (timeout ESC/POS) et n'émet AUCUN
        // `printerdata.error` vers le client. La requête expire côté
        // launcher, et sans cette prise en compte le dashboard gardait la
        // dernière réponse valide — « Connecté », en vert, capot ouvert.
        //
        // La CAUSE du silence (capot, papier, câble) n'est pas discernable
        // d'ici — d'où le rappel en pied de carte plutôt qu'un diagnostic
        // inventé. Mais le fait, lui, est certain : elle est hors ligne.
        const muette = byError["fastprinter.printerdata"];

        // Bool helpers → row {value, state}. undefined → "—" (muted) : les
        // rangées vitales (en ligne/papier/capot/tiroir) sont TOUJOURS
        // affichées pour que l'opérateur voie ce qui manque.
        // Un timeout DIT que l'imprimante n'est plus en ligne : c'est une
        // réponse, pas une absence de réponse. Un tiret serait un aveu
        // d'ignorance alors qu'on sait. Les modèles qui répondent, eux,
        // donnent leur état précis (capot, papier) et il est affiché tel quel.
        const onlineKnown = typeof d?.online === "boolean";
        rows.push({
          label: "En ligne",
          value: muette ? "Non" : onlineKnown ? (d.online ? "Oui" : "Non") : "—",
          state: muette ? "bad" : onlineKnown ? (d.online ? "ok" : "bad") : "muted",
        });
        const paperKnown = typeof d?.paper?.end === "boolean";
        rows.push({
          label: "Papier",
          value: paperKnown ? (d.paper.end ? "Épuisé" : "OK") : "—",
          state: paperKnown ? (d.paper.end ? "bad" : "ok") : "muted",
        });
        const coverKnown = typeof d?.cover_opened === "boolean";
        rows.push({
          label: "Capot",
          value: coverKnown ? (d.cover_opened ? "Ouvert" : "Fermé") : "—",
          state: coverKnown ? (d.cover_opened ? "warn" : "ok") : "muted",
        });
        const drawerKnown =
          d?.cashdrawer === "opened" || d?.cashdrawer === "closed";
        rows.push({
          label: "Tiroir",
          value: drawerKnown
            ? d.cashdrawer === "opened"
              ? "Ouvert"
              : "Fermé"
            : "—",
          state: drawerKnown
            ? d.cashdrawer === "opened"
              ? "warn"
              : "ok"
            : "muted",
        });
        if (d?.type)
          rows.push({
            label: "Liaison",
            value: `${TYPE_LABEL[d.type] || d.type}${
              d.address ? ` · ${d.address}` : ""
            }`,
          });
        if (d?.maxlinesize)
          rows.push({ label: "Largeur", value: `${d.maxlinesize} car./ligne` });
        if (d?.name) footer = [d.name, footer].filter(Boolean).join("  ·  ");

        // Statut card : reflète le device réel quand on le connaît.
        //
        // Capot ouvert ou papier épuisé => PAS vert. L'imprimante répond
        // encore (`online: true`), mais elle n'imprimera pas : afficher
        // « Connecté » en vert pendant que WPT la donne hors service est un
        // mensonge, et c'est précisément ce qu'on voyait en ouvrant le capot.
        if (muette) {
          rows.push({
            label: "État",
            value: "Ne répond plus",
            state: "bad",
          });
          footer = [
            "Vérifier le capot, le papier et le câble.",
            footer,
          ]
            .filter(Boolean)
            .join("  ·  ");
        }

        // Sans réponse `printerdata`, le statut reste "unknown" : on ne sait
        // pas, et on le dit. Le device n'est jamais présumé en ligne.
        if (muette) {
          status = "offline";
        } else if (onlineKnown) {
          const empeche =
            (coverKnown && d.cover_opened) || (paperKnown && d.paper.end);
          status = !d.online
            ? d.detected
              ? "initializing"
              : "offline"
            : empeche
            ? "degraded"
            : "online";
        }

        action = {
          label: "Test impression",
          onClick: () =>
            onAction("fastprinter.printtext", {
              text:
                "*** TEST IMPRESSION ***\n" +
                "WyndPosTools - Electron Launcher\n" +
                new Date().toLocaleString() +
                "\n\n\n",
              allprinters: true,
            }),
        };
      } else if (nk === "universalterminal") {
        const plugin = byEvent["universalterminal.plugin"];
        const init = byEvent["universalterminal.isinitialized"];
        if (plugin?.name) rows.push({ label: "Plugin", value: plugin.name });
        const initKnown = typeof init === "boolean";
        rows.push({
          label: "Initialisé",
          value: initKnown ? (init ? "Oui" : "Non") : "—",
          state: initKnown ? (init ? "ok" : "bad") : "muted",
        });
        if (initKnown && status === "unknown")
          status = init ? "online" : "offline";
      } else if (nk === "linedisplay") {
        // Test visuel : affiche 2 lignes sur l'afficheur client. Pas de
        // réponse socket en succès → vérification sur le device physique.
        // Les deux lignes DOIVENT tenir dans la géométrie de l'afficheur,
        // sinon WPT rejette avec LINE_TOO_LONG (cf TEST_LINE1).
        action = {
          label: "Test affichage",
          onClick: () =>
            onAction("linedisplay.print", {
              line1: TEST_LINE1,
              line2: hhmmss(new Date()),
            }),
        };
      } else if (nk === "lights") {
        // Statut basé sur les devices RÉELS (lights.devices, REST via main) —
        // plugin activé ≠ une light branchée et connectée.
        const devs = byEvent["lights.devices"];
        const isConn = (d: any) =>
          d?.connected === true ||
          d?.isConnected === true ||
          d?.status === "connected";
        if (Array.isArray(devs)) {
          const connected = devs.filter(isConn);
          rows.push({
            label: "Périphériques",
            value: String(devs.length),
            state: devs.length > 0 ? undefined : "muted",
          });
          if (devs.length === 0) {
            status = "offline";
            rows.push({
              label: "État",
              value: "Aucune light",
              state: "muted",
            });
          } else {
            rows.push({
              label: "Connectées",
              value: `${connected.length}/${devs.length}`,
              state: connected.length > 0 ? "ok" : "bad",
            });
            status = connected.length > 0 ? "online" : "offline";
            const names = devs
              .map((d: any) => d?.name)
              .filter(Boolean)
              .join(", ");
            if (names) rows.push({ label: "Noms", value: names });
          }
          // Test seulement s'il y a au moins un device.
          if (devs.length > 0) {
            action = {
              label: "Test lights",
              onClick: () => onAction("lights.test"),
            };
          }
        } else {
          // Liste pas encore reçue → on ne sur-promet pas.
          status = "unknown";
        }
      }

      return {
        key,
        label: meta.label,
        icon: meta.icon,
        status,
        category: meta.category,
        rows,
        footer,
        action,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnostics, pluginState, wpt.plugins, printerLive]);

  // 1er fetch en cours : WPT connecté mais aucune donnée encore reçue.
  const loading =
    wpt.connect &&
    diagnostics.lastUpdate === null &&
    (wpt.plugins?.length ?? 0) === 0;

  const renderCard = (c: ICard) => {
    const sm = STATUS_META[c.status];
    return (
      <div key={c.key} className={`diag-card ${sm.cls}`}>
        <div className="diag-card-head">
          <div className={`diag-card-icon ${sm.cls}`}>{c.icon}</div>
          <div className="diag-card-headtext">
            <div className="diag-card-name">{c.label}</div>
            <div className="diag-cat">{c.category}</div>
          </div>
          <span className={`diag-pill ${sm.cls}`}>
            <i className="dot" />
            {sm.label}
          </span>
        </div>
        {c.rows.length > 0 && (
          <div className="diag-rows">
            {c.rows.map((r) => (
              <div key={`${c.key}-${r.label}`} className="diag-row">
                <span className="diag-row-label">{r.label}</span>
                <span className={`diag-row-value ${r.state || ""}`}>
                  {r.state && r.state !== "muted" && <i className="dot" />}
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        )}
        {(c.action || c.footer) && (
          <div className="diag-card-foot">
            {c.action && (
              <button
                type="button"
                className="diag-card-action"
                onClick={c.action.onClick}
              >
                {c.action.label}
              </button>
            )}
            {c.footer && <span className="diag-card-footer">{c.footer}</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    // Clic sur le fond (hors header/cards) → ferme le panneau (retour caisse).
    <div id="e-launcher-diagnostics" onClick={onClose} role="presentation">
      <div
        className="diag-header"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="diag-title-block">
          <div className="diag-title">
            <span>Périphériques</span>
            <span className={`diag-conn ${wpt.connect ? "online" : "offline"}`}>
              <i className="dot" />
              {wpt.connect ? "WPT connecté" : "WPT déconnecté"}
            </span>
          </div>
          {subtitle && <div className="diag-subtitle">{subtitle}</div>}
        </div>
        <div className="diag-actions">
          <span className="diag-clock">{fmtTime(now)}</span>
          <button type="button" className="diag-reload" onClick={onReload}>
            <ReloadOutlined /> Actualiser
          </button>
          <button type="button" className="diag-close" onClick={onClose}>
            <CloseOutlined /> Retour caisse
          </button>
        </div>
      </div>

      <div
        className="diag-body"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        {loading ? (
          <div className="diag-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="diag-card skeleton">
                <div className="diag-card-head">
                  <div className="diag-card-icon" />
                  <div className="diag-card-headtext">
                    <div className="sk sk-name" />
                    <div className="sk sk-pill" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="diag-empty">
            {wpt.connect
              ? "Aucun plugin détecté."
              : "WyndPosTools non connecté."}
          </div>
        ) : (
          <div className="diag-grid">{cards.map(renderCard)}</div>
        )}
      </div>
    </div>
  );
};

export default DiagnosticsDashboard;
