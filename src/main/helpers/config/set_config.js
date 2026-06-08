const fs = require("fs").promises
const path = require("path")

module.exports =  function setConfig(filePath, data) {
	const dir = path.dirname(filePath)
	return fs.mkdir(dir, { recursive: true }).then(() => {
		return fs.writeFile(filePath, data)
	})
}
