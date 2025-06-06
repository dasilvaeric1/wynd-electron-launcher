#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Variables d'environnement
const PORT = process.env.PORT || 3001;
const NODE_ENV = 'development';

let rendererProcess = null;
let mainProcess = null;

// Fonction pour lancer le renderer (webpack dev server)
function startRenderer() {
  console.log('🚀 Démarrage du webpack dev server...');
  
  rendererProcess = spawn('npx', [
    'cross-env', 
    `NODE_ENV=${NODE_ENV}`, 
    `PORT=${PORT}`,
    'webpack', 'serve', 
    '--config', './configs/webpack.config.renderer.dev.js'
  ], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  rendererProcess.on('error', (err) => {
    console.error('❌ Erreur du renderer:', err);
  });

  return new Promise((resolve, reject) => {
    rendererProcess.on('spawn', () => {
      console.log('✅ Webpack dev server démarré sur le port', PORT);
      // Attendre un peu que webpack soit prêt
      setTimeout(resolve, 3000);
    });
    
    rendererProcess.on('error', reject);
  });
}

// Fonction pour lancer Electron
function startElectron() {
  console.log('🚀 Démarrage d\'Electron...');
  
  mainProcess = spawn('npx', [
    'cross-env',
    `NODE_ENV=${NODE_ENV}`,
    `PORT=${PORT}`,
    'electron',
    '.'
  ], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  mainProcess.on('error', (err) => {
    console.error('❌ Erreur d\'Electron:', err);
  });

  mainProcess.on('close', (code) => {
    console.log('🔴 Electron s\'est fermé avec le code:', code);
    cleanup();
  });
}

// Fonction de nettoyage
function cleanup() {
  console.log('🧹 Nettoyage des processus...');
  
  if (rendererProcess && !rendererProcess.killed) {
    rendererProcess.kill('SIGTERM');
  }
  
  if (mainProcess && !mainProcess.killed) {
    mainProcess.kill('SIGTERM');
  }
  
  process.exit(0);
}

// Gestion des signaux de fermeture
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// Fonction principale
async function main() {
  try {
    console.log('🎯 Démarrage de l\'application Wynd Electron Launcher en mode développement...');
    
    // Démarrer le renderer d'abord
    await startRenderer();
    
    // Puis démarrer Electron
    startElectron();
    
  } catch (error) {
    console.error('❌ Erreur lors du démarrage:', error);
    cleanup();
  }
}

// Lancer le script
if (require.main === module) {
  main();
}

module.exports = { main, cleanup };
