// Set the serverless build flag FIRST, before any imports
// This must happen before webpack.common.js is loaded, since it imports webpackCopyPatterns
process.env.IS_SERVERLESS_BUILD = 'true';

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

            // Exclude non-text sitches (data-dependent sitches not suitable for serverless)
            const excludedSitches = ['agua', 'faa2023', 'gimbal', 'gofast', 'pvs14'];

            // Read all directories in data folder
            const folders = fs.readdirSync(dataDir).filter(f => {
                return fs.statSync(path.join(dataDir, f)).isDirectory() &&
                       f !== '.' && f !== '..' &&
                       !excludedSitches.includes(f.toLowerCase());
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

module.exports = (env, argv) => {
    const isDevelopment = argv.mode !== 'production';
    
    return merge(common, {
        mode: argv.mode || 'development',
        devtool: isDevelopment ? 'eval-source-map' : false,
        optimization: {
            minimize: !isDevelopment,
            splitChunks: false,
        },
        output: {
            filename: isDevelopment ? '[name].bundle.js' : '[name].[contenthash].bundle.js',
            path: serverlessPath,
            clean: true,
            devtoolModuleFilenameTemplate: isDevelopment ? 'webpack://[namespace]/[resource-path]?[loaders]' : undefined,
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
            patterns: copyPatterns,  // Use copyPatterns which respects !isServerlessBuild conditions
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
};