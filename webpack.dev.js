const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const InstallPaths = require('./config/config-install');
const CircularDependencyPlugin = require('circular-dependency-plugin');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    devServer: {
        static: {
            directory: InstallPaths.dev_path,
            publicPath: '/sitrec', // Public path to access the static files
        },
        hot: true, // Hot reload enabled - "Reload site" dialog is handled in index.js via HMR detection
        open: false, // Don't auto-open browser
        host: '0.0.0.0', // Allow external connections (needed for Docker)
        port: 8080,
        historyApiFallback: {
            rewrites: [
                // Don't rewrite API requests
                { from: /^\/sitrecServer/, to: context => context.parsedUrl.pathname },
                { from: /^\/sitrec-videos/, to: context => context.parsedUrl.pathname },
                { from: /^\/sitrec-cache/, to: context => context.parsedUrl.pathname },
                { from: /^\/sitrec-terrain/, to: context => context.parsedUrl.pathname },
            ]
        },
        allowedHosts: 'all', // Allow connections from any host
        proxy: [
            {
                context: ['/sitrecServer/**'], // paths to proxy - use ** to match all subpaths
                target: 'http://localhost:8081', // Proxy to Apache in Docker
                changeOrigin: true,
                secure: false,
                logLevel: 'debug',
            },
            {
                context: ['/sitrec-videos'],
                target: 'http://localhost:8081',
                changeOrigin: true,
                secure: false,
            },
            {
                context: ['/sitrec-cache'],
                target: 'http://localhost:8081',
                changeOrigin: true,
                secure: false,
            },
            {
                context: ['/sitrec-terrain/**'],
                target: 'http://localhost:8081',
                changeOrigin: true,
                secure: false,
            },
        ],
    },
    plugins: [
        new CircularDependencyPlugin({
            exclude: /node_modules/,
            include: /src/,
            // `onDetected` is called for each module that is cyclical
            onDetected({ module: webpackModuleRecord, paths, compilation }) {
                const ignoreModules = ["mathjs"];
                // return if any of the ignoreModules is a substring of any of the paths
                if (paths.some(path => ignoreModules.some(ignoreModule => path.includes(ignoreModule)))) {
                    return;
                }
                // `paths` will be an Array of the relative module paths that make up the cycle
                compilation.errors.push(new Error(paths.join(' -> ')))
            },
        }),
    ],
});
