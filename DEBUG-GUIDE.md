# Sitrec Standalone Debug Guide

This guide covers debugging the Sitrec standalone server for development and troubleshooting.

## Quick Start

```bash
# Build and run with full debugging
npm run dev-standalone-debug

# Or run steps separately
npm run build-standalone-debug  # Build with debug features
npm run start-standalone-debug  # Start with Node.js inspector
```

## Debug Features Overview

### 🔧 **Webpack Debug Build**
- **Source Maps**: `eval-source-map` for fast rebuilds and accurate debugging
- **No Minification**: Code remains readable in browser dev tools
- **Code Splitting**: Separate `vendors.bundle.js` and `index.bundle.js`
- **Clean Filenames**: No content hashes for easier identification

### 🖥️ **Node.js Server Debug**
- **Inspector**: Runs with `--inspect` flag on port 9229
- **Debug Logging**: Detailed Express.js and middleware logs
- **Request Logging**: All HTTP requests logged to console
- **Environment Variables**: `NODE_ENV=development` and `DEBUG=*`

### 🌐 **Debug Endpoints**
- `http://localhost:3000/debug/status` - Server configuration and status
- `http://localhost:3000/debug/files` - List all built files and assets

## Browser Debugging

### Chrome DevTools
1. Open your application: `http://localhost:3000/sitrec`
2. Press `F12` to open DevTools
3. Go to **Sources** tab
4. Navigate to `webpack://sitrec/src/` to find your source files
5. Set breakpoints in your original TypeScript/JavaScript code
6. Source maps will map execution back to your source files

### Debug Build Structure
```
dist-standalone/
├── index.bundle.js          # Main application code (unminified)
├── vendors.bundle.js        # Third-party libraries
├── index.css               # Application styles
├── data/                   # Application data files
├── sitrecServer/           # PHP backend files
└── docs/                   # Documentation files
```

## Node.js Server Debugging

### Chrome Inspector
1. Run: `npm run start-standalone-debug`
2. Look for: `Debugger listening on ws://127.0.0.1:9229/...`
3. Open Chrome and navigate to: `chrome://inspect`
4. Click **"Open dedicated DevTools for Node"**
5. Set breakpoints in `standalone-server.js`

### VS Code Debugging
1. Copy configuration from `debug-config.json` to `.vscode/launch.json`
2. Available configurations:
   - **Debug Sitrec Standalone Server**: Debug Node.js backend
   - **Debug Sitrec Frontend (Chrome)**: Debug frontend in Chrome
   - **Debug Sitrec Full Stack**: Debug both simultaneously

## Debug Output Examples

### Successful Startup
```
Debugger listening on ws://127.0.0.1:9229/...
Starting PHP server on port 8000...
PHP Server: [Date] PHP 8.4.5 Development Server (http://localhost:8000) started

🚀 Sitrec standalone server is running!
📱 Frontend: http://localhost:3000/sitrec
🐘 PHP Backend: http://localhost:8000
```

### Request Logging
```
2025-09-07T23:50:42.347Z GET /sitrec
2025-09-07T23:50:42.348Z GET /sitrec/index.bundle.js
2025-09-07T23:50:42.349Z GET /sitrec/vendors.bundle.js
2025-09-07T23:50:42.350Z GET /sitrec/index.css
```

## Troubleshooting

### Port Conflicts
If you see port conflicts:

**PHP Port (8000) in use:**
```bash
PHP_PORT=8001 npm run start-standalone-debug
```

**Frontend Port (3000) in use:**
```bash
PORT=3001 npm run start-standalone-debug
```

**Both ports:**
```bash
PORT=3001 PHP_PORT=8001 npm run start-standalone-debug
```

### Common Debug Scenarios

#### 1. Frontend JavaScript Issues
- Use browser DevTools Sources tab
- Look for files under `webpack://sitrec/src/`
- Set breakpoints in original source code
- Check Console tab for errors

#### 2. Backend API Issues
- Check server console for PHP errors
- Use debug endpoint: `http://localhost:3000/debug/status`
- Verify PHP server is running on correct port
- Check proxy configuration in server logs

#### 3. Build Issues
- Run `npm run build-standalone-debug` separately
- Check for webpack compilation errors
- Verify `dist-standalone/` directory is created
- Use `http://localhost:3000/debug/files` to see built assets

#### 4. Source Map Issues
- Ensure you're using the debug build (`npm run build-standalone-debug`)
- Check that source files appear under `webpack://sitrec/` in DevTools
- Verify breakpoints are set in original source files, not built files

## Performance Notes

- Debug builds are larger and slower than production builds
- Use regular `npm run dev-standalone` for faster builds without debugging
- Debug logging can be verbose - filter console output as needed
- Source maps increase memory usage in browser DevTools

## Debug vs Regular Build Comparison

| Feature | Regular Build | Debug Build |
|---------|---------------|-------------|
| Source Maps | `inline-source-map` | `eval-source-map` |
| Minification | Yes | No |
| File Names | With hashes | Clean names |
| Bundle Size | Smaller | Larger |
| Build Speed | Faster | Slower |
| Debugging | Basic | Full featured |
| Node Inspector | No | Yes |
| Request Logging | No | Yes |

## Tips for Effective Debugging

1. **Use the right build**: Always use `npm run dev-standalone-debug` for debugging
2. **Check both ends**: Debug both frontend (browser) and backend (Node.js) issues
3. **Use debug endpoints**: `/debug/status` and `/debug/files` for server info
4. **Monitor console**: Both browser console and server console provide valuable info
5. **Source maps**: Always debug in original source files, not built bundles
6. **Port management**: Use environment variables to avoid port conflicts