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
        const codecString = this.createH264CodecString(analysis.spsData);
        const config = {
            codec: codecString,
            description: this.createAVCDecoderConfig(analysis.spsData, analysis.ppsData)
        };

        console.log("Decoder config:", config);

        // Create VideoDecoder
        const decoder = new VideoDecoder({
            output: onFrame,
            error: onError
        });

        // Configure the decoder with error handling
        try {
            console.log("Configuring VideoDecoder...");
            
            // Check if codec is supported first
            if (!VideoDecoder.isConfigSupported) {
                console.warn("VideoDecoder.isConfigSupported not available, skipping codec check");
            } else {
                const supportCheck = await VideoDecoder.isConfigSupported(config);
                console.log("Codec support check:", supportCheck);
                
                if (!supportCheck.supported) {
                    throw new Error(`H.264 codec not supported: ${config.codec}`);
                }
            }
            
            await decoder.configure(config);
            console.log("H.264 decoder configured successfully");
            
        } catch (error) {
            console.error("VideoDecoder configuration failed:", error);
            decoder.close();
            throw new Error(`Failed to configure VideoDecoder: ${error.message}`);
        }

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
     * Create H.264 codec string from SPS data
     * Format: avc1.PPCCLL where PP=profile, CC=compatibility, LL=level
     */
    static createH264CodecString(spsData) {
        if (spsData.length < 4) {
            throw new Error('SPS data too short for codec string generation');
        }
        
        const profileIdc = spsData[1];
        const profileCompatibility = spsData[2];
        const levelIdc = spsData[3];
        
        // Create codec string in format avc1.PPCCLL
        const codecString = `avc1.${profileIdc.toString(16).padStart(2, '0').toUpperCase()}${profileCompatibility.toString(16).padStart(2, '0').toUpperCase()}${levelIdc.toString(16).padStart(2, '0').toUpperCase()}`;
        
        console.log('Generated H.264 codec string:', codecString);
        return codecString;
    }

    /**
     * Create AVC decoder configuration from SPS/PPS data
     */
    static createAVCDecoderConfig(spsData, ppsData) {
        // Create proper AVCC format configuration
        // Reference: ISO/IEC 14496-15 Section 5.2.4.1
        console.log('Creating AVCC config with SPS:', spsData.length, 'bytes, PPS:', ppsData.length, 'bytes');
        
        // Parse SPS for profile/level information
        if (spsData.length < 4) {
            throw new Error('SPS data too short');
        }
        
        const profileIdc = spsData[1];
        const profileCompatibility = spsData[2]; 
        const levelIdc = spsData[3];
        
        console.log('SPS Profile/Level:', {
            profile: profileIdc.toString(16),
            compatibility: profileCompatibility.toString(16),
            level: levelIdc.toString(16)
        });

        // Calculate total size needed
        const configSize = 6 + // AVCC header
                          2 + spsData.length + // SPS
                          1 + 2 + ppsData.length; // PPS
                          
        const config = new Uint8Array(configSize);
        let offset = 0;

        // AVCC header (6 bytes)
        config[offset++] = 0x01; // configurationVersion
        config[offset++] = profileIdc; // AVCProfileIndication
        config[offset++] = profileCompatibility; // profile_compatibility
        config[offset++] = levelIdc; // AVCLevelIndication
        config[offset++] = 0xFF; // lengthSizeMinusOne (4-byte length fields)
        config[offset++] = 0xE1; // numOfSequenceParameterSets (1 SPS)

        // SPS data
        config[offset++] = (spsData.length >> 8) & 0xFF; // SPS length high byte
        config[offset++] = spsData.length & 0xFF;        // SPS length low byte
        config.set(spsData, offset);
        offset += spsData.length;

        // PPS data
        config[offset++] = 0x01; // numOfPictureParameterSets (1 PPS)
        config[offset++] = (ppsData.length >> 8) & 0xFF; // PPS length high byte
        config[offset++] = ppsData.length & 0xFF;        // PPS length low byte
        config.set(ppsData, offset);
        offset += ppsData.length;

        console.log('Created AVCC config:', config.length, 'bytes');
        console.log('AVCC header:', Array.from(config.slice(0, 6)).map(x => '0x' + x.toString(16).padStart(2, '0')).join(' '));
        
        return config.buffer;
    }

    /**
     * Create EncodedVideoChunk objects from NAL units with proper frame aggregation
     */
    static createEncodedVideoChunks(nalUnits, fps) {
        const chunks = [];
        const frameDuration = 1000000 / fps; // Duration in microseconds
        let timestamp = 0;

        // Group NAL units into frames
        const frames = this.groupNALUnitsIntoFrames(nalUnits);
        console.log(`Grouped ${nalUnits.length} NAL units into ${frames.length} frames`);

        for (const frame of frames) {
            if (frame.nalUnits.length === 0) continue;

            // Create aggregated frame data
            const frameData = this.createAggregatedFrame(frame.nalUnits);
            
            chunks.push(new EncodedVideoChunk({
                type: frame.type,
                timestamp: timestamp,
                duration: frameDuration,
                data: frameData
            }));
            timestamp += frameDuration;
        }

        return chunks;
    }

    /**
     * Group NAL units into complete frames
     */
    static groupNALUnitsIntoFrames(nalUnits) {
        const frames = [];
        let currentFrame = {
            type: null,
            nalUnits: []
        };

        for (const nal of nalUnits) {
            const nalType = nal.data[0] & 0x1F;
            
            if (nalType === 5) {
                // IDR frame - start new keyframe
                if (currentFrame.nalUnits.length > 0) {
                    frames.push(currentFrame);
                }
                currentFrame = {
                    type: 'key',
                    nalUnits: [nal]
                };
                
            } else if (nalType === 1) {
                // P frame - start new delta frame
                if (currentFrame.nalUnits.length > 0) {
                    frames.push(currentFrame);
                }
                currentFrame = {
                    type: 'delta',
                    nalUnits: [nal]
                };
                
            } else if (nalType === 6) {
                // SEI - add to current frame if we have one with video data
                if (currentFrame.nalUnits.length > 0 && currentFrame.type !== null) {
                    currentFrame.nalUnits.push(nal);
                }
                // If no current frame or current frame has no video data, ignore orphaned SEI
                
            } else if (nalType === 9) {
                // Access Unit Delimiter - frame boundary marker
                if (currentFrame.nalUnits.length > 0) {
                    frames.push(currentFrame);
                    currentFrame = {
                        type: null,
                        nalUnits: []
                    };
                }
            }
            // Skip SPS/PPS (types 7, 8) - they go in decoder config only
        }

        // Add final frame
        if (currentFrame.nalUnits.length > 0) {
            frames.push(currentFrame);
        }

        // Filter out frames without video data
        return frames.filter(frame => frame.type !== null);
    }

    /**
     * Create aggregated frame data from multiple NAL units
     */
    static createAggregatedFrame(nalUnits) {
        // Calculate total size needed
        let totalSize = 0;
        for (const nal of nalUnits) {
            totalSize += 4 + nal.data.length; // 4 bytes length prefix + NAL data
        }

        // Create aggregated buffer
        const frameBuffer = new ArrayBuffer(totalSize);
        const frameView = new Uint8Array(frameBuffer);
        const dataView = new DataView(frameBuffer);
        
        let offset = 0;
        for (const nal of nalUnits) {
            // Write length prefix (big-endian 32-bit) - AVCC format
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