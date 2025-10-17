const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');
const fs = require('fs');
const CopyPlugin = require("copy-webpack-plugin");
const copyPatterns = require('./webpackCopyPatterns');

// Create a serverless build directory
const serverlessPath = path.resolve(__dirname, 'dist-serverless');

// Plugin to generate sitches manifest
class GenerateSitchesManifestPlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('GenerateSitchesManifestPlugin', () => {
            const dataDir = path.resolve(__dirname, 'data');
            const manifest = {};

            // Read all directories in data folder
            const folders = fs.readdirSync(dataDir).filter(f => {
                return fs.statSync(path.join(dataDir, f)).isDirectory() &&
                       f !== '.' && f !== '..';
            });

            // For each folder, look for a Sit*.js file
            folders.forEach(folder => {
                const folderPath = path.join(dataDir, folder);
                const files = fs.readdirSync(folderPath);
                
                // Find the sitch file (either SitFoldername.js or foldername.sitch.js)
                const sitchFile = files.find(f => {
                    const lowerF = f.toLowerCase();
                    const lowerFolder = folder.toLowerCase();
                    return (lowerF === `sit${lowerFolder}.js` || 
                            lowerF === `${lowerFolder}.sitch.js`);
                });

                if (sitchFile) {
                    const filePath = path.join(folderPath, sitchFile);
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        manifest[folder] = {
                            name: folder,
                            sitchFile: sitchFile,
                            hasData: files.length > 1 // Has more files than just the sitch file
                        };
                    } catch (e) {
                        console.warn(`Failed to read sitch file: ${filePath}`);
                    }
                }
            });

            // Write manifest.json
            const manifestPath = path.join(serverlessPath, 'manifest.json');
            const manifestDir = path.dirname(manifestPath);
            if (!fs.existsSync(manifestDir)) {
                fs.mkdirSync(manifestDir, { recursive: true });
            }

            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            console.log(`Generated sitches manifest with ${Object.keys(manifest).length} sitches`);
        });
    }
}

// Custom plugin to create required directories
class CreateDirectoriesPlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('CreateDirectoriesPlugin', () => {
            const directories = [
                path.resolve(serverlessPath, 'user-files'),
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

module.exports = merge(common, {
    mode: 'development',
    devtool: 'eval-source-map',
    optimization: {
        minimize: false,
        splitChunks: false,
    },
    output: {
        filename: '[name].bundle.js',
        path: serverlessPath,
        clean: true,
        devtoolModuleFilenameTemplate: 'webpack://[namespace]/[resource-path]?[loaders]',
    },
    plugins: [
        // Filter out the original CopyPlugin and DefinePlugin to override them
        ...common.plugins.filter(plugin => 
            plugin.constructor.name !== 'CopyPlugin' && 
            plugin.constructor.name !== 'DefinePlugin'
        ),
        // Override DefinePlugin to set IS_SERVERLESS_BUILD flag
        new (require('webpack')).DefinePlugin({
            'process.env.IS_SERVERLESS_BUILD': JSON.stringify('true'),
        }),
        new CopyPlugin({
            patterns: [
                // Copy data folder (for sitches)
                {
                    from: path.resolve(__dirname, 'data'),
                    to: path.resolve(serverlessPath, 'data'),
                    globOptions: {
                        ignore: [
                            '**/*.map', // Ignore source maps
                            '**/.DS_Store', // Ignore macOS files
                        ],
                    },
                },
                // Copy docs
                {
                    from: path.resolve(__dirname, 'docs'),
                    to: path.resolve(serverlessPath, 'docs'),
                    globOptions: {
                        ignore: ['**/*.md'],
                    },
                },
                // Copy config file if exists
                {
                    from: path.resolve(__dirname, 'src', 'config.default.js'),
                    to: path.resolve(serverlessPath, 'config.default.js'),
                    noErrorOnMissing: true,
                },
            ],
        }),
        new GenerateSitchesManifestPlugin(),
        new CreateDirectoriesPlugin(),
        // Add CircularDependencyPlugin
        (() => {
            let hasStarted = false;
            let hasEnded = false;
            
            return new (require('circular-dependency-plugin'))({
                exclude: /node_modules/,
                include: /src/,
                onStart({ compilation }) {
                    if (!hasStarted) {
                        console.log('start detecting webpack modules cycles');
                        hasStarted = true;
                    }
                },
                onDetected({ module: webpackModuleRecord, paths, compilation }) {
                    const ignoreModules = ["mathjs"];
                    if (paths.some(path => ignoreModules.some(ignoreModule => path.includes(ignoreModule)))) {
                        return;
                    }
                    compilation.errors.push(new Error(paths.join(' -> ')))
                },
                onEnd({ compilation }) {
                    if (!hasEnded) {
                        console.log('end detecting webpack modules cycles');
                        hasEnded = true;
                    }
                },
            });
        })(),
    ]
});