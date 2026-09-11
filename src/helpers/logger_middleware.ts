
import { applyMiddleware } from 'redux'
import { composeWithDevTools } from 'redux-devtools-extension'
import thunk from 'redux-thunk'
import { ICustomWindow } from './interface'

declare let window: ICustomWindow

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-unused-vars
export const loggerMiddleware = (store: any) => (next: any) => (action: any) => {
	if (process.env.NODE_ENV === 'development') {
		let dump = ''
		if (action) {
			try {
				dump = JSON.stringify(action)
			} catch (err) {
				// Une action peut porter une valeur non serialisable : tracer le
				// store ne doit pas casser le dispatch.
				dump = `[action ${action.type || '?'} non serialisable: ${(err as Error).message}]`
			}
		}
		window?.log.debug(`[STORE] > action : ${dump}`)
	}
	next(action)
}
let middleware = applyMiddleware(thunk, loggerMiddleware)
if (process.env.NODE_ENV !== 'production') {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	middleware = composeWithDevTools(middleware)
}
