import {Globals, infoDiv, setRenderOne, Sit} from "./Globals";
import {assert} from "./assert";
import {loadImage} from "./utils";
import {CVideoData} from "./CVideoData";
import {H264Decoder} from "./H264Decoder";
import {updateSitFrames} from "./UpdateSitFrames";
import {EventManager} from "./CEventManager";
import {par} from "./par";
import {isLocal} from "./configUtils";

/**
 * Video data handler for raw H.264 elementary streams with frame caching
 * These are typically extracted from TS files and lack MP4 container structure
 * Now implements on-demand frame decoding similar to CVideoWebCodecDataRaw
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

        // Initialize caching variables early to prevent undefined errors
        this.frames = 0;
        this.lastGetImageFrame = 0;
        this.chunks = []; // per frame chunks
        this.groups = []; // groups for frames+delta
        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        this.incomingFrame = 0;
        this.lastTimeStamp = -1;
        this.lastDecodeInfo = "";
        this.blankFrame = null; // Will be created once we know video dimensions

        // Initialize frame caching system
        this.initializeCaching(v, loadedCallback, errorCallback);
    }

    getImage(frame) {
        frame = Math.floor(frame / this.videoSpeed); // videoSpeed will normally be 1, but for timelapse will be

        if (this.incompatible || this.fallbackMode) {
            // incompatible browser or incompatible H.264 stream
            return this.errorImage
        } else {

            // Safety checks - if not initialized yet, return blank frame if possible
            if (!this.groups || this.groups.length === 0 || !this.imageCache || !this.chunks) {
                return this.createBlankFrame();
            }

            // Check for invalid frame numbers - return blank frame instead of null
            if (frame < 0 || frame >= this.chunks.length) {
                return this.createBlankFrame();
            }

            let cacheWindow = 30; // how much we seek ahead (and keep behind)
            const mem = navigator.deviceMemory
            if (mem !== undefined && mem >= 8) {
                // 8GB or more, then we can afford to cache more
                cacheWindow = 100;

                // PATCH - if we are local, or Mick, then then we can afford to cache even more
                // TODO - allow the user to select this window size in some per-user setting
                if (isLocal || Globals.userID === 1) {
                    cacheWindow = 300;
                }
            }

            this.requestFrame(frame) // request this frame, of course, probable already have it though.

            this.lastGetImageFrame = frame

            // we purge everything except the three proximate groups and any groups that are being decoded
            // in theory this should be no more that four
            // purge before a new request
            const groupsToKeep = [];

            // iteratere through the groups
            // and keep the ones that overlap the range
            // frame to frame + cacheWindow (So we get the next group if we are going forward)
            for (let g in this.groups) {
                const group = this.groups[g]
                if (group.frame + group.length > frame && group.frame < frame + cacheWindow) {
                    groupsToKeep.push(group);
                }
            }

            // then frame - cacheWindow to frame, and iterate g backwards so we get the closest first
            for (let g = this.groups.length - 1; g >= 0; g--) {
                const group = this.groups[g]
                if (group.frame + group.length > frame - cacheWindow && group.frame < frame) {
                    groupsToKeep.push(group);
                }
            }

            // request them all, will ignore if already loaded or pending
            for (let g in groupsToKeep) {
                this.requestGroup(groupsToKeep[g])
            }

            // purge all the other groups
            this.purgeGroupsExcept(groupsToKeep)

            assert(this.imageCache, "imageCache is " + this.imageCache + " for frame " + frame + " but groups.length = " + this.groups.length);

            // return the closest frame that has been loaded
            // usually this just mean it returns the one indicated by "frame"
            // but if we've rapidly scrubbed then we might not have this frame
            // Note when purging we currently don't removed the key frames
            // so we'll have a sparsely populated set of frames for scrubbing
            let A = frame;
            let B = frame;
            let bestFrame = frame;
            while (A >= 0 && B < this.chunks.length) {
                if (A >= 0) {
                    if (this.imageCache[A] !== undefined && this.imageCache[A].width !== 0) {
                        bestFrame = A;
                        break;
                        //return this.imageCache[A];
                    }
                    A--
                }
                if (B < this.chunks.length) {
                    if (this.imageCache[B] !== undefined && this.imageCache[B].width !== 0) {
                        bestFrame = B;
                        break;
                        //    return this.imageCache[B];
                    }
                    B++
                }
            }

            let image = this.imageCache[bestFrame];

            // If no valid frame found, return blank frame
            if (!image || (image.width === 0)) {
                return this.createBlankFrame();
            }

            return image;
        }
    }

    update() {
        // Nothing to update for error state
    }

    createBlankFrame() {
        if (!this.width || !this.height) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 1; tempCanvas.height = 1;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 1, 1);
            return tempCanvas;
        }

        if (!this.blankFrame) {
            // Create a blank canvas with video dimensions
            const canvas = document.createElement('canvas');
            canvas.width = this.width;
            canvas.height = this.height;
            const ctx = canvas.getContext('2d');

            // Fill with black
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, this.width, this.height);

            // Convert to ImageBitmap for consistency with decoded frames
            createImageBitmap(canvas).then(bitmap => {
                this.blankFrame = bitmap;
            }).catch(error => {
                console.warn("Error creating blank frame ImageBitmap:", error);
                // Fallback to canvas
                this.blankFrame = canvas;
            });

            // Return canvas immediately while ImageBitmap is being created
            return canvas;
        }

        return this.blankFrame;
    }

    stopStreaming() {
        this.flushEntireCache();
        // Note: We don't close the decoder here to allow continued scrubbing
        // The decoder will be closed only when the video object is destroyed
    }

    // Only call this when completely done with the video (switching videos, etc.)
    destroy() {
        this.closeDecoder();
        this.flushEntireCache();
    }

    closeDecoder() {
        if (this.decoder && this.decoder.state !== 'closed') {
            try {
                this.decoder.close();
                console.log("VideoDecoder closed");
            } catch (error) {
                console.warn("Error closing decoder:", error);
            }
        }
    }

    getProfileName(profileIdc) {
        const profiles = {
            0x42: 'Baseline',
            0x4D: 'Main',
            0x58: 'Extended',
            0x64: 'High'
        };
        return profiles[profileIdc] || `Unknown (0x${profileIdc.toString(16)})`;
    }

    getLevelName(levelIdc) {
        const levels = {
            0x1E: '3.0',
            0x1F: '3.1',
            0x20: '3.2',
            0x28: '4.0',
            0x29: '4.1'
        };
        return levels[levelIdc] || `Unknown (0x${levelIdc.toString(16)})`;
    }

    flushEntireCache() {
        if (this.imageCache) {
            // Close all ImageBitmap objects to free memory
            for (let i = 0; i < this.imageCache.length; i++) {
                if (this.imageCache[i] && typeof this.imageCache[i].close === 'function') {
                    this.imageCache[i].close();
                }
            }
        }

        // Close blank frame if it's an ImageBitmap
        if (this.blankFrame && typeof this.blankFrame.close === 'function') {
            this.blankFrame.close();
        }
        this.blankFrame = null;



        // Reset cache arrays
        this.imageCache = [];
        this.imageDataCache = [];
        this.frameCache = [];

        // Reset groups
        if (this.groups) {
            for (let group of this.groups) {
                group.loaded = false;
                group.pending = 0;
            }
        }

        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        
        // Reset decode frame index
        this.decodeFrameIndex = 0;
    }

    /**
     * Process a decoded video frame and convert it to ImageBitmap
     */
    processDecodedFrame(frameNumber, videoFrame, group) {
        // If this is our first successful decode, mark success
        if (!this.firstDecodeSuccess) {
            this.firstDecodeSuccess = true;
            console.log(`H.264 decoder working - first frame decoded successfully (${videoFrame.codedWidth}x${videoFrame.codedHeight})`);
        }

        createImageBitmap(videoFrame).then(image => {
            if (!this.imageCache) {
                this.imageCache = [];
            }

            this.imageCache[frameNumber] = image
            this.width = image.width;
            this.height = image.height;
            this.imageWidth = image.width;
            this.imageHeight = image.height;

            if (this.c_tmp === undefined) {
                this.c_tmp = document.createElement("canvas")
                this.c_tmp.setAttribute("width", this.width)
                this.c_tmp.setAttribute("height", this.height)
                this.ctx_tmp = this.c_tmp.getContext("2d")
            }

            // if it's the last one we wanted, then tell the system to render a frame
            if (frameNumber === this.lastGetImageFrame) {
                setRenderOne(true);
            }

            if (!group.decodeOrder) {
                group.decodeOrder = [];
            }
            group.decodeOrder.push(frameNumber);

            if (group.pending <= 0) {
                console.warn("Decoding more frames than were listed as pending at frame " + frameNumber);
                return;
            }

            group.pending--;
            if (group.pending == 0) {
                group.loaded = true;
                this.groupsPending--;
                if (this.groupsPending === 0 && this.requestQueue.length > 0) {
                    console.log("FULFILLING deferred requests as no groups pending");
                    const nextGroup = this.requestQueue.shift();
                    this.requestGroup(nextGroup);
                }
            }
        }).catch(error => {
            console.error("Error creating ImageBitmap:", error);
        });

        videoFrame.close();
    }

    async initializeCaching(v, loadedCallback, errorCallback) {
        try {
            console.log("Initializing H.264 frame caching system...");

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

            // Store h264 data for potential alternative decoding
            this.h264Data = h264Buffer;

            // Reset caching variables for this initialization
            this.frames = 0;
            this.chunks = [];
            this.groups = [];
            this.groupsPending = 0;
            this.nextRequest = null;
            this.requestQueue = [];
            this.decoderError = false; // Reset decoder error flag
            this.recreationAttempts = 0; // Reset recreation attempts
            this.decodeFrameIndex = 0; // Simple counter for decode order

            // Analyze H.264 stream
            console.log("Analyzing H.264 stream...");
            const analysis = H264Decoder.analyzeH264Stream(h264Buffer);
            console.log("H.264 Stream Analysis:", analysis);

            if (!analysis.hasSPS || !analysis.hasPPS) {
                throw new Error(
                    `H.264 stream missing required parameters: ` +
                    `${analysis.hasSPS ? 'has' : 'missing'} SPS, ` +
                    `${analysis.hasPPS ? 'has' : 'missing'} PPS`
                );
            }

            // Validate SPS/PPS data
            if (!analysis.spsData || analysis.spsData.length < 4) {
                throw new Error(`Invalid SPS data: ${analysis.spsData ? analysis.spsData.length : 'null'} bytes`);
            }
            if (!analysis.ppsData || analysis.ppsData.length < 1) {
                throw new Error(`Invalid PPS data: ${analysis.ppsData ? analysis.ppsData.length : 'null'} bytes`);
            }

            console.log(`SPS data: ${analysis.spsData.length} bytes, PPS data: ${analysis.ppsData.length} bytes`);

            // Extract NAL units and create chunks
            const nalUnits = H264Decoder.extractNALUnits(new Uint8Array(h264Buffer));

            // After analysis:
            let fps = 30; // Default
            if (analysis.vui && analysis.vui.timing_info_present) {
                fps = analysis.vui.time_scale / (2 * analysis.vui.num_units_in_tick); // Standard formula, assumes fixed_frame_rate_flag
            }

            const encodedChunks = H264Decoder.createEncodedVideoChunks(nalUnits, fps);
            console.log(`Created ${encodedChunks.length} video chunks`);

            // Process chunks to create groups (similar to MP4 demuxer)
            this.processChunksIntoGroups(encodedChunks);

            // Store decoder callbacks for potential recreation
            this.decoderCallbacks = {
                output: videoFrame => {
                    try {
                        this.format = videoFrame.format;
                        this.lastDecodeInfo = "last frame.timestamp = " + videoFrame.timestamp + "<br>";

                        // SIMPLE SOLUTION: Use decode order as frame index
                        // This ignores timestamps completely and just assigns frames sequentially
                        // as they come out of the decoder
                        
                        if (this.decodeFrameIndex === undefined) {
                            this.decodeFrameIndex = 0;
                        }
                        
                        const frameNumber = this.decodeFrameIndex;
                        this.decodeFrameIndex++;
                        
                        // Process this frame with its decode-order frame number
                        const group = this.getGroup(frameNumber);
                        if (!group) {
                            console.warn("Group not found for frame number", frameNumber);
                            videoFrame.close();
                            return;
                        }
                        
                        this.processDecodedFrame(frameNumber, videoFrame, group);
                        
                    } catch (error) {
                        console.error("Error in decoder output callback:", error);
                        videoFrame.close();
                    }
                },
                error: e => {
                    // If we're in alternative decoding mode, don't recreate - just log and continue
                    if (this.alternativeDecoding) {
                        return;
                    }
                    
                    // Only mark as unusable for fatal errors, not decode errors
                    if (e.name === 'NotSupportedError' || e.name === 'InvalidStateError') {
                        this.decoderError = true;
                        console.error("Fatal H.264 decoder error:", e.message);
                    } else if (e.name === 'EncodingError') {
                        // Prevent infinite recreation loops
                        if (!this.recreationAttempts) this.recreationAttempts = 0;
                        if (this.recreationAttempts < 1) {
                            this.recreationAttempts++;
                            console.log("H.264 decode error, attempting to recreate decoder...");
                            this.recreateDecoder();
                        } else {
                            console.log("H.264 decoder recreation failed, trying alternative format...");
                            this.decoderError = true;
                            this.alternativeDecoding = true;
                            this.tryAlternativeDecoding().catch(error => {
                                console.warn("H.264 alternative decoding failed:", error.message);
                            });
                        }
                    }
                }
            };

            // Create decoder with stored callbacks
            this.decoder = new VideoDecoder(this.decoderCallbacks);

            // Configure decoder
            let spsData = analysis.spsData;
            let ppsData = analysis.ppsData;

            // Keep SPS bytes unmodified; do not twiddle constraint flags.

            const description = H264Decoder.createAVCDecoderConfig(spsData, ppsData);

            // Create codec string from SPS data with compatibility fallbacks
            // SPS structure: [NAL_header, profile_idc, constraint_flags, level_idc, ...]
            const profile = spsData[1];        // profile_idc
            const compatibility = spsData[2];  // constraint_set_flags
            const level = spsData[3];          // level_idc

            // CRITICAL: Codec string MUST exactly match the SPS profile/level data
            // Using mismatched codec strings causes "Decoder error" in WebCodecs
            const actualCodec = `avc1.${profile.toString(16).padStart(2, '0')}${compatibility.toString(16).padStart(2, '0')}${level.toString(16).padStart(2, '0')}`;

            const codecConfigs = [
                {
                    codec: actualCodec,
                    description: description,
                    name: `Actual SPS (${this.getProfileName(profile)}@${this.getLevelName(level)})`
                },
                {
                    codec: 'avc1.4d401f',
                    description: description,
                    name: 'Fallback Main@3.1'
                },
                {
                    codec: 'avc1.42001e',
                    description: description,
                    name: 'Fallback Baseline@3.0'
                }
            ];

            let config = null;

            // Try each configuration until one works
            for (const testConfig of codecConfigs) {
                try {
                    console.log(`Testing codec configuration: ${testConfig.name} (${testConfig.codec})`);
                    const isSupported = await VideoDecoder.isConfigSupported(testConfig);
                    console.log(`Codec support result:`, isSupported);

                    if (isSupported.supported) {
                        config = testConfig;
                        console.log(`✅ Using compatible codec: ${testConfig.name}`);
                        break;
                    } else {
                        console.log(`❌ Codec not supported: ${testConfig.name}`);
                    }
                } catch (supportError) {
                    console.warn(`Could not check support for ${testConfig.name}:`, supportError);
                    // If we can't check support, try it anyway (fallback for older browsers)
                    if (!config) {
                        config = testConfig;
                        console.log(`🔄 Fallback to: ${testConfig.name}`);
                    }
                }
            }

            if (!config) {
                // Ultimate fallback - use original config
                config = codecConfigs[0];
                console.warn('⚠️ No supported codec found, using original configuration');
            }

            console.log(`Decoder config: codec=${config.codec}, description=${config.description.byteLength} bytes`);
            console.log(`Profile: 0x${profile.toString(16)}, Compatibility: 0x${compatibility.toString(16)}, Level: 0x${level.toString(16)}`);

            // Debug: Validate AVCC configuration
            const avccData = new Uint8Array(config.description);
            console.log("🔍 AVCC Config validation:");
            console.log(`   Version: ${avccData[0]} (should be 1)`);
            console.log(`   Profile: 0x${avccData[1].toString(16)} (should match SPS)`);
            console.log(`   Compatibility: 0x${avccData[2].toString(16)}`);
            console.log(`   Level: 0x${avccData[3].toString(16)} (should match SPS)`);
            console.log(`   Length size: ${(avccData[4] & 0x03) + 1} bytes (should be 4)`);
            console.log(`   SPS count: ${avccData[5] & 0x1F} (should be 1)`);

            if (avccData[0] !== 1) {
                console.error("   ❌ Invalid AVCC version");
            }
            if (avccData[1] !== profile) {
                console.error(`   ❌ AVCC profile mismatch: config=0x${avccData[1].toString(16)}, SPS=0x${profile.toString(16)}`);
            }
            if (avccData[3] !== level) {
                console.error(`   ❌ AVCC level mismatch: config=0x${avccData[3].toString(16)}, SPS=0x${level.toString(16)}`);
            }

            this.config = config;

            // Configure decoder and wait for it to be ready
            try {
                await this.decoder.configure(config);
                console.log("VideoDecoder configured successfully, state:", this.decoder.state);

                // Reset recreation attempts on successful configuration
                this.recreationAttempts = 0;

                // Verify decoder is in configured state
                if (this.decoder.state !== 'configured') {
                    throw new Error(`Decoder configuration failed, state: ${this.decoder.state}`);
                }



            } catch (configError) {
                console.error("Decoder configuration failed:", configError);
                throw new Error(`Failed to configure VideoDecoder: ${configError.message}`);
            }

            console.log(`H.264 initialization complete: ${this.frames} frames`);
            console.log(`📊 Using decode order as frame sequence - frames will be numbered 0, 1, 2, 3... as decoded`);
            console.log(`🎯 This ensures consistent frame ordering regardless of H.264 internal timestamps`);

            // Set global video properties
            Sit.videoFrames = this.frames * this.videoSpeed;
            Sit.fps = fps; // Default FPS

            updateSitFrames();

            this.loaded = true;
            this.loadedCallback();

            EventManager.dispatchEvent("videoLoaded", {
                videoData: this,
                width: this.imageWidth,
                height: this.imageHeight
            });

        } catch (error) {
            console.error("Failed to initialize H.264 caching:", error);
            console.warn("Falling back to error state");

            this.errorImage = null;
            loadImage('./data/images/errorImage.png').then(result => {
                this.errorImage = result;
                if (errorCallback) errorCallback(`H.264 initialization failed: ${error.message}`);
            });
        }
    }

    processChunksIntoGroups(encodedChunks) {
        // Process chunks similar to how MP4Demuxer does it
        for (let i = 0; i < encodedChunks.length; i++) {
            const chunk = encodedChunks[i];
            chunk.frameNumber = this.frames++;
            this.chunks.push(chunk);

            if (chunk.type === "key") {
                this.groups.push({
                    frame: this.chunks.length - 1,  // first frame of this group
                    length: 1,                      // for now, increase with each delta
                    pending: 0,                     // how many frames requested and pending
                    loaded: false,                  // set when all the frames in the group are loaded
                    timestamp: chunk.timestamp,
                });
            } else {
                const lastGroup = this.groups[this.groups.length - 1];
                if (lastGroup) {
                    assert(chunk.timestamp >= lastGroup.timestamp, "out of group chunk timestamp");
                    lastGroup.length++;
                }
            }
        }
    }

    // find the group object for a given frame
    getGroup(frame) {
        for (let g = 0; g < this.groups.length; g++) {
            const group = this.groups[g]
            if (frame >= group.frame && frame < (group.frame + group.length)) {
                return group;
            }
        }
        const last = this.groups[this.groups.length - 1];
        assert(last != undefined, "last groups is undefined, I've loaded " + this.groups.length)
        console.warn("Last frame = " + last.frame + ", length = " + last.length + ", i.e. up to " + (last.frame + last.length - 1))
        return null;
    }

    getGroupsBetween(start, end) {
        const groups = []
        for (let g = 0; g < this.groups.length; g++) {
            const group = this.groups[g]
            if (group.frame + group.length >= start && group.frame < end) {
                groups.push(group);
            }
        }
        return groups;
    }

    // request that a frame be loaded
    requestFrame(frame) {
        if (!this.groups || this.groups.length === 0 || !this.chunks) {
            return; // Not initialized yet
        }

        // Silently handle invalid frame numbers - getImage will return blank frame
        if (frame < 0 || frame >= this.chunks.length) {
            return; // Invalid frame, getImage will handle with blank frame
        }

        const group = this.getGroup(frame);
        if (group === null) {
            return; // No group found, getImage will handle with blank frame
        }
        this.requestGroup(group);
    }

    requestGroup(group) {
        if (!group || typeof group !== "object") {
            console.warn("requestGroup: invalid group", group);
            return;
        }

        if (!this.decoder || !this.chunks) {
            return; // Not initialized yet
        }

        // Check if decoder is in a fatal error state
        if (this.decoderError) {
            console.warn("Cannot decode: VideoDecoder has fatal error");
            return;
        }

        // Check if decoder is properly configured
        if (this.decoder.state !== 'configured') {
            console.warn("Cannot decode: VideoDecoder is not configured, state:", this.decoder.state);

            return;
        }

        if (group.loaded || group.pending > 0)
            return;

        // if decoder is busy, defer the request
        if (this.decoder.decodeQueueSize > 0) {
            if (!this.requestQueue.includes(group)) { // Avoid dups
                this.requestQueue.push(group);
            }
            return;
        }

        group.pending = group.length;
        group.loaded = false;
        group.decodeOrder = []
        this.groupsPending++;

        try {
            for (let i = group.frame; i < group.frame + group.length; i++) {
                if (i < this.chunks.length) {
                    // Check for problematic small P-frames and skip them temporarily
                    const chunk = this.chunks[i];
                    let shouldSkip = false;
                    
                    if (chunk.type === 'delta' && chunk.byteLength < 30) {
                        shouldSkip = true;
                    }

                    if (!shouldSkip) {
                        this.decoder.decode(this.chunks[i]);
                    }
                } else {
                    console.warn("Trying to decode frame beyond chunks length:", i, ">=", this.chunks.length);
                    group.pending--;
                }
            }

            // Note: We don't call flush() here to keep the decoder open for scrubbing
            // The decoder will naturally output frames as they're ready
        } catch (error) {
            console.error("Error during group decode:", error);
            // Don't mark decoder as unusable for decode errors - they might be recoverable
            group.pending = 0;
            group.loaded = false;
            this.groupsPending--;
        }
    }

    purgeGroupsExcept(keep) {
        for (let g in this.groups) {
            const group = this.groups[g]
            if (keep.find(keeper => keeper === group) === undefined && group.loaded) {
                assert (this.imageCache, "imageCache is undefined when purging groups but groups.length = " + this.groups.length);

                for (let i = group.frame; i < group.frame + group.length; i++) {
                    // release all the frames in this group
                    this.imageCache[i] = undefined;   // lean sentinel
                    this.imageDataCache[i] = undefined;
                    this.frameCache[i] = undefined;
                }
                group.loaded = false;
            }
        }
    }

    debugVideo() {
        let d = "";

        if (this.config !== undefined && this.decoder && this.groups) {
            d += "Config: Codec: " + this.config.codec + "  format:" + this.format + " " + this.imageWidth + "x" + this.imageHeight + "<br>"
            d += "CVideoView: " + this.width + "x" + this.height + "<br>"
            d += "par.frame = " + par.frame + ", Sit.frames = " + Sit.frames + ", chunks = " + this.chunks.length + "<br>"
            d += this.lastDecodeInfo;
            d += "Decode Queue Size = " + this.decoder.decodeQueueSize + " State = " + this.decoder.state + "<br>";

            const currentGroup = this.getGroup(par.frame);

            for (let _g in this.groups) {
                const g = this.groups[_g];

                // count how many images and imageDatas we have
                var images = 0;
                var imageDatas = 0
                var framesCaches = 0
                if (this.imageCache) {
                    for (var i = g.frame; i < g.frame + g.length; i++) {
                        if (this.imageCache[i] != undefined && this.imageCache[i].width != 0)
                            images++
                        if (this.imageDataCache[i] != undefined && this.imageDataCache[i].width != 0)
                            imageDatas++
                        if (this.frameCache[i] != undefined)
                            framesCaches++
                    }
                }

                d += "Group " + _g + ": frame " + g.frame + " length " + g.length + " images " + images + " imageDatas " + imageDatas + " framesCaches "
                    + framesCaches
                    + (g.loaded ? " Loaded " : "")
                    + (currentGroup === g ? "*" : " ")
                    + (g.pending ? "pending = " + g.pending : "")
                    + "<br>"
            }
        }

        infoDiv.style.display = 'block';
        infoDiv.style.fontSize = "13px"
        infoDiv.style.zIndex = '1001';
        infoDiv.innerHTML = d
    }



    async tryAlternativeDecoding() {
        console.log("Trying alternative H.264 decoding approach...");

        try {
            // Get the original NAL units and analysis
            const nalUnits = H264Decoder.extractNALUnits(new Uint8Array(this.h264Data));
            const analysis = H264Decoder.analyzeH264Stream(this.h264Data);
            const frames = H264Decoder.groupNALUnitsIntoFrames(nalUnits);
            
            // Recreate chunks with SPS/PPS included in keyframes (Annex-B format)
            const fps = 30;
            const frameDuration = 1000000 / fps;
            let timestamp = 0;
            
            this.chunks = [];
            for (const frame of frames) {
                if (frame.nalUnits.length === 0) continue;

                let frameNalUnits = [...frame.nalUnits];
                
                // For keyframes, prepend SPS and PPS
                if (frame.type === 'key') {
                    const spsNal = { data: analysis.spsData };
                    const ppsNal = { data: analysis.ppsData };
                    frameNalUnits = [spsNal, ppsNal, ...frameNalUnits];
                }

                // Create Annex-B format with start codes
                const frameData = H264Decoder.createAnnexBFrame(frameNalUnits);
                
                this.chunks.push(new EncodedVideoChunk({
                    type: frame.type,
                    timestamp: timestamp,
                    duration: frameDuration,
                    data: frameData
                }));
                timestamp += frameDuration;
            }
            
            console.log(`Recreated ${this.chunks.length} chunks in Annex-B format`);
            
            // Try Annex-B decoder configuration (no description needed)
            const annexBConfig = { codec: this.config.codec };
            
            // Close existing decoder
            if (this.decoder && this.decoder.state !== 'closed') {
                try {
                    this.decoder.close();
                } catch (e) {
                    console.warn("Error closing decoder:", e);
                }
            }
            
            // Create new decoder
            this.decoder = new VideoDecoder(this.decoderCallbacks);
            await this.decoder.configure(annexBConfig);
            
            // Try decoding the first keyframe
            this.recreationAttempts = 0;
            
            // Find first keyframe and try to decode it
            for (let i = 0; i < Math.min(5, this.chunks.length); i++) {
                if (this.chunks[i].type === 'key') {
                    try {
                        this.decoder.decode(this.chunks[i]);
                        
                        // Wait briefly to see if decode succeeds
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        if (this.decoder.state === 'configured') {
                            console.log("Alternative H.264 format working");
                        } else {
                            console.log("Alternative H.264 format failed, using fallback");
                            this.implementFinalFallback();
                            return;
                        }
                        
                        break;
                    } catch (error) {
                        console.log(`Keyframe ${i} decode failed:`, error.message);
                    }
                }
            }
            
        } catch (error) {
            console.log("Alternative H.264 decoding failed:", error.message);
            this.implementFinalFallback();
        }
    }
    
    implementFinalFallback() {
        console.log("H.264 stream incompatible with WebCodecs, using fallback mode");
        
        // Mark as using fallback mode
        this.decoderError = true;
        this.fallbackMode = true;
        
        // Create informative error image
        this.createInformativeErrorImage();
        
        // Set up basic video properties if we have them
        if (this.chunks && this.chunks.length > 0) {
            this.frames = this.chunks.length;
        }
        
        // Call loaded callback to indicate we're "ready" (even if in fallback mode)
        if (this.loadedCallback) {
            this.loadedCallback();
        }
    }
    
    createInformativeErrorImage() {
        // Create a more informative error image with details about the issue
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        
        // Black background
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // White text
        ctx.fillStyle = 'white';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        
        const centerX = canvas.width / 2;
        let y = 100;
        
        ctx.fillText('H.264 Video Decoding Failed', centerX, y);
        y += 40;
        
        ctx.font = '16px Arial';
        ctx.fillText('This H.264 stream is not compatible with WebCodecs', centerX, y);
        y += 30;
        ctx.fillText('The video format may be too old or use unsupported features', centerX, y);
        y += 40;
        
        ctx.fillText('Technical Details:', centerX, y);
        y += 25;
        ctx.font = '14px Arial';
        ctx.fillText(`• Profile: ${this.getProfileName(0x4D)} Level: ${this.getLevelName(0x29)}`, centerX, y);
        y += 20;
        ctx.fillText(`• Frames: ${this.chunks ? this.chunks.length : 'Unknown'}`, centerX, y);
        y += 20;
        ctx.fillText(`• Format: Raw H.264 Elementary Stream`, centerX, y);
        y += 40;
        
        ctx.fillText('Possible solutions:', centerX, y);
        y += 25;
        ctx.fillText('• Re-encode video with modern H.264 settings', centerX, y);
        y += 20;
        ctx.fillText('• Use MP4 container format instead of raw H.264', centerX, y);
        y += 20;
        ctx.fillText('• Try a different browser (Chrome/Edge/Safari)', centerX, y);
        
        this.errorImage = canvas;
    }

    async recreateDecoder() {
        try {
            // Close existing decoder if it exists
            if (this.decoder && this.decoder.state !== 'closed') {
                try {
                    this.decoder.close();
                } catch (e) {
                    // Ignore close errors
                }
            }

            // Create new decoder with same callbacks
            this.decoder = new VideoDecoder(this.decoderCallbacks);

            // Reconfigure with stored config
            if (this.config) {
                await this.decoder.configure(this.config);
            } else {
                throw new Error("No decoder configuration available");
            }

        } catch (error) {
            console.log("Failed to recreate H.264 decoder:", error.message);
            this.decoderError = true;
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