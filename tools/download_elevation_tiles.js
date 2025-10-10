#!/usr/bin/env node

/**
 * Script to download AWS Terrarium elevation tiles up to zoom level 3
 * Tiles are saved to sitrec-terrain/elevation/z/x/y.png
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { getTotalTiles, ensureDir, tileExists } = require('./tile-download-utils');

const BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'sitrec-terrain', 'elevation');
const MAX_ZOOM = 5;

const TOTAL_TILES = getTotalTiles(MAX_ZOOM);
let downloadedCount = 0;
let errorCount = 0;
let skippedCount = 0;

// Download a single tile
function downloadTile(z, x, y) {
    return new Promise((resolve, reject) => {
        const url = `${BASE_URL}/${z}/${x}/${y}.png`;
        const outputPath = path.join(OUTPUT_DIR, String(z), String(x), `${y}.png`);
        
        // Check if file already exists - use optimized single filesystem check
        if (tileExists(outputPath)) {
            skippedCount++;
            if (skippedCount % 100 === 0 || downloadedCount + skippedCount <= 10) {
                console.log(`[${downloadedCount + skippedCount}/${TOTAL_TILES}] Skipping (exists): ${z}/${x}/${y}.png`);
            }
            resolve({ skipped: true });
            return;
        }
        
        // Ensure directory exists
        ensureDir(path.dirname(outputPath));
        
        const file = fs.createWriteStream(outputPath);
        
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                console.error(`[ERROR] Failed to download ${z}/${x}/${y}.png - Status: ${response.statusCode}`);
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
                console.log(`[${downloadedCount + skippedCount}/${TOTAL_TILES}] Downloaded: ${z}/${x}/${y}.png`);
                resolve({ skipped: false });
            });
        }).on('error', (err) => {
            file.close();
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath); // Remove partial file
            }
            console.error(`[ERROR] Failed to download ${z}/${x}/${y}.png:`, err.message);
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
                    // Small delay between download batches to be respectful to AWS servers
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }
    }
    
    // Process remaining tiles
    if (promises.length > 0) {
        const results = await Promise.all(promises);
        const downloadedInBatch = results.filter(r => r && !r.skipped).length;
        if (downloadedInBatch > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

// Main function
async function main() {
    console.log('AWS Terrarium Elevation Tile Downloader');
    console.log('========================================');
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log(`Max zoom level: ${MAX_ZOOM}`);
    console.log(`Total tiles to download: ${TOTAL_TILES}`);
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
    console.log('========================================');
}

// Run the script
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});