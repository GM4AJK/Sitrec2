/**
 * Comprehensive TS File Validation Test
 * Tests three TS files to ensure:
 * 1. KLV data is extracted correctly
 * 2. Video streams are valid and contain SPS/PPS
 * 3. No truncation or corruption issues
 */

import fs from 'fs';
import {TSParser} from '../src/TSParser.js';
import {H264Decoder} from '../src/H264Decoder.js';

// Test files - all .ts files in MISB directory
const TEST_FILES = [
    {
        name: 'Cheyenne.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/Cheyenne.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'H.264 video + KLV metadata'
    },
    {
        name: 'falls.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/falls.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'H.264 video + KLV metadata'
    },
    {
        name: 'Esri_multiplexer_0.mp4.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/Esri_multiplexer_0.mp4.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'MPEG2 video + KLV metadata'
    },
    {
        name: 'short.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/short.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'Short test file with video + KLV'
    },
    {
        name: 'klv_metadata_test_sync.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/klv_metadata_test_sync.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'KLV metadata synchronization test'
    },
    {
        name: 'Day Flight.mpg.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/Day Flight.mpg.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'Day flight MPEG video + KLV'
    },
    {
        name: 'Truck.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/Truck.ts',
        expectedVideo: true,
        expectedKLV: true,
        description: 'Truck video + KLV metadata'
    },
    {
        name: 'DOD_110982722-1920x1080-7830k-hls_1-1920x1080-7830k-hls_00001.ts',
        path: '/Users/mick/Dropbox/Sitrec Resources/MISB/DOD_110982722-1920x1080-7830k-hls_1-1920x1080-7830k-hls_00001.ts',
        expectedVideo: true,
        expectedKLV: false,
        description: 'DOD HLS segment with video only (no KLV)'
    }
];

/**
 * Validate H.264 stream structure
 */
function validateH264Stream(data, filename) {
    console.log(`\n  Validating H.264 stream for ${filename}...`);
    
    try {
        const analysis = H264Decoder.analyzeH264Stream(data);
        
        console.log(`    - Total NAL units: ${analysis.nalUnits.length}`);
        console.log(`    - SPS found: ${analysis.hasSPS ? 'YES' : 'NO'}`);
        console.log(`    - PPS found: ${analysis.hasPPS ? 'YES' : 'NO'}`);
        console.log(`    - IDR frames: ${analysis.idrCount}`);
        console.log(`    - P frames: ${analysis.pFrameCount}`);
        console.log(`    - B frames: ${analysis.bFrameCount}`);
        
        if (analysis.hasSPS) {
            console.log(`    - SPS size: ${analysis.spsData.length} bytes`);
            console.log(`    - SPS hex: ${Array.from(analysis.spsData.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        }
        
        if (analysis.hasPPS) {
            console.log(`    - PPS size: ${analysis.ppsData.length} bytes`);
            console.log(`    - PPS hex: ${Array.from(analysis.ppsData.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        }
        
        // Validation checks
        const issues = [];
        
        if (!analysis.hasSPS) {
            issues.push('Missing SPS (Sequence Parameter Set)');
        }
        
        if (!analysis.hasPPS) {
            issues.push('Missing PPS (Picture Parameter Set)');
        }
        
        if (analysis.idrCount === 0 && analysis.pFrameCount === 0) {
            issues.push('No video frames found (no IDR or P frames)');
        }
        
        if (analysis.nalUnits.length === 0) {
            issues.push('No NAL units found');
        }
        
        if (issues.length > 0) {
            console.log(`    ❌ VALIDATION FAILED:`);
            issues.forEach(issue => console.log(`       - ${issue}`));
            return { valid: false, issues, analysis };
        } else {
            console.log(`    ✅ H.264 stream is VALID`);
            return { valid: true, issues: [], analysis };
        }
        
    } catch (error) {
        console.log(`    ❌ VALIDATION ERROR: ${error.message}`);
        return { valid: false, issues: [error.message], analysis: null };
    }
}

/**
 * Validate MPEG2 stream structure
 */
function validateMPEG2Stream(data, filename) {
    console.log(`\n  Validating MPEG2 stream for ${filename}...`);
    
    const uint8 = new Uint8Array(data);
    
    // Look for MPEG2 start codes
    let sequenceHeaders = 0;
    let pictureHeaders = 0;
    let gopHeaders = 0;
    
    for (let i = 0; i < uint8.length - 4; i++) {
        if (uint8[i] === 0x00 && uint8[i + 1] === 0x00 && uint8[i + 2] === 0x01) {
            const startCode = uint8[i + 3];
            
            if (startCode === 0xB3) sequenceHeaders++;      // Sequence header
            if (startCode === 0x00) pictureHeaders++;       // Picture start
            if (startCode === 0xB8) gopHeaders++;           // GOP header
        }
    }
    
    console.log(`    - Sequence headers: ${sequenceHeaders}`);
    console.log(`    - GOP headers: ${gopHeaders}`);
    console.log(`    - Picture headers: ${pictureHeaders}`);
    console.log(`    - Stream size: ${uint8.length} bytes`);
    
    const issues = [];
    
    if (sequenceHeaders === 0) {
        issues.push('Missing MPEG2 sequence headers');
    }
    
    if (pictureHeaders === 0) {
        issues.push('No picture data found');
    }
    
    if (issues.length > 0) {
        console.log(`    ❌ VALIDATION FAILED:`);
        issues.forEach(issue => console.log(`       - ${issue}`));
        return { valid: false, issues };
    } else {
        console.log(`    ✅ MPEG2 stream is VALID`);
        return { valid: true, issues: [] };
    }
}

/**
 * Validate KLV stream structure
 */
function validateKLVStream(data, filename) {
    console.log(`\n  Validating KLV stream for ${filename}...`);
    
    const uint8 = new Uint8Array(data);
    
    // Look for KLV packets
    let localSetPackets = 0;
    let universalKeyPackets = 0;
    let totalBytes = uint8.length;
    
    for (let i = 0; i < uint8.length - 16; i++) {
        // Check for local set key (00 00 df)
        if (uint8[i] === 0x00 && uint8[i + 1] === 0x00 && uint8[i + 2] === 0xdf) {
            localSetPackets++;
        }
        
        // Check for universal key (06 0e 2b 34)
        if (uint8[i] === 0x06 && uint8[i + 1] === 0x0e && 
            uint8[i + 2] === 0x2b && uint8[i + 3] === 0x34) {
            universalKeyPackets++;
        }
    }
    
    console.log(`    - Local set packets: ${localSetPackets}`);
    console.log(`    - Universal key packets: ${universalKeyPackets}`);
    console.log(`    - Total size: ${totalBytes} bytes`);
    console.log(`    - First 32 bytes: ${Array.from(uint8.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    const issues = [];
    
    if (localSetPackets === 0 && universalKeyPackets === 0) {
        issues.push('No KLV packets found (no local set or universal keys)');
    }
    
    if (totalBytes === 0) {
        issues.push('Empty KLV stream');
    }
    
    if (issues.length > 0) {
        console.log(`    ❌ VALIDATION FAILED:`);
        issues.forEach(issue => console.log(`       - ${issue}`));
        return { valid: false, issues };
    } else {
        console.log(`    ✅ KLV stream is VALID`);
        return { valid: true, issues: [] };
    }
}

/**
 * Test a single TS file
 */
async function testTSFile(fileInfo) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${fileInfo.name}`);
    console.log(`Description: ${fileInfo.description}`);
    console.log(`Path: ${fileInfo.path}`);
    console.log(`${'='.repeat(80)}`);
    
    // Check if file exists
    if (!fs.existsSync(fileInfo.path)) {
        console.log(`❌ FILE NOT FOUND: ${fileInfo.path}`);
        return {
            filename: fileInfo.name,
            success: false,
            error: 'File not found'
        };
    }
    
    // Read file
    const buffer = fs.readFileSync(fileInfo.path);
    const fileSize = buffer.length;
    console.log(`File size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    
    try {
        // Extract streams
        console.log('\n--- Extracting Streams ---');
        const streams = TSParser.extractTSStreams(buffer.buffer);
        
        console.log(`\nExtracted ${streams.length} streams:`);
        streams.forEach((stream, idx) => {
            console.log(`  ${idx + 1}. PID ${stream.pid} (0x${stream.pid.toString(16).toUpperCase()}): ${stream.type} (${stream.codec_type}) - ${stream.data.byteLength} bytes`);
        });
        
        // Separate streams by type
        const videoStreams = streams.filter(s => s.codec_type === 'video');
        const dataStreams = streams.filter(s => s.codec_type === 'data');
        
        console.log(`\nVideo streams: ${videoStreams.length}`);
        console.log(`Data streams: ${dataStreams.length}`);
        
        // Validation results
        const results = {
            filename: fileInfo.name,
            success: true,
            fileSize,
            streamCount: streams.length,
            videoStreams: videoStreams.length,
            dataStreams: dataStreams.length,
            validations: []
        };
        
        // Validate video streams
        console.log('\n--- Validating Video Streams ---');
        for (const stream of videoStreams) {
            let validation;
            
            if (stream.type === 'h264') {
                validation = validateH264Stream(stream.data, fileInfo.name);
            } else if (stream.type === 'mpeg2video') {
                validation = validateMPEG2Stream(stream.data, fileInfo.name);
            } else {
                console.log(`\n  Skipping validation for ${stream.type} (not implemented)`);
                validation = { valid: true, issues: [], skipped: true };
            }
            
            results.validations.push({
                type: 'video',
                codec: stream.type,
                pid: stream.pid,
                size: stream.data.byteLength,
                ...validation
            });
        }
        
        // Validate KLV streams
        console.log('\n--- Validating KLV Streams ---');
        for (const stream of dataStreams) {
            if (stream.type === 'klv') {
                const validation = validateKLVStream(stream.data, fileInfo.name);
                results.validations.push({
                    type: 'data',
                    codec: stream.type,
                    pid: stream.pid,
                    size: stream.data.byteLength,
                    ...validation
                });
            }
        }
        
        // Check expectations
        console.log('\n--- Checking Expectations ---');
        
        if (fileInfo.expectedVideo && videoStreams.length === 0) {
            console.log(`❌ Expected video stream but none found`);
            results.success = false;
        } else if (fileInfo.expectedVideo && videoStreams.length > 0) {
            console.log(`✅ Video stream found as expected`);
        }
        
        if (fileInfo.expectedKLV && dataStreams.filter(s => s.type === 'klv').length === 0) {
            console.log(`❌ Expected KLV stream but none found`);
            results.success = false;
        } else if (fileInfo.expectedKLV && dataStreams.filter(s => s.type === 'klv').length > 0) {
            console.log(`✅ KLV stream found as expected`);
        }
        
        // Check if all validations passed
        const failedValidations = results.validations.filter(v => !v.valid && !v.skipped);
        if (failedValidations.length > 0) {
            console.log(`\n❌ ${failedValidations.length} validation(s) failed`);
            results.success = false;
        } else {
            console.log(`\n✅ All validations passed`);
        }
        
        return results;
        
    } catch (error) {
        console.log(`\n❌ ERROR: ${error.message}`);
        console.log(error.stack);
        return {
            filename: fileInfo.name,
            success: false,
            error: error.message
        };
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('\n');
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║' + ' '.repeat(20) + 'TS FILE VALIDATION TEST SUITE' + ' '.repeat(28) + '║');
    console.log('╚' + '═'.repeat(78) + '╝');
    
    const results = [];
    
    for (const fileInfo of TEST_FILES) {
        const result = await testTSFile(fileInfo);
        results.push(result);
    }
    
    // Summary
    console.log('\n\n');
    console.log('╔' + '═'.repeat(78) + '╗');
    console.log('║' + ' '.repeat(32) + 'TEST SUMMARY' + ' '.repeat(34) + '║');
    console.log('╚' + '═'.repeat(78) + '╝');
    
    console.log('\n');
    results.forEach((result, idx) => {
        const status = result.success ? '✅ PASS' : '❌ FAIL';
        console.log(`${idx + 1}. ${status} - ${result.filename}`);
        
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        } else {
            console.log(`   Streams: ${result.streamCount} (${result.videoStreams} video, ${result.dataStreams} data)`);
            
            if (result.validations) {
                const failed = result.validations.filter(v => !v.valid && !v.skipped);
                if (failed.length > 0) {
                    console.log(`   Failed validations:`);
                    failed.forEach(v => {
                        console.log(`     - ${v.codec} (PID ${v.pid}): ${v.issues.join(', ')}`);
                    });
                }
            }
        }
        console.log('');
    });
    
    const passCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log(`Total: ${results.length} files tested`);
    console.log(`Passed: ${passCount}`);
    console.log(`Failed: ${failCount}`);
    
    if (failCount === 0) {
        console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
        process.exit(0);
    } else {
        console.log('\n⚠️  SOME TESTS FAILED ⚠️\n');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});