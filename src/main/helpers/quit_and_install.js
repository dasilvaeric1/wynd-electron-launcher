const autoUpdater = require("./auto_updater")

const wait = require("./wait")

module.exports = (callback) => {

		if (callback) {
			callback("update_quit")
		}

		return wait(500).then(() => {
			autoUpdater.quitAndInstall()
			return true
		})
}
