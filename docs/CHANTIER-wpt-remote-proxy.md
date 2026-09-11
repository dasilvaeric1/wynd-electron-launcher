# Chantier — Accès distant à l'UI WyndPosTools (reverse proxy par tunnel)

> **Statut : EN PAUSE** (mis de côté le 2026-06-10). Spec figée, prête à
> reprendre. Cible launcher **2.6.0**.

## 1. Objectif

Permettre à un opérateur du BO d'ouvrir **l'interface de configuration
WyndPosTools d'une caisse dans son propre navigateur**, sans prise en main
d'écran (le caissier continue d'encaisser pendant ce temps).

Aujourd'hui : configurer WPT = demander une session écran → on monopolise
l'écran de la caisse. Cible : un onglet « Config WPT » qui proxifie
`127.0.0.1:9963` de la caisse jusqu'au navigateur BO.

**Indépendant de la prise en main à distance** (autre canal, autre bouton).

## 2. Contrainte réseau (rappel)

La caisse n'a **que des connexions sortantes** — aucun port exposé. Tout doit
passer par un tunnel **initié par le launcher** vers l'API Railway, comme le
fait déjà la session écran.

```
Navigateur BO ──HTTPS──> API Railway ──WS tunnel (sortant caisse)──> Launcher ──fetch──> 127.0.0.1:9963
   GET /api/wpt-proxy/<serial>/lights/public/index.html
```

`127.0.0.1:9963` est en HTTP **ou** HTTPS auto-signé selon l'install. Côté
launcher c'est transparent : on réutilise `conf.wpt.url.href`.

> **TLS / auto-signé** — le fetch vise **uniquement le loopback**
> (`127.0.0.1`), donc pas de surface MITM réseau. Mais ne pas désactiver la
> vérif globalement (`NODE_TLS_REJECT_UNAUTHORIZED`). Préférer, par ordre :
>
> 1. lire le cert auto-signé local et l'ajouter en `ca:` d'un `Agent`
>    dédié au fetch (le `cacert.pem` est déjà embarqué dans le scaffold,
>    cf. `make_deploy_zip.sh`),
> 2. à défaut, un `https.Agent({rejectUnauthorized:false})` **scopé à ce
>    seul fetch loopback** (jamais global), et documenté comme tel.
> La socket.io WPT actuelle fait déjà un fetch local équivalent — s'aligner
> sur sa config, pas l'élargir.

## 3. Réutilisation de l'existant

Le pattern tunnel est **déjà en place** pour la session écran — on le décline :

| Brique existante | Fichier | Réutilisé pour |
|---|---|---|
| WS sortante launcher→API + ticket single-use | `src/main/screen_session.js` (l.527-551, `WebSocketImpl`, `/stream?ticket=`) | Modèle du tunnel proxy |
| Relay + grantTicket côté API | `api/src/.../screenSessionRelay` (cf. `routes/screen-sessions.ts` l.512-593) | Modèle du relay proxy |
| Presence launcher (online + version) | `api/src/services/launcher-presence.ts` | Gating du bouton (offline → désactivé) |
| fetch local vers WPT (auto-signé) | socket.io client WPT (`store.wpt`) | Le launcher sait déjà parler à 9963 |

## 4. Découpage file-by-file

### 4.1 Launcher (`/Users/ericdasilva/electron-launcher/wynd-electron-launcher`)

**Nouveau — `src/main/helpers/wpt_proxy_tunnel.js`**
- Sur commande « ouvrir tunnel WPT » (reçue via le poll `/pending` ou un
  canal de commande dédié — voir 4.2), ouvre une WS sortante vers
  `${cfg.baseUrl}/api/wpt-proxy/<serial>/tunnel?ticket=…` (ticket fetché
  comme pour la session écran).
- Boucle de relais : reçoit sur la WS des messages
  `{reqId, method, path, headers, body(base64)}` → fait
  `fetch(`${wptBase}${path}`, {method, headers, body})` avec
  `rejectUnauthorized:false` → renvoie
  `{reqId, status, headers, body(base64)}`.
- `wptBase` = `store.wpt.url.href` (déjà connu), fallback
  `http://127.0.0.1:9963`.
- Timeout par requête (5s), cap taille body (ex. 8 MB), TTL de tunnel
  (auto-close après N min d'inactivité — éviter un tunnel zombie).
- **Sécurité** : whitelister les préfixes de path autorisés
  (`/lights`, `/fastprinter`, `/universalterminal`, assets `/public`,
  `/socket.io`) — ne pas exposer aveuglément tout 9963.

**`src/main/screen_session.js`** (ou un nouveau `command_poll.js`)
- Étendre le retour du poll `/pending` pour porter aussi un éventuel ordre
  `openWptTunnel: {id}` → déclenche `wpt_proxy_tunnel.open(cfg, id)`.
  (Alternative plus propre : un endpoint commande séparé, mais le poll
  existe déjà → moindre surface.)

**`package.json`** — bump `2.6.0`. `ws` est déjà dépendance (l.216). `fetch`
natif (Node 22 via Electron 42) — rien à ajouter.

> Note : `@fastify/http-proxy` est déjà embarqué (`create_http.js`) mais sert
> le proxy **local** container→iframe ; le tunnel distant est un autre canal,
> ne pas confondre.

### 4.2 API (`/Users/ericdasilva/dashboard decathlon/api`)

**Nouveau — `src/services/wpt-proxy-relay.ts`**
- Registre des tunnels actifs `Map<serial, WS launcher>`.
- `grantTunnelTicket(serial, clientId)` single-use 30s (calqué sur
  `screenSessionRelay.grantTicket`).
- `proxyRequest(serial, {method, path, headers, body})` :
  - si pas de tunnel ouvert pour ce serial → renvoie 502 « caisse non
    connectée au proxy » (le BO affichera « lancer le tunnel »),
  - sinon génère un `reqId`, push sur la WS launcher, attend la réponse
    (timeout 6s), résout.

**Nouveau — `src/routes/wpt-proxy.ts`** (monté sous `/api/wpt-proxy`)
- `POST /:serial/open` (auth JWT + `resolveClientForUser`) → vérifie la
  caisse appartient au client, émet l'ordre `openWptTunnel` (via le canal
  poll ou un push) + renvoie un ticket BO.
- `GET /:serial/tunnel?ticket=` (upgrade WS, auth par ticket) → c'est le
  **launcher** qui s'y connecte ; enregistre la WS dans le relay.
- `ALL /:serial/*` (auth JWT) → `proxyRequest(...)` et renvoie tel quel
  (status/headers/body). **Routage des assets en chemin absolu** : les UIs
  de plugins WPT chargent `/lights/public/app.js` etc. → router par
  `Referer` pour réécrire vers `/api/wpt-proxy/<serial>/…` (hack proxy
  classique ; sinon réécrire le HTML à la volée).
- **socket.io de l'UI WPT** : forcer le transport long-polling à travers le
  proxy (le WS-natif de l'UI ne traversera pas proprement le double saut au
  début) — acceptable pour des écrans de config.

**`src/server.ts`** — `app.use('/api/wpt-proxy', wptProxyRouter)` + gérer
l'upgrade WS de `/:serial/tunnel` (à côté du handler upgrade existant des
sessions écran, l. ~165-224).

**`src/services/launcher-presence.ts`** — rien d'obligatoire ; éventuellement
exposer `tunnelOpen: boolean` si on veut l'afficher.

### 4.3 BO (`/Users/ericdasilva/dashboard decathlon/frontend`)

**`src/hooks/api/useWptProxy.ts`** (nouveau)
- `useOpenWptTunnel(clientSlug, serial)` → `POST /open`, renvoie l'URL base
  proxy.

**`src/components/caisses/CaisseDetail.tsx`**
- Dans la carte **« Launcher & périphériques »** (déjà en place), ajouter un
  bouton **« Config WPT »** (icône `SlidersHorizontal`/`Settings`), grisé si
  `launcherPresence.data?.online !== true`.
- Au clic : `open` → ouvre
  `${API_URL}/api/wpt-proxy/<serial>/lights/public/index.html` (ou la home
  WPT) dans un nouvel onglet, OU un `<iframe>` plein écran dans un Dialog.

## 5. Étapes recommandées (incrémental)

1. **MVP read-only** : tunnel + relay + une seule page de statut WPT servie
   en lecture (valide le double saut et l'auto-signé). Pas de write.
2. **Assets + navigation** : routage Referer / réécriture HTML pour que l'UI
   complète d'un plugin charge.
3. **Write / socket.io long-polling** : config réelle depuis le BO.
4. **Durcissement** : whitelist de paths, TTL tunnel, quotas, audit log
   (qui a ouvert le tunnel de quelle caisse, quand).

## 6. Risques / points ouverts

- **socket.io UI WPT** : temps réel via long-polling seulement au début.
- **Assets chemin absolu** : le point le plus pénible (Referer-routing) — à
  prototyper en premier sur l'UI lights.
- **Sécurité** : un tunnel = accès HTTP arbitraire au 9963 d'une caisse ⇒
  whitelist stricte + auth JWT + ticket + audit obligatoires avant prod.
- **Charge** : 1 WS launcher de plus par caisse *seulement quand un tunnel
  est ouvert* (pas permanent) — négligeable.

## 7. Estimation

~3 fichiers launcher (1 nouveau + 1 modifié + bump) · 2 fichiers API
(relay + route) + server.ts · 2 fichiers BO (hook + bouton). MVP read-only
faisable en 1 itération ; UI complète write = 2-3 itérations avec le
Referer-routing.
