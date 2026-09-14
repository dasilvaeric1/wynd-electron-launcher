import React from 'react'

import { Modal } from 'antd'

import { ITache, IRunResult, TEtat, RAISONS } from './SchedulerTasks'

const GLYPHE: Record<TEtat, string> = { running: '⟳', failed: '✗', ok: '✓', disabled: '–' }

const ETAT_LABEL: Record<TEtat, string> = {
	running: 'en cours',
	failed: 'en échec',
	ok: 'à jour',
	disabled: 'désactivée',
}

/** « il y a 12 min », « à 23:05 » — rien de plus verbeux sur une caisse. */
function quand(tache: ITache): string {
	if (tache.etat === 'running') {
		return 'démarrée à l’instant'
	}
	if (tache.etat === 'disabled') {
		return 'ne sera pas exécutée'
	}
	if (tache.etat === 'failed' && tache.lastRunUtc) {
		const minutes = Math.max(0, Math.round((Date.now() - Date.parse(tache.lastRunUtc)) / 60000))
		if (minutes < 60) {
			return `échec il y a ${minutes} min`
		}
		const heures = Math.floor(minutes / 60)
		if (heures < 48) {
			return `échec il y a ${heures} h`
		}
		return `échec il y a ${Math.floor(heures / 24)} j`
	}
	if (tache.nextRunUtc) {
		const d = new Date(tache.nextRunUtc)
		return `prochaine à ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
	}
	return 'pas de prochaine échéance'
}

export interface ISchedulerDetailProps {
	open: boolean
	taches: ITache[] | null
	resultat: IRunResult | null
	onClose: () => void
	/** Rejeu direct : l'acces a cette modale a DEJA passe le pinpad. */
	onRun: (name: string) => void
}

/**
 * Detail des taches planifiees — derriere le code superviseur.
 *
 * Le panneau lateral ne montre qu'une ligne de couleur ; tout ce qui demande
 * de lire ou d'agir est ici. Le pinpad est franchi UNE fois, a l'ouverture :
 * redemander le code a chaque rejeu n'apporterait rien, l'operateur est deja
 * authentifie et devant l'ecran.
 *
 * Volontairement pauvre : ni historique, ni compteurs, ni cron — le service a
 * deja une UI complete pour ca sur http://127.0.0.1:5088.
 */
const SchedulerDetail = ({ open, taches, resultat, onClose, onRun }: ISchedulerDetailProps) => {
	return (
		<Modal
			className="scheduler-detail"
			title="Tâches planifiées"
			open={open}
			onCancel={onClose}
			footer={null}
			width={960}
			centered
			destroyOnClose
		>
			{!taches || taches.length === 0 ? (
				<p className="sd-vide">Aucune tâche remontée par le planificateur.</p>
			) : (
				<>
				<p className="sd-count">
					{taches.length} tâche{taches.length > 1 ? 's' : ''} configurée
					{taches.length > 1 ? 's' : ''}
				</p>
				<ul className="sd-list">
					{taches.map((tache) => (
						<li key={tache.name} className={`sd-row ${tache.etat}`}>
							<span className="ico" aria-hidden="true">
								{GLYPHE[tache.etat]}
							</span>
							<span className="txt" title={tache.description || tache.name}>
								<span className="nom">{tache.name}</span>
								<span className="meta">
									{ETAT_LABEL[tache.etat]} · {quand(tache)}
								</span>
							</span>
							{tache.etat === 'running' ? (
								<span className="sd-encours">…</span>
							) : tache.etat === 'disabled' ? null : (
								<button type="button" className="sd-run" onClick={() => onRun(tache.name)}>
									Rejouer
								</button>
							)}
						</li>
					))}
				</ul>
				</>
			)}

			{resultat && !resultat.ok ? (
				<div className="sd-error" role="alert">
					{RAISONS[resultat.reason || ''] || resultat.message || 'Lancement impossible.'}
				</div>
			) : null}
			{resultat && resultat.ok ? (
				<div className="sd-ok" role="status">
					{resultat.name} relancée.
				</div>
			) : null}
		</Modal>
	)
}

export default SchedulerDetail
