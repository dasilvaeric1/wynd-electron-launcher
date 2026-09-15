import React, { useEffect, useState } from 'react'

import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

export type TRole = 'pos' | 'client' | 'libre'

export interface IEcran {
	index: number
	id: string | null
	width: number
	height: number
	x: number
	y: number
	principal: boolean
	role: TRole
}

export type TMode = 'page' | 'idle'

export interface ICustomerState {
	ok: boolean
	mode: TMode | null
	raison: string | null
	libelle: string | null
	url: string | null
	posIndex: number | null
	clientIndex: number | null
	screens: IEcran[]
	manuel: boolean
}

/**
 * Abonnement a l'etat de l'ecran client.
 *
 * Pas de minuterie ici, contrairement aux taches planifiees : le main repousse
 * l'etat de lui-meme a chaque branchement d'ecran. Interroger en boucle
 * n'apprendrait rien de plus et ferait travailler le main pour rien.
 */
export function useCustomerDisplay() {
	const [etat, setEtat] = useState<ICustomerState | null>(null)

	useEffect(() => {
		window.electronAPI.on('customer.state', (next: ICustomerState) => setEtat(next))
		window.electronAPI.send('customer.ask')
		return () => {
			window.electronAPI.removeAllListeners('customer.state')
		}
	}, [])

	return etat
}

/** Un ecran se reconnait a sa definition bien plus qu'a son index. */
export function libelleEcran(e: IEcran): string {
	return `Écran ${e.index + 1} — ${e.width}×${e.height}${e.principal ? ' (principal)' : ''}`
}

export interface ICustomerDisplayProps {
	etat: ICustomerState | null
	onOpenDetail: () => void
}

/**
 * Ecran client — ligne de synthese du panneau lateral.
 *
 * Rien ne s'affiche tant que la fonction n'est pas configuree : un panneau de
 * caisse n'a pas a porter une ligne pour une option que le magasin n'utilise
 * pas. Des qu'une page client EST configuree, en revanche, la ligne reste
 * visible meme en echec — c'est precisement le moment ou elle sert.
 */
const CustomerDisplay = ({ etat, onOpenDetail }: ICustomerDisplayProps) => {
	if (!etat) {
		return null
	}
	// Non configure : on n'occupe pas le panneau.
	if (etat.raison === 'disabled') {
		return null
	}

	const sante = etat.ok ? 'ok' : 'warn'
	const valeur = etat.ok
		? etat.mode === 'idle'
			? `Écran ${(etat.clientIndex ?? 0) + 1} · attente`
			: `Écran ${(etat.clientIndex ?? 0) + 1}`
		: etat.libelle || 'indisponible'

	return (
		<button
			type="button"
			className={`e-launcher-customer ${sante}`}
			onClick={onOpenDetail}
			title="Choisir l’écran client"
		>
			<span className="led" aria-hidden="true" />
			<span className="lbl">Écran client</span>
			<span className="val">{valeur}</span>
			<span className="chev" aria-hidden="true">
				›
			</span>
		</button>
	)
}

export default CustomerDisplay
