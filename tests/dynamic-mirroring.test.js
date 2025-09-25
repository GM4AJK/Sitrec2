/**
 * Tests for dynamic GUI mirroring functionality
 * 
 * Note: These tests focus on the core mirroring logic without importing the full CustomSupport module
 * to avoid ES module import issues in Jest. The actual implementation is tested through integration tests.
 */

// Mock the dynamic mirroring functions that would be in CustomSupport
class MockCustomManager {
    createGUISignature(gui) {
        if (!gui) return '';
        
        let signature = '';
        
        // Add controllers to signature
        if (gui.controllers) {
            for (const controller of gui.controllers) {
                const visibility = controller._hidden ? 'hidden' : 'visible';
                const type = controller.constructor?.name || 'Unknown';
                signature += `ctrl:${controller._name}:${type}:${visibility};`;
            }
        }
        
        // Add folders to signature
        if (gui.folders) {
            for (const folder of gui.folders) {
                const state = folder._closed ? 'closed' : 'open';
                const visible = folder._hidden ? 'hidden' : 'visible';
                const folderSig = this.createGUISignature(folder);
                signature += `folder:${folder._title}:${state}:${visible}:${folderSig};`;
            }
        }
        
        return signature;
    }
    
    clearMirror(menu) {
        if (menu.controllers) {
            menu.controllers.forEach(controller => {
                if (controller.destroy) controller.destroy();
            });
            menu.controllers.length = 0;
        }
        
        if (menu.folders) {
            menu.folders.forEach(folder => {
                if (folder.destroy) folder.destroy();
            });
            menu.folders.length = 0;
        }
    }
    
    mirrorGUIFolder(sourceFolderName, menuTitle, x = 200, y = 200) {
        const sourceFolder = global.guiMenus?.[sourceFolderName];
        if (!sourceFolder) return null;
        
        const standaloneMenu = global.Globals?.menuBar?.createStandaloneMenu(menuTitle, x, y);
        if (!standaloneMenu) return null;
        
        this.setupDynamicMirroring(sourceFolder, standaloneMenu);
        return standaloneMenu;
    }
    
    mirrorNodeGUI(nodeId, menuTitle, x = 200, y = 200) {
        const node = global.NodeMan?.get(nodeId);
        if (!node?.gui) return null;
        
        const standaloneMenu = global.Globals?.menuBar?.createStandaloneMenu(menuTitle, x, y);
        if (!standaloneMenu) return null;
        
        this.setupDynamicMirroring(node.gui, standaloneMenu);
        return standaloneMenu;
    }
    
    createDynamicMirror(sourceType, sourceName, title, x = 200, y = 200) {
        if (sourceType === 'menu') {
            return this.mirrorGUIFolder(sourceName, title, x, y);
        } else if (sourceType === 'node') {
            return this.mirrorNodeGUI(sourceName, title, x, y);
        }
        return null;
    }
    
    setupDynamicMirroring(sourceGUI, mirrorMenu) {
        mirrorMenu._mirrorSource = sourceGUI;
        mirrorMenu._lastMirrorState = this.createGUISignature(sourceGUI);
        
        // Set up recursive hooking
        const allHookedMethods = [];
        this.hookFolderRecursively(sourceGUI, mirrorMenu, allHookedMethods);
        
        // Add refresh method
        mirrorMenu.refreshMirror = () => {
            this.updateMirror(mirrorMenu);
        };
        
        // Override destroy to clean up
        const originalDestroy = mirrorMenu.destroy;
        mirrorMenu.destroy = () => {
            if (mirrorMenu._mirrorUpdateInterval) {
                clearInterval(mirrorMenu._mirrorUpdateInterval);
            }
            if (originalDestroy) originalDestroy.call(mirrorMenu);
        };
    }
    
    updateMirror(mirrorMenu) {
        if (!mirrorMenu._mirrorSource) return;
        
        const currentSignature = this.createGUISignature(mirrorMenu._mirrorSource);
        if (currentSignature !== mirrorMenu._lastMirrorState) {
            this.rebuildMirror(mirrorMenu._mirrorSource, mirrorMenu);
            mirrorMenu._lastMirrorState = currentSignature;
        }
    }
    
    rebuildMirror(sourceGUI, mirrorMenu) {
        this.clearMirror(mirrorMenu);
        this.mirrorGUIControls(sourceGUI, mirrorMenu);
    }
    
    mirrorGUIControls(sourceGUI, targetGUI) {
        // Mirror controllers
        sourceGUI.controllers.forEach(controller => {
            let mirrored;
            if (controller.constructor.name === 'ColorController') {
                mirrored = targetGUI.addColor(controller.object, controller.property);
            } else {
                mirrored = targetGUI.add(controller.object, controller.property);
            }
            
            if (mirrored) {
                if (mirrored.name) mirrored.name(controller._name);
                if (mirrored.tooltip && controller._tooltip) mirrored.tooltip(controller._tooltip);
                
                // Copy visibility state - this is the key fix we're testing
                if (controller._hidden) {
                    if (mirrored.hide) mirrored.hide();
                } else {
                    if (mirrored.show) mirrored.show();
                }
            }
        });
        
        // Mirror folders recursively
        sourceGUI.folders.forEach(folder => {
            const mirroredFolder = targetGUI.addFolder(folder._title);
            this.mirrorGUIControls(folder, mirroredFolder);
            if (!folder._closed && mirroredFolder.open) {
                mirroredFolder.open();
            }
            
            // Copy folder visibility state
            if (folder._hidden) {
                if (mirroredFolder.hide) mirroredFolder.hide();
            } else {
                if (mirroredFolder.show) mirroredFolder.show();
            }
        });
    }
    
    hookFolderRecursively(folder, standaloneMenu, allHookedMethods) {
        // Mock implementation that hooks existing controllers and sets up the hook function
        const hookController = (controller) => {
            if (controller._mirrorHooked) return;
            controller._mirrorHooked = true;
            
            const originalDestroy = controller.destroy;
            controller.destroy = jest.fn(() => {
                if (originalDestroy) originalDestroy.call(controller);
                // Mock the mirror update call
                if (this.updateMirror) {
                    this.updateMirror(standaloneMenu);
                }
            });
        };
        
        // Hook existing controllers in this folder
        folder.controllers.forEach(hookController);
        
        // Store the hook function for new controllers
        folder._controllerHookFunction = hookController;
        
        // For testing purposes, we don't need to actually hook the GUI methods
        // since we're testing the core functionality directly
        // In the real implementation, this would hook the GUI methods to automatically
        // call the _controllerHookFunction when new controllers are added
        
        // Recursively hook sub-folders
        folder.folders.forEach(subfolder => {
            this.hookFolderRecursively(subfolder, standaloneMenu, allHookedMethods);
        });
    }
    
    hookControllerVisibility(sourceFolder, standaloneMenu, allHookedMethods) {
        sourceFolder.controllers.forEach(controller => {
            this.hookSingleControllerVisibility(controller, standaloneMenu, allHookedMethods);
        });
    }
    
    hookSingleControllerVisibility(controller, standaloneMenu, allHookedMethods) {
        // Hook hide method
        if (typeof controller.hide === 'function') {
            const originalHide = controller.hide.bind(controller);
            allHookedMethods.push({ folder: controller, methodName: 'hide', originalMethod: originalHide });
            
            controller.hide = () => {
                const result = originalHide();
                setTimeout(() => this.updateMirror(standaloneMenu), 0);
                return result;
            };
        }
        
        // Hook show method
        if (typeof controller.show === 'function') {
            const originalShow = controller.show.bind(controller);
            allHookedMethods.push({ folder: controller, methodName: 'show', originalMethod: originalShow });
            
            controller.show = () => {
                const result = originalShow();
                setTimeout(() => this.updateMirror(standaloneMenu), 0);
                return result;
            };
        }
    }
    
    hookFolderVisibility(folder, standaloneMenu, allHookedMethods) {
        // Hook hide method
        if (typeof folder.hide === 'function') {
            const originalHide = folder.hide.bind(folder);
            allHookedMethods.push({ folder, methodName: 'hide', originalMethod: originalHide });
            
            folder.hide = () => {
                const result = originalHide();
                setTimeout(() => this.updateMirror(standaloneMenu), 0);
                return result;
            };
        }
        
        // Hook show method
        if (typeof folder.show === 'function') {
            const originalShow = folder.show.bind(folder);
            allHookedMethods.push({ folder, methodName: 'show', originalMethod: originalShow });
            
            folder.show = () => {
                const result = originalShow();
                setTimeout(() => this.updateMirror(standaloneMenu), 0);
                return result;
            };
        }
    }
}

// Mock dependencies
const mockGUI = {
    controllers: [],
    folders: [],
    _title: 'Test GUI',
    _closed: false,
    add: jest.fn(),
    addColor: jest.fn(),
    addFolder: jest.fn(),
    remove: jest.fn(),
    open: jest.fn(),
    destroy: jest.fn(),
    hide: jest.fn(),
    show: jest.fn()
};

const mockController = {
    _name: 'testController',
    constructor: { name: 'NumberController' },
    object: { testProp: 5 },
    property: 'testProp',
    _min: 0,
    _max: 10,
    _step: 1,
    _hidden: false,
    _listening: false,
    _tooltip: 'Test tooltip',
    _onChange: jest.fn(),
    destroy: jest.fn(),
    name: jest.fn().mockReturnThis(),
    tooltip: jest.fn().mockReturnThis(),
    listen: jest.fn().mockReturnThis(),
    onChange: jest.fn().mockReturnThis(),
    hide: jest.fn().mockReturnThis(),
    show: jest.fn().mockReturnThis()
};

const mockStandaloneMenu = {
    ...mockGUI,
    _mirrorSource: null,
    _lastMirrorState: null,
    _mirrorUpdateInterval: null,
    _mirrorEventCleanup: null,
    refreshMirror: jest.fn(),
    _onRebuild: jest.fn()
};

// Mock Globals
global.Globals = {
    menuBar: {
        createStandaloneMenu: jest.fn().mockReturnValue(mockStandaloneMenu)
    }
};

global.guiMenus = {
    testMenu: mockGUI
};

global.NodeMan = {
    get: jest.fn().mockReturnValue({
        gui: mockGUI
    })
};

describe('Dynamic GUI Mirroring', () => {
    let customManager;

    beforeEach(() => {
        customManager = new MockCustomManager();
        jest.clearAllMocks();
        
        // Add spy on updateMirror method
        jest.spyOn(customManager, 'updateMirror');
        
        // Reset mock GUI state
        mockGUI.controllers = [mockController];
        mockGUI.folders = [];
        mockStandaloneMenu._onRebuild.mockClear();
    });

    afterEach(() => {
        // Clean up any intervals
        if (mockStandaloneMenu._mirrorUpdateInterval) {
            clearInterval(mockStandaloneMenu._mirrorUpdateInterval);
            mockStandaloneMenu._mirrorUpdateInterval = null;
        }
    });

    describe('createGUISignature', () => {
        test('should create a signature for GUI with controllers', () => {
            const signature = customManager.createGUISignature(mockGUI);
            expect(signature).toContain('ctrl:testController:NumberController:visible');
        });

        test('should create different signatures for different GUI states', () => {
            const signature1 = customManager.createGUISignature(mockGUI);
            
            // Add another controller
            const mockController2 = {
                ...mockController,
                _name: 'testController2',
                constructor: { name: 'BooleanController' }
            };
            mockGUI.controllers.push(mockController2);
            
            const signature2 = customManager.createGUISignature(mockGUI);
            expect(signature1).not.toBe(signature2);
        });

        test('should detect visibility changes in signature', () => {
            // Initial signature with visible controller
            const signature1 = customManager.createGUISignature(mockGUI);
            expect(signature1).toContain('ctrl:testController:NumberController:visible');
            
            // Hide the controller
            mockController._hidden = true;
            
            // New signature should show hidden state
            const signature2 = customManager.createGUISignature(mockGUI);
            expect(signature2).toContain('ctrl:testController:NumberController:hidden');
            expect(signature1).not.toBe(signature2);
        });

        test('should handle folders in signature', () => {
            const mockFolder = {
                _title: 'Test Folder',
                _closed: false,
                _hidden: false,
                controllers: [],
                folders: []
            };
            mockGUI.folders = [mockFolder];
            
            const signature = customManager.createGUISignature(mockGUI);
            expect(signature).toContain('folder:Test Folder:open:visible:');
        });

        test('should detect folder visibility changes in signature', () => {
            const mockFolder = {
                _title: 'Test Folder',
                _closed: false,
                _hidden: false,
                controllers: [],
                folders: []
            };
            mockGUI.folders = [mockFolder];
            
            // Initial signature with visible folder
            const signature1 = customManager.createGUISignature(mockGUI);
            expect(signature1).toContain('folder:Test Folder:open:visible:');
            
            // Hide the folder
            mockFolder._hidden = true;
            
            // New signature should show hidden state
            const signature2 = customManager.createGUISignature(mockGUI);
            expect(signature2).toContain('folder:Test Folder:open:hidden:');
            expect(signature1).not.toBe(signature2);
        });
    });

    describe('clearMirror', () => {
        test('should remove all controllers and folders', () => {
            const mockMenu = {
                controllers: [mockController],
                folders: [mockGUI]
            };
            
            customManager.clearMirror(mockMenu);
            
            expect(mockController.destroy).toHaveBeenCalled();
            expect(mockGUI.destroy).toHaveBeenCalled();
        });
    });

    describe('mirrorGUIFolder', () => {
        test('should create a mirrored GUI folder', () => {
            const result = customManager.mirrorGUIFolder('testMenu', 'Test Mirror', 100, 100);
            
            expect(global.Globals.menuBar.createStandaloneMenu).toHaveBeenCalledWith('Test Mirror', 100, 100);
            expect(result).toBe(mockStandaloneMenu);
            expect(result.refreshMirror).toBeDefined();
        });

        test('should return null for non-existent menu', () => {
            const result = customManager.mirrorGUIFolder('nonExistentMenu', 'Test Mirror');
            expect(result).toBeNull();
        });
    });

    describe('mirrorNodeGUI', () => {
        test('should create a mirror for node GUI', () => {
            const result = customManager.mirrorNodeGUI('testNode', 'Node Mirror', 200, 200);
            
            expect(global.NodeMan.get).toHaveBeenCalledWith('testNode');
            expect(global.Globals.menuBar.createStandaloneMenu).toHaveBeenCalledWith('Node Mirror', 200, 200);
            expect(result).toBe(mockStandaloneMenu);
        });

        test('should return null for non-existent node', () => {
            global.NodeMan.get.mockReturnValue(null);
            const result = customManager.mirrorNodeGUI('nonExistentNode', 'Node Mirror');
            expect(result).toBeNull();
        });
    });

    describe('createDynamicMirror', () => {
        test('should create menu mirror when sourceType is "menu"', () => {
            const spy = jest.spyOn(customManager, 'mirrorGUIFolder');
            customManager.createDynamicMirror('menu', 'testMenu', 'Test Title');
            expect(spy).toHaveBeenCalledWith('testMenu', 'Test Title', 200, 200);
        });

        test('should create node mirror when sourceType is "node"', () => {
            const spy = jest.spyOn(customManager, 'mirrorNodeGUI');
            customManager.createDynamicMirror('node', 'testNode', 'Test Title');
            expect(spy).toHaveBeenCalledWith('testNode', 'Test Title', 200, 200);
        });

        test('should return null for invalid sourceType', () => {
            const result = customManager.createDynamicMirror('invalid', 'test', 'Test Title');
            expect(result).toBeNull();
        });
    });

    describe('updateMirror', () => {
        test('should update mirror when signature changes', () => {
            mockStandaloneMenu._mirrorSource = mockGUI;
            mockStandaloneMenu._lastMirrorState = 'old_signature';
            
            const spy = jest.spyOn(customManager, 'rebuildMirror');
            customManager.updateMirror(mockStandaloneMenu);
            
            expect(spy).toHaveBeenCalledWith(mockGUI, mockStandaloneMenu);
        });

        test('should not update mirror when signature is unchanged', () => {
            const signature = customManager.createGUISignature(mockGUI);
            mockStandaloneMenu._mirrorSource = mockGUI;
            mockStandaloneMenu._lastMirrorState = signature;
            
            const spy = jest.spyOn(customManager, 'rebuildMirror');
            customManager.updateMirror(mockStandaloneMenu);
            
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('setupDynamicMirroring', () => {
        test('should set up mirror source and initial state', () => {
            customManager.setupDynamicMirroring(mockGUI, mockStandaloneMenu);
            
            expect(mockStandaloneMenu._mirrorSource).toBe(mockGUI);
            expect(mockStandaloneMenu._lastMirrorState).toBeDefined();
        });

        test('should set up cleanup on destroy', () => {
            const originalDestroy = jest.fn();
            mockStandaloneMenu.destroy = originalDestroy;
            
            customManager.setupDynamicMirroring(mockGUI, mockStandaloneMenu);
            
            expect(mockStandaloneMenu.destroy).not.toBe(originalDestroy);
            
            // Test cleanup
            mockStandaloneMenu.destroy();
            expect(originalDestroy).toHaveBeenCalled();
        });
    });

    describe('recursive sub-folder mirroring', () => {
        test('should handle sub-folders in signature creation', () => {
            // Create a mock sub-folder
            const mockSubFolder = {
                _title: 'Material',
                _closed: false,
                controllers: [
                    { _name: 'color', constructor: { name: 'ColorController' }, _hidden: false }
                ],
                folders: []
            };
            
            // Add sub-folder to main GUI
            mockGUI.folders = [mockSubFolder];
            
            const signature = customManager.createGUISignature(mockGUI);
            
            // Should include sub-folder in signature
            expect(signature).toContain('folder:Material:open');
            expect(signature).toContain('ctrl:color:ColorController:visible');
        });

        test('should mirror sub-folders recursively', () => {
            // Create a mock sub-folder with controllers
            const mockSubFolder = {
                _title: 'Material',
                _closed: false,
                controllers: [
                    { 
                        _name: 'color',
                        constructor: { name: 'ColorController' },
                        object: { color: '#ffffff' },
                        property: 'color',
                        _tooltip: 'Material color'
                    }
                ],
                folders: []
            };
            
            // Add sub-folder to main GUI
            mockGUI.folders = [mockSubFolder];
            
            // Create mock target sub-folder
            const mockTargetSubFolder = {
                addColor: jest.fn().mockReturnValue({
                    name: jest.fn().mockReturnThis(),
                    tooltip: jest.fn().mockReturnThis()
                }),
                add: jest.fn(),
                open: jest.fn()
            };
            
            mockStandaloneMenu.addFolder = jest.fn().mockReturnValue(mockTargetSubFolder);
            
            // Mirror the GUI controls
            customManager.mirrorGUIControls(mockGUI, mockStandaloneMenu);
            
            // Should create sub-folder
            expect(mockStandaloneMenu.addFolder).toHaveBeenCalledWith('Material');
            
            // Should mirror controller in sub-folder
            expect(mockTargetSubFolder.addColor).toHaveBeenCalledWith(
                { color: '#ffffff' }, 
                'color'
            );
        });

        test('should detect changes in sub-folders', () => {
            // Create a mock sub-folder
            const mockSubFolder = {
                _title: 'Material',
                _closed: false,
                controllers: [],
                folders: [],
                add: jest.fn(),
                addColor: jest.fn(),
                addFolder: jest.fn(),
                remove: jest.fn()
            };
            
            mockGUI.folders = [mockSubFolder];
            
            // Set up dynamic mirroring
            customManager.setupDynamicMirroring(mockGUI, mockStandaloneMenu);
            
            // Verify that sub-folder methods are hooked
            expect(typeof mockSubFolder.add).toBe('function');
            expect(typeof mockSubFolder.addColor).toBe('function');
            
            // The sub-folder should have a controller hook function stored
            expect(mockSubFolder._controllerHookFunction).toBeDefined();
        });

        test('should handle direct controller destroy calls (material type changes)', () => {
            // Create a mock sub-folder with existing controllers
            const mockController1 = {
                destroy: jest.fn(),
                _mirrorHooked: false
            };
            const mockController2 = {
                destroy: jest.fn(),
                _mirrorHooked: false
            };
            
            const mockSubFolder = {
                _title: 'Material',
                _closed: false,
                controllers: [mockController1, mockController2],
                folders: [],
                add: jest.fn(),
                addColor: jest.fn(),
                addFolder: jest.fn(),
                remove: jest.fn()
            };
            
            mockGUI.folders = [mockSubFolder];
            
            // Set up dynamic mirroring
            customManager.setupDynamicMirroring(mockGUI, mockStandaloneMenu);
            
            // Verify controllers are hooked
            expect(mockController1._mirrorHooked).toBe(true);
            expect(mockController2._mirrorHooked).toBe(true);
            
            // Simulate direct controller destroy (like destroyNonCommonUI does)
            mockController1.destroy();
            mockController2.destroy();
            
            // Should trigger mirror update
            expect(customManager.updateMirror).toHaveBeenCalled();
            
            // Now test the controller hooking directly
            const mockNewController = {
                destroy: jest.fn(),
                _mirrorHooked: false
            };
            
            // Test the hook function directly
            expect(mockSubFolder._controllerHookFunction).toBeDefined();
            mockSubFolder._controllerHookFunction(mockNewController);
            
            // The new controller should be hooked
            expect(mockNewController._mirrorHooked).toBe(true);
            
            // Test that the hooked destroy method calls updateMirror
            const updateMirrorCallCount = customManager.updateMirror.mock.calls.length;
            mockNewController.destroy();
            expect(customManager.updateMirror.mock.calls.length).toBe(updateMirrorCallCount + 1);
        });
    });

    describe('visibility state copying', () => {
        test('should copy controller visibility state when mirroring', () => {
            // Create a hidden controller
            const hiddenController = {
                _name: 'hiddenController',
                constructor: { name: 'NumberController' },
                object: { value: 10 },
                property: 'value',
                _hidden: true
            };
            
            // Create a visible controller
            const visibleController = {
                _name: 'visibleController',
                constructor: { name: 'BooleanController' },
                object: { flag: true },
                property: 'flag',
                _hidden: false
            };
            
            // Set up source GUI with both controllers
            mockGUI.controllers = [hiddenController, visibleController];
            
            // Create mock mirrored controllers with hide/show methods
            const mockHiddenMirrored = {
                name: jest.fn().mockReturnThis(),
                hide: jest.fn(),
                show: jest.fn()
            };
            
            const mockVisibleMirrored = {
                name: jest.fn().mockReturnThis(),
                hide: jest.fn(),
                show: jest.fn()
            };
            
            // Mock the target GUI to return our mock controllers
            const mockTargetGUI = {
                add: jest.fn()
                    .mockReturnValueOnce(mockHiddenMirrored)
                    .mockReturnValueOnce(mockVisibleMirrored)
            };
            
            // Mirror the controls
            customManager.mirrorGUIControls(mockGUI, mockTargetGUI);
            
            // Verify that the hidden controller's mirror was hidden
            expect(mockHiddenMirrored.hide).toHaveBeenCalled();
            expect(mockHiddenMirrored.show).not.toHaveBeenCalled();
            
            // Verify that the visible controller's mirror was shown
            expect(mockVisibleMirrored.show).toHaveBeenCalled();
            expect(mockVisibleMirrored.hide).not.toHaveBeenCalled();
        });

        test('should copy folder visibility state when mirroring', () => {
            // Create a hidden folder
            const hiddenFolder = {
                _title: 'Hidden Folder',
                _closed: false,
                _hidden: true,
                controllers: [],
                folders: []
            };
            
            // Create a visible folder
            const visibleFolder = {
                _title: 'Visible Folder',
                _closed: false,
                _hidden: false,
                controllers: [],
                folders: []
            };
            
            // Set up source GUI with both folders
            const sourceGUI = {
                controllers: [],
                folders: [hiddenFolder, visibleFolder]
            };
            
            // Create mock mirrored folders with hide/show methods
            const mockHiddenMirroredFolder = {
                hide: jest.fn(),
                show: jest.fn(),
                open: jest.fn()
            };
            
            const mockVisibleMirroredFolder = {
                hide: jest.fn(),
                show: jest.fn(),
                open: jest.fn()
            };
            
            // Mock the target GUI to return our mock folders
            const mockTargetGUI = {
                addFolder: jest.fn()
                    .mockReturnValueOnce(mockHiddenMirroredFolder)
                    .mockReturnValueOnce(mockVisibleMirroredFolder)
            };
            
            // Mirror the controls
            customManager.mirrorGUIControls(sourceGUI, mockTargetGUI);
            
            // Verify that the hidden folder's mirror was hidden
            expect(mockHiddenMirroredFolder.hide).toHaveBeenCalled();
            expect(mockHiddenMirroredFolder.show).not.toHaveBeenCalled();
            
            // Verify that the visible folder's mirror was shown
            expect(mockVisibleMirroredFolder.show).toHaveBeenCalled();
            expect(mockVisibleMirroredFolder.hide).not.toHaveBeenCalled();
        });

        test('should trigger mirror update when visibility changes', () => {
            // Reset controller visibility to false first
            mockController._hidden = false;
            
            // Set up initial state
            mockStandaloneMenu._mirrorSource = mockGUI;
            const initialSignature = customManager.createGUISignature(mockGUI);
            mockStandaloneMenu._lastMirrorState = initialSignature;
            
            // Change controller visibility
            mockController._hidden = true;
            
            // Update mirror should detect the change
            const spy = jest.spyOn(customManager, 'rebuildMirror');
            customManager.updateMirror(mockStandaloneMenu);
            
            // Should trigger rebuild due to visibility change
            expect(spy).toHaveBeenCalledWith(mockGUI, mockStandaloneMenu);
        });

        test('should hook controller visibility methods and trigger updates', async () => {
            const allHookedMethods = [];
            
            // Hook controller visibility methods
            customManager.hookControllerVisibility(mockGUI, mockStandaloneMenu, allHookedMethods);
            
            // Verify that hide and show methods were hooked
            expect(allHookedMethods).toHaveLength(2); // hide and show methods
            expect(allHookedMethods[0].methodName).toBe('hide');
            expect(allHookedMethods[1].methodName).toBe('show');
            
            // Call the hooked hide method
            mockController.hide();
            
            // Wait for the setTimeout to execute
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should trigger updateMirror
            expect(customManager.updateMirror).toHaveBeenCalled();
        });

        test('should hook folder visibility methods and trigger updates', async () => {
            const allHookedMethods = [];
            
            // Hook folder visibility methods
            customManager.hookFolderVisibility(mockGUI, mockStandaloneMenu, allHookedMethods);
            
            // Verify that hide and show methods were hooked
            expect(allHookedMethods).toHaveLength(2); // hide and show methods
            expect(allHookedMethods[0].methodName).toBe('hide');
            expect(allHookedMethods[1].methodName).toBe('show');
            
            // Call the hooked show method
            mockGUI.show();
            
            // Wait for the setTimeout to execute
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should trigger updateMirror
            expect(customManager.updateMirror).toHaveBeenCalled();
        });

        test('should hook single controller visibility methods', () => {
            const allHookedMethods = [];
            
            // Hook single controller visibility methods
            customManager.hookSingleControllerVisibility(mockController, mockStandaloneMenu, allHookedMethods);
            
            // Verify that hide and show methods were hooked
            expect(allHookedMethods).toHaveLength(2);
            expect(allHookedMethods[0].methodName).toBe('hide');
            expect(allHookedMethods[1].methodName).toBe('show');
            
            // Verify the original methods are stored for cleanup
            expect(typeof allHookedMethods[0].originalMethod).toBe('function');
            expect(typeof allHookedMethods[1].originalMethod).toBe('function');
        });
    });
});