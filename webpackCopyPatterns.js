const path = require('path');
const InstallPaths = require('./config/config-install');

// In Docker development mode, sitrecServer is served by Apache via proxy
// So we don't need to copy it to the webpack output directory
const isDockerDev = process.env.NODE_ENV === 'development' && InstallPaths.dev_path === '/var/www/html';

const patterns = [
    // copies the data directory
    { from: "data", to: "./data"},

    // copy the shared.env file, renaming it to shared.env.php to prevent direct access
    // combined with the initial <?php tag, this will prevent the file from being served
    { from: "./config/shared.env", to: "./shared.env.php",
        transform: (content, absoluteFrom) => {
            // Convert Buffer to string, prepend '<?php\n', then return as Buffer again
            const updatedContent = `<?php /*;\n${content.toString()}\n*/`;
            return Buffer.from(updatedContent);
        },},

    // Web worker source code needs to be loaded at run time
    // so we just copy it over
    // This is currently not used
    { from: "./src/workers/*.js", to:""},
    { from: "./src/PixelFilters.js", to:"./src"},
];

// Only copy sitrecServer and config.php in production or non-Docker environments
if (!isDockerDev) {
    // Copy sitrecServer directory, but exclude config.php (we'll copy it separately)
    // This prevents copying the empty placeholder file that Docker creates
    patterns.push(
        { 
            from: "sitrecServer", 
            to: "./sitrecServer",
            globOptions: {
                ignore: ['**/config.php']
            }
        }
    );
    
    // Copy config.php from the config directory to ensure we get the real file
    // (not the empty placeholder that Docker creates due to overlapping volume mounts)
    patterns.push(
        { from: "./config/config.php", to: "./sitrecServer/config.php"}
    );
}

module.exports = patterns;