jest.mock('../../src/main/helpers/electron_log', () => ({
	error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(),
}))

const fs = require('fs')
const os = require('os')
const path = require('path')
const JSZip = require('jszip')

const {
	buildReportMeta, buildIncidentZip, tailFile, latestLogFile, MAX_COMMENT,
} = require('../../src/main/helpers/incident_report')

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0)

const store = (over = {}) => ({
	infos: {
		version: '2.8.8',
		os: { platform: 'win32', version: '10.0.19045' },
		stack: { electron: '42.4.0' },
	},
	conf: { title: 'Caisse 04', view: 'webview', url: { href: 'https://pos.example/' }, wpt: { enable: true } },
	wpt: { connect: true, version: '3.1.0', plugins: [{ name: 'fastprinter', enabled: true }] },
	logs: {},
	...over,
})

describe('buildReportMeta (fonction pure)', () => {
	it('rassemble ce que le support demanderait de toute facon', () => {
		const m = buildReportMeta(store(), 'Le tiroir ne s ouvre plus', NOW)
		expect(m).toMatchObject({
			kind: 'incident',
			comment: 'Le tiroir ne s ouvre plus',
			launcherVersion: '2.8.8',
			platform: 'win32',
			title: 'Caisse 04',
			view: 'webview',
		})
		expect(m.wpt).toEqual({
			enabled: true, connected: true, version: '3.1.0',
			plugins: [{ name: 'fastprinter', enabled: true }],
		})
		expect(m.reportedAt).toBe('2026-09-13T12:00:00.000Z')
	})

	it('borne le commentaire et retire les espaces', () => {
		const m = buildReportMeta(store(), '  ' + 'x'.repeat(MAX_COMMENT + 500) + '  ', NOW)
		expect(m.comment.length).toBeLessThanOrEqual(MAX_COMMENT)
	})

	it('tolere un commentaire absent ou non textuel', () => {
		expect(buildReportMeta(store(), undefined, NOW).comment).toBe('')
		expect(buildReportMeta(store(), 42, NOW).comment).toBe('')
	})

	it('ne jette pas sur un store vide', () => {
		expect(() => buildReportMeta({}, 'x', NOW)).not.toThrow()
		expect(buildReportMeta({}, 'x', NOW).kind).toBe('incident')
	})
})

describe('lecture des logs', () => {
	let dir
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-'))
	})
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	it('ne garde que la queue du fichier', () => {
		const f = path.join(dir, 'a.log')
		fs.writeFileSync(f, 'DEBUT' + 'z'.repeat(1000) + 'FIN')
		const tail = tailFile(f, 100)
		expect(tail).toHaveLength(100)
		expect(tail.endsWith('FIN')).toBe(true)
	})

	it('renvoie null plutot que de jeter sur un fichier absent', () => {
		expect(tailFile(path.join(dir, 'nexiste.pas'), 100)).toBeNull()
		expect(latestLogFile(path.join(dir, 'nexiste-pas'))).toBeNull()
	})

	it('choisit le fichier de log le plus recent', () => {
		fs.writeFileSync(path.join(dir, 'vieux.log'), 'a')
		fs.writeFileSync(path.join(dir, 'recent.log'), 'b')
		const old = new Date(Date.now() - 86_400_000)
		fs.utimesSync(path.join(dir, 'vieux.log'), old, old)
		expect(path.basename(latestLogFile(dir))).toBe('recent.log')
	})
})

describe('buildIncidentZip', () => {
	let dir
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-zip-'))
		fs.writeFileSync(path.join(dir, '2026-09-13.log'), 'ligne de log')
	})
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	it('contient report.json et la queue des journaux', async () => {
		const { buf } = await buildIncidentZip(store({ logs: { main: dir } }), 'tiroir bloque', NOW)
		const zip = await JSZip.loadAsync(buf)
		expect(Object.keys(zip.files).sort()).toEqual(['logs/', 'logs/main.log', 'report.json'])
		const report = JSON.parse(await zip.file('report.json').async('string'))
		expect(report.comment).toBe('tiroir bloque')
		expect(await zip.file('logs/main.log').async('string')).toBe('ligne de log')
	})

	it('reste valide meme sans aucun journal disponible', async () => {
		const { buf } = await buildIncidentZip(store({ logs: {} }), 'sans logs', NOW)
		const zip = await JSZip.loadAsync(buf)
		expect(Object.keys(zip.files)).toEqual(['report.json'])
	})
})
