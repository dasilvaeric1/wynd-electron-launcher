const fs = require("fs").promises
const ini = require('ini')
const {extname} = require('path')
const CustomError = require("../../../helpers/custom_error")
const defaultConfig = require("./default_config")
const set_config = require("./set_config")

module.exports =  function getConfig(path, raw, fallbackUrl) {

	return fs.lstat(path).then((stats) => {
		if (!stats.isFile()) {
			return Promise.reject(new CustomError(400, CustomError.CODE.INVALID_$$_PATH, `invalid config path (${path})`, ["CONFIG"]))
		}
		if (extname(path) !== '.ini') {
			return Promise.reject(new CustomError(400, CustomError.CODE.INVALID_$$_PATH, `invalid config path. Required .ini file (${path})`, ["CONFIG"]))
		}
		return fs.readFile(path).then((data) => {
			return raw === 'buffer' ? data : raw === 'string' ? data.toString() : ini.parse(data.toString())
		})

	})
	.catch((err) => {
		if (err.code === "ENOENT") {
			const url = fallbackUrl || null
			const default_config = {
				url: url,
				wpt: {
					enable: false,
				},
				menu: {
					enable: true,
				},
				emergency: {
					enable: false,
				},
				update: {
					enable: false,
				},
				http: {
					enable: false,
				},
				report: {
					enable: false,
				},
				central: {
					enable: false,
				},
				display_plugin_state: {
					enable: false,
				},
			}
			defaultConfig(default_config)
			const data = ini.stringify(default_config)
			return set_config(path, data).then(() => {
				if (!url) {
					const message = `Default config file generated. Set correct values in\r\r config path: ${path}`
					const ce = new CustomError(400, CustomError.CODE.INVALID_PARAMETER_VALUE, message, ["config"])
					throw ce
				}
				// Config generated with fallback URL — continue with it
				return default_config
			})
		}
		throw err

	})
}
