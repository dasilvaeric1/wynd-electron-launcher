const createRenderLog = require('../../helpers/create_renderer_log')

const {
	ipcRenderer
} = require("electron");
ipcRenderer.once("user_path", (event, userPath) => {
	// eslint-disable-next-line no-console
	window.log = createRenderLog(userPath)
})

const sources = [];
if (process && process.env && process.env.NODE_ENV === "development") {
  // Dynamically insert the DLL script in development env in the
  // renderer process  // Dynamically insert the bundled app script in the renderer process
  const port = process.env.PORT || 3001;
  console.log('[LOADER PRELOAD] Loading from:', `http://localhost:${port}/dist/loader.js`);
  console.log('[LOADER PRELOAD] PORT env var:', process.env.PORT);
  sources.push(`http://localhost:${port}/dist/loader.js`);
} else {
  sources.push("../dist/index.js");
}

window.addEventListener('DOMContentLoaded', () => {
	// eslint-disable-next-line no-console
	console.log('[LOADER PRELOAD] DOMContentLoaded event fired');

	if (process && process.env && process.env.NODE_ENV !== "development") {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = '../dist/index.css';
		// HACK: Writing the script path should be done with webpack
		document.getElementsByTagName('head')[0].appendChild(link);
	}

  if (sources.length) {    for (let i = 0; i < sources.length; i++) {
      const scriptNode = document.createElement('script')
      const src = sources[i];
      // eslint-disable-next-line no-console
      console.log('[LOADER PRELOAD] Adding script:', src);
      scriptNode.src = src
      // eslint-disable-next-line no-console
      scriptNode.onload = () => console.log('[LOADER PRELOAD] Script loaded:', src);
      // eslint-disable-next-line no-console
      scriptNode.onerror = (err) => console.error('[LOADER PRELOAD] Script error:', src, err);
      document.body.appendChild(scriptNode);

    }
  }
})

// Backup: if DOM is already loaded
if (document.readyState === 'loading') {
  // eslint-disable-next-line no-console
  console.log('[LOADER PRELOAD] DOM is loading, waiting for DOMContentLoaded');
} else {
  // eslint-disable-next-line no-console
  console.log('[LOADER PRELOAD] DOM is already loaded, executing immediately');
  // DOM is already loaded, execute the script injection
  if (process && process.env && process.env.NODE_ENV !== "development") {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '../dist/index.css';
    document.getElementsByTagName('head')[0].appendChild(link);
  }

  if (sources.length) {
    for (let i = 0; i < sources.length; i++) {
      const scriptNode = document.createElement('script')
      const src = sources[i];
      // eslint-disable-next-line no-console
      console.log('[LOADER PRELOAD] Adding script (immediate):', src);
      scriptNode.src = src
      // eslint-disable-next-line no-console
      scriptNode.onload = () => console.log('[LOADER PRELOAD] Script loaded (immediate):', src);
      // eslint-disable-next-line no-console
      scriptNode.onerror = (err) => console.error('[LOADER PRELOAD] Script error (immediate):', src, err);
      document.body.appendChild(scriptNode);
    }
  }
}

