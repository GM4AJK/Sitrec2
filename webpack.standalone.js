const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');
const fs = require('fs');
const CopyPlugin = require("copy-webpack-plugin");
const copyPatterns = require('./webpackCopyPatterns');

// Create a standalone build directory
const standalonePath = path.resolve(__dirname, 'dist-standalone');

// Custom plugin to create required directories
class CreateDirectoriesPlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('CreateDirectoriesPlugin', () => {
            const directories = [
                path.resolve(standalonePath, 'sitrec-upload'),
                path.resolve(standalonePath, 'u')
            ];
            
            directories.forEach(dir => {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    console.log(`Created directory: ${dir}`);
                }
            });
        });
    }
}

// Create a modified common config for standalone build
const standaloneCommon = merge(common, {
    output: {
        filename: '[name].[contenthash].bundle.js',
        path: standalonePath,
        clean: true,
    },
    plugins: [
        // Filter out the original CopyPlugin and add our own
        ...common.plugins.filter(plugin => plugin.constructor.name !== 'CopyPlugin'),
        new CopyPlugin({
            patterns: [
                ...copyPatterns, // Use the same patterns but they'll go to standalonePath
                {
                    from: path.resolve(__dirname, 'docs'),
                    to: path.resolve(standalonePath, 'docs'),
                    globOptions: {
                        ignore: ['**/*.md'], // Ignore Markdown files here
                    },
                },
            ],
        }),
        new CreateDirectoriesPlugin(),
    ]
});

module.exports = merge(standaloneCommon, {
    mode: 'development',
    devtool: 'eval-source-map', // Better for debugging - faster rebuild, good source maps
    optimization: {
        minimize: false, // Don't minify for debugging
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                },
            },
        },
    },
    output: {
        filename: '[name].bundle.js', // Remove hash for easier debugging
        path: standalonePath,
        clean: true,
        // Enable source map support
        devtoolModuleFilenameTemplate: 'webpack://[namespace]/[resource-path]?[loaders]',
    },
});