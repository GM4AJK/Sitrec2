import fs from 'fs';
import path from 'path';
import {TSParser} from '../src/TSParser.js';

describe('MISB File Processing Test', () => {
    const testFilePath = '/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/falls.ts';
    
    beforeAll(() => {
        // Check if test file exists
        if (!fs.existsSync(testFilePath)) {
            throw new Error(`Test file not found: ${testFilePath}`);
        }
    });
    
    test('should successfully parse falls.ts file', async () => {
        console.log('Testing MISB file processing for falls.ts');
        
        // Read the file
        const buffer = fs.readFileSync(testFilePath);
        const fileName = path.basename(testFilePath);
        const fileSize = buffer.length;
        
        console.log(`File: ${fileName}`);
        console.log(`Size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
        
        // Test basic analysis
        console.log('Running basic TS analysis...');
        const startBasic = Date.now();
        const basicResult = TSParser.probeTransportStreamBuffer(buffer);
        const basicTime = Date.now() - startBasic;
        
        console.log(`Basic analysis completed in ${basicTime}ms`);
        console.log('Basic result:', JSON.stringify(basicResult, null, 2));
        
        // Test detailed analysis
        console.log('Running detailed TS analysis...');
        const startDetailed = Date.now();
        const detailedResult = TSParser.probeTransportStreamBufferDetailed(buffer);
        const detailedTime = Date.now() - startDetailed;
        
        console.log(`Detailed analysis completed in ${detailedTime}ms`);
        console.log('Programs found:', detailedResult.programs?.length || 0);
        console.log('Streams found:', detailedResult.streams?.length || 0);
        
        // Log stream details
        if (detailedResult.streams && detailedResult.streams.length > 0) {
            console.log('Stream details:');
            detailedResult.streams.forEach((stream, index) => {
                console.log(`  Stream ${index}:`);
                console.log(`    - Codec: ${stream.codec_name} (${stream.codec_long_name})`);
                console.log(`    - Type: ${stream.codec_type}`);
                console.log(`    - PID: ${stream.id} (0x${stream.id.toString(16).toUpperCase()})`);
                console.log(`    - Stream Type: ${stream.stream_type}`);
                if (stream.duration && parseFloat(stream.duration) > 0) {
                    console.log(`    - Duration: ${stream.duration}s`);
                }
            });
        }
        
        // Test stream extraction
        console.log('Testing stream extraction...');
        const startExtraction = Date.now();
        const extractedStreams = TSParser.extractTSStreams(buffer);
        const extractionTime = Date.now() - startExtraction;
        
        console.log(`Stream extraction completed in ${extractionTime}ms`);
        console.log(`Extracted ${extractedStreams.length} streams`);
        
        // Log extracted stream details
        if (extractedStreams.length > 0) {
            console.log('Extracted stream details:');
            extractedStreams.forEach((stream, index) => {
                console.log(`  Stream ${index}:`);
                console.log(`    - Type: ${stream.type}`);
                console.log(`    - Extension: ${stream.extension}`);
                console.log(`    - PID: ${stream.pid} (0x${stream.pid.toString(16).toUpperCase()})`);
                console.log(`    - Size: ${stream.data.byteLength} bytes`);
                console.log(`    - Codec Type: ${stream.codec_type}`);
                console.log(`    - Stream Type: ${stream.stream_type}`);
            });
        }
        
        // Assertions
        expect(buffer).toBeDefined();
        expect(buffer.length).toBeGreaterThan(0);
        expect(basicResult).toBeDefined();
        expect(detailedResult).toBeDefined();
        expect(extractedStreams).toBeDefined();
        expect(extractedStreams.length).toBeGreaterThan(0);
        
        // Check for expected stream types (video and data for MISB)
        const videoStreams = extractedStreams.filter(s => s.codec_type === 'video');
        const dataStreams = extractedStreams.filter(s => s.codec_type === 'data');
        
        console.log(`Video streams: ${videoStreams.length}`);
        console.log(`Data streams: ${dataStreams.length}`);
        
        expect(videoStreams.length).toBeGreaterThan(0);
        // MISB files should have data streams for metadata
        expect(dataStreams.length).toBeGreaterThan(0);
        
        // Performance checks
        expect(basicTime).toBeLessThan(5000); // Should complete within 5 seconds
        expect(detailedTime).toBeLessThan(10000); // Should complete within 10 seconds
        expect(extractionTime).toBeLessThan(30000); // Should complete within 30 seconds
        
        console.log('All tests passed!');
        
        // Return results for potential further analysis
        return {
            fileName,
            fileSize,
            basicTime,
            detailedTime,
            extractionTime,
            basicResult,
            detailedResult,
            extractedStreams
        };
    });
});