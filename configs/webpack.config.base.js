const path = require('path');
const webpack = require('webpack');
const { dependencies } = require('../package.json')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const baseConfig = {
	module: {
		rules: [
			{
				test: /\.(less)$/,
				use: [
					{
						loader: 'css-loader',
					},
					{
						loader: 'less-loader',
						options: {
							lessOptions: {
								javascriptEnabled: true,
							}
						}
					}],
			},
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: {
					loader: 'ts-loader',
				},
			},
			{
				test: /\.woff(\?v=\d+\.\d+\.\d+)?$/,
				use: {
					loader: 'url-loader',
					options: {
						limit: 10000,
						mimetype: 'application/font-woff',
					},
				},
			},
			// WOFF2 Font
			{
				test: /\.woff2(\?v=\d+\.\d+\.\d+)?$/,
				use: {
					loader: 'url-loader',
					options: {
						limit: 10000,
						mimetype: 'application/font-woff',
					},
				},
			},
			// OTF Font
			{
				test: /\.otf(\?v=\d+\.\d+\.\d+)?$/,
				use: {
					loader: 'url-loader',
					options: {
						limit: 10000,
						mimetype: 'font/otf',
					},
				},
			},
			// TTF Font
			{
				test: /\.ttf(\?v=\d+\.\d+\.\d+)?$/,
				use: {
					loader: 'url-loader',
					options: {
						limit: 10000,
						mimetype: 'application/octet-stream',
					},
				},
			},
			// EOT Font
			{
				test: /\.eot(\?v=\d+\.\d+\.\d+)?$/,
				use: 'file-loader',
			},
			// SVG Font
			{
				test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
				use: {
					loader: 'url-loader',
					options: {
						mimetype: 'image/svg+xml',
					},
				},
			},
			// Common Image Formats
			{
				test: /\.(?:ico|gif|png|jpg|jpeg|webp)$/,
				use: 'url-loader',
			},
		],
	},
	/**
	 * Determine the array of extensions that should be used to resolve modules.
	 */	resolve: {
		extensions: ['.js', '.ts', '.tsx', '.css', '.less'],
		modules: [path.join(__dirname, '../src'), 'node_modules'],		fallback: {
			"path": require.resolve("path-browserify"),
			"fs": false,
			"crypto": require.resolve("crypto-browserify"),
			"stream": require.resolve("stream-browserify"),
			"url": require.resolve("url/"),
			"events": require.resolve("events/"),
			"string_decoder": require.resolve("string_decoder/"),
			"buffer": require.resolve("buffer/"),
			"util": require.resolve("util/"),
			"process": require.resolve("process/browser.js")
		}
	},
	plugins: [
		new NodePolyfillPlugin(),
		new webpack.ProvidePlugin({
			Buffer: ['buffer', 'Buffer'],
			process: 'process/browser'
		})
	],
};


module.exports = baseConfig
