import React, { useEffect, useRef, useState } from 'react'

import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

/** Cadence de rafraichissement tant que le panneau est ouvert. */
const REFRESH_MS = 30000

export type TEtat = 'running' | 'failed' | 'ok' | 'disabled'

export interface ITache {
	name: string
	description: string
	etat: TEtat
	/** Uniquement pour 'failed' : l'echec date de moins de 12 h. */
	recent: boolean
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

/**
 * Rouge sur un echec RECENT seulement. Un echec vieux de trois jours ne doit
 * pas laisser le panneau rouge en permanence — plus personne ne le regarderait.
 * Il reste visible en orange, et dans le detail.
 */
export function sante(taches: ITache[]): TSante {
	if (taches.some((t) => t.etat === 'failed' && t.recent)) {
		return 'bad'
	}
	if (taches.some((t) => t.etat === 'running' || t.etat === 'failed')) {
		return 'warn'
	}
	return 'ok'
}

/** Le libelle doit tenir sur une ligne etroite : pas de phrase. */
function resume(taches: ITache[], etat: TSante): string {
	if (etat === 'bad') {
		const n = taches.filter((t) => t.etat === 'failed' && t.recent).length
		return n > 1 ? `${n} échecs` : '1 échec'
	}
	if (etat === 'warn') {
		const enCours = taches.filter((t) => t.etat === 'running').length
		if (enCours > 0) {
			return enCours > 1 ? `${enCours} en cours` : '1 en cours'
		}
		const anciens = taches.filter((t) => t.etat === 'failed').length
		return anciens > 1 ? `${anciens} échecs anciens` : '1 échec ancien'
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
