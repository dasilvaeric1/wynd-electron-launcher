import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  PrinterOutlined,
  CreditCardOutlined,
  CloudServerOutlined,
  ScanOutlined,
  WalletOutlined,
  InboxOutlined,
  ApiOutlined,
  ReloadOutlined,
  BulbOutlined,
  BarcodeOutlined,
  DesktopOutlined,
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
  "central.applications",
];

export interface IDiagnosticsDashboardProps {
  // Déclenche les requêtes WPT (une par event de diagnostic).
  onReload: () => void;
  // Ferme le panneau (clic sur le fond du dashboard, hors cards/actions).
  onClose: () => void;
  // Émet une action WPT arbitraire (ex. test d'impression, printerdata).
  onAction: (event: string, ...datas: any[]) => void;
}

type TStatus = "online" | "offline" | "initializing" | "unknown";
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

const STATUS_META: Record<TStatus, { label: string; cls: string }> = {
  online: { label: "Connecté", cls: "online" },
  offline: { label: "Déconnecté", cls: "offline" },
  initializing: { label: "Initialisation", cls: "initializing" },
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
  central: {
    label: "Central",
    icon: <CloudServerOutlined />,
    category: "Système",
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
  useEffect(() => {
    onReload();
    const i = window.setInterval(() => onReload(), 30000);
    return () => window.clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byEvent = diagnostics.byEvent || {};

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

  // Si l'imprimante par défaut est connue mais que ses champs live (online/
  // cover/paper) manquent, interroge directement le device. Garde-fou : une
  // seule requête par cycle de refresh (lastUpdate).
  const printerProbeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!defaultPrinter || !defaultPrinter.type) return;
    const hasLive =
      typeof printerLive?.online === "boolean" &&
      typeof printerLive?.cover_opened === "boolean";
    if (hasLive) return;
    if (printerProbeRef.current === diagnostics.lastUpdate) return;
    printerProbeRef.current = diagnostics.lastUpdate;
    onAction("fastprinter.printerdata", {
      type: defaultPrinter.type,
      address: defaultPrinter.address,
      name: defaultPrinter.name,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPrinter, diagnostics.lastUpdate]);

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
    ["fastprinter", "universalterminal", "central"].forEach((k) => {
      if (!keyByNorm.has(k)) keyByNorm.set(k, k);
    });
    OPTIONAL_PLUGIN_KEYS.forEach((k) => {
      if (!keyByNorm.has(k) && findPlugin(k)) keyByNorm.set(k, k);
    });

    const statusOf = (key: string): TStatus => {
      const s = pluginState?.[key]?.status;
      if (s === "online" || s === "offline" || s === "initializing") return s;
      const pl = findPlugin(key);
      if (pl) return pl.enabled ? "online" : "offline";
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
        if (d && status === "unknown") status = "online";

        // Bool helpers → row {value, state}. undefined → "—" (muted) : les
        // rangées vitales (en ligne/papier/capot/tiroir) sont TOUJOURS
        // affichées pour que l'opérateur voie ce qui manque.
        const onlineKnown = typeof d?.online === "boolean";
        rows.push({
          label: "En ligne",
          value: onlineKnown ? (d.online ? "Oui" : "Non") : "—",
          state: onlineKnown ? (d.online ? "ok" : "bad") : "muted",
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
        if (onlineKnown)
          status = d.online
            ? "online"
            : d.detected
            ? "initializing"
            : "offline";

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
      } else if (nk === "central") {
        const apps = byEvent["central.applications"];
        if (Array.isArray(apps))
          rows.push({ label: "Applications", value: String(apps.length) });
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
