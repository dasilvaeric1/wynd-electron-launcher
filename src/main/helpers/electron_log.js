const { join } = require('node:path')
const { transports, createLogger, format } = require('winston');
require('winston-daily-rotate-file');

const { app } = require('electron')

// N'importe quel objet peut etre passe au logger : un throw ici ferait tomber
// tout le pipeline de journalisation, pas seulement la ligne fautive.
function safeMessage(message) {
	if (typeof message !== "object" || message === null) return message
	try {
		return JSON.stringify(message)
	} catch (err) {
		return `[message non serialisable: ${err.message}]`
	}
}

const mainTransport = new transports.DailyRotateFile({
	dirname: join(app.getPath('userData'), 'logs', 'main'),
	filename: '%DATE%.log',
	datePattern: 'YYYY-MM-DD',
	zippedArchive: true,
	maxSize: '20m',
	format: format.combine(
		format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
		format.printf(info => `[${info.timestamp}] [${info.level}] ${safeMessage(info.message)}`)
	),
});

mainTransport.on('rotate', function (oldFilename, newFilename) {
	// do something fun
});

const logger = createLogger({
	level: "info",
	transports: [
		new transports.Console({
			format: format.combine(
				format.colorize(),
				format.printf(info => `MAIN >>> [${info.level}] ${info.message}`)
			)
		}),
		mainTransport
	]
});

module.exports = logger
