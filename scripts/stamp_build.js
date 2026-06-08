// Génère src/main/build_info.json avec un identifiant de build UNIQUE
// (version + date + sha git), à l'image du service C# RetailScheduler.
// Lancé avant electron-builder (cf scripts build:* + CI). Permet de savoir
// EXACTEMENT quel build tourne sur une caisse — affiché dans le tray et
// remonté au BO via le heartbeat screen-session.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')

let commit = 'nogit'
try {
	commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
		cwd: path.join(__dirname, '..'),
	})
		.toString()
		.trim()
} catch {
	/* pas de git (zip détaché) → nogit */
}

const builtAt = new Date().toISOString()
const date = builtAt.slice(0, 10).replace(/-/g, '')
const full = `${pkg.version}+${date}.${commit}`

const info = { version: pkg.version, commit, builtAt, full }
const outPath = path.join(__dirname, '..', 'src', 'main', 'build_info.json')
fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n')
console.log(`[stamp] ${full} -> ${outPath}`)
