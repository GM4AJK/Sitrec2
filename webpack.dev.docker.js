const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const InstallPaths = require('./config/config-install');
const CircularDependencyPlugin = require('circular-dependency-plugin');

// This config is specifically for Docker development with optimizations for Windows/Mac Docker volumes
// For local development, use webpack.dev.js instead (which has cache disabled)

module.exports = merge(common, {
    mode: 'development',
    devtool: 'eval-cheap-module-source-map', // Much faster than inline-source-map
    devServer: {
        static: {
            directory: InstallPaths.dev_path,
            publicPath: '/sitrec', // Public path to access the static files
        },
        hot: true, // Hot reload enabled
        open: false, // Don't auto-open browser
        host: '0.0.0.0', // Allow external connections (needed for Docker)
        port: 8080,
        // Optimize file watching for Docker/Windows/Mac
        watchFiles: {
            options: {
                poll: 1000, // Check for changes every second (reduces CPU usage on slow Docker volumes)
                aggregateTimeout: 300, // Wait 300ms after change before rebuilding
            },
        },
        // CRITICAL: Serve from memory instead of disk (huge performance boost on Windows/Mac Docker)
        devMiddleware: {
            writeToDisk: false, // Keep bundle in memory, don't write to slow volume mount
        },
        // Enable compression to reduce bundle transfer size
        compress: true,
        // Optimize client-side webpack connection
        client: {
            logging: 'warn', // Reduce console noise
            overlay: {
                errors: true,
                warnings: false, // Don't show warnings overlay
            },
            progress: false, // Disable progress reporting (reduces overhead)
        },
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
    // Enable webpack caching for faster Docker rebuilds (safe in Docker since cache is ephemeral)
    cache: {
        type: 'filesystem',
        cacheDirectory: '.webpack_cache',
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
    // Override output settings for dev mode
    output: {
        filename: '[name].bundle.js', // Remove contenthash for faster builds
        pathinfo: false, // Don't include path info comments (faster)
    },
    // Optimize module resolution for Docker
    optimization: {
        removeAvailableModules: false, // Skip this optimization in dev
        removeEmptyChunks: false, // Skip this optimization in dev
        splitChunks: false, // Don't split chunks in dev (faster)
    },
});