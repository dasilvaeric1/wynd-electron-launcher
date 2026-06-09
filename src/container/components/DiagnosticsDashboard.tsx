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
}

type TStatus = "online" | "offline" | "initializing" | "unknown";

interface ICard {
  key: string;
  label: string;
  icon: React.ReactNode;
  status: TStatus;
  lines: string[];
}

const STATUS_META: Record<TStatus, { label: string; cls: string }> = {
  online: { label: "Connecté", cls: "online" },
  offline: { label: "Déconnecté", cls: "offline" },
  initializing: { label: "Initialisation…", cls: "initializing" },
  unknown: { label: "Inconnu", cls: "unknown" },
};

// Libellé + icône par clé de plugin connue (clé = celle de display_plugin_state).
const PLUGIN_META: Record<string, { label: string; icon: React.ReactNode }> = {
  fastprinter: { label: "Imprimante", icon: <PrinterOutlined /> },
  universalterminal: { label: "TPE / Paiement", icon: <CreditCardOutlined /> },
  central: { label: "Central", icon: <CloudServerOutlined /> },
  cashdrawer: { label: "Tiroir-caisse", icon: <InboxOutlined /> },
  rfidupos: { label: "Lecteur RFID", icon: <ScanOutlined /> },
  balance: { label: "Balance", icon: <WalletOutlined /> },
};

const metaFor = (key: string) =>
  PLUGIN_META[key] || { label: key, icon: <ApiOutlined /> };

const fmtTime = (ts: number | null) =>
  ts ? new Date(ts).toLocaleTimeString() : "—";

/**
 * Dashboard "Périphériques" affiché dans la zone principale quand le panneau
 * latéral est ouvert. Cards par plugin WPT avec statut (connecté / déconnecté
 * / init) + détails device (imprimante : papier/capot/tiroir ; TPE : plugin de
 * paiement + initialisé ; Central : nb applications). Données via le slice
 * diagnostics (réponses request_wpt) + pluginState live.
 */
const DiagnosticsDashboard: React.FunctionComponent<IDiagnosticsDashboardProps> = ({
  onReload,
  onClose,
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

  const cards = useMemo<ICard[]>(() => {
    const byEvent = diagnostics.byEvent || {};
    const plugins = wpt.plugins || [];
    // Cherche un plugin WPT par clé (insensible casse/séparateurs) :
    // 'fastprinter' → "FastPrinter", 'universalterminal' → "UniversalTerminal".
    const findPlugin = (key: string) =>
      plugins.find(
        (p) => (p?.name || "").toLowerCase().replace(/[^a-z]/g, "") === key
      );
    // Ensemble des clés : celles suivies en live (pluginState) + les
    // priorités (toujours montrées si WPT connecté).
    const keys = new Set<string>(Object.keys(pluginState || {}));
    ["fastprinter", "universalterminal", "central"].forEach((k) => keys.add(k));

    // Status : live pluginState en priorité, sinon plugin chargé/activé
    // (wpt.plugins) → ne dépend PAS de la requête matériel (lente/faillible).
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

      if (key === "fastprinter") {
        // defaultprinterdata = CONFIG (name, type, maxlinesize), pas le status
        // live. printers = liste configurée. Si l'un répond → imprimante
        // présente/fonctionnelle → 'online'. Les champs live (online/paper/
        // cover) ne sont affichés que si le driver les fournit réellement.
        const p = byEvent["fastprinter.defaultprinterdata"];
        const list = byEvent["fastprinter.printers"];
        const hasData = !!p || Array.isArray(list);
        if (hasData && status === "unknown") status = "online";
        if (p) {
          if (p.name || p.printerName)
            lines.push(`Défaut : ${p.name || p.printerName}`);
          if (typeof p.online === "boolean")
            lines.push(p.online ? "En ligne" : "Hors ligne");
          if (p.paper && typeof p.paper.end === "boolean")
            lines.push(p.paper.end ? "⚠️ Papier épuisé" : "Papier OK");
          if (typeof p.cover_opened === "boolean")
            lines.push(p.cover_opened ? "⚠️ Capot ouvert" : "Capot fermé");
          if (p.cashdrawer) lines.push(`Tiroir : ${p.cashdrawer}`);
        }
        if (Array.isArray(list)) {
          lines.push(`${list.length} imprimante(s)`);
          const names = list
            .map((x: any) => x?.name || x?.printerName)
            .filter(Boolean);
          if (names.length) lines.push(names.join(", "));
        }
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

      return { key, label: meta.label, icon: meta.icon, status, lines };
    });
  }, [diagnostics, pluginState, wpt.plugins]);

  return (
    // Clic sur le fond (hors header/cards) → ferme le panneau (retour caisse).
    <div id="e-launcher-diagnostics" onClick={onClose} role="presentation">
      <div
        className="diag-header"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="diag-title">
          <span>Périphériques</span>
          <span className={`diag-conn ${wpt.connect ? "online" : "offline"}`}>
            <i className="dot" />
            {wpt.connect ? "WPT connecté" : "WPT déconnecté"}
          </span>
        </div>
        <div className="diag-actions">
          <span className="diag-clock">{fmtTime(now)}</span>
          <span className="diag-update">
            MAJ : {fmtTime(diagnostics.lastUpdate)}
          </span>
          <button type="button" className="diag-reload" onClick={onReload}>
            <ReloadOutlined /> Actualiser
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="diag-empty">
          {wpt.connect ? "Aucun plugin détecté." : "WyndPosTools non connecté."}
        </div>
      ) : (
        <div
          className="diag-grid"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          {cards.map((c) => {
            const sm = STATUS_META[c.status];
            return (
              <div key={c.key} className={`diag-card ${sm.cls}`}>
                <div className="diag-card-icon">{c.icon}</div>
                <div className="diag-card-name">{c.label}</div>
                <div className={`diag-card-status ${sm.cls}`}>
                  <i className="dot" />
                  {sm.label}
                </div>
                {c.lines.length > 0 && (
                  <ul className="diag-card-lines">
                    {c.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DiagnosticsDashboard;
