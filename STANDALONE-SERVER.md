# Sitrec Standalone Development Server

This document describes how to use the standalone development server for Sitrec, which provides a complete Node.js-based testing environment.

## Overview

The standalone server provides:
- **Frontend**: Webpack-built JavaScript/CSS served by Express.js
- **Backend**: PHP development server for API endpoints
- **Proxying**: Automatic routing between frontend and backend
- **One-command setup**: Build and run everything with a single command

## Quick Start

### Option 1: Using npm scripts
```bash
# Build and run in one command
npm run dev-standalone

# Or run separately
npm run build-standalone  # Build the frontend
npm run start-standalone  # Start the servers
```

### Option 2: Using the shell script
```bash
# Make sure the script is executable (already done)
./dev-standalone.sh
```

## What it does

1. **Builds the frontend** using webpack with a standalone configuration
2. **Starts a PHP development server** on port 8000 for the `sitrecServer` directory
3. **Starts an Express.js server** on port 3000 that:
   - Serves the built frontend files at `/sitrec`
   - Proxies PHP API requests to the PHP server
   - Handles video and cache requests (with graceful fallbacks)

## Access Points

- **Main Application**: http://localhost:3000/sitrec
- **PHP Backend**: http://localhost:8000 (direct access)
- **Root Redirect**: http://localhost:3000 → redirects to `/sitrec`

## Requirements

- **Node.js**: For the Express server and webpack build
- **PHP**: For the backend API server
- **npm dependencies**: Run `npm install` to ensure all packages are available

## Configuration

### Ports
You can customize the ports using environment variables:
```bash
PORT=4000 PHP_PORT=9000 npm run start-standalone
```

### Build Directory
The standalone build creates files in `dist-standalone/` directory, separate from your regular development build.

## Differences from Regular Development

| Feature | Regular Dev (`npm start`) | Standalone (`npm run dev-standalone`) |
|---------|---------------------------|---------------------------------------|
| Frontend Server | Webpack Dev Server | Express.js |
| Build Output | `/Users/mick/Sites/sitrec` | `./dist-standalone/` |
| PHP Server | External (Apache/Nginx) | Built-in PHP dev server |
| Hot Reload | Yes | No (manual rebuild needed) |
| Use Case | Active development | Testing/demos |

## Troubleshooting

### PHP Server Issues
- Ensure PHP is installed and in your PATH
- Check that port 8000 is available
- PHP errors will be displayed in the console

### Frontend Issues
- Ensure the build completed successfully
- Check that port 3000 is available
- Build files are in `dist-standalone/` directory

### Proxy Issues
- Video/cache proxy errors are normal if you don't have a local web server
- PHP proxy errors indicate the PHP server isn't running

## Stopping the Server

Press `Ctrl+C` in the terminal to stop both servers gracefully.

## Debugging

The standalone build is optimized for debugging with several features:

### Debug Commands
```bash
# Build with enhanced debugging features
npm run build-standalone-debug

# Start server with Node.js inspector and debug logging
npm run start-standalone-debug

# Build and run with full debugging
npm run dev-standalone-debug
```

### Debug Features
- **Source Maps**: `eval-source-map` for fast rebuilds and accurate debugging
- **No Minification**: Code remains readable in browser dev tools
- **Request Logging**: All HTTP requests are logged to console
- **Debug Endpoints**:
  - `http://localhost:3000/debug/status` - Server status and configuration
  - `http://localhost:3000/debug/files` - List all built files
- **Node.js Inspector**: Server runs with `--inspect` flag for debugging
- **No Caching**: JavaScript files served with `Cache-Control: no-cache`

### Browser Debugging
1. Open Chrome DevTools (F12)
2. Go to Sources tab
3. Your source files will be available under `webpack://sitrec/`
4. Set breakpoints in your original source code
5. Source maps will map back to your TypeScript/JavaScript files

### Node.js Server Debugging
1. Run `npm run start-standalone-debug`
2. Open Chrome and go to `chrome://inspect`
3. Click "Open dedicated DevTools for Node"
4. Set breakpoints in `standalone-server.js`

### VS Code Debugging
Copy the configuration from `debug-config.json` to your `.vscode/launch.json` file for integrated debugging:

- **Debug Sitrec Standalone Server**: Debug the Node.js backend
- **Debug Sitrec Frontend (Chrome)**: Debug the frontend in Chrome
- **Debug Sitrec Full Stack**: Debug both frontend and backend simultaneously

### Debug Output Structure
```
dist-standalone/
├── index.bundle.js          # Main application (no hash for easier debugging)
├── vendors.bundle.js        # Third-party libraries
├── index.css               # Styles
├── data/                   # Application data
├── sitrecServer/           # PHP backend files
└── docs/                   # Documentation
```

## Development Workflow

For active development, continue using `npm start` for hot reload.
Use the standalone server for:
- Testing the complete application
- Demonstrating to others
- Verifying production-like behavior
- Running without external web server dependencies
- **Debugging production-like issues**
- **Testing with real backend integration**