import type { IElectronAPI, ILogger } from '../helpers/interface'

export type TPhaseKey = 'config' | 'update' | 'hardware' | 'devices' | 'pos' | 'shutdown'
export type TPhaseState = 'pending' | 'active' | 'done' | 'failed'
export type TBootAction = 'initialize' | 'reload' | 'update' | 'close'

export interface IBootError {
  code: string
  message: string
  detail: string | null
  status: number | null
}

export interface IBootPlan {
  action: TBootAction
  phases: TPhaseKey[]
  total: number
}

export interface ILoaderState {
  action: TBootAction
  phases: TPhaseKey[]
  phaseState: Record<string, TPhaseState>
  current: number
  total: number
  detail: string
  title: string
  version: string
  download: boolean
  progress: number
  error: IBootError | null
  slow: boolean
}

export type TLoaderEvent =
  | { type: 'plan'; plan: IBootPlan }
  | { type: 'retry' }
  | { type: 'status'; event: string; data?: unknown }
  | { type: 'progress'; percent: number }
  | { type: 'infos'; infos: { title?: string; name?: string; version?: string } }
  | { type: 'error'; error: IBootError }
  | { type: 'slow' }

/**
 * Le loader n'utilise plus `window.theme` : react-antd-cssvars a ete retire
 * (il faisait un require('antd') nu en CommonJS, ce qui empechait tout
 * tree-shaking et embarquait antd en entier dans le bundle du splash screen).
 */
export interface ILoaderWindow extends Window {
  electronAPI: IElectronAPI
  log?: ILogger
}
