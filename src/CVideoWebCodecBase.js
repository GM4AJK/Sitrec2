import {Globals, infoDiv, setRenderOne, Sit} from "./Globals";
import {assert} from "./assert";
import {loadImage} from "./utils";
import {CVideoData} from "./CVideoData";
import {par} from "./par";
import {isLocal} from "./configUtils";
import {showError} from "./showError";

/**
 * Base class for WebCodec-based video data handlers
 * Provides common frame caching, group management, and decoder functionality
 */
export class CVideoWebCodecBase extends CVideoData {

    constructor(v, loadedCallback, errorCallback) {
        super(v);
        
        this.format = "";
        this.error = false;
        this.loaded = false;
        this.loadedCallback = loadedCallback;
        this.errorCallback = errorCallback;
        
        // Store filename for debugging
        this.filename = v.dropFile ? v.dropFile.name : (v.filename || "Unknown");

        // Check WebCodec compatibility
        this.incompatible = true;
        try {
            if (VideoDecoder !== undefined) {
                this.incompatible = false;
            }
        } catch (e) {
        }

        if (this.incompatible) {
            console.log("Video Playback Requires up-to-date WebCodec Browser (Chrome/Edge/Safari)");
            this.errorImage = null;
            loadImage('./data/images/errorImage.png').then(result => {
                this.errorImage = result;
                if (errorCallback) errorCallback("WebCodec not supported");
            });
            return;
        }

        // Initialize common caching variables
        this.initializeCommonVariables();
    }

    initializeCommonVariables() {
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
        this.blankFrameCanvas = null; // Temporary canvas for blank frame creation
        this.blankFramePending = false; // Flag indicating blank frame creation is in progress
        this.decodeFrameIndex = 0; // Simple counter for decode order
        this.c_tmp = null; // Temporary canvas (if used)
        this.ctx_tmp = null; // Temporary canvas context (if used)
    }

    /**
     * Create decoder with common output/error handling
     * Subclasses can override createDecoderCallbacks() to customize behavior
     */
    createDecoder() {
        const callbacks = this.createDecoderCallbacks();
        this.decoder = new VideoDecoder(callbacks);
        return this.decoder;
    }

    /**
     * Create decoder callbacks - can be overridden by subclasses
     */
    createDecoderCallbacks() {
        return {
            output: videoFrame => {
                this.format = videoFrame.format;
                this.lastDecodeInfo = "last frame.timestamp = " + videoFrame.timestamp + "<br>";

                // Find the group this frame belongs to
                var groupNumber = 0;
                while (groupNumber + 1 < this.groups.length && videoFrame.timestamp >= this.groups[groupNumber + 1].timestamp)
                    groupNumber++;
                var group = this.groups[groupNumber];

                // Calculate the frame number from group position and pending count
                const frameNumber = group.frame + group.length - group.pending;
                
                this.processDecodedFrame(frameNumber, videoFrame, group);
            },
            error: e => {
                showError("Decoder error:", e);
                this.handleDecoderError(e);
            }
        };
    }

    /**
     * Process a decoded video frame and convert it to ImageBitmap
     */
    processDecodedFrame(frameNumber, videoFrame, group) {
        // Check if imageCache is still valid (video might have been disposed)
        if (!this.imageCache) {
            videoFrame.close();
            return;
        }

        // Close any existing frame at this position to avoid memory leaks
        const existingFrame = this.imageCache[frameNumber];
        if (existingFrame && typeof existingFrame.close === 'function') {
            try {
                existingFrame.close();
            } catch (e) {
                // Ignore errors when closing already-closed frames
            }
        }

        createImageBitmap(videoFrame).then(image => {
            // Double-check imageCache still exists (video might have been disposed during async operation)
            if (!this.imageCache) {
                if (typeof image.close === 'function') {
                    image.close();
                }
                return;
            }

            this.imageCache[frameNumber] = image;
            if (this.videoWidth !== image.width || this.videoHeight !== image.height) {
                console.log("New per-frame video dimensions detected: width=" + image.width + ", height=" + image.height);
                this.videoWidth = image.width;
                this.videoHeight = image.height;
            }

            if (this.c_tmp === undefined) {
                this.c_tmp = document.createElement("canvas");
                this.c_tmp.setAttribute("width", this.videoWidth);
                this.c_tmp.setAttribute("height", this.videoHeight);
                this.ctx_tmp = this.c_tmp.getContext("2d");
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
                this.handleGroupComplete();
            }
        }).catch(error => {
            showError("Error creating ImageBitmap:", error);
            // Ensure we still close the videoFrame on error
            try {
                videoFrame.close();
            } catch (e) {
                // Ignore errors
            }
        });

        videoFrame.close();
    }

    /**
     * Handle completion of a group - process any queued requests
     */
    handleGroupComplete() {
        if (this.groupsPending === 0) {
            // Handle deferred requests differently for each subclass
            if (this.nextRequest !== null && this.nextRequest >= 0) {
                // CVideoMp4Data style
                console.log("FULFILLING deferred request as no groups pending, frame = " + this.nextRequest);
                this.requestGroup(this.nextRequest);
                this.nextRequest = -1;
            } else if (this.requestQueue && this.requestQueue.length > 0) {
                // CVideoH264Data style
                console.log("FULFILLING deferred requests as no groups pending");
                const nextGroup = this.requestQueue.shift();
                this.requestGroup(nextGroup);
            }
        }
    }

    /**
     * Handle decoder errors - can be overridden by subclasses
     */
    handleDecoderError(error) {
        showError("Decoder error:", error);
        // Default implementation - subclasses can override for specific error handling
    }

    /**
     * Process chunks into groups (common logic)
     */
    processChunksIntoGroups(encodedChunks) {
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
            const group = this.groups[g];
            if (frame >= group.frame && frame < (group.frame + group.length)) {
                return group;
            }
        }
        const last = this.groups[this.groups.length - 1];
        if (last) {
            console.warn("Last frame = " + last.frame + ", length = " + last.length + ", i.e. up to " + (last.frame + last.length - 1));
        }
        return null;
    }

    getGroupsBetween(start, end) {
        const groups = [];
        for (let g = 0; g < this.groups.length; g++) {
            const group = this.groups[g];
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

        if (frame > Sit.videoFrames - 1) frame = Sit.videoFrames - 1;
        if (frame < 0) frame = 0;

        const group = this.getGroup(frame);
        if (group === null) {
            return; // No group found
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

        if (group.loaded || group.pending > 0)
            return;

        // Check if decoder is busy
        if (this.decoder.decodeQueueSize > 0) {
            this.handleBusyDecoder(group);
            return;
        }

        group.pending = group.length;
        group.loaded = false;
        group.decodeOrder = [];
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

            // Kick the reorder buffer so the tail frames are delivered.
            this.decoder.flush().catch(() => { /* ignore mid-seek aborts */ });
        } catch (error) {
            showError("Error during group decode:", error);
            group.pending = 0;
            group.loaded = false;
            this.groupsPending--;
        }
    }

    /**
     * Handle busy decoder - different strategies for different subclasses
     */
    handleBusyDecoder(group) {
        // CVideoMp4Data uses nextRequest
        if (this.nextRequest !== undefined) {
            this.nextRequest = group;
        }
        // CVideoH264Data uses requestQueue
        if (this.requestQueue && !this.requestQueue.includes(group)) {
            this.requestQueue.push(group);
        }
    }

    purgeGroupsExcept(keep) {
        for (let g in this.groups) {
            const group = this.groups[g];
            if (!keep.has(group) && group.loaded) {
                assert(this.imageCache, "imageCache is undefined when purging groups but groups.length = " + this.groups.length);

                for (let i = group.frame; i < group.frame + group.length; i++) {
                    // release all the frames in this group
                    // Close imageCache (ImageBitmap for WebCodec videos)
                    if (this.imageCache[i]) {
                        if (typeof this.imageCache[i].close === 'function') {
                            try {
                                this.imageCache[i].close(); // Close ImageBitmap to free GPU memory
                            } catch (e) {
                                console.warn("Error closing ImageBitmap:", e);
                            }
                        }
                        this.imageCache[i] = null; // Use null instead of undefined for better garbage collection
                    }
                    
                    // Clean up data caches
                    if (this.imageDataCache && this.imageDataCache[i]) {
                        this.imageDataCache[i] = null;
                    }
                    if (this.frameCache && this.frameCache[i]) {
                        this.frameCache[i] = null;
                    }
                }
                group.loaded = false;
                group.decodeOrder = []; // Clear decode order to free memory
            }
        }
    }

    getImage(frame) {
        frame = Math.floor(frame / this.videoSpeed);

        if (this.incompatible || this.fallbackMode) {
            return this.errorImage;
        }

        // Safety checks - if not initialized yet, return blank frame if possible
        if (!this.groups || this.groups.length === 0 || !this.imageCache || !this.chunks) {
            return this.createBlankFrame();
        }

        // Check for invalid frame numbers - return blank frame instead of null
        if (frame < 0 || frame >= this.chunks.length) {
            return this.createBlankFrame();
        }

        let cacheWindow = 30; // how much we seek ahead (and keep behind)
        const mem = navigator.deviceMemory;
        if (mem !== undefined && mem >= 8) {
            // 8GB or more, then we can afford to cache more
            cacheWindow = 100;

            // PATCH - if we are local, or Mick, then we can afford to cache even more
            // TODO - allow the user to select this window size in some per-user setting
            if (isLocal || Globals.userID === 1) {
         //       cacheWindow = 300;
            }
        }

        this.requestFrame(frame); // request this frame
        this.lastGetImageFrame = frame;

        // we purge everything except the proximate groups and any groups that are being decoded
        const groupsToKeep = new Set(); // Use Set to avoid duplicates

        // iterate through the groups and keep the ones that overlap the range
        // frame to frame + cacheWindow (So we get the next group if we are going forward)
        for (let g in this.groups) {
            const group = this.groups[g];
            if (group.frame + group.length > frame && group.frame < frame + cacheWindow) {
                groupsToKeep.add(group);
            }
        }

        // then frame - cacheWindow to frame, and iterate g backwards so we get the closest first
        for (let g = this.groups.length - 1; g >= 0; g--) {
            const group = this.groups[g];
            if (group.frame + group.length > frame - cacheWindow && group.frame < frame) {
                groupsToKeep.add(group);
            }
        }

        // request them all, will ignore if already loaded or pending
        for (const group of groupsToKeep) {
            this.requestGroup(group);
        }

        // purge all the other groups
        this.purgeGroupsExcept(groupsToKeep);

        assert(this.imageCache, "imageCache is " + this.imageCache + " for frame " + frame + " but groups.length = " + this.groups.length);

        // return the closest frame that has been loaded
        let A = frame;
        let B = frame;
        let bestFrame = frame;
        let foundFrame = false;
        
        while (A >= 0 && B < this.chunks.length) {
            if (A >= 0 && A < this.imageCache.length) {
                const frameA = this.imageCache[A];
                if (frameA && frameA.width && frameA.width > 0) {
                    bestFrame = A;
                    foundFrame = true;
                    break;
                }
            }
            A--;
            
            if (B < this.chunks.length && B < this.imageCache.length) {
                const frameB = this.imageCache[B];
                if (frameB && frameB.width && frameB.width > 0) {
                    bestFrame = B;
                    foundFrame = true;
                    break;
                }
            }
            B++;
        }

        // Check if bestFrame is valid and accessible
        if (foundFrame && bestFrame >= 0 && bestFrame < this.imageCache.length) {
            const image = this.imageCache[bestFrame];
            if (image && image.width && image.width > 0) {
                return image;
            }
        }

        // If no valid frame found, return blank frame
        return this.createBlankFrame();
    }

    createBlankFrame() {
        if (!this.videoWidth || !this.videoHeight) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 1; 
            tempCanvas.height = 1;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = 'black'; 
            ctx.fillRect(0, 0, 1, 1);
            return tempCanvas;
        }

        // if the desired dimensions of the blank frame haven't changed, just return it
        // but if they have, dispose of it, so it gets recreated
        if (this.blankFrame &&
             (this.blankFrame.width !== this.videoWidth ||
            this.blankFrame.height !== this.videoHeight)) {
            // Dispose of old blank frame
            if (typeof this.blankFrame.close === 'function') {
                try {
                    this.blankFrame.close();
                } catch (e) {
                    console.warn("Error closing old blank frame:", e);
                }
            }
            this.blankFrame = null;
            this.blankFramePending = false;
        }

        // If we already have a blank frame or it's pending creation, return it
        if (this.blankFrame) {
            return this.blankFrame;
        }
        
        // If blank frame creation is already pending, return a temporary canvas
        if (this.blankFramePending) {
            if (!this.blankFrameCanvas) {
                this.blankFrameCanvas = document.createElement('canvas');
                this.blankFrameCanvas.width = this.videoWidth;
                this.blankFrameCanvas.height = this.videoHeight;
                const ctx = this.blankFrameCanvas.getContext('2d');
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, this.videoWidth, this.videoHeight);
            }
            return this.blankFrameCanvas;
        }

        // Create a blank canvas with video dimensions
        const canvas = document.createElement('canvas');
        canvas.width = this.videoWidth;
        canvas.height = this.videoHeight;
        const ctx = canvas.getContext('2d');

        // Fill with black
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, this.videoWidth, this.videoHeight);

        // Store canvas for return while ImageBitmap is being created
        this.blankFrameCanvas = canvas;
        this.blankFramePending = true;

        // Convert to ImageBitmap for consistency with decoded frames
        createImageBitmap(canvas).then(bitmap => {
            this.blankFrame = bitmap;
            this.blankFramePending = false;
            // Clean up temporary canvas once we have the bitmap
            this.blankFrameCanvas = null;
        }).catch(error => {
            console.warn("Error creating blank frame ImageBitmap:", error);
            // Fallback to canvas - keep using the canvas
            this.blankFrame = canvas;
            this.blankFramePending = false;
        });

        // Return canvas immediately while ImageBitmap is being created
        return canvas;
    }

    update() {
        super.update();
        if (this.incompatible) return;

        // Ensure rendering continues while groups are pending
        for (let g in this.groups) {
            const group = this.groups[g];
            if (group.pending > 0)
                setRenderOne(true);
        }

        if (isLocal) {
        //     this.debugVideo()
        }
    }

    debugVideo() {
        let d = "";

        // Start with filename
        d += "<strong>File: " + this.filename + "</strong><br>";
        
        if (this.config !== undefined && this.decoder && this.groups) {
            // Get config info - allow subclasses to override
            const configInfo = this.getDebugConfigInfo();
            d += configInfo + "<br>";
            
            d += "CVideoView: " + this.videoWidth + "x" + this.videoHeight + "<br>";
            d += "par.frame = " + par.frame + ", Sit.frames = " + Sit.frames + ", chunks = " + this.chunks.length + "<br>";
            d += this.lastDecodeInfo;
            d += "Decode Queue Size = " + this.decoder.decodeQueueSize + " State = " + this.decoder.state + "<br>";

            // Add any additional debug info from subclasses
            const additionalInfo = this.getAdditionalDebugInfo();
            if (additionalInfo) {
                d += additionalInfo + "<br>";
            }

            const currentGroup = this.getGroup(par.frame);

            for (let _g in this.groups) {
                const g = this.groups[_g];

                // count how many images and imageDatas we have
                var images = 0;
                var imageDatas = 0;
                var framesCaches = 0;
                if (this.imageCache) {
                    for (var i = g.frame; i < g.frame + g.length; i++) {
                        if (this.imageCache[i] != undefined && this.imageCache[i].width != 0)
                            images++;
                        if (this.imageDataCache[i] != undefined && this.imageDataCache[i].width != 0)
                            imageDatas++;
                        if (this.frameCache[i] != undefined)
                            framesCaches++;
                    }
                }

                // Get group info - allow subclasses to customize format
                const groupInfo = this.getDebugGroupInfo(_g, g, images, imageDatas, framesCaches, currentGroup);
                d += groupInfo + "<br>";
            }
        }

        infoDiv.style.display = 'block';
        infoDiv.style.fontSize = "13px";
        infoDiv.style.zIndex = '1001';
        infoDiv.innerHTML = d;
    }

    /**
     * Get config information for debug display - can be overridden by subclasses
     */
    getDebugConfigInfo() {
        const fps = Sit.fps ? ` @ ${Sit.fps}fps` : '';
        return "Config: Codec: " + this.config.codec + "  format:" + this.format + " " + this.videoWidth + "x" + this.videoHeight + fps;
    }

    /**
     * Get additional debug information - can be overridden by subclasses
     */
    getAdditionalDebugInfo() {
        return "";
    }

    /**
     * Get group information for debug display - can be overridden by subclasses
     */
    getDebugGroupInfo(groupIndex, group, images, imageDatas, framesCaches, currentGroup) {
        return "Group " + groupIndex + ": frame " + group.frame + " length " + group.length + " images " + images + " imageDatas " + imageDatas + " framesCaches "
            + framesCaches
            + (group.loaded ? " Loaded " : "")
            + (currentGroup === group ? "*" : " ")
            + (group.pending ? "pending = " + group.pending : "");
    }

    flushEntireCache() {
        if (this.imageCache) {
            // Close all ImageBitmap objects to free memory
            for (let i = 0; i < this.imageCache.length; i++) {
                if (this.imageCache[i]) {
                    if (typeof this.imageCache[i].close === 'function') {
                        try {
                            this.imageCache[i].close();
                        } catch (e) {
                            console.warn("Error closing ImageBitmap during flush:", e);
                        }
                    }
                    this.imageCache[i] = null;
                }
            }
        }

        // Close blank frame if it's an ImageBitmap
        if (this.blankFrame) {
            if (typeof this.blankFrame.close === 'function') {
                try {
                    this.blankFrame.close();
                } catch (e) {
                    console.warn("Error closing blank frame:", e);
                }
            }
            this.blankFrame = null;
        }

        // Clean up temporary canvas and context
        if (this.c_tmp) {
            this.c_tmp = null;
        }
        if (this.ctx_tmp) {
            this.ctx_tmp = null;
        }

        // Reset cache arrays
        this.imageCache = [];
        this.imageDataCache = [];
        this.frameCache = [];

        // Reset groups
        if (this.groups) {
            for (let group of this.groups) {
                group.loaded = false;
                group.pending = 0;
                group.decodeOrder = [];
            }
        }

        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        
        // Reset decode frame index
        this.decodeFrameIndex = 0;
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

    dispose() {
        // Stop any pending operations
        this.groupsPending = 0;
        this.nextRequest = null;
        this.requestQueue = [];
        
        // Flush and close decoder
        if (this.decoder) {
            // flush is asynchronous, so we need to wait for it to finish
            // before we close the decoder
            const decoder = this.decoder;
            decoder.flush()
                .catch(() => {})   // swallow any flush errors we don't care about
                .finally(() => {
                    try {
                        decoder.close();
                        console.log("VideoDecoder closed successfully");
                    } catch (e) {
                        console.warn("Error closing decoder:", e);
                    }
                });
            this.decoder = null;
        }
        
        // Flush all caches before calling parent dispose
        this.flushEntireCache();
        
        super.dispose();

        delete Sit.videoFile;
        delete Sit.videoFrames;
    }
}