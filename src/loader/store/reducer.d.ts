import type { ILoaderState, TLoaderEvent, TPhaseKey, TPhaseState } from '../interface'

export declare function initialState(over?: Partial<ILoaderState>): ILoaderState
export declare function reduce(state: ILoaderState, event: TLoaderEvent): ILoaderState
export declare function markPhases(
  phases: TPhaseKey[],
  activeKey: TPhaseKey | null,
  failed?: boolean
): Record<string, TPhaseState>
export declare function detailFor(event: string, data?: unknown): string
export declare const PHASE_LABELS: Record<TPhaseKey, string>
export declare const ACTION_LABELS: Record<string, string>
export declare const EVENT_LABELS: Record<string, string>
