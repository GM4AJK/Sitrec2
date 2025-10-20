# Sitrec Tools

This directory contains standalone tools for working with Sitrec data.

## Tile Download Scripts

### ESRI World Imagery Downloader

**File:** `download_texture_tiles.js`

Downloads ESRI World Imagery satellite tiles for offline/local caching.

```bash
./download_texture_tiles.js
```

### Elevation Tile Downloader

**File:** `download_elevation_tiles.js`

Downloads AWS Terrarium elevation tiles for offline terrain data.

```bash
./download_elevation_tiles.js
```

Both scripts:
- Support resume capability (re-run to download only missing tiles)
- Include progress tracking and error handling
- Save tiles to `sitrec-terrain/imagery/` and `sitrec-terrain/elevation/` respectively
- Use `__dirname` to automatically find the correct output paths
- Output directory is in `.gitignore` to avoid committing large tile caches

## LOS CSV Viewer

**File:** `los-viewer.html`

A standalone web application for visualizing Line of Sight (LOS) CSV data exported from Sitrec.

### Features

- **Ground Grid**: 1km grid (50km x 50km total area) with white lines on grey background
- **North Indicator**: Large red arrow at origin pointing north with "N" label
- **Track Visualization**: 3px thick red line showing the sensor path with spheres at each point
- **Ground Lines**: 1px blue lines connecting each track point to the ground
- **LOS Vectors**: Every 30th LOS vector displayed as green arrows extending to maxRange
- **Interactive Controls**: 
  - Left-click and drag to orbit around the track
  - Right-click and drag to pan
  - Scroll wheel to zoom in/out
  - Reset camera button to recenter view

### Usage

1. Export LOS data from Sitrec using the "CSV" button on a LOS node
2. Open `los-viewer.html` in a web browser
3. Click "Choose File" and select your exported CSV file
4. The visualization will automatically load and center on your track data

**Quick Test:** A sample CSV file (`sample-los.csv`) is included for testing the viewer.

### CSV Format

The viewer expects CSV files with the following format:
```
Time, SensorPositionX, SensorPositionY, SensorPositionZ, LOSUnitVectorX, LOSUnitVectorY, LOSUnitVectorZ, maxRange, LOSUncertaintyVertical, LOSUncertaintyHorizontal
```

Where:
- **Time**: Timestamp in milliseconds since epoch
- **SensorPosition**: X, Y, Z coordinates in ENU (East, North, Up) coordinate system (meters)
- **LOSUnitVector**: X, Y, Z components of the unit vector pointing along the line of sight
- **maxRange**: Maximum range for LOS visualization (meters). Special value `-1` indicates infinity (LOS doesn't intersect ground), which is displayed as 100km in the viewer
- **LOSUncertainty**: Vertical and horizontal uncertainty values

### Coordinate System

The viewer uses Three.js coordinate system:
- X-axis: East (red)
- Y-axis: Up (green)
- Z-axis: South (blue, opposite of North)

The CSV data is in ENU format and is automatically converted for proper visualization.

### Browser Compatibility

This tool uses modern web standards including:
- ES6 modules
- Import maps
- Three.js r180 (local copy)

Recommended browsers:
- Chrome 89+
- Firefox 108+
- Safari 16.4+
- Edge 89+

### Development

The viewer is a standalone HTML file with no build process required. It uses a local copy of Three.js r180 located in the `three.js/` directory.

To modify the visualization:
1. Edit `los-viewer.html`
2. Refresh your browser to see changes
3. No webpack rebuild needed (the file is copied as-is)

### Three.js Library

The `three.js/` directory contains just the essential Three.js files (core module + OrbitControls addon) downloaded from the CDN. This provides the simplicity of a single-file install while eliminating runtime CDN dependencies.