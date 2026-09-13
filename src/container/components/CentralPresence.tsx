import React, { useEffect, useState } from 'react'

import { useSelector } from 'react-redux'

import { IRootState, IWPT } from '../interface'
import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

type TPresenceLevel = 'off' | 'ok' | 'warn' | 'down'

interface IPresence {
	level: TPresenceLevel
	lastContactAt: number | null
	secondsSince: number | null
}

/**
 * Etat des deux liaisons de la caisse : peripheriques (WPT) et dashboard
 * central. Le signal central existait deja — screen_session.js bat toutes les
 * 5 s sur /api/screen-sessions/pending — mais n'etait jamais remonte a
 * l'ecran : un magasin ne pouvait pas savoir que sa caisse avait cesse de
 * remonter au siege avant que le siege ne le lui dise.
 */
function ago(seconds: number | null): string {
	if (seconds === null) {
		return 'jamais'
	}
	if (seconds < 60) {
		return `il y a ${seconds} s`
	}
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) {
		return `il y a ${minutes} min`
	}
	return `il y a ${Math.floor(minutes / 60)} h`
}

const CentralPresence = () => {
	const wpt = useSelector<IRootState, IWPT>((state) => state.wpt)
	const [presence, setPresence] = useState<IPresence | null>(null)

	useEffect(() => {
		window.electronAPI.on('central.presence', (next: IPresence) => setPresence(next))
		return () => window.electronAPI.removeAllListeners('central.presence')
	}, [])

	const rows: Array<{ key: string; label: string; level: TPresenceLevel; value: string }> = [
		{
			key: 'wpt',
			label: 'Périphériques',
			level: wpt.connect ? 'ok' : 'down',
			value: wpt.connect ? 'connectés' : 'non connectés',
		},
	]

	// 'off' = caisse non enrolee : il n'y a rien a dire, on n'affiche pas une
	// ligne rouge qui inquieterait pour rien.
	if (presence && presence.level !== 'off') {
		rows.push({
			key: 'central',
			label: 'Dashboard central',
			level: presence.level,
			value: presence.level === 'down' ? 'hors ligne' : ago(presence.secondsSince),
		})
	}

	return (
		<div className="e-launcher-presence">
			{rows.map((row) => (
				<div key={row.key} className={`presence-row ${row.level}`}>
					<span className="led" aria-hidden="true" />
					<span className="lbl">{row.label}</span>
					<span className="val">{row.value}</span>
				</div>
			))}
		</div>
	)
}

export default CentralPresence
