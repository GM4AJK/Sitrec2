#!/usr/bin/env node

/**
 * Script to download ESRI World Imagery satellite tiles
 * Tiles are saved to sitrec-terrain/imagery/esri/z/y/x.jpg
 * 
 * Note: ESRI uses z/y/x format (not z/x/y like some other services)
 * 
 * Storage estimates:
 * - Zoom 0-3: ~10 MB (85 tiles)
 * - Zoom 0-4: ~40 MB (341 tiles)
 * - Zoom 0-5: ~160 MB (1,365 tiles)
 * - Zoom 0-6: ~640 MB (5,461 tiles)
 * - Zoom 0-7: ~2.5 GB (21,845 tiles)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { getTotalTiles, ensureDir, tileExists, calculateDirSize } = require('./tile-download-utils');

const BASE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'sitrec-terrain', 'imagery', 'esri');
const MAX_ZOOM = 7; // Start conservative - adjust as needed

const TOTAL_TILES = getTotalTiles(MAX_ZOOM);
let downloadedCount = 0;
let errorCount = 0;
let skippedCount = 0;

// Download a single tile
function downloadTile(z, x, y) {
    return new Promise((resolve, reject) => {
        // ESRI uses z/y/x format in the URL
        const url = `${BASE_URL}/${z}/${y}/${x}`;
        const outputPath = path.join(OUTPUT_DIR, String(z), String(y), `${x}.jpg`);
        
        // Check if file already exists - use optimized single filesystem check
        if (tileExists(outputPath)) {
            skippedCount++;
            if (skippedCount % 100 === 0 || downloadedCount + skippedCount <= 10) {
                console.log(`[${downloadedCount + skippedCount}/${TOTAL_TILES}] Skipping (exists): ${z}/${y}/${x}.jpg`);
            }
            resolve({ skipped: true });
            return;
        }
        
        // Ensure directory exists
        ensureDir(path.dirname(outputPath));
        
        const file = fs.createWriteStream(outputPath);
        
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                console.error(`[ERROR] Failed to download ${z}/${y}/${x}.jpg - Status: ${response.statusCode}`);
                errorCount++;
                file.close();
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath); // Remove empty file
                }
                resolve({ skipped: false }); // Continue with other downloads
                return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                downloadedCount++;
                console.log(`[${downloadedCount + skippedCount}/${TOTAL_TILES}] Downloaded: ${z}/${y}/${x}.jpg`);
                resolve({ skipped: false });
            });
        }).on('error', (err) => {
            file.close();
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath); // Remove partial file
            }
            console.error(`[ERROR] Failed to download ${z}/${y}/${x}.jpg:`, err.message);
            errorCount++;
            resolve({ skipped: false }); // Continue with other downloads
        });
    });
}

// Download all tiles for a given zoom level
async function downloadZoomLevel(z) {
    const tilesPerSide = Math.pow(2, z);
    const totalTilesThisZoom = tilesPerSide * tilesPerSide;
    console.log(`\n=== Downloading zoom level ${z} (${tilesPerSide}x${tilesPerSide} = ${totalTilesThisZoom} tiles) ===\n`);
    
    const promises = [];
    for (let x = 0; x < tilesPerSide; x++) {
        for (let y = 0; y < tilesPerSide; y++) {
            promises.push(downloadTile(z, x, y));
            
            // Process in batches of 50 for better performance
            if (promises.length >= 50) {
                const results = await Promise.all(promises);
                promises.length = 0;
                
                // Only delay if we actually downloaded files (not just skipped)
                const downloadedInBatch = results.filter(r => r && !r.skipped).length;
                if (downloadedInBatch > 0) {
                    // Small delay between download batches to be respectful to ESRI servers
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }
    
    // Process remaining tiles
    if (promises.length > 0) {
        const results = await Promise.all(promises);
        const downloadedInBatch = results.filter(r => r && !r.skipped).length;
        if (downloadedInBatch > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// Main function
async function main() {
    console.log('ESRI World Imagery Tile Downloader');
    console.log('========================================');
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log(`Max zoom level: ${MAX_ZOOM}`);
    console.log(`Total tiles to download: ${TOTAL_TILES}`);
    
    // Estimate storage
    const avgTileSize = 120; // KB (ESRI tiles are typically larger than elevation tiles)
    const estimatedSize = (TOTAL_TILES * avgTileSize / 1024).toFixed(1);
    console.log(`Estimated storage: ~${estimatedSize} MB`);
    console.log('========================================\n');
    
    const startTime = Date.now();
    
    // Ensure base output directory exists
    ensureDir(OUTPUT_DIR);
    
    // Download tiles for each zoom level
    for (let z = 0; z <= MAX_ZOOM; z++) {
        await downloadZoomLevel(z);
    }
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n========================================');
    console.log('Download Complete!');
    console.log(`Total tiles: ${TOTAL_TILES}`);
    console.log(`Successfully downloaded: ${downloadedCount}`);
    console.log(`Skipped (already exist): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Time taken: ${duration} seconds`);
    
    // Calculate actual storage used
    const totalSizeMB = (calculateDirSize(OUTPUT_DIR) / (1024 * 1024)).toFixed(2);
    console.log(`Actual storage used: ${totalSizeMB} MB`);
    console.log('========================================');
}

// Run the script
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});