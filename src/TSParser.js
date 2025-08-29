import {debugLog} from "./Globals";

/**
 * Transport Stream (TS) Parser
 * Handles parsing of MPEG Transport Stream files and extraction of individual streams
 */
export class TSParser {
    
    /**
     * Parse TS (Transport Stream) files and extract individual streams
     * @param {string} filename - The filename of the TS file
     * @param {string} id - The file ID
     * @param {ArrayBuffer} buffer - The TS file buffer
     * @param {Function} parseAssetCallback - Callback function to parse extracted streams
     * @returns {Promise} Promise that resolves to array of parsed streams
     */
    static parseTSFile(filename, id, buffer, parseAssetCallback) {
        try {
            const streams = TSParser.extractTSStreams(buffer);
            
            if (streams.length === 0) {
                return Promise.resolve([]);
            }
            
            // Create promises for each extracted stream
            const streamPromises = streams.map(stream => {
                const streamFilename = filename + "_" + stream.type + "_" + stream.pid + "." + stream.extension;
                return parseAssetCallback(streamFilename, id, stream.data);
            });
            
            // Wait for all streams to be processed
            return Promise.all(streamPromises);
            
        } catch (error) {
            console.error('Error parsing TS file:', error);
            return Promise.reject(error);
        }
    }

    /**
     * Extract streams from TS buffer
     * @param {ArrayBuffer} buffer - The TS file buffer
     * @returns {Array} Array of extracted streams
     */
    static extractTSStreams(buffer) {
        const streams = [];
        const uint8Array = new Uint8Array(buffer);
        const packetSize = 188; // Standard TS packet size
        const streamData = new Map(); // PID -> accumulated data
        const streamTypes = new Map(); // PID -> stream type info
        
        let packetCount = 0;
        let syncErrors = 0;
        const pidCounts = new Map(); // Track packet counts per PID
        
        // Parse TS packets
        for (let offset = 0; offset < uint8Array.length - packetSize; offset += packetSize) {
            packetCount++;
            // Check for sync byte (0x47)
            if (uint8Array[offset] !== 0x47) {
                syncErrors++;
                // Try to find next sync byte
                let found = false;
                for (let i = offset + 1; i < uint8Array.length - packetSize; i++) {
                    if (uint8Array[i] === 0x47) {
                        offset = i;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    break;
                }
            }
            
            // Parse TS header
            const header1 = uint8Array[offset + 1];
            const header2 = uint8Array[offset + 2];
            const header3 = uint8Array[offset + 3];
            
            const transportErrorIndicator = (header1 & 0x80) !== 0;
            const payloadUnitStartIndicator = (header1 & 0x40) !== 0;
            const transportPriority = (header1 & 0x20) !== 0;
            const pid = ((header1 & 0x1F) << 8) | header2;
            const scramblingControl = (header3 & 0xC0) >> 6;
            const adaptationFieldControl = (header3 & 0x30) >> 4;
            const continuityCounter = header3 & 0x0F;
            
            // Track PID counts
            pidCounts.set(pid, (pidCounts.get(pid) || 0) + 1);
            
            // Skip error packets
            if (transportErrorIndicator) {
                continue;
            }
            
            // Skip null packets (PID 0x1FFF)
            if (pid === 0x1FFF) continue;
            
            let payloadStart = 4;
            
            // Handle adaptation field
            if (adaptationFieldControl === 2 || adaptationFieldControl === 3) {
                const adaptationFieldLength = uint8Array[offset + 4];
                payloadStart += 1 + adaptationFieldLength;
            }
            
            // Skip if no payload
            if (adaptationFieldControl === 2) continue;
            
            // Handle PAT (Program Association Table) - PID 0
            if (pid === 0) {
                // Parse PAT to find PMT PIDs - simplified implementation
                continue;
            }
            
            // Handle PMT (Program Map Table) - detect stream types
            if (payloadUnitStartIndicator && payloadStart < packetSize) {
                const payloadData = uint8Array.slice(offset + payloadStart, offset + packetSize);
                
                // Try to detect stream type based on payload
                const streamType = TSParser.detectStreamType(payloadData, pid);
                if (streamType) {
                    // Only log KLV stream detection
                    if (streamType.type === 'klv') {
                        console.log(`extractTSStreams: Detected KLV stream for PID ${pid}:`, streamType);
                    }
                    streamTypes.set(pid, streamType);
                }
            }
            
            // Accumulate payload data for this PID
            if (payloadStart < packetSize) {
                const payloadData = uint8Array.slice(offset + payloadStart, offset + packetSize);
                
                if (!streamData.has(pid)) {
                    streamData.set(pid, []);
                }
                streamData.get(pid).push(payloadData);
            }
        }
        
        // Convert accumulated data to streams
        for (const [pid, dataChunks] of streamData.entries()) {
            if (dataChunks.length === 0) continue;
            
            // Concatenate all data chunks for this PID
            const totalLength = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const concatenatedData = new Uint8Array(totalLength);
            let offset = 0;
            
            for (const chunk of dataChunks) {
                concatenatedData.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Get stream type info
            const streamInfo = streamTypes.get(pid) || { type: 'unknown', extension: 'bin' };
            
            streams.push({
                pid: pid,
                type: streamInfo.type,
                extension: streamInfo.extension,
                data: concatenatedData.buffer
            });
        }
        
        return streams;
    }

    /**
     * Detect stream type based on payload data
     * @param {Uint8Array} payloadData - The payload data to analyze
     * @param {number} pid - The PID of the stream
     * @returns {Object|null} Stream type info or null if not detected
     */
    static detectStreamType(payloadData, pid) {
        if (payloadData.length < 4) {
            return null;
        }
        
        // Check for PES header (starts with 0x000001)
        if (payloadData[0] === 0x00 && payloadData[1] === 0x00 && payloadData[2] === 0x01) {
            const streamId = payloadData[3];

            //      console.log(`detectStreamType: PID ${pid} identified as stream ID ${streamId}`);

            // Video streams (0xE0-0xEF)
            if (streamId >= 0xE0 && streamId <= 0xEF) {
                return { type: 'video', extension: 'h264' };
            }
            
            // Audio streams (0xC0-0xDF)
            if (streamId >= 0xC0 && streamId <= 0xDF) {
                return { type: 'audio', extension: 'aac' };
            }
            
            // Private stream 1 (could be KLV metadata)
            if (streamId === 0xBD) {
                console.log(`detectStreamType: PID ${pid} identified as private stream 1 (potential KLV)`);
                return { type: 'klv', extension: 'klv' };
            }
        }

        // Check for H.264 NAL units
        if (payloadData.length >= 4) {
            // Look for H.264 start codes (0x00000001 or 0x000001)
            for (let i = 0; i < Math.min(payloadData.length - 4, 100); i++) {
                if ((payloadData[i] === 0x00 && payloadData[i+1] === 0x00 && 
                     payloadData[i+2] === 0x00 && payloadData[i+3] === 0x01) ||
                    (payloadData[i] === 0x00 && payloadData[i+1] === 0x00 && 
                     payloadData[i+2] === 0x01)) {
                    return { type: 'video', extension: 'h264' };
                }
            }
        }

        // Check for KLV data (MISB metadata)
        // KLV typically starts with a 16-byte Universal Label
        if (payloadData.length >= 16) {

            // get the first 24 bytes as a hex string
            const labelHex = payloadData.slice(0, 24).reduce((acc, val) => acc + ('0' + val.toString(16)).slice(-2), '');
            debugLog(`detectStreamType: PID ${pid} identified as potential KLV data (labelHex=${labelHex}`)

            // MISB KLV Universal Labels typically start with 0x060E2B34
            if (payloadData[0] === 0x06 && payloadData[1] === 0x0E &&
                payloadData[2] === 0x2B && payloadData[3] === 0x34) {
                console.log(`detectStreamType: PID ${pid} identified as KLV data (Universal Label found)`);
                return { type: 'klv', extension: 'klv' };
            }
        }

        // Default to unknown binary data
        return { type: 'data', extension: 'bin' };
    }
}