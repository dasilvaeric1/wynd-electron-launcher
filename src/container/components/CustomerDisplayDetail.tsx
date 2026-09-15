import React from 'react'

import { Modal } from 'antd'

import { ICustomerState, IEcran, libelleEcran } from './CustomerDisplay'
import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

const ROLE_LABEL: Record<string, string> = {
	pos: 'Caisse',
	client: 'Client',
	libre: 'Libre',
}

export interface ICustomerDisplayDetailProps {
	open: boolean
	etat: ICustomerState | null
	onClose: () => void
}

/**
 * Choix de l'ecran client — derriere le code superviseur.
 *
 * Deplacer la page client d'un ecran a l'autre change ce que voit le public :
 * ce n'est pas une action de caissier. Le pinpad est franchi une fois, a
 * l'ouverture.
 *
 * « Rechercher les ecrans » existe parce qu'Electron n'emet aucun evenement
 * pour un ecran deja branche au lancement : apres avoir cable l'ecran, le
 * technicien a besoin d'un moyen de forcer la relecture sans redemarrer.
 */
const CustomerDisplayDetail = ({ open, etat, onClose }: ICustomerDisplayDetailProps) => {
	const choisir = (index: number | null) => {
		window.electronAPI.send('customer.set', index)
	}

	const ecrans: IEcran[] = etat?.screens || []

	return (
		<Modal
			className="customer-detail"
			title="Écran client"
			open={open}
			onCancel={onClose}
			footer={null}
			width={640}
			centered
			destroyOnClose
		>
			<div className="cd-head">
				<span className={`cd-etat ${etat?.ok ? 'ok' : 'warn'}`}>
					<i className="dot" />
					{etat?.ok
						? `${etat.mode === 'idle' ? 'Écran d’attente' : 'Page client'} sur l’écran ${
								(etat.clientIndex ?? 0) + 1
						  }`
						: etat?.libelle || 'Indisponible'}
				</span>
				<button
					type="button"
					className="cd-rescan"
					onClick={() => window.electronAPI.send('customer.refresh')}
				>
					Rechercher les écrans
				</button>
			</div>

			{etat?.url ? (
				<p className="cd-url">{etat.url}</p>
			) : (
				<p className="cd-url">
					Aucune page configurée — écran d’attente Octipas POS affiché.
				</p>
			)}

			<ul className="cd-list">
				{ecrans.map((e) => {
					const estPos = e.role === 'pos'
					return (
						<li key={e.index} className={`cd-row ${e.role}`}>
							<span className="ico" aria-hidden="true">
								▭
							</span>
							<span className="txt">
								<span className="nom">{libelleEcran(e)}</span>
								<span className="meta">
									{ROLE_LABEL[e.role]} · position {e.x},{e.y}
								</span>
							</span>
							{estPos ? (
								// Poser la page client sur l'ecran de la caisse masquerait le
								// POS : le bouton n'existe pas, plutot que d'echouer apres coup.
								<span className="cd-bloque">occupé</span>
							) : e.role === 'client' ? (
								<span className="cd-actuel">actuel</span>
							) : (
								<button type="button" className="cd-pick" onClick={() => choisir(e.index)}>
									Utiliser
								</button>
							)}
						</li>
					)
				})}
			</ul>

			{ecrans.length < 2 ? (
				<p className="cd-vide">
					Un seul écran détecté. Branchez le second écran puis lancez « Rechercher les
					écrans ».
				</p>
			) : null}

			<div className="cd-foot">
				<span className="cd-mode">
					{etat?.manuel
						? 'Choix manuel — il survit au redémarrage.'
						: 'Choix automatique, d’après config.ini.'}
				</span>
				{etat?.manuel ? (
					<button type="button" className="cd-auto" onClick={() => choisir(null)}>
						Revenir à l’automatique
					</button>
				) : null}
			</div>
		</Modal>
	)
}

export default CustomerDisplayDetail
