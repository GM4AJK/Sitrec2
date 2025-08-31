import {Sit} from "./Globals";
import {loadImage} from "./utils";
import {CVideoData} from "./CVideoData";
import {H264Decoder} from "./H264Decoder";
import {updateSitFrames} from "./UpdateSitFrames";
import {EventManager} from "./CEventManager";

/**
 * Video data handler for raw H.264 elementary streams
 * These are typically extracted from TS files and lack MP4 container structure
 */
export class CVideoH264Data extends CVideoData {

    constructor(v, loadedCallback, errorCallback) {
        super(v);

        this.format = "h264"
        this.error = false;
        this.loaded = false;
        this.loadedCallback = loadedCallback;
        this.errorCallback = errorCallback;

        this.incompatible = true;
        try {
            if (VideoDecoder !== undefined) {
                this.incompatible = false;
            }
        } catch (e) {
        }

        if (this.incompatible) {
            console.log("H.264 Video Playback Requires up-to-date WebCodec Browser (Chrome/Edge/Safari)");
            this.errorImage = null;
            loadImage('./data/images/errorImage.png').then(result => {
                this.errorImage = result;
                if (errorCallback) errorCallback("WebCodec not supported");
            });
            return;
        }

        // Try to decode H.264 directly using WebCodecs
        this.tryDirectDecoding(v, loadedCallback, errorCallback);
    }

    getImage(frame) {
        if (this.errorImage) {
            return this.errorImage;
        }
        
        if (this.loaded && this.frames && this.frames.length > 0) {
            // Get frame index, wrapping around if necessary
            const frameIndex = Math.floor(frame) % this.frames.length;
            return this.frames[frameIndex];
        }
        
        return null;
    }

    update() {
        // Nothing to update for error state
    }

    stopStreaming() {
        // Clean up resources
        if (this.frames) {
            // Close all ImageBitmap objects to free memory
            this.frames.forEach(bitmap => {
                if (bitmap && typeof bitmap.close === 'function') {
                    bitmap.close();
                }
            });
            this.frames = [];
        }
    }

    async tryDirectDecoding(v, loadedCallback, errorCallback) {
        try {
            console.log("Attempting to decode H.264 stream directly...");
            
            let h264Buffer;
            
            // Get the H.264 data from either file or buffer
            if (v.dropFile) {
                // Read the dropped file
                const arrayBuffer = await this.readFileAsArrayBuffer(v.dropFile);
                h264Buffer = arrayBuffer;
            } else if (v.buffer) {
                h264Buffer = v.buffer;
            } else {
                throw new Error("No H.264 data available");
            }

            console.log(`H.264 data size: ${h264Buffer.byteLength} bytes`);

            console.log("Analyzing H.264 stream...");

            this.frames = [];
            this.currentFrame = 0;
            this.loaded = false;
            this.imageWidth = 0;
            this.imageHeight = 0;

            console.log("Decoding H.264 frames...");

            // Decode H.264 frames directly
            try {
                const decoder = await H264Decoder.createDecoder(h264Buffer, {
                    fps: 30,
                    onFrame: (frame) => {
                        // Set dimensions from first frame
                        if (this.imageWidth === 0) {
                            this.imageWidth = frame.displayWidth || frame.codedWidth;
                            this.imageHeight = frame.displayHeight || frame.codedHeight;
                            console.log(`Video dimensions: ${this.imageWidth}x${this.imageHeight}`);
                        }

                        // Create ImageBitmap from VideoFrame for storage
                        createImageBitmap(frame).then(bitmap => {
                            this.frames.push(bitmap);
                            
                            // Log progress occasionally
                            if (this.frames.length % 30 === 0) {
                                console.log(`Decoded ${this.frames.length} frames...`);
                            }
                        });
                        frame.close();
                    },
                    onError: (error) => {
                        console.error("Decoder error:", error);
                        if (typeof errorCallback === 'function') {
                            errorCallback(error);
                        }
                    }
                });

                // Extract and decode NAL units
                const nalUnits = H264Decoder.extractNALUnits(new Uint8Array(h264Buffer));
                const chunks = H264Decoder.createEncodedVideoChunks(nalUnits, 30);

                console.log(`Decoding ${chunks.length} video chunks...`);

                // Decode all chunks
                for (const chunk of chunks) {
                    decoder.decode(chunk);
                }

                // Wait for decoding to complete
                await decoder.flush();
                decoder.close();

                console.log(`Successfully decoded ${this.frames.length} frames`);

                // Mark as loaded
                this.loaded = true;
                this.error = false;

                // Set global video properties (similar to CVideoWebCodecDataRaw)
                Sit.videoFrames = this.frames.length;
                Sit.fps = 30; // Default FPS, could be extracted from stream analysis

                updateSitFrames();

                console.log(`H.264 decoding complete: ${this.frames.length} frames, ${this.imageWidth}x${this.imageHeight}`);

                // Call the loaded callback with this video data object
                if (typeof loadedCallback === 'function') {
                    loadedCallback(this);
                }

                // Dispatch video loaded event
                EventManager.dispatchEvent("videoLoaded", {
                    videoData: this, 
                    width: this.imageWidth, 
                    height: this.imageHeight
                });

            } catch (decodingError) {
                console.error("H.264 decoding failed:", decodingError);
                
                // Provide helpful error message to user
                const errorMsg = `Failed to decode H.264: ${decodingError.message}. ` +
                    `This may be due to missing SPS/PPS parameters, unsupported H.264 profile, or corrupted data. ` +
                    `Try using a different H.264 file with Baseline profile.`;
                
                if (typeof errorCallback === 'function') {
                    errorCallback(new Error(errorMsg));
                }
                return;
            }

        } catch (error) {
            console.error("Failed to decode H.264:", error);
            console.warn("Falling back to error state");
            
            this.errorImage = null;
            loadImage('./data/images/errorImage.png').then(result => {
                this.errorImage = result;
                if (errorCallback) errorCallback(`H.264 decoding failed: ${error.message}`);
            });
        }
    }

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }
}