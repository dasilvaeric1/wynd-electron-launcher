import React, { useEffect, useRef, useState } from 'react'

import { TNextAction } from '../store/actions'
import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

/** Cadence de rafraichissement tant que le panneau est ouvert. */
const REFRESH_MS = 30000

type TEtat = 'running' | 'failed' | 'ok'

interface ITache {
	name: string
	description: string
	etat: TEtat
	lastRunUtc: string | null
	nextRunUtc: string | null
}

interface IRunResult {
	name: string
	ok: boolean
	reason?: string
	message?: string
}

export interface ISchedulerTasksProps {
	onRun: (action: TNextAction, ...data: any) => void
}

const RAISONS: Record<string, string> = {
	NOT_ENROLLED: 'Caisse non rattachée',
	UNAUTHORIZED: 'Refusé par le planificateur',
	UNREACHABLE: 'Planificateur injoignable',
	FAILED: 'La tâche a échoué',
}

/** « il y a 12 min », « à 23:05 » — rien de plus verbeux sur une caisse. */
function quand(tache: ITache): string {
	if (tache.etat === 'running') {
		return 'en cours…'
	}
	if (tache.etat === 'failed' && tache.lastRunUtc) {
		const minutes = Math.max(0, Math.round((Date.now() - Date.parse(tache.lastRunUtc)) / 60000))
		if (minutes < 60) {
			return `échec il y a ${minutes} min`
		}
		return `échec il y a ${Math.floor(minutes / 60)} h`
	}
	if (tache.nextRunUtc) {
		const d = new Date(tache.nextRunUtc)
		return `prochaine à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
	}
	return ''
}

const GLYPHE: Record<TEtat, string> = { running: '⟳', failed: '✗', ok: '✓' }

/**
 * Taches planifiees du RetailScheduler, vue caissier.
 *
 * Volontairement pauvre : ce qui tourne, ce qui vient d'echouer, la prochaine
 * echeance. Ni historique, ni compteurs, ni cron — le service a deja une UI
 * complete pour ca. Rien ne s'affiche si le service est absent.
 */
const SchedulerTasks = ({ onRun }: ISchedulerTasksProps) => {
	const [taches, setTaches] = useState<ITache[] | null>(null)
	const [resultat, setResultat] = useState<IRunResult | null>(null)
	const timer = useRef<ReturnType<typeof setInterval> | null>(null)

	useEffect(() => {
		window.electronAPI.on('scheduler.tasks', (next: ITache[] | null) => setTaches(next))
		window.electronAPI.on('scheduler.run.result', (next: IRunResult) => setResultat(next))

		const refresh = () => window.electronAPI.send('scheduler.refresh')
		refresh()
		timer.current = setInterval(refresh, REFRESH_MS)

		return () => {
			if (timer.current) {
				clearInterval(timer.current)
			}
			window.electronAPI.removeAllListeners('scheduler.tasks')
			window.electronAPI.removeAllListeners('scheduler.run.result')
		}
	}, [])

	// Service absent ou rien a montrer : on n'occupe pas le panneau pour rien.
	if (!taches || taches.length === 0) {
		return null
	}

	const enCours = taches.filter((t) => t.etat === 'running').length

	return (
		<div className="e-launcher-scheduler">
			<div className="sched-head">
				<span className="lbl">Tâches planifiées</span>
				{enCours > 0 ? <span className="val">{enCours} en cours</span> : null}
			</div>

			<ul className="sched-list">
				{taches.map((tache) => (
					<li key={tache.name} className={`sched-row ${tache.etat}`}>
						<span className="ico" aria-hidden="true">
							{GLYPHE[tache.etat]}
						</span>
						<span className="nom" title={tache.description || tache.name}>
							{tache.description || tache.name}
						</span>
						<span className="quand">{quand(tache)}</span>
						{tache.etat !== 'running' ? (
							<button
								type="button"
								className="sched-run"
								onClick={() => {
									setResultat(null)
									onRun(TNextAction.SCHEDULER_RUN, tache.name)
								}}
							>
								Lancer
							</button>
						) : null}
					</li>
				))}
			</ul>

			{resultat && !resultat.ok ? (
				<div className="sched-error" role="alert">
					{RAISONS[resultat.reason || ''] || resultat.message || 'Lancement impossible.'}
				</div>
			) : null}
		</div>
	)
}

export default SchedulerTasks
