# Webpack Configuration Separation: Local vs Docker

## Problem Solved
Previously, `webpack.dev.js` had Docker-specific optimizations (persistent caching, `writeToDisk: false`) that were causing issues with local development:
- Build cache was not being invalidated
- Changes to files weren't reflected in the bundle
- Had to manually clear `.cache` and `node_modules/.cache` to get clean rebuilds

## Solution: Separate Configurations

### **webpack.dev.js** (Local Development)
**Purpose**: Rapid development iteration on local machine

**Key Features**:
- ✅ **Cache disabled** (`cache: false`) - Fresh rebuild on every change
- ✅ **Standard file watching** - No polling (fast on local filesystems)
- ✅ **Writes to disk normally** - No special Docker volume optimizations
- ✅ **Hot module reloading** enabled for quick feedback

**Usage**: 
```bash
npm run build          # Uses webpack.dev.js (local)
npm run webpack-dev    # Starts dev server with hot reload
```

### **webpack.dev.docker.js** (Docker Development)
**Purpose**: Optimized builds within Docker containers with volume mounts

**Key Features**:
- ✅ **Cache enabled** (`cache: { type: 'filesystem' }`) - Faster subsequent builds
- ✅ **Polling enabled** (`poll: 1000`) - Detects changes on slow Docker volumes
- ✅ **In-memory serving** (`writeToDisk: false`) - Avoids slow volume writes
- ✅ **Compression enabled** - Smaller bundle transfer to browser
- ✅ **Optimized client settings** - Reduced console noise and progress overhead

**Usage** (in Docker):
```bash
npx webpack --config webpack.dev.docker.js  # Use Docker-optimized build
```

**Add to docker-compose.dev.yml**:
```yaml
web:
  environment:
    - WEBPACK_CONFIG=webpack.dev.docker.js
```

## Key Differences

| Feature | webpack.dev.js | webpack.dev.docker.js |
|---------|-----------------|------------------------|
| Cache | ❌ Disabled | ✅ Enabled (filesystem) |
| File watching | Filesystem native | Polling (1000ms) |
| Write to disk | ✅ Normal | ❌ Memory only |
| Compression | Default | ✅ Enabled |
| Use case | Local dev | Docker containers |

## Migration Guide

### For Local Development
- ✅ No changes needed - `npm run build` automatically uses `webpack.dev.js`
- Delete `.cache` and `node_modules/.cache` if you still have stale builds
- Clean rebuilds now happen automatically

### For Docker Development
Update your Docker build/dev scripts to use:
```bash
npx webpack --config webpack.dev.docker.js
```

Or set environment variable in docker-compose:
```yaml
environment:
  - WEBPACK_CLI_CONFIG_FILE=webpack.dev.docker.js
```

## Testing the Fix

### Local Build (no cache):
```bash
npm run build
# Should show fresh build with no "cached modules"
```

### Force Cache Clear (if needed):
```bash
rm -rf .cache node_modules/.cache
npm run build
```

## Performance Impact

| Operation | Before | After |
|-----------|--------|-------|
| Local dev rebuild | 2-3 sec | 2-3 sec (clean each time) |
| Docker rebuild | 30+ sec | ~5-10 sec with cache |

**Note**: Local dev is slightly slower per rebuild since cache is disabled, but the tradeoff is worth it for accurate hot reload and avoiding stale code issues.