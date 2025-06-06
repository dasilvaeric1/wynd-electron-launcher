const { app, globalShortcut } = require('electron')

const path = require('path')
const os = require('os')


let pm2 = app.isPackaged ? null : require("pm2")

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const package = require("../../package.json")

const getScreens = require("./helpers/get_screens")
const killWPT = require("./helpers/kill_wpt")
const chooseScreen = require('./helpers/choose_screen')
const getConfig = require("./helpers/config/get_config")
const log = require("./helpers/electron_log")
const showDialogError = require("./dialog_err")
const createAppLog = require("./helpers/create_app_log")
const configureProtocol = require("./helpers/register_file_protocol")
const nodeIpcConnect = require("./helpers/node_ipc")
const generateLoaderWindow = require('./loader_window')
const generateContainerWindow = require('./container_window')
const generateIpc = require('./ipc')
const generateInitCallback = require('./initcallback')
const innerGlobalShortcut = require("./global_shortcut")
const generateTray = require('./tray')
const CustomError = require('../helpers/custom_error')

require('./lock')
require('./helpers/stream_logger')(log)
// require('@electron/remote/main').initialize()


// contextMenu({});
// try {
// 	const Hooks = require(path.join(app.getPath("userData"), 'hooks'))

// 	const hooks = new Hooks()
// }
// catch(err) {
// }
const wpt = {
	process: null,
	version: null,
	pid: null,
	socket: null,
	infos: null,
	plugins: null,
	connect: false,
	datas: null,
	plugins_state: {}
}

const [ appLog, appLogPath ] = createAppLog(app)

const store = {
	infos: {
		name: app.getName(),
		version: app.getVersion(),
		user_path: app.getPath("userData"),
		stack: {
			electron: process.versions.electron,
			node: process.versions.node,
			os: os.release()
		},
		app_versions: null,
		os: {
			platform: process.platform,
			arch: os.arch(),
			version: os.release()
		},
		debug: !!process.env.EL_DEBUG,
		packaged: app.isPackaged,
	},

	wpt: wpt,
	central: {
		registered: false,
		registering: false,
		status: "DISCONNECTED",
		ready: false,
		pending_messages: []
	},
	conf: null,
	screens: [],
	ready: false,
	path: {
		conf: null
	},
	ask: {
		request: null,
		next_action: null
	},
	choosen_screen: null,
	windows: {
		container: {
			current: null,
			state: null
		},
		loader: {
			current: null,
			width: 300,
			height: 140
		}
	},
	pm2: {
		connected: false
	},
	http: null,
	finish: false,
	appLog: appLog,
	logs: {
		app: appLogPath,
		main: log._readableState.pipes[1].dirname
	},
	current_request: null,
}

if (process.env.NODE_ENV === "development") {
	process.env.APPIMAGE = path.join(__dirname, '..', '..', 'dist', `${app.name}-1.0.0.AppImage`)
}

const default_path = process.env.EL_CONFIG_PATH || (app.isPackaged ? path.resolve(store.infos.user_path, 'config.ini') : '../../config.ini')

if (process.env.EL_CONFIG_PATH) {
	log.info(`[CONFIG] EL_CONFIG_PATH env is set ${process.env.EL_CONFIG_PATH}`)
}

const argv = yargs(hideBin(process.argv))
	.option('config_path', {
		alias: 'c',
		type: 'string',
		description: 'set config path',
		default: default_path
	})
	.option('screen', {
		alias: 's',
		type: 'number',
		description: 'set screen',
		default: 0
	})
	// .option('hooks', {
	//   alias: 'h',
	//   type: 'string',
	//   description: 'set hooks file',
	// 	default: null
	// })
	.argv;

if (argv.config_path !== default_path) {
	log.info(`[CONFIG] --config_path set ${argv.config_path}`)
}

store.path.conf = path.isAbsolute(argv.config_path) ?
	argv.config_path :
	app.isPackaged ? path.resolve(path.dirname(process.execPath), argv.config_path) :
		path.resolve(__dirname, argv.config_path)


store.version = app.getVersion()

log.info(`[CONFIG] > path used ${store.path.conf}`)
log.info(`[LOG] > path used ${path.join(app.getPath('userData'), 'logs')}`)

const initCallback = generateInitCallback(store, log)

const createWindows = () => {
	log.debug(`[APP] > packaged: ${app.isPackaged, process.resourcesPath}`)

	store.choosen_screen = chooseScreen(argv.screen, store.screens)
	log.debug(`[APP] > Chosen screen: ${store.choosen_screen ? store.choosen_screen.id : 'null'}`)

	try {
		log.debug("[APP] > Creating container window...")
		store.windows.container.current = generateContainerWindow(store)
		log.debug("[APP] > Creating loader window...")
		store.windows.loader.current = generateLoaderWindow(store)
		log.debug("[APP] > Generating IPC...")
		generateIpc(store, initCallback)
		log.debug("[APP] > Windows created successfully")

	} catch (err) {
		log.error(`[APP] > Error creating windows: ${err.message}`)
		throw new CustomError(500, err.api_code || err.code || CustomError.CODE.GENERATE_WINDOWS, err.message)
	}
}

app.commandLine.appendSwitch("disable-http-cache");

app.on("will-quit", async (e) => {
	globalShortcut.unregisterAll()
	if (wpt.process && !wpt.process.killed) {
		try {
			await killWPT(wpt)
		}
		catch (err) {
			log.error(`[QUIT] > before-quit: ${err.message}`)
		}
	}
	if (wpt.socket) {
		wpt.socket.close()
		wpt.socket = null
	}
	if (store.http) {
		store.http.close()
		store.http = null
	}
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {

		if (pm2 && process.env.NODE_ENV === "development" && store.pm2.connected) {
			pm2.delete(package.pm2.process[0].name)
		}
		app.quit()
	}
})

if (process.env.EL_DISABLE_HDA && process.env.EL_DISABLE_HDA !== '0') {
	app.disableHardwareAcceleration()
	log.info('[HARDWARE] > Disable hardware accceleration')
}

getConfig(store.path.conf).then(conf => {
	store.conf = conf
	if (conf.commandline) {
		for (const commandName in conf.commandline) {
			const value = conf.commandline[commandName];
			app.commandLine.appendSwitch(commandName, value)
			log.info('[COMMANDLINE] > ' + commandName + ', ' + value)
		}
	}
})
	.catch((err) => {
		store.pre_error_init = err
	})
	.finally(() => {		app.whenReady()
			.then(() => {
				log.info("[INIT] > App is ready, starting initialization...")

				if (store.pre_error_init) {
					showDialogError(store, store.pre_error_init)
					throw store.pre_error_init
				}
				process.on("SIGINT", () => {
					log.info("[PROCESS] > SIGINT")
					app.quit()
				});

				process.on("SIGTERM", () => {
					log.info("[PROCESS] > SIGTERM")
					app.quit()
				});

			})		.then(() => {
			log.info("[INIT] > Connecting to PM2...")
			return new Promise((resolve, reject) => {
				if (pm2 && process.env.NODE_ENV === "development") {
					pm2.connect(true, (err) => {
						if (err) {
							return reject(err)
						}
						store.pm2.connected = true
						log.info("[INIT] > PM2 connected")
						resolve()
					})
				}
				else {
					log.info("[INIT] > PM2 skipped (not in development)")
					resolve()
				}
			})

		})
		.then(() => {
			log.info("[INIT] > Configuring protocol...")
			configureProtocol(store)
		})
		.then(() => {
			log.info("[INIT] > Setting up global shortcuts...")
			innerGlobalShortcut(store, log)
		})
		.then(() => {
			log.info("[INIT] > Getting screens...")
			store.screens = getScreens()
			log.info(`[INIT] > Found ${store.screens.length} screens`)
		})
		.then(() => {
			log.info("[INIT] > Creating windows...")
			return createWindows()
		})
		.then(() => {
			log.info("[INIT] > Connecting to Node IPC...")
			return nodeIpcConnect(store, initCallback, log)
		})
		.then(() => {
			log.info("[INIT] > Generating tray...")
			generateTray(store)
			log.info("[INIT] > Initialization complete!")
			return null
		})
		.catch((err) => {
			log.error(`[INIT] > Error during initialization: ${err.code ? `[${err.code}] ${err.message}` : err.message}`)
			log.error(err.stack)
		})

		app.on('activate', () => {
			if (store.windows.container.current === null) createWindows()
		})
	})
