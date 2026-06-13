import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Build renderer (Vite) — remplace l'ancien webpack.
 *
 * On build UN renderer à la fois (container | loader) via la variable
 * d'env RENDERER, pour produire une sortie isolée :
 *   src/<name>/dist/index.js + src/<name>/dist/index.css
 * avec des NOMS FIXES, car `src/<name>/assets/index.html` (écrit à la main,
 * inchangé) les référence en relatif (`../dist/index.js`, `../dist/index.css`).
 *
 * Contraintes de chargement (préservées) :
 *  - mode fichier : le main fait loadURL(file://…/assets/index.html) → `base: './'`
 *    + assets inlinés (pas de chemins file:// fragiles).
 *  - mode HTTP / raw : servis par fastify static depuis src/<name>/ → idem relatif.
 */
const RENDERER = process.env.RENDERER === 'loader' ? 'loader' : 'container'

export default defineConfig({
	root: '.',
	base: './',
	plugins: [react()],
	resolve: {
		alias: [
			// Imports LESS/CSS façon webpack (`@import '~pkg/...'`) → strip le `~`
			// pour que Vite résolve depuis node_modules.
			{ find: /^~/, replacement: '' },
			// react-antd-cssvars déclare un champ `module` (dist/index.esm.js) qui
			// n'existe pas → Vite échoue. On pointe le CJS réel (match EXACT du
			// specifier nu, pour ne pas réécrire les sous-chemins .less).
			{
				find: /^react-antd-cssvars$/,
				replacement: 'react-antd-cssvars/dist/index.cjs.js',
			},
		],
	},
	css: {
		preprocessorOptions: {
			// antd 4 utilise du JS inline dans ses .less (mixins) — comme l'ancien
			// less-loader (lessOptions.javascriptEnabled).
			less: { javascriptEnabled: true },
		},
	},
	define: {
		// socket.io-client@2.4 et quelques vieilles libs attendent `global`.
		global: 'globalThis',
		'process.env.NODE_ENV': JSON.stringify(
			process.env.NODE_ENV || 'production',
		),
		'process.env.EL_DEBUG': JSON.stringify(process.env.EL_DEBUG || ''),
		'process.env.DEV': JSON.stringify(process.env.DEV || ''),
		'process.env.DEBUG_PROD': JSON.stringify(process.env.DEBUG_PROD || ''),
	},
	build: {
		outDir: `src/${RENDERER}/dist`,
		emptyOutDir: true,
		target: 'es2020', // Electron 42 = Chromium récent
		cssCodeSplit: false, // un seul index.css par renderer
		sourcemap: true,
		// Inline polices/icônes/petites images (réplique url-loader limit:10000) →
		// un seul index.js + index.css, aucun chemin d'asset à résoudre en file://.
		assetsInlineLimit: 1024 * 1024,
		rollupOptions: {
			input: `src/${RENDERER}/index.tsx`,
			output: {
				entryFileNames: 'index.js',
				chunkFileNames: 'index.js',
				assetFileNames: 'index.[ext]',
				inlineDynamicImports: true, // force un bundle unique
			},
		},
	},
})
