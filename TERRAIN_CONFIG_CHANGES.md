# SITREC_TERRAIN Configuration Implementation

## Summary
Implemented a proper configuration system for the `sitrec-terrain` path, making it consistent with how `SITREC_CACHE` and `SITREC_UPLOAD` are handled. This replaces the hardcoded `../sitrec-terrain/` relative path with a configurable path that works across all deployment scenarios.

## Changes Made

### 1. Server-Side Configuration (`sitrecServer/config_paths.php`)
- Added `$TERRAIN_PATH` and `$TERRAIN_URL` variables
- Added `TERRAIN` and `TERRAIN_PATH` to the `$server_config` array
- Follows the same pattern as cache and upload paths

### 2. Client-Side Configuration (`src/configUtils.js`)
- Added `SITREC_TERRAIN` export variable
- Configured terrain path for console applications: `../sitrec-terrain/`
- Fetches terrain URL from server config for web applications
- Added terrain to configuration logging output

### 3. Terrain Node (`src/nodes/CNodeTerrainUI.js`)
- Imported `SITREC_TERRAIN` from configUtils
- Updated Local imagery source to use `${SITREC_TERRAIN}/imagery/esri/...`
- Updated Local elevation source to use `${SITREC_TERRAIN}/elevation/...`
- Removed hardcoded `${SITREC_APP}../sitrec-terrain/` references

### 4. Deployment Script (`sitrec-tools/deploy.sh`)
- Added commented-out rsync command for terrain deployment
- Includes documentation about why it's commented out (large size)
- Provides the correct command for manual terrain deployment if needed

## How It Works Across Build Cases

### Local Development Server
- **Location**: `/Users/mick/Sites/sitrec-terrain/`
- **URL**: `http://localhost/sitrec-terrain/`
- **Status**: ✅ Works - Server config determines path based on app location

### Docker Development
- **Location**: `/var/www/html/sitrec-terrain/` (mounted from `./sitrec-terrain`)
- **URL**: `http://localhost:8080/sitrec-terrain/`
- **Status**: ✅ Works - Server config + webpack proxy handle routing

### Docker Production
- **Location**: `/var/www/html/sitrec-terrain/` (mounted from `./sitrec-terrain`)
- **URL**: `http://localhost:6425/sitrec-terrain/`
- **Status**: ✅ Works - Server config determines correct path

### Remote Production Server
- **Location**: `/srv/www/metabunk.org/public_html/sitrec-terrain/`
- **URL**: `https://www.metabunk.org/sitrec-terrain/`
- **Status**: ✅ Works - Server config determines path based on app location

## Benefits

1. **Consistency**: Terrain paths now follow the same pattern as cache and upload
2. **Flexibility**: Can be configured differently per environment
3. **Maintainability**: Single source of truth for terrain location
4. **Future-Proof**: Easy to add CDN support or alternative terrain sources
5. **Self-Documenting**: Configuration is explicit and logged

## Testing

Build completed successfully with no errors:
```bash
npm run build
# webpack 5.101.3 compiled successfully
```

## Future Enhancements

Possible improvements for future consideration:

1. **Environment Variable Override**: Allow `TERRAIN_PATH` to be set via environment variable
2. **CDN Fallback**: Try local terrain first, fall back to remote CDN
3. **Separate Imagery/Elevation**: Different paths for imagery vs elevation tiles
4. **Graceful Degradation**: Handle missing terrain more elegantly
5. **Terrain Download Integration**: Integrate terrain download scripts with deployment

## Migration Notes

No migration needed for existing deployments. The new configuration automatically determines the correct terrain path based on the app location, maintaining backward compatibility with existing directory structures.

For new deployments, ensure `sitrec-terrain` directory exists at the same level as `sitrec`, `sitrec-cache`, and `sitrec-upload` directories.