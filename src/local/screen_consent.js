// Logique de la page de consentement screen-session.
//
// Extraite de screen_consent.html : le script etait inline, ce qui imposait
// `script-src 'unsafe-inline'` dans la CSP de la page. Charge en externe, il
// passe par `script-src 'self'` (verifie : Chromium l'autorise pour une page
// file:// et son voisin de dossier).
//
// `window.screenConsent` est expose par helpers/screen_consent_preload.js.

const params = new URLSearchParams(location.search)
const sessionId = params.get('sessionId') || '?'
const ttl = parseInt(params.get('ttlSeconds') || '900', 10)
const requestedBy = params.get('requestedBy') || ''
document.getElementById('meta').textContent =
  `Session ${sessionId.substring(0, 12)}… · durée max ${Math.round(ttl / 60)} min` +
  (requestedBy ? ` · demandé par ${requestedBy.substring(0, 24)}` : '')

document.getElementById('accept-btn').addEventListener('click', () => {
  window.screenConsent.accept()
})
document.getElementById('decline-btn').addEventListener('click', () => {
  window.screenConsent.decline()
})

// Décompte 30s — auto-decline côté main aussi (filet)
let remaining = 30
const cdEl = document.getElementById('countdown')
const tick = () => {
  cdEl.textContent = `Refus automatique dans ${remaining}s si pas de réponse`
  remaining--
  if (remaining < 0) return
  setTimeout(tick, 1000)
}
tick()
