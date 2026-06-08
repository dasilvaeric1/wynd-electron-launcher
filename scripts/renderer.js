const pm2 = require('pm2');

const package = require('../package.json')
const processName = package.pm2.process[1].name
function startReact() {

	// Collect extra CLI args (e.g. --url https://...) to forward to electron main process
	const extraArgs = process.argv.slice(2).join(' ')

	return new Promise((resolve, reject) => {
		pm2.connect(false, function(err) {
			if (err) {
				return reject(err)
			}
			pm2.delete(processName, (errDelete) => {
				// eslint-disable-next-line no-console
				errDelete && console.error(`${processName}`, errDelete.message)
				pm2.start({
					name: processName,
					wait_ready: true,
					args: [ 'serve', '--config',  "./configs/webpack.config.renderer.dev.js"],
					script: "./node_modules/webpack/bin/webpack.js",
					watch: false,
					env: {
						"NODE_ENV": "development",
						"NODE_OPTIONS": "--openssl-legacy-provider",
						"START_MAIN": process.env.START_MAIN || "",
						"EL_EXTRA_ARGS": extraArgs || "",
					},
				}, function(err, apps) {
					// eslint-disable-next-line no-console
					if (err) console.error(err)
					if (err) return reject(err)
					pm2.disconnect();   // Disconnects from PM2
					resolve(apps)
				});
			})
		})
	})
}
module.exports = startReact

if (require.main === module) {

	startReact()
	.catch((err) => {
		process.exit(1)
	})
}
