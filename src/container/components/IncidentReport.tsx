import React, { useEffect, useState } from 'react'

import { Modal, Input } from 'antd'

import { ICustomWindow } from '../../helpers/interface'

declare let window: ICustomWindow

export interface IIncidentReportProps {
	open: boolean
	onClose: () => void
}

interface IIncidentResult {
	ok: boolean
	traceId?: string
	reason?: string
	message?: string
}

const REASONS: Record<string, string> = {
	NOT_ENROLLED: "Cette caisse n'est pas rattachée au dashboard. Contactez le support.",
	UPLOAD_FAILED: "L'envoi a échoué. Vérifiez la connexion et réessayez.",
}

/**
 * Signalement d'anomalie : le caissier decrit le probleme en une phrase, le
 * launcher y joint tout seul ce que le support demanderait de toute facon
 * (journaux, etat des peripheriques, version, numero de caisse).
 */
const IncidentReport = ({ open, onClose }: IIncidentReportProps) => {
	const [comment, setComment] = useState('')
	const [sending, setSending] = useState(false)
	const [result, setResult] = useState<IIncidentResult | null>(null)

	useEffect(() => {
		window.electronAPI.on('incident.result', (next: IIncidentResult) => {
			setSending(false)
			setResult(next)
		})
		return () => window.electronAPI.removeAllListeners('incident.result')
	}, [])

	useEffect(() => {
		if (open) {
			setComment('')
			setResult(null)
			setSending(false)
		}
	}, [open])

	const onSend = () => {
		setSending(true)
		setResult(null)
		window.log.info('[WINDOW CONTAINER] Signalement d’anomalie envoyé')
		window.electronAPI.send('main.action', 'report_incident', comment)
	}

	const sent = result && result.ok

	return (
		<Modal
			className="incident-report"
			title="Signaler une anomalie"
			open={open}
			onCancel={onClose}
			centered={true}
			okText={sent ? 'Fermer' : 'Envoyer au support'}
			cancelText="Annuler"
			okButtonProps={{ loading: sending, disabled: sending }}
			cancelButtonProps={{ style: sent ? { display: 'none' } : undefined }}
			onOk={sent ? onClose : onSend}
		>
			{sent ? (
				<div className="incident-sent">
					<p>Le support a reçu votre signalement.</p>
					{result?.traceId ? <code>{result.traceId}</code> : null}
				</div>
			) : (
				<React.Fragment>
					<label htmlFor="incident-comment">Que s’est-il passé&nbsp;?</label>
					<Input.TextArea
						id="incident-comment"
						rows={3}
						value={comment}
						maxLength={2000}
						disabled={sending}
						placeholder="Ex. : le tiroir-caisse ne s’ouvre plus depuis ce matin."
						onChange={(event) => setComment(event.target.value)}
					/>
					<div className="incident-attach">
						<div className="cap">Joint automatiquement</div>
						<ul>
							<li>Journaux de la caisse</li>
							<li>État des périphériques</li>
							<li>Version, configuration, numéro de caisse</li>
						</ul>
					</div>
					{result && !result.ok ? (
						<p className="incident-error">
							{REASONS[result.reason || ''] || result.message || 'Envoi impossible.'}
						</p>
					) : null}
				</React.Fragment>
			)}
		</Modal>
	)
}

export default IncidentReport
