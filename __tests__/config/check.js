const path = require('path')
const checkConfig = require('../../src/main/helpers/config/check_config')

// Racine du depot, deduite de l'emplacement du test : les chemins attendus
// etaient codes en dur sur la machine d'origine.
const ROOT = path.join(__dirname, '..', '..')

let config = null
beforeAll(() => {

})

beforeEach(() => {
	config = null
})

describe("Validation config", () => {
	test('1_1: with url only', (done) => {
		config = {
			url: 'http://localhost:3000'
		}

		const expectedConfig =     {
      url: {
        href: 'http://localhost:3000/',
        host: 'localhost:3000',
        hostname: 'localhost',
        port: '3000',
        protocol: 'http:'
      },
			border: false,
			frame: false,
			full_screen: true,
			kiosk: true,
			raw: false,
      screen: 0,
      menu: { enable: true, phone_number: null, email: null, password: null, button_position: 0, button_size: 30},
      view: 'iframe',
      emergency: { enable: false },
      clear_cache_on_start: false,
      // Ecran client : inactif tant qu'aucune page n'est configuree.
      customer: { enable: false, url: null, screen: null, background: null },
      display_plugin_state: { enable: false },
      wpt: {
        enable: false,
        path: null,
        url: {
          href: 'http://localhost:9963/',
          host: 'localhost:9963',
          hostname: 'localhost',
          port: '9963',
          protocol: 'http:'
        },
        keep_listeners: false,
        detached: false,
        shell: false,
        cwd: null,
        connection_timeout: 10,
        creation_timeout: 30,
				password: null
      },
      central: { enable: false, mode: 'AUTO' },
      report: { enable: false },
      incident: { enable: false },
      proxy: { enable: false, url: null },
      http: { enable: false, port: null },
      update: { enable: false, on_start: false },
      zoom: { level: 1, factor: 0.99 },
      log: { main: 'info', renderer: 'info', app: 'info' },
      publish: {
        provider: 'github',
        owner: 'Wynd-Lab',
        repo: 'wynd-electron-launcher'
      }
    }

		try {
			checkConfig(config)
			expect(config).toEqual(expectedConfig)
			done()
		} catch (err) {
			done(err)
		}
	})

	test('1_2: url local with auto enable', (done) => {
		config = {
			url: null,
			screen: '1',
			wpt: {
				enable: '1',
				path: '/home/nekran/nodeJS/wyndpostools',
				url: 'http://localhost:9963/'
			},
			menu: {
				enable: '1',
				phone_number: '+33 (0)1.76.44.03.53',
				password: '1111'
			},
			update: {
				enable: '0',
				on_start: '0',
			},
			http: {
				enable: "1",
				port: "3000"
			},
			theme: {}

		}
		const expectedConfig = {
      url: {
        href: path.join(ROOT, 'src', 'local'),
        host: '',
        hostname: '',
        port: '',
        protocol: 'file'
      },
      screen: 1,
			border: false,
			frame: false,
			full_screen: true,
			kiosk: true,
			raw: false,
      wpt: {
        enable: true,
        path: '/home/nekran/nodeJS/wyndpostools',
        url: {
          href: 'http://localhost:9963/',
          host: 'localhost:9963',
          hostname: 'localhost',
          port: '9963',
          protocol: 'http:'
        },
        connection_timeout: 10,
        creation_timeout: 30,
        wait_on_ipc: false,
        keep_listeners: true,
        detached: false,
        shell: false,
        cwd: null,
				password: null
      },
      menu: {
        enable: true,
        phone_number: '+33 (0)1.76.44.03.53',
        password: '1111',
        logo: 'Logo.png'
      },
      update: { enable: false, on_start: false },
      http: {
        enable: true,
        port: 3000,
        static: {
          href: path.join(ROOT, 'src', 'local'),
          host: '',
          hostname: '',
          port: '',
          protocol: 'file'
        }
      },
      theme: {},
      view: 'iframe',
      emergency: { enable: false },
      clear_cache_on_start: false,
      // Ecran client : inactif tant qu'aucune page n'est configuree.
      customer: { enable: false, url: null, screen: null, background: null },
      display_plugin_state: { enable: false },
      central: { enable: false, mode: 'AUTO' },
      report: { enable: false },
      incident: { enable: false },
      proxy: { enable: false, url: null },
      zoom: { level: 1, factor: 0.99 },
      log: { main: 'info', renderer: 'info', app: 'info' },
      publish: {
        provider: 'github',
        owner: 'Wynd-Lab',
        repo: 'wynd-electron-launcher'
      }
    }

		try {
			checkConfig(config)
			expect(config).toEqual(expectedConfig)
			done()
		} catch (err) {
			done(err)
		}
	})

	// Regression : `must_exist` avec keep:false doit remettre a null les cles
	// dependantes quand enable=false. La boucle iterait sur metaData.keys.length
	// mais lisait metaData[i], donc elle posait une cle "undefined" et laissait
	// `url` intact : une URL de proxy explicitement desactivee restait alors
	// visible pour create_http. Les cas 1_1/1_2 ne pouvaient pas le voir, leur
	// proxy.url etant deja null.
	test('1_3: proxy desactive remet son url a null', (done) => {
		config = {
			url: 'http://localhost:3000',
			proxy: { enable: false, url: 'http://proxy.interne:8080' }
		}

		try {
			checkConfig(config)
			expect(config.proxy).toEqual({ enable: false, url: null })
			done()
		} catch (err) {
			done(err)
		}
	})

});
