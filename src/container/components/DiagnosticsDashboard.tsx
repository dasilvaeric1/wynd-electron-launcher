import React, { useEffect, useMemo, useState } from "react";
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
} from "@ant-design/icons";

import { IRootState, IDiagnostics, IWPT, TWPTPluginState } from "../interface";

// Events WPT requêtés au reload — réponses stockées dans le slice diagnostics.
// 'plugins' (instantané) peuple wpt.plugins → status fiable par plugin activé,
// indépendamment du scan matériel (lent/faillible) des requêtes device.
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
  // Émet une action WPT arbitraire (ex. test d'impression).
  onAction: (event: string, ...datas: any[]) => void;
}

type TStatus = "online" | "offline" | "initializing" | "unknown";

interface ICard {
  key: string;
  label: string;
  icon: React.ReactNode;
  status: TStatus;
  category: string;
  lines: string[];
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
};

const CATEGORY_ORDER = ["Encaissement", "Paiement", "Système", "Autres"];

const metaFor = (key: string) =>
  PLUGIN_META[key] || {
    label: key,
    icon: <ApiOutlined />,
    category: "Autres",
  };

const fmtTime = (ts: number | null) =>
  ts ? new Date(ts).toLocaleTimeString() : "—";

/**
 * Dashboard "Périphériques" affiché dans la zone principale quand le panneau
 * latéral est ouvert. Cards par plugin WPT regroupées par catégorie, avec
 * pastille d'icône, pill de statut et détails device. Données via wpt.plugins
 * (fiable) + slice diagnostics (réponses request_wpt) + pluginState live.
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

  // Sous-titre : poste · serial (depuis wpt.infos).
  const subtitle = useMemo(() => {
    const i = wpt.infos || {};
    const host = i.hostname || i.host || null;
    const serial = i.hardwareserial || i.serial || null;
    return [host, serial].filter(Boolean).join("  ·  ");
  }, [wpt.infos]);

  const cards = useMemo<ICard[]>(() => {
    const byEvent = diagnostics.byEvent || {};
    const plugins = wpt.plugins || [];
    const findPlugin = (key: string) =>
      plugins.find(
        (p) => (p?.name || "").toLowerCase().replace(/[^a-z]/g, "") === key
      );

    const keys = new Set<string>(Object.keys(pluginState || {}));
    ["fastprinter", "universalterminal", "central"].forEach((k) => keys.add(k));

    const statusOf = (key: string): TStatus => {
      const s = pluginState?.[key]?.status;
      if (s === "online" || s === "offline" || s === "initializing") return s;
      const pl = findPlugin(key);
      if (pl) return pl.enabled ? "online" : "offline";
      return "unknown";
    };

    return Array.from(keys).map((key) => {
      const meta = metaFor(key);
      let status = statusOf(key);
      const lines: string[] = [];
      let action: ICard["action"];
      const pl = findPlugin(key);
      if (pl?.version) lines.push(`v${pl.version}`);

      if (key === "fastprinter") {
        const cfg = byEvent["fastprinter.defaultprinterdata"]; // config
        const list = byEvent["fastprinter.printers"]; // Printer[] + status live
        // Imprimante par défaut : la registered, sinon la 1ère détectée.
        const def = Array.isArray(list)
          ? list.find((x: any) => x?.registered) ||
            list.find((x: any) => x?.detected) ||
            list[0]
          : null;
        const d = def || cfg; // fallback config si la liste n'a pas répondu
        if ((d || Array.isArray(list)) && status === "unknown")
          status = "online";

        const TYPE_LABEL: Record<string, string> = {
          usb: "USB",
          serial: "Série",
          network: "Réseau",
        };
        if (d) {
          if (d.name) lines.push(d.name);
          if (d.type) lines.push(`Liaison : ${TYPE_LABEL[d.type] || d.type}`);
          if (d.address) lines.push(`Adresse : ${d.address}`);
          if (typeof d.detected === "boolean")
            lines.push(d.detected ? "Détectée" : "⚠️ Non détectée");
          if (typeof d.online === "boolean") {
            lines.push(d.online ? "En ligne" : "Hors ligne");
            status = d.online
              ? "online"
              : d.detected
              ? "initializing"
              : "offline";
          }
          if (d.paper && typeof d.paper.end === "boolean")
            lines.push(d.paper.end ? "⚠️ Papier épuisé" : "Papier OK");
          if (typeof d.cover_opened === "boolean")
            lines.push(d.cover_opened ? "⚠️ Capot ouvert" : "Capot fermé");
          if (d.cashdrawer)
            lines.push(
              `Tiroir : ${d.cashdrawer === "opened" ? "ouvert" : "fermé"}`
            );
          if (d.maxlinesize) lines.push(`${d.maxlinesize} car./ligne`);
        }
        if (Array.isArray(list) && list.length > 1)
          lines.push(`${list.length} imprimantes configurées`);

        // Bouton test d'impression (fastprinter.printtext).
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
      } else if (key === "universalterminal") {
        const plugin = byEvent["universalterminal.plugin"];
        const init = byEvent["universalterminal.isinitialized"];
        if (plugin?.name) lines.push(`Paiement : ${plugin.name}`);
        if (typeof init === "boolean") {
          lines.push(init ? "TPE initialisé" : "TPE non initialisé");
          if (status === "unknown") status = init ? "online" : "offline";
        }
      } else if (key === "central") {
        const apps = byEvent["central.applications"];
        if (Array.isArray(apps)) lines.push(`${apps.length} application(s)`);
      }

      return {
        key,
        label: meta.label,
        icon: meta.icon,
        status,
        category: meta.category,
        lines,
        action,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnostics, pluginState, wpt.plugins]);

  // Regroupement par catégorie (ordre fixe, catégories vides ignorées).
  const groups = useMemo(() => {
    const m = new Map<string, ICard[]>();
    for (const c of cards) {
      const arr = m.get(c.category);
      if (arr) arr.push(c);
      else m.set(c.category, [c]);
    }
    return CATEGORY_ORDER.filter((cat) => m.has(cat)).map((cat) => ({
      cat,
      items: (m.get(cat) as ICard[]).sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    }));
  }, [cards]);

  // 1er fetch en cours : WPT connecté mais aucune donnée encore reçue.
  const loading =
    wpt.connect &&
    diagnostics.lastUpdate === null &&
    (wpt.plugins?.length ?? 0) === 0;

  const renderCard = (c: ICard) => {
    const sm = STATUS_META[c.status];
    return (
      <div key={c.key} className={`diag-card ${sm.cls}`}>
        <div className={`diag-card-icon ${sm.cls}`}>{c.icon}</div>
        <div className="diag-card-name">{c.label}</div>
        <span className={`diag-pill ${sm.cls}`}>
          <i className="dot" />
          {sm.label}
        </span>
        {c.lines.length > 0 && (
          <ul className="diag-card-lines">
            {c.lines.map((l, i) => (
              <li key={`${c.key}-${i}`}>{l}</li>
            ))}
          </ul>
        )}
        {c.action && (
          <button
            type="button"
            className="diag-card-action"
            onClick={c.action.onClick}
          >
            {c.action.label}
          </button>
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
                <div className="diag-card-icon" />
                <div className="sk sk-name" />
                <div className="sk sk-pill" />
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
          groups.map((g) => (
            <section key={g.cat} className="diag-section">
              <h3 className="diag-section-title">{g.cat}</h3>
              <div className="diag-grid">{g.items.map(renderCard)}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default DiagnosticsDashboard;
