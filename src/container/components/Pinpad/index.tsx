import React, { useCallback, useEffect, useRef, useState } from 'react'

import { Modal } from 'antd'
import { useDispatch, useSelector } from 'react-redux'
import classNames from 'classnames'

import { IPinpad, IRootState } from '../../interface'
import { closePinpadAction } from '../../store/actions'

export interface IPinpadProps {
	code: string
	onSuccess?: () => void
}

type TPinpadStatus = 'typing' | 'error' | 'success'

const MESSAGES: Record<TPinpadStatus, string> = {
	typing: 'Saisissez le code superviseur',
	error: 'Code incorrect — réessayez',
	success: 'Code accepté',
}

/** Delai avant remise a zero apres un code refuse, pour laisser lire le message. */
const RESET_AFTER_ERROR_MS = 700

/** Touches, dans l'ordre de la grille 4x3. `null` = pas de touche. */
const KEYS: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

const Pinpad = (props: IPinpadProps) => {
	const dispatch = useDispatch()
	const conf = useSelector<IRootState, IPinpad>((state) => state.pinpad)

	const [code, setCode] = useState('')
	const [status, setStatus] = useState<TPinpadStatus>('typing')
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const expected = props.code || ''

	const clearTimer = () => {
		if (resetTimer.current) {
			clearTimeout(resetTimer.current)
			resetTimer.current = null
		}
	}

	const reset = useCallback(() => {
		clearTimer()
		setCode('')
		setStatus('typing')
	}, [])

	const onClose = useCallback(() => {
		dispatch(closePinpadAction())
		reset()
	}, [dispatch, reset])

	const onDigit = useCallback(
		(digit: string) => {
			// Apres un refus, la premiere touche repart d'un code vide plutot que
			// d'obliger a passer par « C » : l'ancien pinpad verrouillait toutes
			// les touches des que la longueur etait atteinte.
			const base = status === 'error' ? '' : code
			if (base.length >= expected.length) {
				return
			}
			clearTimer()
			const next = base + digit
			setCode(next)

			if (next.length < expected.length) {
				setStatus('typing')
				return
			}
			if (next === expected) {
				setStatus('success')
				props.onSuccess && props.onSuccess()
				dispatch(closePinpadAction())
				reset()
				return
			}
			setStatus('error')
			resetTimer.current = setTimeout(() => setCode(''), RESET_AFTER_ERROR_MS)
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[code, status, expected, dispatch, reset]
	)

	const onBack = useCallback(() => {
		clearTimer()
		setCode((current) => current.slice(0, -1))
		setStatus('typing')
	}, [])

	// Les caisses ont un clavier physique (souvent un pave numerique) : le
	// pinpad n'en tenait aucun compte, il fallait viser les boutons au doigt.
	useEffect(() => {
		if (!conf.open) {
			return undefined
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key >= '0' && event.key <= '9') {
				event.preventDefault()
				onDigit(event.key)
			} else if (event.key === 'Backspace') {
				event.preventDefault()
				onBack()
			} else if (event.key === 'Escape') {
				event.preventDefault()
				onClose()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [conf.open, onDigit, onBack, onClose])

	useEffect(() => clearTimer, [])

	const onKeyPress = (key: string) => () => {
		if (key === 'clear') {
			reset()
		} else if (key === 'back') {
			onBack()
		} else {
			onDigit(key)
		}
	}

	const filled = status === 'error' ? expected.length : code.length

	return (
		<Modal
			className={classNames('pinpad', status)}
			open={conf.open}
			closable={true}
			onCancel={onClose}
			footer={null}
			centered={true}
			width="auto"
			title="Code superviseur"
		>
			<div className="pinpad-slots" aria-label={`${code.length} chiffre(s) sur ${expected.length}`}>
				{Array.from({ length: expected.length }).map((_unused, index) => (
					<i key={`slot-${index}`} className={index < filled ? 'on' : undefined} />
				))}
			</div>

			<div className="pinpad-message" role="status">
				{MESSAGES[status]}
			</div>

			<div className="pinpad-grid">
				{KEYS.map((key) => (
					<button
						type="button"
						key={key}
						className={classNames('pinpad-key', { util: key === 'clear' || key === 'back' })}
						onClick={onKeyPress(key)}
						disabled={key === 'back' && code.length === 0}
						aria-label={key === 'clear' ? 'Tout effacer' : key === 'back' ? 'Effacer le dernier chiffre' : key}
					>
						{key === 'clear' ? 'C' : key === 'back' ? '⌫' : key}
					</button>
				))}
			</div>

			<div className="pinpad-hint">clavier physique accepté · Échap pour annuler</div>
		</Modal>
	)
}

export default Pinpad
