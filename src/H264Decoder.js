/**
 * H264Decoder - Direct H.264 decoding using WebCodecs
 * 
 * This utility directly decodes raw H.264 elementary streams using the browser's
 * native WebCodecs API without requiring MP4 container conversion.
 */

export class H264Decoder {
    
    /**
     * Create a WebCodecs VideoDecoder for H.264 data
     * @param {ArrayBuffer} h264Data - Raw H.264 elementary stream
     * @param {Object} options - Configuration options
     * @param {number} options.fps - Frame rate (default: 30)
     * @param {Function} options.onFrame - Callback for decoded frames
     * @param {Function} options.onError - Error callback
     * @returns {Promise<VideoDecoder>} Configured VideoDecoder
     */
    static async createDecoder(h264Data, options = {}) {
        console.log("Creating H.264 WebCodecs decoder...");

        // Parse H.264 to extract information
        const analysis = this.analyzeH264Stream(h264Data);
        
        console.log("H.264 Stream Analysis:", analysis);

        if (!analysis.hasSPS || !analysis.hasPPS) {
            throw new Error(
                `H.264 stream missing required parameters: ` +
                `${analysis.hasSPS ? 'has' : 'missing'} SPS, ` +
                `${analysis.hasPPS ? 'has' : 'missing'} PPS`
            );
        }

        const { 
            fps = 30,
            onFrame = (frame) => console.log("Decoded frame:", frame),
            onError = (error) => console.error("Decoder error:", error)
        } = options;

        // Create decoder configuration from SPS/PPS
        const config = {
            codec: 'avc1.42E01E', // H.264 Baseline Profile
            description: this.createAVCDecoderConfig(analysis.spsData, analysis.ppsData)
        };

        console.log("Decoder config:", config);

        // Create VideoDecoder
        const decoder = new VideoDecoder({
            output: onFrame,
            error: onError
        });

        // Configure the decoder
        await decoder.configure(config);

        console.log("H.264 decoder created successfully");
        return decoder;
    }

    /**
     * Decode H.264 frames and render to canvas
     * @param {ArrayBuffer} h264Data - Raw H.264 elementary stream
     * @param {HTMLCanvasElement} canvas - Target canvas
     * @param {Object} options - Configuration options
     * @returns {Promise<void>}
     */
    static async decodeToCanvas(h264Data, canvas, options = {}) {
        const ctx = canvas.getContext('2d');
        let frameCount = 0;

        const decoder = await this.createDecoder(h264Data, {
            ...options,
            onFrame: (frame) => {
                // Draw frame to canvas
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
                ctx.drawImage(frame, 0, 0);
                frame.close();
                frameCount++;
                console.log(`Rendered frame ${frameCount}`);
            }
        });

        // Extract and decode NAL units
        const nalUnits = this.extractNALUnits(new Uint8Array(h264Data));
        const chunks = this.createEncodedVideoChunks(nalUnits, options.fps || 30);

        console.log(`Decoding ${chunks.length} video chunks...`);

        // Decode all chunks
        for (const chunk of chunks) {
            decoder.decode(chunk);
        }

        // Wait for decoding to complete
        await decoder.flush();
        decoder.close();

        console.log(`Decoding complete. Rendered ${frameCount} frames.`);
    }

    /**
     * Create AVC decoder configuration from SPS/PPS data
     */
    static createAVCDecoderConfig(spsData, ppsData) {
        // Create AVCC format configuration
        // This is a simplified version - a full implementation would parse SPS/PPS properly
        const config = new Uint8Array(spsData.length + ppsData.length + 11);
        let offset = 0;

        // AVCC header
        config[offset++] = 0x01; // configurationVersion
        config[offset++] = spsData[1]; // AVCProfileIndication
        config[offset++] = spsData[2]; // profile_compatibility
        config[offset++] = spsData[3]; // AVCLevelIndication
        config[offset++] = 0xFF; // lengthSizeMinusOne (4 bytes)
        config[offset++] = 0xE1; // numOfSequenceParameterSets (1)

        // SPS length and data
        config[offset++] = (spsData.length >> 8) & 0xFF;
        config[offset++] = spsData.length & 0xFF;
        config.set(spsData, offset);
        offset += spsData.length;

        // PPS count and data
        config[offset++] = 0x01; // numOfPictureParameterSets (1)
        config[offset++] = (ppsData.length >> 8) & 0xFF;
        config[offset++] = ppsData.length & 0xFF;
        config.set(ppsData, offset);

        return config.buffer;
    }

    /**
     * Create EncodedVideoChunk objects from NAL units
     */
    static createEncodedVideoChunks(nalUnits, fps) {
        const chunks = [];
        const frameDuration = 1000000 / fps; // Duration in microseconds
        let timestamp = 0;

        // Group NAL units into frames
        let currentFrame = [];
        let isKeyFrame = false;

        for (const nal of nalUnits) {
            const nalType = nal.data[0] & 0x1F;
            
            if (nalType === 7 || nalType === 8) {
                // SPS/PPS - add to current frame
                currentFrame.push(nal);
            } else if (nalType === 5) {
                // IDR frame - keyframe
                currentFrame.push(nal);
                isKeyFrame = true;
                
                // Create chunk for this frame
                if (currentFrame.length > 0) {
                    const frameData = this.combineNALUnits(currentFrame);
                    chunks.push(new EncodedVideoChunk({
                        type: isKeyFrame ? 'key' : 'delta',
                        timestamp: timestamp,
                        duration: frameDuration,
                        data: frameData
                    }));
                    
                    timestamp += frameDuration;
                    currentFrame = [];
                    isKeyFrame = false;
                }
            } else if (nalType === 1) {
                // P frame - delta frame
                currentFrame.push(nal);
                
                // Create chunk for this frame
                if (currentFrame.length > 0) {
                    const frameData = this.combineNALUnits(currentFrame);
                    chunks.push(new EncodedVideoChunk({
                        type: 'delta',
                        timestamp: timestamp,
                        duration: frameDuration,
                        data: frameData
                    }));
                    
                    timestamp += frameDuration;
                    currentFrame = [];
                }
            }
        }

        // Handle any remaining frame data
        if (currentFrame.length > 0) {
            const frameData = this.combineNALUnits(currentFrame);
            chunks.push(new EncodedVideoChunk({
                type: isKeyFrame ? 'key' : 'delta',
                timestamp: timestamp,
                duration: frameDuration,
                data: frameData
            }));
        }

        return chunks;
    }

    /**
     * Combine multiple NAL units into a single frame buffer (AVCC format)
     */
    static combineNALUnits(nalUnits) {
        let totalSize = 0;
        
        // Calculate total size needed
        for (const nal of nalUnits) {
            totalSize += 4 + nal.data.length; // 4 bytes for length prefix + NAL data
        }

        const frameBuffer = new ArrayBuffer(totalSize);
        const frameView = new Uint8Array(frameBuffer);
        const dataView = new DataView(frameBuffer);
        
        let offset = 0;
        
        // Write each NAL unit with length prefix (AVCC format)
        for (const nal of nalUnits) {
            // Write length prefix (big-endian 32-bit)
            dataView.setUint32(offset, nal.data.length, false);
            offset += 4;
            
            // Write NAL unit data
            frameView.set(nal.data, offset);
            offset += nal.data.length;
        }

        return frameBuffer;
    }

    /**
     * Extract individual NAL units from H.264 stream
     */
    static extractNALUnits(data) {
        const nalUnits = [];

        for (let i = 0; i < data.length - 4; i++) {
            // Look for NAL unit start codes
            if (data[i] === 0x00 && data[i + 1] === 0x00) {
                let nalStart = -1;
                let startCodeLength = 0;
                
                if (data[i + 2] === 0x01) {
                    nalStart = i + 3;
                    startCodeLength = 3;
                } else if (data[i + 2] === 0x00 && data[i + 3] === 0x01) {
                    nalStart = i + 4;
                    startCodeLength = 4;
                }

                if (nalStart !== -1 && nalStart < data.length) {
                    // Find end of this NAL unit
                    let nalEnd = data.length;
                    for (let j = nalStart + 1; j < data.length - 3; j++) {
                        if (data[j] === 0x00 && data[j + 1] === 0x00 && 
                            (data[j + 2] === 0x01 || (data[j + 2] === 0x00 && data[j + 3] === 0x01))) {
                            nalEnd = j;
                            break;
                        }
                    }

                    nalUnits.push({
                        start: i,
                        startCodeLength: startCodeLength,
                        data: data.slice(nalStart, nalEnd)
                    });

                    i = nalEnd - 1; // Skip to end of this NAL unit
                }
            }
        }

        return nalUnits;
    }

    /**
     * Analyze H.264 stream to extract metadata
     */
    static analyzeH264Stream(h264Data) {
        const data = new Uint8Array(h264Data);
        const analysis = {
            nalUnits: 0,
            hasSPS: false,
            hasPPS: false,
            hasIDR: false,
            spsData: null,
            ppsData: null,
            totalSize: h264Data.byteLength
        };

        for (let i = 0; i < data.length - 4; i++) {
            // Look for NAL unit start codes (0x00 0x00 0x01 or 0x00 0x00 0x00 0x01)
            if (data[i] === 0x00 && data[i + 1] === 0x00) {
                let nalStart = -1;
                if (data[i + 2] === 0x01) {
                    nalStart = i + 3;
                } else if (data[i + 2] === 0x00 && data[i + 3] === 0x01) {
                    nalStart = i + 4;
                }

                if (nalStart !== -1 && nalStart < data.length) {
                    const nalType = data[nalStart] & 0x1F;
                    analysis.nalUnits++;
                    
                    // Find end of this NAL unit
                    let nalEnd = data.length;
                    for (let j = nalStart + 1; j < data.length - 3; j++) {
                        if (data[j] === 0x00 && data[j + 1] === 0x00 && 
                            (data[j + 2] === 0x01 || (data[j + 2] === 0x00 && data[j + 3] === 0x01))) {
                            nalEnd = j;
                            break;
                        }
                    }

                    if (nalType === 7) { // SPS
                        analysis.hasSPS = true;
                        analysis.spsData = data.slice(nalStart, nalEnd);
                        console.log(`Found SPS NAL unit: ${analysis.spsData.length} bytes`);
                    } else if (nalType === 8) { // PPS
                        analysis.hasPPS = true;
                        analysis.ppsData = data.slice(nalStart, nalEnd);
                        console.log(`Found PPS NAL unit: ${analysis.ppsData.length} bytes`);
                    } else if (nalType === 5) { // IDR
                        analysis.hasIDR = true;
                    }
                }
            }
        }

        return analysis;
    }



}