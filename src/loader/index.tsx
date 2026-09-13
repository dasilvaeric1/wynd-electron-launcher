import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import './index.less'
import type { ILoaderWindow } from './interface'

declare let window: ILoaderWindow

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(<App />)

// `ready` declenche le show() de la fenetre cote main. L'ancien code l'envoyait
// AVANT root.render() : la fenetre etait donc affichee alors qu'elle etait
// encore vide, d'ou le flash blanc. On attend la frame qui suit le commit React.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    window.electronAPI.send('ready', 'loader')
  })
})
