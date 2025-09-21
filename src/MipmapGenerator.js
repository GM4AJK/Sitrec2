import {CanvasTexture} from "three/src/textures/CanvasTexture";

/**
 * Generates mipmaps for a texture by creating progressively smaller filtered versions
 * Each level is half the resolution of the previous level
 */
export class MipmapGenerator {
    constructor() {
        this.mipmapCache = new Map(); // Cache generated mipmaps
    }

    /**
     * Generate a mipmap level for a given texture
     * @param {Texture} baseTexture - The original texture
     * @param {number} level - Mipmap level (0 = original, 1 = half size, etc.)
     * @returns {CanvasTexture} The generated mipmap texture
     */
    generateMipmapLevel(baseTexture, level) {
        if (level === 0) {
            return baseTexture;
        }

        const cacheKey = `${baseTexture.uuid}_${level}`;
        if (this.mipmapCache.has(cacheKey)) {
            return this.mipmapCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate dimensions for this mipmap level
        const originalWidth = baseTexture.image.width;
        const originalHeight = baseTexture.image.height;
        const scale = Math.pow(0.5, level);
        
        canvas.width = Math.max(1, Math.floor(originalWidth * scale));
        canvas.height = Math.max(1, Math.floor(originalHeight * scale));
        
        // Enable image smoothing for better filtering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw the scaled image
        ctx.drawImage(baseTexture.image, 0, 0, canvas.width, canvas.height);
        
        // Create texture from canvas
        const mipmapTexture = new CanvasTexture(canvas);
        mipmapTexture.needsUpdate = true;
        
        // Copy texture properties from original
        mipmapTexture.wrapS = baseTexture.wrapS;
        mipmapTexture.wrapT = baseTexture.wrapT;
        mipmapTexture.magFilter = baseTexture.magFilter;
        mipmapTexture.minFilter = baseTexture.minFilter;
        
        // Cache the generated mipmap
        this.mipmapCache.set(cacheKey, mipmapTexture);
        
        return mipmapTexture;
    }

    /**
     * Generate mipmaps for tiled textures based on zoom level
     * Creates a proper mipmap chain where each level is generated from the previous level
     * @param {Texture} baseTexture - The original seamless texture
     * @param {number} currentZoom - Current zoom level
     * @param {number} maxZoom - Maximum zoom level for this texture
     * @returns {CanvasTexture} The appropriate mipmap for this zoom level
     */
    generateTiledMipmap(baseTexture, currentZoom, maxZoom) {
        if (currentZoom > maxZoom) {
            console.log(`MipmapGenerator: Using original texture for zoom ${currentZoom} (> maxZoom ${maxZoom})`);
            return baseTexture;
        }

        const cacheKey = `tiled_${baseTexture.uuid}_${currentZoom}_${maxZoom}`;
        if (this.mipmapCache.has(cacheKey)) {
//            console.log(`MipmapGenerator: Using cached mipmap for zoom ${currentZoom}`);
            return this.mipmapCache.get(cacheKey);
        }

//        console.log(`MipmapGenerator: Generating mipmap for zoom ${currentZoom} from maxZoom ${maxZoom}`);
        
        // Generate the mipmap chain from maxZoom down to currentZoom
        let currentTexture = baseTexture;
        
        // Build the chain from maxZoom down to currentZoom
        for (let zoom = maxZoom - 1; zoom >= currentZoom; zoom--) {
            const levelCacheKey = `tiled_${baseTexture.uuid}_${zoom}_${maxZoom}`;
            
            if (this.mipmapCache.has(levelCacheKey)) {
                currentTexture = this.mipmapCache.get(levelCacheKey);
                continue;
            }
            
            // Generate this level from the previous (higher resolution) level
            currentTexture = this.generateNextMipmapLevel(currentTexture, baseTexture.uuid, zoom, maxZoom);
        }
        
        return currentTexture;
    }

    /**
     * Generate the next mipmap level (one level lower resolution)
     * @param {Texture} sourceTexture - The source texture to downsample
     * @param {string} baseUuid - UUID of the original base texture for caching
     * @param {number} targetZoom - The zoom level we're generating
     * @param {number} maxZoom - Maximum zoom level
     * @returns {CanvasTexture} The downsampled texture
     */
    generateNextMipmapLevel(sourceTexture, baseUuid, targetZoom, maxZoom) {
        const cacheKey = `tiled_${baseUuid}_${targetZoom}_${maxZoom}`;
        
//        console.log(`MipmapGenerator: Generating mipmap level ${targetZoom} (2x2 downsample)`);
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Use the original texture size
        canvas.width = sourceTexture.image.width;
        canvas.height = sourceTexture.image.height;
        
        // Enable high-quality image smoothing for better filtering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Create a 2x2 tiled version of the source texture, then scale it down
        // This simulates the effect of viewing 4 tiles as 1 tile at the next zoom level
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width * 2;
        tempCanvas.height = canvas.height * 2;
        
        // Draw 2x2 pattern
        tempCtx.drawImage(sourceTexture.image, 0, 0);
        tempCtx.drawImage(sourceTexture.image, canvas.width, 0);
        tempCtx.drawImage(sourceTexture.image, 0, canvas.height);
        tempCtx.drawImage(sourceTexture.image, canvas.width, canvas.height);
        
        // Scale down to original size with filtering
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        
        // Create texture from canvas
        const mipmapTexture = new CanvasTexture(canvas);
        mipmapTexture.needsUpdate = true;
        
        // Copy texture properties from source
        mipmapTexture.wrapS = sourceTexture.wrapS;
        mipmapTexture.wrapT = sourceTexture.wrapT;
        mipmapTexture.magFilter = sourceTexture.magFilter;
        mipmapTexture.minFilter = sourceTexture.minFilter;
        
        // Cache the generated mipmap
        this.mipmapCache.set(cacheKey, mipmapTexture);
        
        // Clean up temporary canvas
        tempCanvas.remove();
        
        return mipmapTexture;
    }

    /**
     * Clear all cached mipmaps
     */
    clearCache() {
        this.mipmapCache.forEach((texture) => {
            texture.dispose();
        });
        this.mipmapCache.clear();
    }

    /**
     * Clear mipmaps for a specific base texture
     */
    clearTextureCache(baseTextureUuid) {
        const keysToDelete = [];
        this.mipmapCache.forEach((texture, key) => {
            if (key.startsWith(baseTextureUuid) || key.includes(`_${baseTextureUuid}_`)) {
                texture.dispose();
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.mipmapCache.delete(key));
    }
}

// Global instance
export const globalMipmapGenerator = new MipmapGenerator();