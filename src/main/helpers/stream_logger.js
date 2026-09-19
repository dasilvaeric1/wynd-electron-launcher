const Stream = require("node:stream")
const autoUpdater = require("./auto_updater")

class StreamLogger extends Stream.Duplex {
  constructor(log) {
    super();
		// log.level = process.env.EL_DEBUG ? 'silly' : 'info'
		this.log = log
  }

  // Cote lisible : alimente par `push()` depuis emitMessages, pas par une
  // production a la demande. Un `_read` vide est l'idiome attendu dans ce cas
  // — l'implementer est obligatoire, produire ici ne l'est pas.
  _read() {}

  // Cote ecrivable : personne n'ecrit dans ce flux aujourd'hui (electron-updater
  // appelle .info()/.debug(), jamais .write()). Mais un `_write` qui n'appelle
  // pas son callback bloque le flux des la premiere ecriture : la contre-
  // pression n'est jamais relachee et tout write suivant s'empile. On acquitte
  // donc, au lieu de laisser la mine amorcee.
  _write(chunk, encoding, next) {
    next();
  }

  emitMessages(level, messages) {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      let payload
      try {
        payload = JSON.stringify({level, message})
      } catch (err) {
        // Message non serialisable : on emet quand meme la ligne, degradee,
        // plutot que de casser le flux. Ce repli ne porte que des chaines,
        // il ne peut pas echouer a son tour.
        payload = JSON.stringify({level, message: `[non serialisable: ${err.message}]`})
      }
      const buf = Buffer.from(payload, "utf-8");
			this.push(buf)
    }
  }

  debug(...messages) {
		if (!this) {
			autoUpdater.logger.emitMessages("DEBUG", messages)
		} else {
			this.log.debug(...messages);
			this.emitMessages("DEBUG", messages);
		}
  }

  warn(...messages) {
		if (!this) {
			autoUpdater.logger.emitMessages('WARN', messages)
		} else {
			this.log.warn(...messages);
			this.emitMessages('WARN', messages);
		}
  }

  info(...messages) {
		if (!this) {
			autoUpdater.logger.emitMessages("INFO", messages)
		} else {
			this.log.info(...messages);
			this.emitMessages("INFO", messages);
		}
  }

	error(...messages) {
		if (!this) {
			autoUpdater.logger.emitMessages("ERROR", messages)
		} else {
			this.emitMessages("ERROR", messages);
			this.log.error(...messages);
		}
  }

};

module.exports = (log) => {
	const tmp = new StreamLogger(log)
	autoUpdater.logger = tmp
	return tmp
}

