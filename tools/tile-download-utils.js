/**
 * Shared utilities for tile download scripts
 * Used by download_textuire_tiles.js and download_elevation_tiles.js
 */

const fs = require('fs');

/**
 * Calculate total number of tiles for a given max zoom level
 * @param {number} maxZoom - Maximum zoom level
 * @returns {number} Total number of tiles
 */
function getTotalTiles(maxZoom) {
    let total = 0;
    for (let z = 0; z <= maxZoom; z++) {
        const tilesPerSide = Math.pow(2, z);
        total += tilesPerSide * tilesPerSide;
    }
    return total;
}

/**
 * Create directory if it doesn't exist
 * @param {string} dirPath - Directory path to create
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Check if a tile file already exists and has content
 * Uses a single statSync call for better performance
 * @param {string} filePath - Path to the tile file
 * @returns {boolean} True if file exists and has content
 */
function tileExists(filePath) {
    try {
        const stats = fs.statSync(filePath);
        // Only consider file as existing if it has content (> 0 bytes)
        return stats.size > 0;
    } catch (err) {
        // File doesn't exist
        return false;
    }
}

/**
 * Process tiles in batches with smart delay logic
 * Only applies delays when actual downloads occurred (not when all files were skipped)
 * 
 * @param {Array} tiles - Array of tile coordinates {z, x, y}
 * @param {Function} downloadFn - Async function to download a tile, should return {skipped: boolean}
 * @param {Object} options - Configuration options
 * @param {number} options.batchSize - Number of tiles to process in parallel (default: 50)
 * @param {number} options.delayMs - Delay in milliseconds between batches with downloads (default: 200)
 */
async function processTilesInBatches(tiles, downloadFn, options = {}) {
    const { batchSize = 50, delayMs = 200 } = options;
    
    const promises = [];
    for (const tile of tiles) {
        promises.push(downloadFn(tile));
        
        // Process in batches
        if (promises.length >= batchSize) {
            const results = await Promise.all(promises);
            promises.length = 0;
            
            // Only delay if we actually downloaded files (not just skipped)
            const downloadedInBatch = results.filter(r => r && !r.skipped).length;
            if (downloadedInBatch > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    
    // Process remaining tiles
    if (promises.length > 0) {
        const results = await Promise.all(promises);
        const downloadedInBatch = results.filter(r => r && !r.skipped).length;
        if (downloadedInBatch > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

/**
 * Calculate the total size of a directory recursively
 * @param {string} dirPath - Directory path to calculate size for
 * @returns {number} Total size in bytes
 */
function calculateDirSize(dirPath) {
    let totalSize = 0;
    
    function traverse(currentPath) {
        if (!fs.existsSync(currentPath)) return;
        const files = fs.readdirSync(currentPath);
        for (const file of files) {
            const filePath = require('path').join(currentPath, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                traverse(filePath);
            } else {
                totalSize += stats.size;
            }
        }
    }
    
    traverse(dirPath);
    return totalSize;
}

module.exports = {
    getTotalTiles,
    ensureDir,
    tileExists,
    processTilesInBatches,
    calculateDirSize
};