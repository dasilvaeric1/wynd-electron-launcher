/**
 * Build config for electron renderer process
 */

const path = require('path')
const webpack = require('webpack')

const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
const { merge } = require('webpack-merge')
const TerserPlugin = require('terser-webpack-plugin')
const baseConfig = require('./webpack.config.base')
// const dllDir = path.join(__dirname, '../dll');
// const manifest = path.resolve(dllDir, 'manifest.json');

const prodConfig = merge(baseConfig, {
	devtool: 'source-map',
	mode: 'production',
	// PATCH dev macOS : 'electron-renderer' suppose require() Node dispo dans
	// le renderer, mais nos windows ont nodeIntegration:false + contextIsolation:true.
	// On bundle pour le web et on poly-remplit `events` (seul Node built-in importé
	// par le code renderer ; tout le reste passe par contextBridge dans les preloads).
	target: 'web',
	entry: {
		container: './src/container/index.tsx',
		loader: './src/loader/index.tsx',
	},
	output: {
		path: path.join(__dirname, '../src'),
		filename: '[name]/dist/index.js',
	},
	resolve: {
		fallback: {
			events: require.resolve('events/'),
		},
	},
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				parallel: true,
			}),
			new CssMinimizerPlugin(),
		],
	},
	plugins: [
		new webpack.EnvironmentPlugin({
			NODE_ENV: 'production',
			DEBUG_PROD: false,
			DEV: '',
			EL_DEBUG: '',
		}),
		new MiniCssExtractPlugin({
			filename: '[name]/dist/index.css',
		}),
		new BundleAnalyzerPlugin({
			analyzerMode:
				process.env.OPEN_ANALYZER === 'true' ? 'server' : 'disabled',
			openAnalyzer: process.env.OPEN_ANALYZER === 'true',
		}),
	],
})

prodConfig.module.rules[0].use.unshift({
	loader: MiniCssExtractPlugin.loader,
})

module.exports = prodConfig
