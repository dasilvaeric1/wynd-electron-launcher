import React, { useEffect, useMemo, useState } from "react";
import { Drawer, Layout } from "antd";
import { useSelector, useDispatch } from "react-redux";

import { TNextAction, openPinpadAction, setToggleMenu } from "./store/actions";
import Menu from "./components/Menu";
import Emergency from "./components/Emergency";
import PluginState from "./components/PluginState";
import { IConfig } from "./helpers/config";
import { ICustomWindow } from "../helpers/interface";
import {
  IAppInfo,
  IDisplay,
  ILoader,
  IMenu,
  IPinpad,
  IRootState,
  IWPT,
} from "./interface";
import PinPad from "./components/Pinpad";
import classNames from "classnames";
import ReportComponent from "./components/Report";
import LoaderComponent from "./components/Loader";
import Title from "./components/Title";
import DiagnosticsDashboard, {
  DIAGNOSTIC_EVENTS,
} from "./components/DiagnosticsDashboard";
import SchedulerDetail from "./components/SchedulerDetail";
import { useSchedulerTasks } from "./components/SchedulerTasks";
import CustomerDisplayDetail from "./components/CustomerDisplayDetail";
import { useCustomerDisplay } from "./components/CustomerDisplay";
// import { ICustomWindow } from '../helpers/interface'

export interface IAppProps {
  onCallback: (action: TNextAction, ...data: any) => void;
  sendChildAction: (action: string, ...data: any) => void;
}

interface IMyWindow extends ICustomWindow {
  __STATIC__: string;
}

declare let window: IMyWindow;

export interface IAppState {}

const App: React.FunctionComponent<IAppProps> = (props) => {
  const [urlApp, setUrlApp] = useState<string | null>(null);
  const [readyToDiplayApp, setReadyToDiplayApp] = useState<boolean | null>(
    false
  );

  const appInfo = useSelector<IRootState, IAppInfo>((state) => state.app);
  const menu = useSelector<IRootState, IMenu>((state) => state.menu);
  const wpt = useSelector<IRootState, IWPT>((state) => state.wpt);
  const display = useSelector<IRootState, IDisplay>((state) => state.display);
  const conf = useSelector<IRootState, IConfig | null>((state) => state.conf);
  const pinpad = useSelector<IRootState, IPinpad>((state) => state.pinpad);
  const loader = useSelector<IRootState, ILoader>(
    (state: IRootState) => state.loader
  );
  const dispatch = useDispatch();

  // Abonnement unique aux taches planifiees : la ligne du panneau et la modale
  // de detail lisent la meme source (cf useSchedulerTasks).
  const { taches, resultat, setResultat } = useSchedulerTasks();
  const [detailOpen, setDetailOpen] = useState(false);

  // Ecran client : le main pousse l'etat de lui-meme a chaque branchement.
  const ecranClient = useCustomerDisplay();
  const [ecransOpen, setEcransOpen] = useState(false);

  const displayPluginState = useMemo(() => {
    return conf ? conf.display_plugin_state.enable : false;
  }, [conf]);

  // Origine attendue des messages postés par le POS : celle de la page
  // réellement chargée dans l'iframe.
  //
  // Sans ce contrôle, `window.addEventListener("message")` accepte n'importe
  // quel émetteur — une frame tierce, ou une page vers laquelle le POS aurait
  // navigué — et le message est traité comme venant du POS. Or `receiveMessage`
  // ne se contente pas de journaliser : il déclenche aussi `central.register`.
  //
  // Une page `file://` poste avec l'origine littérale "null", pas avec son URL.
  const origineAttendue = useMemo(() => {
    if (!urlApp) return null;
    try {
      const u = new URL(urlApp, window.location.href);
      return u.protocol === "file:" ? "null" : u.origin;
    } catch {
      return null;
    }
  }, [urlApp]);
  useEffect(() => {
    if (conf) {
      let url = conf?.http.static
        ? `http://localhost:${conf.http.port}`
        : conf?.url.href;

      if (url && conf?.url.protocol === "file" && !url.endsWith(".html")) {
        if (!url.endsWith("/")) {
          url += "/";
        }
        url += "index.html";
      }
      if (url) {
        setUrlApp(url);
      }

      if (!conf.wpt.enable) {
        setReadyToDiplayApp(true);
      }
    }
  }, [conf]);

  useEffect(() => {
    if (wpt.connect && !readyToDiplayApp) {
      setReadyToDiplayApp(true);
    }
  }, [wpt, readyToDiplayApp]);

  // Quand on bascule sur une vue plein écran (WPT config, Report), on ferme le
  // panneau latéral : sinon le drawer (mask off) + le dashboard recouvraient
  // l'iframe WPT et la rendaient inutilisable.
  useEffect(() => {
    if (display.switch !== "CONTAINER" && menu.open) {
      dispatch(setToggleMenu(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.switch]);

  useEffect(() => {
    if (urlApp) {
      const iFrame = document.getElementById(
        "e-launcher-frame"
      ) as HTMLIFrameElement;
      if (iFrame) {
        iFrame.addEventListener("dom-ready", function () {
          const webview = iFrame as any;
          sendParent(webview);
        });
      }
      const view = conf?.view;

      if (iFrame && view) {
        if (iFrame.contentWindow) {
          iFrame.contentWindow.onerror = function onerror(err) {
            props.sendChildAction("log", "ERROR", err.toString());
            return false;
          };
        }
        if (view === "webview") {
          iFrame.addEventListener("ipc-message", receiveMessage);
        } else if (view === "iframe") {
          window.addEventListener("message", receiveMessage, false);
        }
      }
    }

    return () => {
      const iFrame = document.getElementById(
        "e-launcher-frame"
      ) as HTMLIFrameElement;
      if (iFrame) {
        iFrame.removeEventListener("ipc-message", receiveMessage);
      }
      window.removeEventListener("message", receiveMessage);
    };
  }, [urlApp]);

  const sendParent = (webview: any) => {
    const message = {
      type: "PARENT.AUTH",
      name: appInfo.name,
      version: appInfo.version,
    };
    if (conf?.view === "webview") {
      webview.send("parent.action", message);
    } else if (conf?.view === "iframe") {
      if (urlApp) {
        // Cibler l'origine reellement chargee dans l'iframe plutot que "*" : avec "*",
        // n'importe quelle page ayant remplace le contenu de l'iframe (redirection,
        // navigation interne) recevrait ce message. urlApp est la source de l'iframe,
        // donc son origine est exactement le destinataire attendu. On ne retombe sur "*"
        // que pour les schemas sans origine reelle (file://), ou l'URL ne donne pas de
        // cible exploitable et ou le contenu est de toute facon local.
        let targetOrigin = "*";
        try {
          const { origin } = new URL(urlApp);
          if (origin && origin !== "null") {
            targetOrigin = origin;
          }
        } catch (e) {
          // urlApp non parsable : on conserve le comportement precedent ("*").
          window.log?.debug(
            `[WINDOW CONTAINER] origine cible non deduite de urlApp: ${
              (e as Error).message
            }`,
          );
        }
        webview.contentWindow.postMessage(message, targetOrigin);
      }
    }
  };

  const receiveMessage = (event: any) => {
    // Les `ipc-message` viennent du webview que nous avons nous-mêmes créé :
    // le canal est déjà clos. Seuls les `message` postés au window doivent
    // prouver leur provenance.
    //
    // L'effet qui pose ce listener dépend de `urlApp`, donc l'origine capturée
    // ici correspond toujours à l'url effectivement chargée.
    if (event.type === "message" && origineAttendue !== null) {
      if (event.origin !== origineAttendue) {
        window.log?.debug(
          `[WINDOW CONTAINER] message ignoré, origine inattendue: ${event.origin}`,
        );
        return;
      }
    }

    let data: any = null;
    if (
      event.type === "message" &&
      event.data &&
      event.data &&
      typeof event.data === "string" &&
      event.data.startsWith("{")
    ) {
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        // Message poste par le POS : tout ce qui commence par "{" n'est pas
        // forcement du JSON. Trace dans le journal, pas sur la console.
        window.log?.debug(
          `[WINDOW CONTAINER] message POS non parsable: ${(e as Error).message}`,
        );
      }
    } else if (
      event.type === "ipc-message" &&
      event.channel === "app.action" &&
      event.args &&
      event.args.length > 0
    ) {
      if (typeof event.args[0] === "string") {
        try {
          data = JSON.parse(event.args[0]);
        } catch (e) {
          window.log?.debug(
            `[WINDOW CONTAINER] app.action non parsable: ${(e as Error).message}`,
          );
        }
      } else if (typeof event.args[0] === "object") {
        data = event.args[0];
      }
    }

    if (data?.type && typeof data.type === "string") {
      switch (data.type.toUpperCase()) {
        case "LOG":
          if (
            typeof data.payload === "string" &&
            (data.payload.startsWith("{") || data.payload.startsWith("["))
          ) {
            try {
              data.payload = JSON.parse(data.payload);
            } catch (err) {
              // Charge utile non-JSON : on la remonte telle quelle.
              window.log?.debug(
                `[WINDOW CONTAINER] log SCO non parsable: ${
                  (err as Error).message
                }`,
              );
            }
          }
          props.sendChildAction("log", data.level || "INFO", data.payload);
          break;
        case "CENTRAL.REGISTER":
          props.sendChildAction("central.register", data.payload);
          break;
        // case 'PARENT.WHO':
        // 	const containerApp = document.getElementById('e-launcher-frame') as HTMLIFrameElement | null

        // 	if (containerApp) {
        // 		const currentState = store.getState()

        // 		const message = {
        // 			name: 'electron-launcher',
        // 			type: 'PARENT.IS',
        // 			version: currentState.app.version,
        // 		}
        // 		containerApp.contentWindow?.postMessage(JSON.stringify(message), '*')
        // 	}
        // 	break
        default:
          break;
      }
    }
  };

  const onClose = () => {
    dispatch(setToggleMenu(false));
  };

  // Déclenche les requêtes WPT de diagnostic (une par event) → réponses
  // stockées dans le slice diagnostics, lues par le dashboard.
  const onDiagReload = () => {
    if (!conf?.wpt?.enable) return;
    DIAGNOSTIC_EVENTS.forEach((ev) =>
      props.onCallback(TNextAction.REQUEST_WPT, ev)
    );
  };

  const onClick = () => {
    if (!wpt.infos) {
      props.onCallback(TNextAction.REQUEST_WPT, "infos");
    }
    dispatch(setToggleMenu(true));
  };

  // Le detail des taches s'ouvre dans la fenetre courante ; tout le reste part
  // vers le main. Un seul point de passage, utilise aussi bien quand il n'y a
  // pas de code superviseur configure qu'apres un pinpad accepte.
  const executerAction = (action: TNextAction, ...data: any) => {
    if (action === TNextAction.SCHEDULER_DETAIL) {
      setResultat(null);
      setDetailOpen(true);
      return;
    }
    if (action === TNextAction.CUSTOMER_SCREENS) {
      setEcransOpen(true);
      return;
    }
    props.onCallback(action, ...data);
  };

  const onMenuClick = (action: TNextAction, ...data: any) => {
    switch (action) {
      case TNextAction.RELOAD:
      case TNextAction.CLOSE:
      case TNextAction.REQUEST_WPT:
      case TNextAction.WPT_STATUS:
      case TNextAction.REPORT:
      // Le declenchement manuel d'une tache planifiee passe par le meme
      // garde-fou que les autres actions sensibles du menu.
      case TNextAction.SCHEDULER_RUN:
      // Voir le detail des taches, et donc pouvoir les rejouer, est une action
      // d'exploitation : meme code superviseur que le reste du menu.
      case TNextAction.SCHEDULER_DETAIL:
      // Deplacer la page client change ce que voit le public : meme garde-fou.
      case TNextAction.CUSTOMER_SCREENS:
        if (
          conf &&
          conf.menu &&
          conf.menu.password &&
          display.switch === "CONTAINER"
        ) {
          dispatch(openPinpadAction(action, conf.menu.password, ...data));
        } else if (
          action === TNextAction.WPT_STATUS &&
          conf?.wpt.password &&
          display.switch !== "WPT"
        ) {
          dispatch(openPinpadAction(action, conf?.wpt.password, ...data));
        } else {
          executerAction(action, ...data);
        }
        break;

      default:
        executerAction(action, ...data);
        break;
    }
  };

  const onClickEmergency = () => {
    props.onCallback(TNextAction.EMERGENCY);
  };

  const onPinpadSuccess = () => {
    if (pinpad.nextAction) {
      executerAction(pinpad.nextAction, ...pinpad.datas);
    }
  };

  const onLoad = (e: any) => {
    sendParent(e.target);
  };

  const wyndposFrameCN = classNames("frame", {
    hide: display.switch !== "CONTAINER",
  });

  const menuButtonCN = classNames({
    hide: menu.open,
    dbg: conf?.debug,
  });
  const layoutCN = classNames({
    brd: conf?.border,
    dbg: conf?.debug,
  });

  return (
    <Layout id="e-launcher-layout" className={layoutCN}>
      {conf && conf.menu && conf.menu.enable && (
        <Drawer
          className="e-launcher-drawer"
          placement="left"
          closable={false}
          onClose={onClose}
          open={menu.open}
          width={340}
          // mask off : la zone à droite du panneau reste visible pour afficher
          // le dashboard "Périphériques" (pas de voile sombre par-dessus).
          mask={!conf?.wpt?.enable}
        >
          <Menu
            onMenuClick={onMenuClick}
            taches={taches}
            ecranClient={ecranClient}
          />
          {loader.active && <LoaderComponent />}
          {conf?.title && !conf.frame && <Title title={conf.title} />}
        </Drawer>
      )}
      {/* Dashboard "Périphériques" : occupe le reste de l'écran (à droite du
          panneau) quand le panneau est ouvert et WPT activé. */}
      {conf &&
        conf.menu &&
        conf.menu.enable &&
        conf.wpt &&
        conf.wpt.enable &&
        menu.open &&
        display.switch === "CONTAINER" && (
          <DiagnosticsDashboard
            onReload={onDiagReload}
            onClose={() => dispatch(setToggleMenu(false))}
            onAction={(ev, ...d) =>
              props.onCallback(TNextAction.REQUEST_WPT, ev, ...d)
            }
          />
        )}
      {readyToDiplayApp && urlApp && conf?.view === "webview" && (
        <webview
          title="wyndpos"
          id="e-launcher-frame"
          className={wyndposFrameCN}
          src={urlApp as string}
          preload={window.__STATIC__}
        ></webview>
      )}
      {readyToDiplayApp && urlApp && conf?.view === "iframe" && (
        <iframe
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          title="wyndpos"
          id="e-launcher-frame"
          className={wyndposFrameCN}
          src={urlApp as string}
          onLoad={onLoad}
        ></iframe>
      )}

      {conf &&
        conf.wpt &&
        conf.wpt.enable &&
        conf.wpt.url.href &&
        display.ready &&
        display.switch === "WPT" && (
          <iframe
            className="frame"
            title="wyndpostools"
            id="wpt-frame"
            src={conf.wpt.url.href}
          ></iframe>
        )}
      {conf &&
        conf.wpt &&
        conf.report &&
        conf.report.enable &&
        display.switch === "REPORT" && (
          <ReportComponent onCallback={props.onCallback} />
        )}
      {/* Bouton d'ouverture du menu Wynd. `role`/`tabIndex`/`onKeyDown` ne
          sont pas cosmétiques ici : le support distant pilote la caisse en
          injectant des événements clavier (cf screen_session), et un <div>
          nu n'est atteignable qu'aux coordonnées. */}
      <div
        id="el-menu-button"
        className={menuButtonCN}
        role="button"
        tabIndex={0}
        aria-label="Ouvrir le menu Wynd"
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      />
      {conf && conf.emergency.enable && menu.open && (
        <Emergency visible={menu.open} onClick={onClickEmergency} />
      )}
      {pinpad.code && <PinPad code={pinpad.code} onSuccess={onPinpadSuccess} />}
      <CustomerDisplayDetail
        open={ecransOpen}
        etat={ecranClient}
        onClose={() => setEcransOpen(false)}
      />
      <SchedulerDetail
        open={detailOpen}
        taches={taches}
        resultat={resultat}
        onClose={() => setDetailOpen(false)}
        // Le pinpad a deja ete franchi pour ouvrir cette modale : on part
        // directement vers le main, sans le redemander a chaque rejeu.
        onRun={(name) => {
          setResultat(null);
          props.onCallback(TNextAction.SCHEDULER_RUN, name);
        }}
      />
      {displayPluginState && menu.open && <PluginState />}
    </Layout>
  );
};

export default App;
