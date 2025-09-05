import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

describe('MISB File Drag and Drop Test', () => {
    let browser;
    let page;
    
    // Increase timeout for file processing
    jest.setTimeout(120000);
    
    const testFileName = 'falls.ts';
    const testFilePath = `/Users/mick/Dropbox/Sitrec Resources/MISB/QGISFMV_Samples/MISB/${testFileName}`;
    
    beforeAll(async () => {
        // Check if test file exists
        if (!fs.existsSync(testFilePath)) {
            throw new Error(`Test file not found: ${testFilePath}`);
        }

        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: {
                width: 1920,
                height: 1080,
            },
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        page = await browser.newPage();
        
        // Enable console logging
        page.on('console', msg => {
            const type = msg.type();
            if (type === 'error' || type === 'warn') {
                console.log(`[${type.toUpperCase()}] ${msg.text()}`);
            } else if (type === 'log') {
                console.log(`[LOG] ${msg.text()}`);
            }
        });
        
        // Enable error logging
        page.on('pageerror', error => {
            console.error('Page error:', error.message);
        });
        
        page.on('requestfailed', request => {
            console.error('Request failed:', request.url(), request.failure().errorText);
        });
        
        // Handle alert dialogs (like the WebGL incompatibility alert)
        page.on('dialog', async dialog => {
            console.log('Dialog appeared:', dialog.message());
            if (dialog.message().includes('Incompatible Browser') || dialog.message().includes('WebGLRenderer')) {
                console.log('Dismissing WebGL incompatibility dialog');
                await dialog.accept();
            } else {
                await dialog.accept();
            }
        });
    });
    
    afterAll(async () => {
        if (browser) {
            await browser.close();
        }
    });
    
    test(`should successfully drag and drop ${testFileName} file and process it`, async () => {
        try {
            // Navigate to the Custom sitch
            const url = 'https://local.metabunk.org/sitrec/?sitch=custom&ignoreunload=1';
            console.log('Navigating to:', url);
            
            // Add additional debugging
            console.log('Page created, starting navigation...');
            
            const response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            }).catch(async (error) => {
                console.log('Navigation failed, trying with different wait condition:', error.message);
                // Try with a more lenient wait condition
                return await page.goto(url, {
                    waitUntil: 'load',
                    timeout: 90000
                });
            });
            
            if (!response.ok()) {
                throw new Error(`Page load failed with status: ${response.status()}`);
            }
            
            console.log('Page loaded successfully');
            
            // Check WebGL context availability
            const webglCheck = await page.evaluate(() => {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                const gl2 = canvas.getContext('webgl2');
                return {
                    hasWebGL: !!gl,
                    hasWebGL2: !!gl2,
                    webglVendor: gl ? gl.getParameter(gl.VENDOR) : 'N/A',
                    webglRenderer: gl ? gl.getParameter(gl.RENDERER) : 'N/A',
                    webglVersion: gl ? gl.getParameter(gl.VERSION) : 'N/A'
                };
            });
            
            console.log('WebGL availability check:', webglCheck);
            
            if (!webglCheck.hasWebGL) {
                console.warn('WebGL is not available! This may cause issues with Sitrec initialization.');
            }
            
            // Check if there's a browser compatibility warning and try to dismiss it
            try {
                const compatibilityWarning = await page.$('.browser-warning, .incompatible-browser, #browser-warning');
                if (compatibilityWarning) {
                    console.log('Found browser compatibility warning, trying to dismiss...');
                    // Try to find and click a dismiss button
                    const dismissButton = await page.$('.dismiss, .close, .continue, button[onclick*="continue"]');
                    if (dismissButton) {
                        await dismissButton.click();
                        console.log('Dismissed browser warning');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            } catch (warningError) {
                console.log('No browser warning found or could not dismiss:', warningError.message);
            }
            
            // Wait for the page to be fully initialized
            // Note: Sit object won't exist until a file is loaded in custom mode
            
            // First, let's check what's available on the window
            const windowObjects = await page.evaluate(() => {
                return {
                    hasNodeMan: !!window.NodeMan,
                    hasDragDropHandler: !!window.DragDropHandler,
                    hasSit: !!window.Sit,
                    windowKeys: Object.keys(window).filter(key => key.includes('Node') || key.includes('Drag') || key.includes('Sit')).slice(0, 10)
                };
            });
            
            console.log('Window objects check:', windowObjects);
            
            if (!windowObjects.hasNodeMan || !windowObjects.hasDragDropHandler) {
                // Wait a bit more and try again
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const windowObjectsRetry = await page.evaluate(() => {
                    return {
                        hasNodeMan: !!window.NodeMan,
                        hasDragDropHandler: !!window.DragDropHandler,
                        hasSit: !!window.Sit,
                        windowKeys: Object.keys(window).filter(key => key.includes('Node') || key.includes('Drag') || key.includes('Sit')).slice(0, 10)
                    };
                });
                
                console.log('Window objects retry:', windowObjectsRetry);
            }
            
            // Wait for Sitrec to be initialized using the DOM-based ready signal
            // In custom mode, we only need partial ready (NodeMan and DragDropHandler)
            try {
                await page.waitForFunction(() => {
                    const readyElement = document.getElementById('sitrec-objects-ready');
                    const readyStatus = readyElement ? readyElement.getAttribute('data-ready') : null;
                    const isReady = readyElement && (readyStatus === 'partial' || readyStatus === 'complete');
                    console.log('Checking DOM ready signal:', {
                        elementExists: !!readyElement,
                        readyStatus: readyStatus,
                        timestamp: readyElement ? readyElement.getAttribute('data-timestamp') : 'no element',
                        isReady: isReady
                    });
                    return isReady;
                }, { timeout: 15000 });
                
                console.log('Sitrec objects are ready according to DOM signal');
                
                // Double-check that the objects are actually accessible
                const objectsCheck = await page.evaluate(() => {
                    const readyElement = document.getElementById('sitrec-objects-ready');
                    return {
                        hasNodeMan: typeof window.NodeMan !== 'undefined',
                        hasDragDropHandler: typeof window.DragDropHandler !== 'undefined',
                        hasSit: typeof window.Sit !== 'undefined',
                        readyFlag: window.SITREC_OBJECTS_READY,
                        domSignal: {
                            exists: !!readyElement,
                            ready: readyElement ? readyElement.getAttribute('data-ready') : null,
                            timestamp: readyElement ? readyElement.getAttribute('data-timestamp') : null
                        },
                        nodeManType: typeof window.NodeMan,
                        dragDropType: typeof window.DragDropHandler,
                        sitType: typeof window.Sit
                    };
                });
                
                console.log('Final objects check:', objectsCheck);
                
                // In custom mode, we only need NodeMan and DragDropHandler
                if (!objectsCheck.hasNodeMan || !objectsCheck.hasDragDropHandler) {
                    throw new Error('Required objects (NodeMan, DragDropHandler) are not accessible despite ready signal being set');
                }
                
            } catch (timeoutError) {
                console.log('Timeout waiting for DOM ready signal, trying fallback approach...');
                
                // Fallback: Try a different approach - poll manually
                let attempts = 0;
                const maxAttempts = 30;
                let objectsFound = false;
                
                while (attempts < maxAttempts && !objectsFound) {
                    const result = await page.evaluate(() => {
                        return {
                            hasNodeMan: typeof window.NodeMan !== 'undefined',
                            hasDragDropHandler: typeof window.DragDropHandler !== 'undefined',
                            hasSit: typeof window.Sit !== 'undefined',
                            readyFlag: window.SITREC_OBJECTS_READY,
                            nodeManType: typeof window.NodeMan,
                            dragDropType: typeof window.DragDropHandler,
                            sitType: typeof window.Sit,
                            allWindowKeys: Object.keys(window).length,
                            windowKeysWithSitrec: Object.keys(window).filter(key => 
                                key.includes('Node') || key.includes('Drag') || key.includes('Sit') || key.includes('SITREC')
                            )
                        };
                    });
                    
                    console.log(`Fallback attempt ${attempts + 1}:`, result);
                    
                    // In custom mode, we only need NodeMan and DragDropHandler
                    if (result.hasNodeMan && result.hasDragDropHandler) {
                        objectsFound = true;
                        break;
                    }
                    
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                if (!objectsFound) {
                    throw new Error(`Failed to find required window objects after ${maxAttempts} attempts`);
                }
            }
            
            console.log('Sitrec initialized');
            
            // Get file info
            const fileName = path.basename(testFilePath);
            const fileStats = fs.statSync(testFilePath);
            
            console.log(`Preparing to drop file: ${fileName} (${fileStats.size} bytes)`);
            
            // Create a hidden file input element that we can use to upload the file
            await page.evaluate(() => {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.id = 'test-file-input';
                fileInput.style.display = 'none';
                fileInput.accept = '.ts,video/*';
                document.body.appendChild(fileInput);
            });
            
            // Use Puppeteer's file upload capability
            const fileInput = await page.$('#test-file-input');
            await fileInput.uploadFile(testFilePath);
            
            // Get the uploaded file from the input
            const uploadedFile = await page.evaluate(() => {
                const input = document.getElementById('test-file-input');
                const file = input.files[0];
                if (!file) {
                    throw new Error('No file was uploaded');
                }
                return {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified
                };
            });
            
            console.log('File uploaded successfully:', uploadedFile);
            
            // Set up console monitoring for specific events
            const consoleMessages = [];
            const consoleHandler = (msg) => {
                const text = msg.text();
                consoleMessages.push(text);
                
                // Log important messages
                if (text.includes('LOADING DROPPED FILE') || 
                    text.includes('Uploading dropped file') ||
                    text.includes('H.264') ||
                    text.includes('MISB') ||
                    text.includes('TS') ||
                    text.includes('parsed') ||
                    text.includes('error') ||
                    text.includes('Error')) {
                    console.log(`[CONSOLE] ${text}`);
                }
            };
            
            page.on('console', consoleHandler);
            
            // Simulate drag and drop
            console.log('Simulating drag and drop...');
            
            await page.evaluate(() => {
                // Get the file from the input
                const input = document.getElementById('test-file-input');
                const file = input.files[0];
                
                if (!file) {
                    throw new Error('No file available for drag and drop');
                }
                
                // Create a synthetic drop event
                const dropEvent = new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: new DataTransfer()
                });
                
                // Add the file to the dataTransfer
                dropEvent.dataTransfer.items.add(file);
                
                // Create a FileList-like object
                const fileList = [file];
                fileList.item = (index) => fileList[index];
                dropEvent.dataTransfer.files = fileList;
                
                console.log('Dispatching drop event with file:', file.name, file.size, 'bytes');
                
                // Dispatch the drop event on the document body
                document.body.dispatchEvent(dropEvent);
                
                return { success: true, fileName: file.name, fileSize: file.size };
            });
            
            console.log('Drop event dispatched');
            
            // Wait for file processing to complete
            console.log('Waiting for file processing to start...');
            
            // Wait for the drag drop handler to process the file
            let processingStarted = false;
            try {
                await page.waitForFunction(() => {
                    // Check if DragDropHandler has started processing
                    if (window.DragDropHandler && window.DragDropHandler.dropQueue) {
                        return window.DragDropHandler.dropQueue.length > 0;
                    }
                    return false;
                }, { timeout: 10000 });
                
                console.log('File processing started');
                processingStarted = true;
                
            } catch (timeoutError) {
                console.log('Timeout waiting for file processing to start');
                
                // Check what's in the drop queue
                const queueStatus = await page.evaluate(() => {
                    return {
                        hasDragDropHandler: !!window.DragDropHandler,
                        hasDropQueue: !!(window.DragDropHandler && window.DragDropHandler.dropQueue),
                        queueLength: window.DragDropHandler ? window.DragDropHandler.dropQueue.length : -1,
                        queueContents: window.DragDropHandler ? window.DragDropHandler.dropQueue.map(item => ({
                            name: item.name || 'unknown',
                            size: item.size || 'unknown',
                            type: item.type || 'unknown'
                        })) : []
                    };
                });
                
                console.log('Drop queue status:', queueStatus);
            }
            
            // Wait for processing to complete
            if (processingStarted) {
                console.log('Waiting for file processing to complete...');
                
                try {
                    await page.waitForFunction(() => {
                        // Wait for the queue to be empty (processing complete)
                        if (window.DragDropHandler && window.DragDropHandler.dropQueue) {
                            return window.DragDropHandler.dropQueue.length === 0;
                        }
                        return true;
                    }, { timeout: 30000 });
                    
                    console.log('File processing completed');
                    
                } catch (timeoutError) {
                    console.log('Timeout waiting for file processing to complete');
                }
            }
            
            // Give a bit more time for any final processing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check the results
            const processingResults = await page.evaluate(() => {
                const results = {
                    dropQueueLength: window.DragDropHandler ? window.DragDropHandler.dropQueue.length : -1,
                    hasVideoNode: window.NodeMan ? window.NodeMan.exists('video') : false,
                    videoNodeInfo: null,
                    sitrecState: {
                        loaded: window.Sit ? window.Sit.loaded : false,
                        error: window.Sit ? window.Sit.error : null,
                        sitExists: !!window.Sit
                    },
                    consoleMessages: window.console._lastMessages || []
                };
                
                if (results.hasVideoNode && window.NodeMan) {
                    const videoNode = window.NodeMan.get('video');
                    if (videoNode) {
                        results.videoNodeInfo = {
                            hasFile: !!videoNode.file,
                            fileName: videoNode.file ? videoNode.file.name : null,
                            format: videoNode.format || null,
                            width: videoNode.width || null,
                            height: videoNode.height || null,
                            frames: videoNode.frames || null,
                            loaded: videoNode.loaded || false,
                            error: videoNode.error || false
                        };
                    }
                }
                
                return results;
            });
            
            console.log('Processing results:', JSON.stringify(processingResults, null, 2));
            
            // Remove console handler
            page.off('console', consoleHandler);
            
            // Analyze console messages for key indicators
            const relevantMessages = consoleMessages.filter(msg => 
                msg.includes('LOADING DROPPED FILE') ||
                msg.includes('Uploading dropped file') ||
                msg.includes('H.264') ||
                msg.includes('MISB') ||
                msg.includes('TS') ||
                msg.includes('parsed') ||
                msg.toLowerCase().includes('error')
            );
            
            console.log('Relevant console messages:');
            relevantMessages.forEach(msg => console.log(`  - ${msg}`));
            
            // Assertions
            expect(processingResults.dropQueueLength).toBeGreaterThanOrEqual(0);
            expect(processingResults.hasVideoNode).toBe(true);
            
            // Check if file was processed
            const fileProcessed = consoleMessages.some(msg => 
                msg.includes('LOADING DROPPED FILE') && msg.includes(testFileName)
            );
            
            expect(fileProcessed).toBe(true);
            
            // If video node has file info, check it
            if (processingResults.videoNodeInfo && processingResults.videoNodeInfo.hasFile) {
                expect(processingResults.videoNodeInfo.fileName).toBe(testFileName);
                console.log(`Video loaded: ${processingResults.videoNodeInfo.fileName}`);
                console.log(`Format: ${processingResults.videoNodeInfo.format}`);
                console.log(`Dimensions: ${processingResults.videoNodeInfo.width}x${processingResults.videoNodeInfo.height}`);
                console.log(`Frames: ${processingResults.videoNodeInfo.frames}`);
                console.log(`Loaded: ${processingResults.videoNodeInfo.loaded}`);
                console.log(`Error: ${processingResults.videoNodeInfo.error}`);
            }
            
            // Take a screenshot for visual verification
            const screenshot = await page.screenshot({
                fullPage: true,
                type: 'png'
            });
            
            // Save screenshot
            const screenshotPath = path.join(process.cwd(), 'test-results', 'dragdrop-misb-screenshot.png');
            const screenshotDir = path.dirname(screenshotPath);
            if (!fs.existsSync(screenshotDir)) {
                fs.mkdirSync(screenshotDir, { recursive: true });
            }
            fs.writeFileSync(screenshotPath, screenshot);
            console.log(`Screenshot saved to: ${screenshotPath}`);
            
        } catch (error) {
            console.error('Test failed with error:', error);
            
            // Try to get more information about the current state
            try {
                const debugInfo = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        hasNodeMan: !!window.NodeMan,
                        hasDragDropHandler: !!window.DragDropHandler,
                        hasSit: !!window.Sit,
                        dropQueueLength: window.DragDropHandler ? window.DragDropHandler.dropQueue.length : -1,
                        sitLoaded: window.Sit ? window.Sit.loaded : false,
                        sitError: window.Sit ? window.Sit.error : null,
                        documentReadyState: document.readyState,
                        bodyChildren: document.body.children.length,
                        hasFileInput: !!document.getElementById('test-file-input'),
                        fileInputFiles: document.getElementById('test-file-input') ? document.getElementById('test-file-input').files.length : 0
                    };
                }).catch(() => ({ error: 'Could not evaluate page state' }));
                
                console.log('Debug info at error:', debugInfo);
            } catch (debugError) {
                console.log('Could not get debug info:', debugError.message);
            }
            
            // Take error screenshot
            try {
                const errorScreenshot = await page.screenshot({
                    fullPage: true,
                    type: 'png'
                });
                const errorScreenshotPath = path.join(process.cwd(), 'test-results', 'dragdrop-misb-error.png');
                const screenshotDir = path.dirname(errorScreenshotPath);
                if (!fs.existsSync(screenshotDir)) {
                    fs.mkdirSync(screenshotDir, { recursive: true });
                }
                fs.writeFileSync(errorScreenshotPath, errorScreenshot);
                console.log(`Error screenshot saved to: ${errorScreenshotPath}`);
            } catch (screenshotError) {
                console.error('Failed to take error screenshot:', screenshotError);
            }
            
            throw error;
        }
    });
});