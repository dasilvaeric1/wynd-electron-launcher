import React, { useEffect, useReducer } from 'react'

import './App.less'
import { initialState, reduce, PHASE_LABELS, ACTION_LABELS } from './store/reducer'
import type { IBootError, IBootPlan, ILoaderState, ILoaderWindow, TPhaseKey } from './interface'

declare let window: ILoaderWindow

/** Sans transition pendant ce delai, on previent que l'etape traine. */
const SLOW_AFTER_MS = 20000

/**
 * Couleurs de config.ini appliquees au loader.
 *
 * Le loader n'avait jusqu'ici JAMAIS applique `[theme]` : `conf` n'etait pas
 * dans sa whitelist IPC. Un deploiement aux couleurs du client obtenait donc
 * un container personnalise et un loader reste au bleu par defaut.
 */
const THEME_VARS: Record<string, string> = {
  'menu-background': '--l-accent',
  'primary-color': '--l-accent-deep',
}

interface IPhaseRowProps {
  phase: TPhaseKey
  state: string
}

function PhaseRow({ phase, state }: IPhaseRowProps) {
  const glyph = state === 'done' ? '✓' : state === 'failed' ? '!' : ''
  return (
    <li className={`phase ${state}`}>
      <span className="dot" aria-hidden="true">
        {glyph}
      </span>
      {PHASE_LABELS[phase] || phase}
    </li>
  )
}

interface IBootErrorViewProps {
  error: IBootError
  state: ILoaderState
  onRetry: () => void
  onLogs: () => void
  onQuit: () => void
}

function BootErrorView({ error, state, onRetry, onLogs, onQuit }: IBootErrorViewProps) {
  const failed = state.phases.find((key) => state.phaseState[key] === 'failed')
  return (
    <div className="n-body" role="alert">
      <div className="fail-head">
        <div className="fail-badge" aria-hidden="true">
          !
        </div>
        <div className="fail-title">
          {failed ? PHASE_LABELS[failed] : 'Démarrage interrompu'}
        </div>
      </div>
      <p className="fail-msg">{error.message}</p>
      <div className="fail-meta">
        <span>{error.code}</span>
        {error.detail ? <span>{error.detail}</span> : null}
      </div>
      <div className="btns">
        <button type="button" className="btn primary" onClick={onRetry}>
          Réessayer
        </button>
        <button type="button" className="btn" onClick={onLogs}>
          Voir les journaux
        </button>
        <button type="button" className="btn ghost" onClick={onQuit}>
          Quitter
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [state, dispatch] = useReducer(reduce, undefined, () =>
    initialState({ version: window.electronAPI?.version || '' })
  )

  // Le watchdog se rearme a chaque transition : seule une etape reellement
  // bloquee finit par lever l'alerte.
  const beat = state.current + state.phases.indexOf(state.phases[0]) + state.detail.length

  useEffect(() => {
    const api = window.electronAPI
    if (!api) {
      return
    }

    api.on('loader.action', (plan: IBootPlan | string) => {
      // Compat : le main envoyait autrefois une simple chaine d'action.
      dispatch(
        typeof plan === 'string'
          ? { type: 'plan', plan: { action: plan, phases: [], total: 0 } as unknown as IBootPlan }
          : { type: 'plan', plan }
      )
    })

    api.on('loader.plan', (plan: IBootPlan) => dispatch({ type: 'plan', plan }))

    api.on('current_status', (event: string, data: unknown) => {
      dispatch({ type: 'status', event, data })
    })

    api.on('download_progress', (percent: number) => {
      dispatch({ type: 'progress', percent })
    })

    api.on('app_infos', (infos: { title?: string; name?: string; version?: string }) => {
      dispatch({ type: 'infos', infos })
    })

    api.on('boot_error', (error: IBootError) => dispatch({ type: 'error', error }))
    api.on('error', (error: IBootError) => dispatch({ type: 'error', error }))

    api.on('conf', (conf: { theme?: Record<string, string>; log?: { renderer?: string } }) => {
      if (conf && conf.log && conf.log.renderer) {
        window.log?.setLevel(conf.log.renderer)
      }
      if (!conf || !conf.theme) {
        return
      }
      Object.keys(conf.theme).forEach((key) => {
        const cssVar = THEME_VARS[key]
        if (cssVar && conf.theme) {
          document.documentElement.style.setProperty(cssVar, `#${conf.theme[key]}`)
        }
      })
    })

    return () => {
      ;['loader.action', 'loader.plan', 'current_status', 'download_progress', 'app_infos', 'boot_error', 'error', 'conf'].forEach(
        (channel) => api.removeAllListeners(channel)
      )
    }
  }, [])

  useEffect(() => {
    if (state.error) {
      return undefined
    }
    const timer = setTimeout(() => dispatch({ type: 'slow' }), SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [beat, state.error])

  const send = (channel: string) => () => window.electronAPI?.send(channel)
  const onRetry = () => {
    dispatch({ type: 'retry' })
    window.electronAPI?.send('boot.retry')
  }

  const percent = state.total > 0 ? Math.round((state.current * 100) / state.total) : 0
  const step = Math.min(state.current + 1, state.total)

  return (
    <div id="e-launcher-loader">
      <div className="n-head">
        <div className="n-mark" aria-hidden="true">
          {(state.title || 'O').charAt(0).toUpperCase()}
        </div>
        <div className="n-ident">
          <div className="n-title">{state.title || 'Point de vente'}</div>
          <div className="n-sub">
            {state.error ? 'DÉMARRAGE INTERROMPU' : (ACTION_LABELS[state.action] || '').toUpperCase()}
          </div>
        </div>
      </div>

      {state.error ? (
        <BootErrorView
          error={state.error}
          state={state}
          onRetry={onRetry}
          onLogs={send('boot.open_logs')}
          onQuit={send('boot.quit')}
        />
      ) : (
        <div className="n-body">
          <ul className="phases">
            {state.phases.map((phase) => (
              <PhaseRow key={phase} phase={phase} state={state.phaseState[phase] || 'pending'} />
            ))}
          </ul>
          <div className="n-detail" title={state.detail}>
            {state.detail}
          </div>
          <div
            className="n-bar"
            role="progressbar"
            aria-valuenow={state.download ? state.progress : percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${state.download ? state.progress : percent}%` }} />
          </div>
          {state.slow ? (
            <div className="n-banner">
              <span aria-hidden="true">⚠</span>
              <span>Cette étape est plus longue que d’habitude.</span>
            </div>
          ) : null}
        </div>
      )}

      <div className="n-foot">
        <span className="left">
          {state.error ? `Échec à l’étape ${step} / ${state.total}` : `Étape ${step} / ${state.total}`}
        </span>
        <span className="right">{state.version ? `v${state.version}` : ''}</span>
      </div>
    </div>
  )
}
