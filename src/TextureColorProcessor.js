/**
 * Process a texture to apply color filtering
 * Sets all pixels to 10% intensity except pixels within colorDistance of target colors
 * which are set to bright yellow, with blending between minBlendDistance and colorDistance
 * 
 * @param {THREE.Texture} texture - The texture to process
 * @param {Object} options - Processing options
 * @param {number} options.colorDistance - Maximum color-space distance for highlighting (default: 6)
 * @param {number} options.minBlendDistance - Minimum distance where blending starts (default: 2)
 * @param {Array<Array<number>>} options.targetColors - Array of RGB color arrays to highlight (default: [[104,104,104], [111,103,110]])
 * @param {number} options.dimIntensity - Intensity for non-highlighted pixels (default: 0.1 = 10%)
 * @param {Array<number>} options.highlightColor - RGB color for highlighted pixels (default: [255,255,0] = yellow)
 * @returns {THREE.CanvasTexture} - The processed texture
 */
import {CanvasTexture} from "three";

export function processTextureColors(texture, options = {}) {
    const {
        colorDistance = 80,
        minBlendDistance = 40,
//        targetColors = [[222, 222, 222], [218, 218, 218]], // greys
        targetColors = [[232, 147, 163], [252, 214, 164], [247,250,190], [255,255,255]], // roads: pink (freeways), orange (highways), yellow (roads), white (streets))
        dimIntensity = 0.1,
        highlightColor = [255, 255, 0]
    } = options;

    // Create a canvas to process the texture
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Get the image from the texture
    const image = texture.image;
    canvas.width = image.width;
    canvas.height = image.height;
    
    // Draw the original image
    ctx.drawImage(image, 0, 0);
    
    // Get the image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // Calculate minimum distance to any target color
        let minDistance = Infinity;
        for (const targetColor of targetColors) {
            const dr = r - targetColor[0];
            const dg = g - targetColor[1];
            const db = b - targetColor[2];
            const distance = Math.sqrt(dr * dr + dg * dg + db * db);
            minDistance = Math.min(minDistance, distance);
        }
        
        // Determine the blend factor
        let blendFactor;
        if (minDistance <= minBlendDistance) {
            // Full highlight
            blendFactor = 1.0;
        } else if (minDistance >= colorDistance) {
            // Full dim
            blendFactor = 0.0;
        } else {
            // Blend between highlight and dim
            // Linear interpolation from 1.0 at minBlendDistance to 0.0 at colorDistance
            blendFactor = 1.0 - (minDistance - minBlendDistance) / (colorDistance - minBlendDistance);
        }


        // Calculate dimmed color (10% intensity)
        const dimR = r * dimIntensity;
        const dimG = g * dimIntensity;
        const dimB = b * dimIntensity;
        
        // Blend between highlight color and dimmed color
        data[i] = highlightColor[0] * blendFactor + dimR * (1 - blendFactor);
        data[i + 1] = highlightColor[1] * blendFactor + dimG * (1 - blendFactor);
        data[i + 2] = highlightColor[2] * blendFactor + dimB * (1 - blendFactor);
        // Keep alpha unchanged
        data[i + 3] = a;
    }
    
    // Put the processed image data back
    ctx.putImageData(imageData, 0, 0);
    
    // Create a new texture from the canvas
    const processedTexture = new CanvasTexture(canvas);
    processedTexture.needsUpdate = true;
    
    // Copy relevant properties from the original texture
    processedTexture.colorSpace = texture.colorSpace;
    processedTexture.minFilter = texture.minFilter;
    processedTexture.magFilter = texture.magFilter;
    processedTexture.wrapS = texture.wrapS;
    processedTexture.wrapT = texture.wrapT;
    
    return processedTexture;
}