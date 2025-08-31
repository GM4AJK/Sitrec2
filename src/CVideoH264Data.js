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
        this.nextRequest = -1;
        this.incomingFrame = 0;
        this.lastTimeStamp = -1;
        this.lastDecodeInfo = "";
        this.blankFrame = null; // Will be created once we know video dimensions

        // Initialize frame caching system
        this.initializeCaching(v, loadedCallback, errorCallback);
    }

    getImage(frame) {
        frame = Math.floor(frame / this.videoSpeed); // videoSpeed will normally be 1, but for timelapse will be

        if (this.incompatible) {
            // incompatible browser (i.e. does not support WebCodec)
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
            return null; // Can't create blank frame without dimensions
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
        this.nextRequest = -1;
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

            // Reset caching variables for this initialization
            this.frames = 0;
            this.chunks = [];
            this.groups = [];
            this.groupsPending = 0;
            this.nextRequest = -1;

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

            // Extract NAL units and create chunks
            const nalUnits = H264Decoder.extractNALUnits(new Uint8Array(h264Buffer));
            const encodedChunks = H264Decoder.createEncodedVideoChunks(nalUnits, 30);

            console.log(`Created ${encodedChunks.length} video chunks`);

            // Process chunks to create groups (similar to MP4 demuxer)
            this.processChunksIntoGroups(encodedChunks);

            // Create decoder with frame caching
            this.decoder = new VideoDecoder({
                output: videoFrame => {
                    try {
                        this.format = videoFrame.format;
                        this.lastDecodeInfo = "last frame.timestamp = " + videoFrame.timestamp + "<br>";

                        var groupNumber = 0;
                        // find the group this frame is in
                        while (groupNumber + 1 < this.groups.length && videoFrame.timestamp >= this.groups[groupNumber + 1].timestamp)
                            groupNumber++;
                        var group = this.groups[groupNumber]

                        if (!group) {
                            console.warn("No group found for decoded frame with timestamp", videoFrame.timestamp);
                            videoFrame.close();
                            return;
                        }

                        // calculate the frame number we are decoding from how many are left
                        const frameNumber = group.frame + group.length - group.pending;
                        
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

                            const group = this.getGroup(frameNumber);
                            if (!group) {
                                console.warn("Group not found for frame number", frameNumber);
                                return;
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
                                if (this.groupsPending === 0 && this.nextRequest >= 0) {
                                    console.log("FULFILLING deferred request as no groups pending , frame = " + this.nextRequest)
                                    this.requestGroup(this.nextRequest)
                                    this.nextRequest = -1
                                }
                            }
                        }).catch(error => {
                            console.error("Error creating ImageBitmap:", error);
                        });

                        videoFrame.close();
                    } catch (error) {
                        console.error("Error in decoder output callback:", error);
                        videoFrame.close();
                    }
                },
                error: e => {
                    console.error("VideoDecoder error:", e);
                    // Only mark as unusable for fatal errors, not decode errors
                    if (e.name === 'NotSupportedError' || e.name === 'InvalidStateError') {
                        this.decoderError = true;
                        console.error("Fatal decoder error, marking as unusable");
                    } else {
                        console.warn("Non-fatal decoder error, continuing operation");
                    }
                },
            });

            // Configure decoder
            const config = {
                codec: 'avc1.42E01E', // H.264 Baseline Profile
                description: H264Decoder.createAVCDecoderConfig(analysis.spsData, analysis.ppsData)
            };

            this.config = config;
            this.decoder.configure(config);

            console.log(`H.264 initialization complete: ${this.frames} frames`);

            // Set global video properties
            Sit.videoFrames = this.frames * this.videoSpeed;
            Sit.fps = 30; // Default FPS

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
            this.nextRequest = group;
            return;
        }

        group.pending = group.length;
        group.loaded = false;
        group.decodeOrder = []
        this.groupsPending++;
        
        try {
            for (let i = group.frame; i < group.frame + group.length; i++) {
                if (i < this.chunks.length) {
                    this.decoder.decode(this.chunks[i]);
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
                    this.imageCache[i] = new Image()    // TODO, maybe better as null, but other code expect an empty Image when not loaded
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

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }
}