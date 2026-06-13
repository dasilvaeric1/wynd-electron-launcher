# Migration — Vite + pnpm + Node 20 + TS 5

Branche : `chore/modernize-vite-pnpm`. Objectif : moderniser la chaîne de build
**sans toucher au process main** (proven, non bundlé) et **en préservant le
contrat de chargement des renderers** (3 modes : fichier / HTTP local / raw).

## Cartographie actuelle (constatée)

- **2 renderers** : `container` (`src/container/index.tsx`) + `loader`
  (`src/loader/index.tsx`).
- **Build webpack** (`configs/webpack.config.*.js`) → sortie
  `src/<name>/dist/index.js` + `src/<name>/dist/index.css`.
- **HTML écrit à la main** : `src/<name>/assets/index.html` référence
  `../dist/index.js` et `../dist/index.css` (relatif).
- **Main** (`src/main/index.js`, JS brut **non bundlé**, packagé tel quel par
  electron-builder via `build.files`) charge les renderers de 3 façons
  (`src/main/initcallback.js`) :
  1. **fichier** : `loadURL(file://…/src/<name>/assets/index.html)`
  2. **HTTP local** : fastify static (`create_http.js`) sert
     `localhost:<port>/container/index.html`
  3. **raw** : `localhost:<port>/index.html`
- `build.files` whiteliste `src/<name>/dist` + `src/<name>/assets` → **doit
  rester valide**.

## Principe de migration (faible risque)

**Vite remplace UNIQUEMENT le bundling renderer**, en émettant **exactement les
mêmes fichiers au même endroit** (`src/<name>/dist/index.{js,css}`). Donc :
- les `assets/index.html` restent **inchangés** ;
- les 3 modes de chargement restent **inchangés** ;
- `build.files` reste **inchangé** ;
- le **main n'est pas touché** (pas d'electron-vite, pas de bundling main).

→ La surface de risque se limite au contenu des bundles renderer, pas au
câblage. C'est validable par build CI + un test caisse ciblé.

## Étapes

### 1. Package manager → pnpm
- `package.json` : `"packageManager": "pnpm@9.x"`, `"engines": { "node": ">=20" }`.
- Supprimer `package-lock.json` (npm, parasite) et l'éventuel yarn.
- `pnpm install` → **committer `pnpm-lock.yaml`** (fin du build non reproductible).

### 2. Build renderer → Vite
- Nouveau `vite.config.ts` : 2 entrées buildées séparément (`RENDERER=container|loader`),
  `base: './'`, sortie `src/<name>/dist`, noms fixes `index.js` / `index.css`,
  `cssCodeSplit:false`, `inlineDynamicImports:true`, `assetsInlineLimit` élevé
  (réplique `url-loader limit:10000` → polices/icônes inlinées, pas de chemins
  d'assets à gérer en file://).
- `define` : `process.env.NODE_ENV`, `EL_DEBUG`, `DEV`, `DEBUG_PROD`, et
  `global: 'globalThis'` (⚠️ socket.io-client@2.4 peut en dépendre — à vérifier).
- Script `dist` : `cross-env RENDERER=container vite build && cross-env RENDERER=loader vite build`.
- Supprimer : `configs/webpack.*.js`, la DLL, `scripts/renderer.js`/`main.js`
  (dev webpack), et les deps webpack/babel/loaders/dev-server/refresh.

### 3. TypeScript 5
- `typescript@5`, `tsconfig` : `moduleResolution: "bundler"`, `jsx: "react-jsx"`
  (drop `import React`), `target: "ES2020"`, `types: ["vite/client"]`.
- `@types/*` à jour, retirer `@types/electron` (electron fournit ses types).

### 4. CI (`.gitlab-ci.yml`)
- Image `node:20`. `corepack enable && corepack prepare pnpm@9 --activate`.
- `pnpm install --frozen-lockfile` (1er run : `--no-frozen-lockfile` puis committer le lock).
- `dist` : `pnpm dist` (vite). Retirer le flag `--openssl-legacy-provider`
  (Vite n'en a pas besoin).
- `build:win` : reste sur l'image wine, `pnpm` au lieu de `yarn`.

## Risques connus (à valider)

| Risque | Détail | Mitigation |
|---|---|---|
| Polyfills node | socket.io-client@2.4, anciennes libs → `global`/`process` | `define global`, sinon `vite-plugin-node-polyfills` |
| Nommage CSS | Vite nomme le CSS d'après le chunk | `assetFileNames` forcé → `index.css` (à vérifier au build) |
| `target: es5` | Vite ne descend pas sous es2015 facilement | passer à ES2020 (Electron 42 = Chromium récent, OK) |
| antd 4 + styled-components 5 | gros, less | Vite gère `.less` nativement (`less` en dep) |
| Assets file:// | URLs relatives en mode fichier | `base:'./'` + inline élevé |

## ⛔ GATE de validation avant merge (obligatoire — non validable hors caisse)

- [ ] CI : `pnpm install` + `pnpm dist` produisent `src/<name>/dist/index.{js,css}`
- [ ] CI : `build:win` produit le portable + l'archive zip
- [ ] **Caisse** : POS s'affiche en mode **fichier** (container)
- [ ] **Caisse** : POS s'affiche en mode **HTTP** (`http.enable`)
- [ ] **Caisse** : mode **raw** OK
- [ ] **Caisse** : loader s'affiche
- [ ] **Caisse** : visu (capture écran + réseau), tunnel WPT, `update electron` OK
- [ ] Comparer taille/perf bundle vs webpack (régression ?)

Tant que ce gate n'est pas vert sur une caisse, **ne pas merger dans `develop`**.
