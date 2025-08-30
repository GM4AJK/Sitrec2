
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
     * Extract streams from TS buffer using proper PSI parsing
     * @param {ArrayBuffer} buffer - The TS file buffer
     * @returns {Array} Array of extracted streams
     */
    static extractTSStreams(buffer) {
        try {
            // Use the new detailed analysis to get stream information
            const analysis = TSParser.probeTransportStreamBufferDetailed(buffer);
            
            if (!analysis.programs || analysis.programs.length === 0) {
                console.log('extractTSStreams: No programs found in transport stream');
                return [];
            }

            const streams = [];
            const uint8Array = new Uint8Array(buffer);
            const streamData = new Map(); // PID -> accumulated data
            
            // Get elementary stream PIDs and their types from analysis
            const elementaryStreams = new Map(); // PID -> stream info
            for (const program of analysis.programs) {
                for (const stream of program.streams) {
                    const pid = parseInt(stream.id, 16);
                    elementaryStreams.set(pid, {
                        codec_name: stream.codec_name,
                        codec_type: stream.codec_type,
                        stream_type: stream.stream_type,
                        descriptors: stream.descriptors
                    });
                }
            }

            console.log(`extractTSStreams: Found ${elementaryStreams.size} elementary streams to extract`);

            // Extract payload data for each elementary stream
            const packetSize = 188;
            for (let offset = 0; offset < uint8Array.length - packetSize; offset += packetSize) {
                // Check for sync byte (0x47)
                if (uint8Array[offset] !== 0x47) {
                    // Try to find next sync byte
                    let found = false;
                    for (let i = offset + 1; i < uint8Array.length - packetSize; i++) {
                        if (uint8Array[i] === 0x47) {
                            offset = i;
                            found = true;
                            break;
                        }
                    }
                    if (!found) break;
                }

                // Parse TS header
                const header1 = uint8Array[offset + 1];
                const header2 = uint8Array[offset + 2];
                const header3 = uint8Array[offset + 3];

                const transportErrorIndicator = (header1 & 0x80) !== 0;
                const pid = ((header1 & 0x1F) << 8) | header2;
                const adaptationFieldControl = (header3 & 0x30) >> 4;

                // Skip error packets and null packets
                if (transportErrorIndicator || pid === 0x1FFF) continue;

                // Only process elementary stream PIDs
                if (!elementaryStreams.has(pid)) continue;

                let payloadStart = 4;

                // Handle adaptation field
                if (adaptationFieldControl === 2 || adaptationFieldControl === 3) {
                    const adaptationFieldLength = uint8Array[offset + 4];
                    payloadStart += 1 + adaptationFieldLength;
                }

                // Skip if no payload
                if (adaptationFieldControl === 2 || payloadStart >= packetSize) continue;

                // Extract payload data
                const payloadData = uint8Array.slice(offset + payloadStart, offset + packetSize);
                if (payloadData.length > 0) {
                    if (!streamData.has(pid)) {
                        streamData.set(pid, []);
                    }
                    streamData.get(pid).push(payloadData);
                }
            }

            // Convert accumulated data to streams
            for (const [pid, dataChunks] of streamData.entries()) {
                if (dataChunks.length === 0) continue;

                const streamInfo = elementaryStreams.get(pid);
                if (!streamInfo) continue;

                // Concatenate all data chunks for this PID
                const totalLength = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const concatenatedData = new Uint8Array(totalLength);
                let offset = 0;

                for (const chunk of dataChunks) {
                    concatenatedData.set(chunk, offset);
                    offset += chunk.length;
                }

                // Determine file extension based on codec
                let extension;
                switch (streamInfo.codec_name) {
                    case 'h264':
                        extension = 'h264';
                        break;
                    case 'hevc':
                        extension = 'h265';
                        break;
                    case 'aac':
                        extension = 'aac';
                        break;
                    case 'mp3':
                        extension = 'mp3';
                        break;
                    case 'klv':
                        extension = 'klv';
                        break;
                    case 'timed_id3':
                        extension = 'id3';
                        break;
                    default:
                        extension = 'bin';
                }

                console.log(`extractTSStreams: Extracted ${streamInfo.codec_name} stream (PID ${pid}): ${totalLength} bytes`);

                streams.push({
                    pid: pid,
                    type: streamInfo.codec_name,
                    extension: extension,
                    data: concatenatedData.buffer,
                    codec_type: streamInfo.codec_type,
                    stream_type: streamInfo.stream_type,
                    descriptors: streamInfo.descriptors
                });
            }

            console.log(`extractTSStreams: Successfully extracted ${streams.length} streams`);
            return streams;

        } catch (error) {
            console.error('extractTSStreams: Error extracting streams:', error);
            return [];
        }
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

            // console.log(`detectStreamType: PID ${pid} identified as stream ID ${streamId}`);

            let dataOffset = 6; // After prefix, id, length
            const pesLength = (payloadData[4] << 8) | payloadData[5];

            // Check if has optional PES header extension
            const noExtensionIds = new Set([0xBC, 0xBE, 0xBF, 0xF0, 0xF1, 0xFF, 0xF2, 0xF8]);
            if (!noExtensionIds.has(streamId)) {
                // Has extension
                const pesFlags = payloadData[6];
                const pesHeaderDataLen = payloadData[8];
                dataOffset = 9 + pesHeaderDataLen;
            }

            const innerData = payloadData.subarray(dataOffset);

            // Private streams (potential KLV)
            if (streamId === 0xBD || streamId === 0xBF) {
                console.log(`detectStreamType: PID ${pid} identified as private stream (ID ${streamId}, potential KLV)`);
                if (innerData.length >= 16 &&
                    innerData[0] === 0x06 && innerData[1] === 0x0E &&
                    innerData[2] === 0x2B && innerData[3] === 0x34) {
                    console.log(`detectStreamType: PID ${pid} confirmed as KLV data (Universal Label found after PES header)`);
                    return { type: 'klv', extension: 'klv' };
                }
                return { type: 'data', extension: 'bin' };
            }

            // Video streams (0xE0-0xEF)
            if (streamId >= 0xE0 && streamId <= 0xEF) {
                return { type: 'video', extension: 'h264' };
            }

            // Audio streams (0xC0-0xDF)
            if (streamId >= 0xC0 && streamId <= 0xDF) {
                return { type: 'audio', extension: 'aac' };
            }
        }

        // Check for H.264 NAL units (raw, non-PES)
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

        // Check for KLV data (MISB metadata) - raw, non-PES
        // KLV typically starts with a 16-byte Universal Label
        if (payloadData.length >= 16) {

            // get the first 24 bytes as a hex string
            const labelHex = payloadData.slice(0, 24).reduce((acc, val) => acc + ('0' + val.toString(16)).slice(-2), '');

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

    /**
     * Comprehensive Transport Stream analysis - ffprobe equivalent
     * Analyzes the entire stream for detailed codec information, timing, and metadata
     * @param {ArrayBuffer} buffer - The TS file buffer
     * @returns {Object} Detailed stream analysis with timing, codec info, etc.
     */
    static probeTransportStreamBufferDetailed(buffer) {
        return probeTransportStreamBufferDetailed(buffer);
    }

    /**
     * Basic Transport Stream analysis - PSI tables only
     * @param {ArrayBuffer} buffer - The TS file buffer  
     * @returns {Object} Basic stream structure from PAT/PMT tables
     */
    static probeTransportStreamBuffer(buffer) {
        return probeTransportStreamBuffer(buffer);
    }

}


// tsProbe.js
// Minimal MPEG-TS PSI parser in Node.js (no ffprobe). Focus: PAT/PMT → programs/streams.
// Handles 188-byte TS packets, PAT (PID 0x0000), PMT, PCR PID, stream types, and key descriptors.
// Good enough to label H.264, H.265, AAC, MP3, KLV (via registration desc “KLVA”), and generic private data.

const PACKET = 188;
const SYNC = 0x47;

const STREAM_TYPE = {
    0x01: "MPEG1 Video",
    0x02: "MPEG2 Video",
    0x03: "MPEG1 Audio (MP1/MP2/MP3)",
    0x04: "MPEG2 Audio (MP2/MP3)",
    0x06: "PES Private Data (e.g., KLV, DVB subtitles)",
    0x0F: "AAC (LATM)",
    0x11: "AAC (ADTS)",
    0x15: "Metadata (ID3, SCTE-35, etc.)",
    0x1B: "H.264/AVC",
    0x24: "H.265/HEVC",
    0x42: "AVS",
    0x81: "AC3 (ATSC)",
    0x86: "SCTE-35 (Digital Program Insertion)",
};

function readFile(path) {
    const buf = fs.readFileSync(path);
    if (buf.length < PACKET || buf[0] !== SYNC) {
        throw new Error("Not an MPEG-TS file (bad sync).");
    }
    return buf;
}

function* packets(buf) {
    for (let off = 0; off + PACKET <= buf.length; off += PACKET) {
        if (buf[off] !== SYNC) continue; // resync loosely
        yield buf.subarray(off, off + PACKET);
    }
}

// Very small PSI section reassembler for a given PID
function collectSections(buf, pidWanted) {
    const sections = [];
    const seenSections = new Set(); // Track unique sections by their content hash
    let cur = null;

    for (const pkt of packets(buf)) {
        const tei = (pkt[1] & 0x80) >>> 7;
        const pusi = (pkt[1] & 0x40) >>> 6;
        const pid = ((pkt[1] & 0x1f) << 8) | pkt[2];
        if (tei) continue;
        if (pid !== pidWanted) continue;

        let p = 4;
        const adapt = (pkt[3] & 0x30) >>> 4;
        if (adapt === 2 || adapt === 3) {
            const afl = pkt[p]; p += 1 + afl; // skip adaptation field
        }
        if (p >= PACKET) continue;

        if (pusi) {
            const pointerField = pkt[p]; p += 1;
            p += pointerField; // skip stuffing to section start
            if (p >= PACKET) continue;
            // New section begins
            const remaining = pkt.subarray(p);
            if (remaining.length >= 3) {
                const sectionLen = ((remaining[1] & 0x0f) << 8) | remaining[2];
                cur = new Uint8Array(3 + sectionLen);
                const copyLength = Math.min(cur.length, remaining.length);
                cur.set(remaining.subarray(0, copyLength), 0);
                // If not complete yet, wait for next packets
                if (remaining.length >= cur.length) {
                    // Create a simple hash of the section content for deduplication
                    const hash = Array.from(cur).join(',');
                    if (!seenSections.has(hash)) {
                        seenSections.add(hash);
                        sections.push(cur);
                    }
                    cur = null;
                } else {
                    cur._written = remaining.length;
                }
            }
        } else if (cur) {
            // Continuation of current section
            const toCopy = Math.min(cur.length - (cur._written ?? 0), PACKET - p);
            cur.set(pkt.subarray(p, p + toCopy), cur._written ?? 0);
            cur._written = (cur._written ?? 0) + toCopy;
            if (cur._written >= cur.length) {
                // Create a simple hash of the section content for deduplication
                const hash = Array.from(cur).join(',');
                if (!seenSections.has(hash)) {
                    seenSections.add(hash);
                    sections.push(cur);
                }
                cur = null;
            }
        }
    }
    return sections;
}

// Parse PAT → map program_number → PMT PID
function parsePAT(section) {
    const tableId = section[0];
    if (tableId !== 0x00) return [];
    const sectionLen = ((section[1] & 0x0f) << 8) | section[2];
    const tsid = (section[3] << 8) | section[4];
    const entriesEnd = 3 + sectionLen - 4; // minus CRC32
    const out = [];
    
    for (let i = 8; i < entriesEnd; i += 4) {
        const programNumber = (section[i] << 8) | section[i + 1];
        const pid = ((section[i + 2] & 0x1f) << 8) | section[i + 3];
        if (programNumber === 0) {
            // network PID (NIT) — ignore for this purpose
        } else {
            out.push({ program_number: programNumber, pmt_pid: pid, ts_id: tsid });
        }
    }
    return out;
}

// Parse PMT → PCR PID + ES list (pid, stream_type, descriptors)
function parsePMT(section) {
    const tableId = section[0];
    if (tableId !== 0x02) return null;
    const sectionLen = ((section[1] & 0x0f) << 8) | section[2];
    const programNumber = (section[3] << 8) | section[4];
    const pcrPid = ((section[8] & 0x1f) << 8) | section[9];
    const progInfoLen = ((section[10] & 0x0f) << 8) | section[11];
    let p = 12 + progInfoLen;
    const entriesEnd = 3 + sectionLen - 4;

    const streams = [];
    while (p + 5 <= entriesEnd) {
        const streamType = section[p]; p += 1;
        const elementaryPid = ((section[p] & 0x1f) << 8) | section[p + 1]; p += 2;
        const esInfoLen = ((section[p] & 0x0f) << 8) | section[p + 1]; p += 2;

        // Parse ES descriptors (very selectively)
        const descs = [];
        const esEnd = p + esInfoLen;
        while (p + 2 <= esEnd) {
            const tag = section[p], len = section[p + 1];
            const body = section.subarray(p + 2, p + 2 + len);
            if (tag === 0x05 && len >= 4) { // registration_descriptor
                const fourCC = String.fromCharCode(...body.subarray(0, 4));
                descs.push({ tag, name: "registration", format_identifier: fourCC });
            } else if (tag === 0x0A) { // ISO_639_language_descriptor
                const lang = String.fromCharCode(...body.subarray(0, 3));
                descs.push({ tag, name: "language", lang });
            } else if (tag === 0x26 && len >= 7) { // Check if tag 38 contains KLVA registration
                // Look for KLVA at different positions in the descriptor
                let foundKLVA = false;
                for (let i = 0; i <= len - 4; i++) {
                    const fourCC = String.fromCharCode(...body.subarray(i, i + 4));
                    if (fourCC === "KLVA") {
                        descs.push({ tag, name: "registration", format_identifier: fourCC });
                        foundKLVA = true;
                        break;
                    }
                }
                if (!foundKLVA) {
                    descs.push({ tag, length: len, data: Array.from(body) });
                }
            } else {
                descs.push({ tag, length: len, data: len <= 16 ? Array.from(body) : undefined });
            }
            p += 2 + len;
        }
        streams.push({
            stream_type: streamType,
            stream_type_name: STREAM_TYPE[streamType] || "Unknown",
            elementary_pid: elementaryPid,
            descriptors: descs,
        });
    }

    return {
        program_number: programNumber,
        pcr_pid: pcrPid,
        streams,
    };
}

// Public API
export function probeTransportStream(path) {
    const buf = readFile(path);
    return probeTransportStreamBuffer(buf);
}

export function probeTransportStreamBuffer(buf) {
    // if ArrayBuffer, convert it to Uint8Array
    if (buf instanceof ArrayBuffer) {
        buf = new Uint8Array(buf);
    }
    

    if (!(buf instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array.");
    }

    // 1) PAT on PID 0x0000 → PMT PIDs
    const patSections = collectSections(buf, 0x0000);
    const patEntries = patSections.flatMap(parsePAT);

    // Deduplicate programs by program_number (multiple PAT sections may contain same programs)
    const uniquePrograms = new Map();
    for (const entry of patEntries) {
        uniquePrograms.set(entry.program_number, entry);
    }

    // 2) For each unique PMT PID, parse PMT
    const programs = [];
    for (const { program_number, pmt_pid, ts_id } of uniquePrograms.values()) {
        const pmtSections = collectSections(buf, pmt_pid);
        
        // Use the last complete PMT section (newest version)
        const last = pmtSections[pmtSections.length - 1];
        if (!last) continue;
        const pmt = parsePMT(last);
        if (!pmt) continue;

        // Normalize to ffprobe-like shape
        const streams = pmt.streams.map((s, index) => {
            // Try to infer KLV when registration = "KLVA" or stream_type private
            const reg = s.descriptors.find(d => d.name === "registration")?.format_identifier;
            const codec_name =
                reg === "KLVA" ? "klv" :
                    (s.stream_type === 0x1B ? "h264" :
                        s.stream_type === 0x24 ? "hevc" :
                            s.stream_type === 0x0F || s.stream_type === 0x11 ? "aac" :
                                s.stream_type === 0x03 || s.stream_type === 0x04 ? "mp3" :
                                    s.stream_type === 0x15 && reg === "KLVA" ? "klv" :
                                        s.stream_type === 0x15 ? "timed_id3" :
                                            s.stream_type === 0x06 && reg ? reg : "unknown");

            const codec_type = codec_name === "h264" || codec_name === "hevc" ? "video" :
                        codec_name === "aac" || codec_name === "mp3" ? "audio" :
                            codec_name === "klv" || codec_name === "timed_id3" ? "data" : "unknown";

            return {
                index: index,
                codec_name,
                codec_long_name: codec_name === "h264" ? "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10" :
                                codec_name === "hevc" ? "H.265 / HEVC (High Efficiency Video Coding)" :
                                codec_name === "aac" ? "AAC (Advanced Audio Coding)" :
                                codec_name === "mp3" ? "MP3 (MPEG audio layer 3)" :
                                codec_name === "klv" ? "SMPTE 336M Key-Length-Value (KLV) metadata" :
                                codec_name === "timed_id3" ? "Timed ID3 metadata" :
                                "Unknown",
                codec_type,
                codec_tag_string: codec_name === "klv" ? "KLVA" : `[${s.stream_type.toString(16).padStart(2, '0')}][0][0][0]`,
                codec_tag: codec_name === "klv" ? "0x41564c4b" : "0x" + s.stream_type.toString(16).padStart(4, "0"),
                id: "0x" + s.elementary_pid.toString(16),
                ts_id: ts_id.toString(),
                ts_packetsize: "188",
                r_frame_rate: "0/0",
                avg_frame_rate: "0/0", 
                time_base: "1/90000",
                start_pts: 0,
                start_time: "0.000000",
                duration_ts: 0,
                duration: "0.000000",
                disposition: {
                    default: 0,
                    dub: 0,
                    original: 0,
                    comment: 0,
                    lyrics: 0,
                    karaoke: 0,
                    forced: 0,
                    hearing_impaired: 0,
                    visual_impaired: 0,
                    clean_effects: 0,
                    attached_pic: 0,
                    timed_thumbnails: 0,
                    non_diegetic: 0,
                    captions: 0,
                    descriptions: 0,
                    metadata: 0,
                    dependent: 0,
                    still_image: 0,
                    multilayer: 0
                },
                stream_type: "0x" + s.stream_type.toString(16).padStart(2, "0"),
                stream_type_name: s.stream_type_name,
                descriptors: s.descriptors,
            };
        });

        programs.push({
            program_id: program_number,
            program_num: program_number,
            nb_streams: streams.length,
            pmt_pid,
            pcr_pid: pmt.pcr_pid,
            ts_id,
            streams,
        });
    }

    // 3) Flatten “streams” (ffprobe prints both per-program and a top-level list)
    const flatStreams = programs.flatMap(p => p.streams);
    
    // Re-index streams globally for the flattened list
    flatStreams.forEach((stream, globalIndex) => {
        stream.index = globalIndex;
    });

    return { programs, streams: flatStreams };
}

// Elementary Stream Parsers for detailed codec information

/**
 * Parse H.264 SPS (Sequence Parameter Set) to extract video parameters
 */
function parseH264SPS(nalUnit) {
    try {
        if (nalUnit.length < 10) return null;
        
        // Skip NAL header and start parsing SPS
        let offset = 1;
        const profile_idc = nalUnit[offset];
        offset += 1;
        
        // Skip constraint flags
        offset += 1;
        
        const level_idc = nalUnit[offset];
        offset += 1;
        
        // This is a simplified SPS parser - full implementation would need
        // proper Exponential-Golomb decoding for width/height
        // For now, we'll use common resolutions based on level
        let width = 1920, height = 1080;
        
        // Try to guess resolution from level (very rough approximation)
        if (level_idc <= 30) { // Level 3.0 and below
            width = 1280; height = 720;
        } else if (level_idc <= 31) { // Level 3.1
            width = 1280; height = 720;
        } else if (level_idc <= 40) { // Level 4.0
            width = 1920; height = 1080;
        } else { // Level 4.1+
            width = 1920; height = 1080;
        }
        
        return {
            profile: profile_idc,
            level: level_idc,
            width,
            height
        };
    } catch (e) {
        return null;
    }
}

/**
 * Parse AAC ADTS header to extract audio parameters
 */
function parseAACHeader(data) {
    try {
        if (data.length < 7) return null;
        
        // Check for ADTS sync word (0xFFF)
        if ((data[0] & 0xFF) !== 0xFF || (data[1] & 0xF0) !== 0xF0) {
            return null;
        }
        
        const profile = ((data[2] & 0xC0) >> 6) + 1;
        const sampleRateIndex = (data[2] & 0x3C) >> 2;
        const channelConfig = ((data[2] & 0x01) << 2) | ((data[3] & 0xC0) >> 6);
        
        const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        const sampleRate = sampleRates[sampleRateIndex] || 48000;
        
        return {
            profile,
            sample_rate: sampleRate,
            channels: channelConfig || 2
        };
    } catch (e) {
        return null;
    }
}

/**
 * Parse PES packet to extract timing information
 */
function parsePESPacket(data) {
    try {
        if (data.length < 9) return null;
        
        // Check PES start code (0x000001)
        if (data[0] !== 0x00 || data[1] !== 0x00 || data[2] !== 0x01) {
            return null;
        }
        
        const streamId = data[3];
        const pesLength = (data[4] << 8) | data[5];
        
        // Skip if no PES header extension
        const noExtensionIds = new Set([0xBC, 0xBE, 0xBF, 0xF0, 0xF1, 0xFF, 0xF2, 0xF8]);
        if (noExtensionIds.has(streamId)) {
            return { streamId, pts: null, dts: null };
        }
        
        if (data.length < 9) return null;
        
        const pesFlags = data[7];
        const pesHeaderLength = data[8];
        
        let pts = null, dts = null;
        let offset = 9;
        
        // Parse PTS
        if ((pesFlags & 0x80) && offset + 5 <= data.length) {
            pts = ((data[offset] & 0x0E) << 29) |
                  (data[offset + 1] << 22) |
                  ((data[offset + 2] & 0xFE) << 14) |
                  (data[offset + 3] << 7) |
                  ((data[offset + 4] & 0xFE) >> 1);
            offset += 5;
        }
        
        // Parse DTS
        if ((pesFlags & 0x40) && offset + 5 <= data.length) {
            dts = ((data[offset] & 0x0E) << 29) |
                  (data[offset + 1] << 22) |
                  ((data[offset + 2] & 0xFE) << 14) |
                  (data[offset + 3] << 7) |
                  ((data[offset + 4] & 0xFE) >> 1);
        }
        
        return { streamId, pts, dts, pesHeaderLength };
    } catch (e) {
        return null;
    }
}

/**
 * Comprehensive Transport Stream analysis - ffprobe equivalent
 * Analyzes the entire stream for detailed codec information, timing, and metadata
 */
export function probeTransportStreamBufferDetailed(buffer) {
    // First get basic structure from PSI tables
    const basicInfo = probeTransportStreamBuffer(buffer);
    
    // Now do detailed analysis of each stream
    const detailedStreams = [];
    const streamAnalysis = new Map(); // PID -> analysis data
    
    const uint8Array = new Uint8Array(buffer);
    const packetSize = 188;
    
    // Track timing and content for each stream
    for (const program of basicInfo.programs) {
        for (const stream of program.streams) {
            const pid = parseInt(stream.id, 16);
            streamAnalysis.set(pid, {
                ...stream,
                packets: [],
                firstPTS: null,
                lastPTS: null,
                pesPackets: [],
                elementaryData: [],
                frameCount: 0,
                totalBytes: 0
            });
        }
    }
    
    // Scan through all packets to collect stream data
    for (let offset = 0; offset < uint8Array.length - packetSize; offset += packetSize) {
        if (uint8Array[offset] !== 0x47) continue; // Skip non-sync packets
        
        // Parse TS header
        const header1 = uint8Array[offset + 1];
        const header2 = uint8Array[offset + 2];
        const header3 = uint8Array[offset + 3];
        
        const pid = ((header1 & 0x1F) << 8) | header2;
        const payloadUnitStartIndicator = (header1 & 0x40) !== 0;
        const adaptationFieldControl = (header3 & 0x30) >> 4;
        
        if (!streamAnalysis.has(pid)) continue;
        
        let payloadStart = 4;
        
        // Handle adaptation field
        if (adaptationFieldControl === 2 || adaptationFieldControl === 3) {
            const adaptationFieldLength = uint8Array[offset + 4];
            payloadStart += 1 + adaptationFieldLength;
        }
        
        // Skip if no payload
        if (adaptationFieldControl === 2) continue;
        
        if (payloadStart < packetSize) {
            const payloadData = uint8Array.slice(offset + payloadStart, offset + packetSize);
            const analysis = streamAnalysis.get(pid);
            
            analysis.packets.push({
                offset,
                payloadUnitStart: payloadUnitStartIndicator,
                payload: payloadData
            });
            
            analysis.totalBytes += payloadData.length;
            
            // If this starts a new PES packet, try to parse it
            if (payloadUnitStartIndicator) {
                const pesInfo = parsePESPacket(payloadData);
                if (pesInfo && pesInfo.pts !== null) {
                    if (analysis.firstPTS === null) {
                        analysis.firstPTS = pesInfo.pts;
                    }
                    analysis.lastPTS = pesInfo.pts;
                    analysis.pesPackets.push(pesInfo);
                }
                
                // Collect elementary stream data for codec analysis
                if (payloadData.length > 20) {
                    analysis.elementaryData.push(payloadData);
                }
            }
        }
    }
    
    // Analyze each stream in detail
    for (const [pid, analysis] of streamAnalysis.entries()) {
        const detailedStream = { ...analysis };
        
        // Calculate timing information
        if (analysis.firstPTS !== null && analysis.lastPTS !== null) {
            const startTime = analysis.firstPTS / 90000; // Convert from 90kHz to seconds
            const endTime = analysis.lastPTS / 90000;
            const duration = endTime - startTime;
            
            detailedStream.start_pts = analysis.firstPTS;
            detailedStream.start_time = startTime.toFixed(6);
            detailedStream.duration_ts = analysis.lastPTS - analysis.firstPTS;
            detailedStream.duration = duration.toFixed(6);
        }
        
        // Analyze elementary stream content based on codec
        if (analysis.codec_name === 'h264' && analysis.elementaryData.length > 0) {
            // Look for H.264 NAL units
            for (const data of analysis.elementaryData) {
                // Look for SPS NAL unit (type 7)
                for (let i = 0; i < data.length - 4; i++) {
                    if (data[i] === 0x00 && data[i+1] === 0x00 && data[i+2] === 0x01) {
                        const nalType = data[i+3] & 0x1F;
                        if (nalType === 7) { // SPS
                            const spsInfo = parseH264SPS(data.slice(i+3));
                            if (spsInfo) {
                                detailedStream.width = spsInfo.width;
                                detailedStream.height = spsInfo.height;
                                detailedStream.profile = spsInfo.profile;
                                detailedStream.level = spsInfo.level;
                            }
                            break;
                        }
                    }
                }
            }
            
            // Estimate frame rate from PES packets
            if (analysis.pesPackets.length > 1) {
                const frameInterval = (analysis.lastPTS - analysis.firstPTS) / (analysis.pesPackets.length - 1);
                const fps = 90000 / frameInterval;
                detailedStream.r_frame_rate = `${Math.round(fps * 1000)}/1000`;
                detailedStream.avg_frame_rate = detailedStream.r_frame_rate;
            }
        }
        
        if (analysis.codec_name === 'aac' && analysis.elementaryData.length > 0) {
            // Look for AAC ADTS headers
            for (const data of analysis.elementaryData) {
                const aacInfo = parseAACHeader(data);
                if (aacInfo) {
                    detailedStream.sample_rate = aacInfo.sample_rate;
                    detailedStream.channels = aacInfo.channels;
                    detailedStream.profile = aacInfo.profile;
                    break;
                }
            }
        }
        
        // Clean up temporary analysis data
        delete detailedStream.packets;
        delete detailedStream.pesPackets;
        delete detailedStream.elementaryData;
        delete detailedStream.firstPTS;
        delete detailedStream.lastPTS;
        delete detailedStream.frameCount;
        delete detailedStream.totalBytes;
        
        detailedStreams.push(detailedStream);
    }
    
    // Update the programs with detailed stream info
    const detailedPrograms = basicInfo.programs.map(program => ({
        ...program,
        streams: detailedStreams.filter(s => 
            program.streams.some(ps => ps.id === s.id)
        )
    }));
    
    return {
        programs: detailedPrograms,
        streams: detailedStreams
    };
}


// ---- Example ----
// const info = TSParser.probeTransportStreamBufferDetailed(buffer);
// console.dir(info, { depth: null });


