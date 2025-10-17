#!/usr/bin/env node

/**
 * Standalone Serverless Server for Sitrec
 * 
 * This is a minimal Node.js server that serves the Sitrec frontend without requiring PHP.
 * All data is stored locally in the browser's IndexedDB.
 * 
 * Usage:
 *   npm run build-serverless
 *   npm run start-serverless
 * 
 * Then navigate to http://localhost:3000/sitrec
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DIST_DIR = path.resolve(__dirname, 'dist-serverless');

// Middleware
app.use(express.json());

/**
 * API Routes (before static files to intercept requests)
 */

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0-serverless',
        mode: 'serverless'
    });
});

/**
 * Get application manifest (list of available sitches)
 */
app.get('/api/manifest', (req, res) => {
    try {
        const manifestPath = path.join(DIST_DIR, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            res.json(manifest);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Error reading manifest:', error);
        res.status(500).json({ error: 'Failed to read manifest' });
    }
});

/**
 * Debug endpoint to get server status
 */
app.get('/api/debug/status', (req, res) => {
    res.json({
        timestamp: new Date().toISOString(),
        frontend: {
            port: PORT,
            buildDir: DIST_DIR,
            buildExists: fs.existsSync(DIST_DIR)
        },
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            cwd: process.cwd()
        },
        mode: 'serverless-no-php'
    });
});

/**
 * Debug endpoint to list available files in the build
 */
app.get('/api/debug/files', (req, res) => {
    function getFiles(dir, fileList = []) {
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                if (fs.statSync(filePath).isDirectory()) {
                    getFiles(filePath, fileList);
                } else {
                    fileList.push(path.relative(DIST_DIR, filePath));
                }
            });
        } catch (e) {
            console.error('Error reading directory:', e);
        }
        return fileList;
    }
    
    try {
        const files = getFiles(DIST_DIR);
        res.json({
            buildDir: DIST_DIR,
            fileCount: files.length,
            files: files.sort().slice(0, 100) // Limit to first 100 files
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Stub endpoints for backwards compatibility
 * These simulate the PHP backend but return appropriate responses for serverless mode
 */

// getsitches.php stub - returns empty (manifest.json is used instead)
app.get('/sitrecServer/getsitches.php', (req, res) => {
    res.json({});
});

// rehost.php stub - returns error (server save disabled)
app.post('/sitrecServer/rehost.php', (req, res) => {
    res.status(501).json({
        error: 'File rehosting disabled in serverless mode',
        message: 'Use local save/load functionality instead'
    });
});

// settings.php stub - returns error (IndexedDB used instead)
app.all('/sitrecServer/settings.php', (req, res) => {
    res.status(501).json({
        error: 'Server settings disabled in serverless mode',
        message: 'Settings are stored locally in IndexedDB'
    });
});

// proxy.php stub - returns error
app.get('/sitrecServer/proxy.php', (req, res) => {
    res.status(501).json({
        error: 'Proxy disabled in serverless mode',
        message: 'Use direct API calls with service worker caching'
    });
});

// user.php stub
app.get('/sitrecServer/user.php', (req, res) => {
    res.json({
        loggedIn: false,
        userId: 0,
        message: 'Anonymous user in serverless mode'
    });
});

/**
 * Serve static files from build directory (after API routes)
 */
app.use(express.static(DIST_DIR));

/**
 * Serve index.html for SPA routing
 */
app.get('/sitrec', (req, res) => {
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('index.html not found. Run: npm run build-serverless');
    }
});

/**
 * Catch-all for index.html (SPA support) - handles all /sitrec/* paths
 */
app.get('/sitrec/*', (req, res) => {
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('index.html not found. Run: npm run build-serverless');
    }
});

/**
 * Root redirect
 */
app.get('/', (req, res) => {
    res.redirect('/sitrec');
});

/**
 * 404 handler
 */
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        path: req.path,
        message: 'Endpoint not found. This is a serverless build with limited backend capabilities.'
    });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

/**
 * Start the server
 */
function startServer() {
    // Check if build directory exists
    if (!fs.existsSync(DIST_DIR)) {
        console.error(`\n❌ Build directory not found: ${DIST_DIR}`);
        console.error('\nPlease run: npm run build-serverless');
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(60));
        console.log('🚀 Sitrec Serverless (No PHP Required!)');
        console.log('='.repeat(60));
        console.log(`\n📱 Frontend: http://localhost:${PORT}/sitrec`);
        console.log('\n✨ Features:');
        console.log('   ✅ Local saves via IndexedDB');
        console.log('   ✅ Offline-first architecture');
        console.log('   ✅ No backend server required');
        console.log('   ✅ No PHP dependency');
        console.log('\n⚠️  Limitations:');
        console.log('   ❌ No server-side file upload');
        console.log('   ❌ No AI chat feature');
        console.log('   ❌ No cloud sync');
        console.log('\n📊 Debug Endpoints:');
        console.log(`   http://localhost:${PORT}/api/debug/status`);
        console.log(`   http://localhost:${PORT}/api/debug/files`);
        console.log(`   http://localhost:${PORT}/api/manifest`);
        console.log('\n💡 Tip: Open browser console for more information');
        console.log('\nPress Ctrl+C to stop the server\n');
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\nShutting down server...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n\nShutting down server...');
        process.exit(0);
    });
}

startServer();