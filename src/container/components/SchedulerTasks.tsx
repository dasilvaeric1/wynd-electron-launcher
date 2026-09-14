import React, { useEffect, useRef, useState } from 'react'

import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

/** Cadence de rafraichissement tant que le panneau est ouvert. */
const REFRESH_MS = 30000

export type TEtat = 'running' | 'failed' | 'ok'

export interface ITache {
	name: string
	description: string
	etat: TEtat
	lastRunUtc: string | null
	nextRunUtc: string | null
}

export interface IRunResult {
	name: string
	ok: boolean
	reason?: string
	message?: string
}

/** Sante globale, dans l'ordre de gravite decroissante. */
export type TSante = 'bad' | 'warn' | 'ok'

export const RAISONS: Record<string, string> = {
	NOT_ENROLLED: 'Caisse non rattachée',
	UNAUTHORIZED: 'Refusé par le planificateur',
	UNREACHABLE: 'Planificateur injoignable',
	FAILED: 'La tâche a échoué',
}

/**
 * Abonnement unique aux evenements du planificateur.
 *
 * Monte une SEULE fois, au niveau de l'App : la ligne du panneau et la modale
 * de detail lisent la meme source. Deux montages concurrents se marcheraient
 * dessus — le demontage de l'un appelle `removeAllListeners` et couperait
 * l'autre.
 */
export function useSchedulerTasks() {
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

	return { taches, resultat, setResultat }
}

/** Rouge des qu'une tache est en echec, orange si quelque chose tourne. */
export function sante(taches: ITache[]): TSante {
	if (taches.some((t) => t.etat === 'failed')) {
		return 'bad'
	}
	if (taches.some((t) => t.etat === 'running')) {
		return 'warn'
	}
	return 'ok'
}

/** Le libelle doit tenir sur une ligne etroite : pas de phrase. */
function resume(taches: ITache[], etat: TSante): string {
	if (etat === 'bad') {
		const n = taches.filter((t) => t.etat === 'failed').length
		return n > 1 ? `${n} échecs` : '1 échec'
	}
	if (etat === 'warn') {
		const n = taches.filter((t) => t.etat === 'running').length
		return n > 1 ? `${n} en cours` : '1 en cours'
	}
	return 'à jour'
}

export interface ISchedulerTasksProps {
	taches: ITache[] | null
	onOpenDetail: () => void
}

/**
 * Taches planifiees — ligne de synthese du panneau lateral.
 *
 * Une seule ligne, une seule couleur : le caissier n'a pas a lire une liste
 * pour savoir si quelque chose va mal. La version precedente listait chaque
 * tache avec son bouton « Lancer » ; sur un panneau de 340 px les libelles du
 * planificateur debordaient et provoquaient un scroll horizontal.
 *
 * Le detail et le rejeu vivent desormais derriere le pinpad (cf
 * SchedulerDetail) : ce sont des actions d'exploitation, pas de caisse.
 *
 * Rien ne s'affiche si le service est absent.
 */
const SchedulerTasks = ({ taches, onOpenDetail }: ISchedulerTasksProps) => {
	if (!taches || taches.length === 0) {
		return null
	}

	const etat = sante(taches)

	return (
		<button
			type="button"
			className={`e-launcher-scheduler ${etat}`}
			onClick={onOpenDetail}
			title="Voir le détail des tâches planifiées"
		>
			<span className="led" aria-hidden="true" />
			<span className="lbl">Tâches planifiées</span>
			<span className="val">{resume(taches, etat)}</span>
			<span className="chev" aria-hidden="true">
				›
			</span>
		</button>
	)
}

export default SchedulerTasks
