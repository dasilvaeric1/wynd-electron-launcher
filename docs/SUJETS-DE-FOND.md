# Sujets de fond — wynd-electron-launcher

Backlog des chantiers structurants du launcher (hors features ponctuelles).
Établi par audit du repo. Sévérité : 🔴 critique · 🟠 important · 🟡 à planifier.

---

## A. Hygiène & process

### ✅ A1 — Assainir l'état git (FAIT — commit c73bd93)
Le travail non commité était en fait un corps cohérent (contextIsolation +
screen-session + reformat repo-wide), pas du WIP étranger. Committé en bloc.
Arbre propre.

### 🟠 A2 — CI incomplète
La CI build le portable x64 (ajouté) mais : pas de `lint`, pas de `test` en
pipeline, **pas de signature de code** (le `.exe` non signé déclenche
SmartScreen / "éditeur inconnu" sur les caisses).
→ **Action** : ajouter jobs lint + test ; évaluer un certificat de signature
(OV/EV) — impact direct sur l'install caisse.

### 🟡 A3 — Stratégie de branche / release
`develop` est la branche de travail, beaucoup de branches `feature/*`
distantes orphelines. Pas de convention de tag/release documentée.
→ **Action** : définir le flow (develop → tag → CI release) + nettoyer les
branches mortes.

---

## B. Sécurité (prioritaire : POS en production)

### 🔴 B1 — Electron 21 est en fin de vie
Electron 21 (Chromium 106) n'a plus de patchs de sécurité depuis fin 2023.
Sur des caisses qui chargent une URL POS distante, c'est une exposition aux
CVE Chromium non corrigées.
→ **Action** : planifier la montée vers une version Electron supportée
(28+). Gros chantier (API breaking, rebuild natifs, nut.js, electron-builder
24+) mais structurant.

### ✅ B2 — Gardes de navigation (FAIT)
`helpers/harden_web_contents.js` : `setWindowOpenHandler` (deny + openExternal
des liens http(s)), `will-attach-webview` (force nodeIntegration:false /
contextIsolation:true + check src), `will-navigate` (log par défaut, bloque
si `EL_STRICT_NAV=1`). Câblé dans index.js avant createWindows.

### ✅ B3 — Whitelist IPC (FAIT — dans le commit c73bd93)
Les preloads container + loader exposent désormais des whitelists explicites
`SEND_CHANNELS` / `RECEIVE_CHANNELS` via contextBridge (`electronAPI`), fini
le passthrough générique.

### 🟠 B4 — Pas de CSP sur le contenu rendu
Le webview/iframe charge le POS sans Content-Security-Policy ni contrôle des
popups.
→ **Action** : définir une CSP, contrôler `allowpopups`.

### 🟡 B5 — Secrets en clair
api-key + base URL lus depuis `appsettings.json` (en clair), creds Cloudflare
TURN poussés au launcher. Les creds TURN ont transité en clair pendant le
dev → **à rotationner**.
→ **Action** : rotation TURN ; réfléchir au stockage des secrets caisse.

### 🟡 B6 — Screen-session auto-accept par défaut
Depuis ce cycle : consentement caissier désactivé + indicateur masqué par
défaut (RMM non surveillé, choix assumé). Exposition RGPD/droit du travail à
tracer (charte, signalétique = responsabilité opérateur).
→ **Action** : documenter la décision + le périmètre légal côté déploiement.

---

## C. Qualité / tests / archi

### 🟠 C1 — `screen_session.js` : monolithe non testé
1363 lignes dans un seul fichier : capture, injection input, hit-testing,
WebRTC, reconnexion, présence, consent, indicateur. Zéro test.
→ **Action** : découper en modules (`capture/`, `input/`, `signaling/`,
`presence/`) + tests unitaires sur les parties pures (mapping coords,
hit-test, mapping clavier, backoff).

### 🟠 C2 — Couverture de test quasi nulle
Seuls `__tests__/config/{check,validate}.js` + `__tests__/log/` existent.
Rien sur le bootstrap, l'IPC, les fenêtres, le scheduler de capture.
→ **Action** : socle de tests sur les chemins critiques + CI test gate (cf A2).

### 🟡 C3 — Pipeline de dev fragile
Le dev sur macOS est cassé (bundle `target:web` + fallback `events`, DLL
`prepare`, `dist` manuel). Reproduire un env de dev propre est pénible.
→ **Action** : fiabiliser/documenter le `npm run start`, ou assumer le mode
`raw`/prod-bundle comme chemin de dev officiel.

---

## D. Robustesse runtime

### 🟠 D1 — Survie aux crashs renderer
Pas de handler `render-process-gone` / `unresponsive` / `crashed` visible →
si le webview POS plante, la caisse reste bloquée sans relance auto.
→ **Action** : watchdog renderer + reload auto + remontée central.

### 🟡 D2 — Reprise réseau au bootstrap
Le screen-session a un reconnect exponentiel, mais le bootstrap WPT/HTTP
(chargement initial du POS) — comportement si le réseau est down au boot ?
→ **Action** : retry/backoff au chargement initial, écran d'attente clair.

### 🟡 D3 — Logs
Rotation OK (winston daily). Manque : niveau configurable à chaud, et
remontée centralisée des erreurs (aujourd'hui local-only, accès via tray).
→ **Action** : évaluer une remontée d'erreurs (type Sentry/GlitchTip) côté
launcher.

---

## E. Screen-session (feature récente — à durcir)

### 🟠 E1 — WebRTC à valider à l'échelle
Fan-out multi-viewer + TURN Cloudflare fonctionnels en POC. À valider :
montée en charge (N viewers), bascule JPEG↔WebRTC, comportement TURN sous
NAT symétrique réel.
→ **Action** : tests de charge + métriques (fps, latence, bascule).

### 🟡 E2 — Input window vs webview
En mode `window`, les events n'atteignent pas toujours le DOM du webview
(limite Chromium guest view) ; le hit-test route au mieux. Comportement à
clarifier/documenter, ou converger vers le mode `screen` pour le contrôle.

### 🟡 E3 — Pas de quota de sessions
Aucune limite de sessions concurrentes / durée max imposée côté launcher
(seul le TTL central borne).
→ **Action** : garde-fou local (1 session active, durée plafond).

---

## Ordre recommandé

1. **A1** (git) — socle, débloque tout.
2. **B2 + B3** (gardes navigation + IPC whitelist) — sécurité rapide, fort impact.
3. **C1/C2** (split + tests screen-session) — avant d'empiler dessus.
4. **B1** (upgrade Electron) — gros chantier à planifier tôt (sécurité).
5. Le reste selon priorités produit.
