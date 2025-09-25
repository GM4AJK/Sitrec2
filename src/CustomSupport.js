// Support functions for the custom sitches and mods
// 
// GUI Mirroring Functionality:
// - mirrorGUIFolder(sourceFolderName, menuTitle, x, y): Mirror any GUI menu to a standalone draggable window with dynamic updates
// - mirrorNodeGUI(nodeId, menuTitle, x, y): Mirror a specific node's GUI with dynamic updates
// - createDynamicMirror(sourceType, sourceName, title, x, y): Universal function to create dynamic mirrors
// - setupFlowOrbsMirrorExample(): Example that mirrors Flow Orbs menu (or effects menu as fallback)
// - showMirrorMenuDemo(): Interactive demo accessible from Help menu
//
// Dynamic Mirroring Features:
// - Automatically detects when original menu items are added/removed/changed
// - Uses event-based detection when possible, falls back to polling
// - Handles model/geometry switching and other programmatic GUI changes
// - Provides manual refresh capability via refreshMirror() method
// - Proper cleanup when mirrors are destroyed

import {
    FileManager,
    GlobalDateTimeNode,
    Globals,
    guiMenus,
    infoDiv,
    NodeMan,
    setRenderOne,
    setSitchEstablished,
    Sit,
    Units
} from "./Globals";
import {isKeyHeld, toggler} from "./KeyBoardHandler";
import {ECEFToLLAVD_Sphere, EUSToECEF} from "./LLA-ECEF-ENU";
import {createCustomModalWithCopy, saveFilePrompted} from "./CFileManager";
import {DragDropHandler} from "./DragDropHandler";
import {par} from "./par";
import {GlobalScene} from "./LocalFrame";
import {refreshLabelsAfterLoading} from "./nodes/CNodeLabels3D";
import {assert} from "./assert.js";
import {getShortURL} from "./urlUtils";
import {CNode3DObject} from "./nodes/CNode3DObject";
import {UpdateHUD} from "./JetStuff";
import {degrees} from "./utils";
import {ViewMan} from "./CViewManager";
import {EventManager} from "./CEventManager";
import {SITREC_APP} from "./configUtils";
import {CNodeDisplayTrack} from "./nodes/CNodeDisplayTrack";
import {DebugArrowAB} from "./threeExt";
import {TrackManager} from "./TrackManager";
import {CNodeTrackGUI} from "./nodes/CNodeControllerTrackGUI";
import {forceUpdateUIText} from "./nodes/CNodeViewUI";
import {configParams} from "./login";


export class CCustomManager {
    constructor() {
    }


    setup() {


        if (Sit.canMod) {
            // we have "SAVE MOD", but "SAVE CUSTOM" is no more, replaced by standard "Save", "Save As", etc.
            this.buttonText = "SAVE MOD"

            // add a lil-gui button linked ot the serialize function
            //FileManager.guiFolder.add(this, "serialize").name("Export Custom Sitch")

            const theGUI = guiMenus.file;

            this.buttonColor = "#80ff80"

            if (Globals.userID > 0)
                this.serializeButton = theGUI.add(this, "serialize").name(this.buttonText).setLabelColor(this.buttonColor)
            else
                this.serializeButton = theGUI.add(this, "loginAttempt").name("Export Disabled (click to log in)").setLabelColor("#FF8080");

            this.serializeButton.moveToFirst();
        }

        toggler('k', guiMenus.help.add(par, 'showKeyboardShortcuts').listen().name("[K]eyboard Shortcuts").onChange(value => {
            if (value) {
                infoDiv.style.display = 'block';
            } else {
                infoDiv.style.display = 'none';
            }
        }))

        toggler('e', guiMenus.contents.add(this, "toggleExtendToGround")
            .name("Toggle ALL [E]xtend To Ground")
            .moveToFirst()
            .tooltip("Toggle 'Extend to Ground' for all tracks\nWill set all off if any are on\nWill set all on if none are on")
        )

        if (Globals.showAllTracksInLook === undefined)
            Globals.showAllTracksInLook = false;
        guiMenus.showhide.add(Globals, "showAllTracksInLook").name("Show All Tracks in Look View").onChange(() => {
            this.refreshLookViewTracks();

        }).listen();

        guiMenus.contents.add(this, "removeAllTracks")
            .name("Remove All Tracks")
            .moveToFirst()
            .tooltip("Remove all tracks from the scene\nThis will not remove the objects, just the tracks\nYou can add them back later by dragging and dropping the files again")


       // guiMenus.physics.add(this, "calculateBestPairs").name("Calculate Best Pairs");


        if (Globals.objectScale === undefined)
            Globals.objectScale = 1.0;
        guiMenus.objects.add(Globals, "objectScale", 1, 50, 0.01)
            .name("Global Scale")
            .listen()
            .onChange((value) => {
            // iterate over all node, any CNode3DObject, and set the scale to this.objectScale
            NodeMan.iterate((id, node) => {
                if (node instanceof CNode3DObject) {
                    node.recalculate();
                }
            });
        });

        // configParmas.extraHelpFunctions has and object keyed on function name
        if (configParams.extraHelpFunctions) {
            // iterate over k, value of configParmas.extraHelpFunctions
            for (const funcName in configParams.extraHelpFunctions) {
                const funcVars = configParams.extraHelpFunctions[funcName];
                // create a new function in CCustomManager with the function name
                this[funcName] = () => {
                    funcVars[0]();
                }

                guiMenus["help"].add(this, funcName).name(funcVars[1]).listen().tooltip(funcVars[2]);
            }
        }

        // Add GUI mirroring functionality to help menu
        guiMenus.help.add(this, "showMirrorMenuDemo").name("Mirror Menu Demo").tooltip("Demonstrates how to mirror any GUI menu to create a standalone floating menu");

        // TODO - Multiple events passed to EventManager.addEventListener

        // Listen for events that mean we've changed the camera track
        // and hence established a sitch we don't want subsequent tracks to mess up.
        // changing camera to a fixed camera, which might be something the user does even beforer
        // they add any tracks
        EventManager.addEventListener("Switch.onChange.cameraTrackSwitch", (choice) => {
            console.log("EVENT Camera track switch changed to " + choice)
            setSitchEstablished(true)
        });

        // Changing the LOS traversal method would indicate a sitch has been established
        // this might be done after the first track
        EventManager.addEventListener("Switch.onChange.LOSTraverseSelectTrack", (choice) => {
            console.log("EVENT Camera track switch changed to " + choice)
            setSitchEstablished(true)
        });

        // Changing the CameraLOSController method would indicate a sitch has been established
        // this might be done after the first track
        // I'm not doing this, as the LOS controller is changed programatically by loading the first track
        // coudl possibly patch around it, but I'm not sure if it's needed.
        // EventManager.addEventListener("Switch.onChange.CameraLOSController", (choice) => {
        //     setSitchEstablished(true)
        // });

        EventManager.addEventListener("GUIValue.onChange.Camera [C] Lat", (value) => {
            setSitchEstablished(true)
        });

        EventManager.addEventListener("GUIValue.onChange.Camera [C] Lon", (value) => {
            setSitchEstablished(true)
        });

        EventManager.addEventListener("PositionLLA.onChange", (data) => {
            if (data.id === "fixedCameraPosition") {
                setSitchEstablished(true)

                // if there's a camera track switch, then we need to update the camera track
                if (NodeMan.exists("cameraTrackSwitch")) {
                    const cameraTrackSwitch = NodeMan.get("cameraTrackSwitch");
                    // if the camera track switch is not set to "fixedCamera" or "flightSimCamera", then set it to "fixedCamera"
                    if (cameraTrackSwitch.choice !== "fixedCamera" && cameraTrackSwitch.choice !== "flightSimCamera") {
                        console.log("Setting camera track switch to fixedCamera");
                        cameraTrackSwitch.selectOption("fixedCamera");
                    }
                }
            }
        });

        EventManager.addEventListener("videoLoaded", (data) => {
           let width,height;

           if (data.width !== undefined && data.height !== undefined) {
                // this is a video loaded from a file, so we can use the width and height directly
                width  = data.width;
                height = data.height;
              } else if (data.videoData && data.videoData.config) {
                // this is a video loaded from a CVideoMp4Data, so we can use the config
                // codedWidth and codedHeight are the original video dimensions
               width  = data.videoData.config.codedWidth;
               height = data.videoData.config.codedHeight;
           }

           const videoView = NodeMan.get("video");
           if (!videoView.visible) {
              // decide what preset is needed
               if (width == undefined || width > height) {
                   this.currentViewPreset = "Default"; // wide video
               } else {
                   this.currentViewPreset = "ThreeWide"; // tall video
               }
               this.updateViewFromPreset();

           }

           if (Sit.metadata && !Globals.sitchEstablished) {
               const meta = Sit.metadata;
               // got lat, lon, alt?
               if (meta.latitude && meta.longitude && meta.altitude) {
                   const camera = NodeMan.get("fixedCameraPosition");
                   camera.gotoLLA(meta.latitude, meta.longitude, meta.altitude)
                   // and set sitchEstablished to true
                   setSitchEstablished(true);
               }

                // got date and time?
               if (meta.creationDate) {
                   // parse the date and time
                   // set the GlobalDateTimeNode to this date
                   GlobalDateTimeNode.setStartDateTime(meta.creationDate);
                   // and set sitchEstablished to true
                   setSitchEstablished(true);
               }



           }

           NodeMan.recalculateAllRootFirst();



        });


        this.viewPresets = {
            Default: {
                keypress: "1",
                // video: {visible: true, left: 0.5, top: 0, width: -1.7927, height: 0.5},
                // mainView: {visible: true, left: 0.0, top: 0, width: 0.5, height: 1},
                // lookView: {visible: true, left: 0.5, top: 0.5, width: -1.7927, height: 0.5},
                mainView: {visible: true, left: 0.0, top: 0, width: 0.5, height: 1},
                video: {visible: true, left: 0.5, top: 0, width: 0.5, height: 0.5},
                lookView: {visible: true, left: 0.5, top: 0.5, width: 0.5, height: 0.5},
                chatView: {left: 0.25, top: 0.10, width: 0.25, height: 0.85,}, // does not work
            },

            SideBySide: {
                keypress: "2",
                mainView: {visible: true, left: 0.0, top: 0, width: 0.5, height: 1},
                video: {visible: false},
                lookView: {visible: true, left: 0.5, top: 0, width: 0.5, height: 1},
            },

            TopandBottom: {
                keypress: "3",
                mainView: {visible: true, left: 0.0, top: 0, width: 1, height: 0.5},
                video: {visible: false},
                lookView: {visible: true, left: 0.0, top: 0.5, width: 1, height: 0.5},
            },

            ThreeWide: {
                keypress: "4",
                mainView: {visible: true, left: 0.0, top: 0, width: 0.333, height: 1},
                video:    {visible: true, left: 0.333, top: 0, width: 0.333, height: 1},
                lookView: {visible: true, left: 0.666, top: 0, width: 0.333, height: 1},
            },

            TallVideo: {
                keypress: "5",
                mainView: {visible: true, left: 0.0,  top: 0,   width: 0.50, height: 1},
                video:    {visible: true, left: 0.5,  top: 0,   width: 0.25, height: 1},
                lookView: {visible: true, left: 0.75, top: 0, width: 0.25, height: 1},

            },

            VideoLookHorizontal: {
                keypress: "6",
                mainView: {visible: false},
                video: {visible: true, left: 0.0, top: 0, width: 1, height: 0.5},
                lookView: {visible: true, left: 0.0, top: 0.5, width: 1, height: 0.5},
            },

            VideoLookVertical: {
                keypress: "7",
                mainView: {visible: false},
                video: {visible: true, left: 0.0, top: 0, width: 0.5, height: 1},
                lookView: {visible: true, left: 0.5, top: 0, width: 0.5, height: 1},

            },
        }

        this.currentViewPreset = "Default";
        // add a key handler to switch between the view presets

        this.presetGUI = guiMenus.view.add(this, "currentViewPreset", Object.keys(this.viewPresets))
            .name("View Preset")
            .listen()
            .tooltip("Switch between different view presets\nSide-by-side, Top and Bottom, etc.")
            .onChange((value) => {
                this.updateViewFromPreset();
            })

        EventManager.addEventListener("keydown", (data) => {
            const keypress = data.key.toLowerCase();
            // if it's a number key, then switch to the corresponding view preset
            // in this.viewPreset
            if (keypress >= '0' && keypress <= '9') {

                // find the preset with the key: in the object
                const presetKey = Object.keys(this.viewPresets).find(
                    key => this.viewPresets[key].keypress === keypress
                );
                if (presetKey) {
                    this.currentViewPreset = presetKey;
                    console.log("Switching to view preset " + keypress);
                    this.updateViewFromPreset();
                }
            }
        })

        // Test the debug view after a short delay to ensure it's initialized
        setTimeout(() => {
            if (NodeMan.exists("debugView")) {
                const debugView = NodeMan.get("debugView");
                debugView.log("CCustomManager setup complete!");
                debugView.info("Debug view is working correctly.");
                debugView.warn("This is a warning message.");
                debugView.error("This is an error message.");
                debugView.debug("This is a debug message.");
            }
        }, 1000);

        // Example of creating a standalone pop-up menu
        // This creates a draggable menu that behaves like the individual menus from the menu bar
        // but is not attached to the menu bar itself
        // this.setupStandaloneMenuExample();
        //
        // // Example of mirroring the Flow Orbs menu (or effects menu if no Flow Orbs exist)
        // this.setupFlowOrbsMirrorExample();

    }

    setupStandaloneMenuExample() {
        // Create a standalone pop-up menu at position (300, 150)
        const standaloneMenu = Globals.menuBar.createStandaloneMenu("Example Popup", 300, 150);
        
        // Add some example controls to the menu
        const exampleObject = {
            message: "Hello World!",
            value: 42,
            enabled: true,
            color: "#ff0000",
            showMenu: () => {
                console.log("Standalone menu button clicked!");
                alert("This is a standalone pop-up menu!\n\nYou can:\n- Drag it around by the title bar\n- Click anywhere on it to bring it to front\n- Add any lil-gui controls to it");
            },
            closeMenu: () => {
                standaloneMenu.destroy();
            }
        };
        
        // Add various controls to demonstrate functionality
        standaloneMenu.add(exampleObject, "message").name("Text Message");
        standaloneMenu.add(exampleObject, "value", 0, 100).name("Numeric Value");
        standaloneMenu.add(exampleObject, "enabled").name("Toggle Option");
        standaloneMenu.addColor(exampleObject, "color").name("Color Picker");
        
        // Add a folder to show nested structure works
        const subFolder = standaloneMenu.addFolder("Sub Menu");
        subFolder.add(exampleObject, "showMenu").name("Show Info");
        subFolder.add(exampleObject, "closeMenu").name("Close This Menu");
        
        // Open the menu by default to show it
        standaloneMenu.open();
        subFolder.open();
        
        // Store reference for potential cleanup
        this.exampleStandaloneMenu = standaloneMenu;
    }

    /**
     * Mirror a GUI folder to create a standalone menu with all the same functions
     * @param {string} sourceFolderName - The name of the source folder in guiMenus to mirror
     * @param {string} menuTitle - The title for the new standalone menu
     * @param {number} x - X position for the standalone menu
     * @param {number} y - Y position for the standalone menu
     * @returns {GUI} The created standalone menu
     */
    mirrorGUIFolder(sourceFolderName, menuTitle, x = 200, y = 200) {
        // Check if the source folder exists
        if (!guiMenus[sourceFolderName]) {
            console.error(`Source folder '${sourceFolderName}' not found in guiMenus`);
            return null;
        }

        const sourceFolder = guiMenus[sourceFolderName];
        
        // Create the standalone menu
        const standaloneMenu = Globals.menuBar.createStandaloneMenu(menuTitle, x, y);
        
        // Set up dynamic mirroring
        this.setupDynamicMirroring(sourceFolder, standaloneMenu);
        
        // Open the menu by default
        standaloneMenu.open();
        
        console.log(`Mirrored GUI folder '${sourceFolderName}' to standalone menu '${menuTitle}'`);
        
        // Add a method to manually refresh the mirror
        standaloneMenu.refreshMirror = () => {
            this.updateMirror(standaloneMenu);
        };
        
        return standaloneMenu;
    }

    /**
     * Set up dynamic mirroring that automatically updates when the source changes
     * @param {GUI} sourceFolder - Source GUI folder to mirror
     * @param {GUI} standaloneMenu - Target standalone menu
     */
    setupDynamicMirroring(sourceFolder, standaloneMenu) {
        console.log('setupDynamicMirroring called for sourceFolder:', sourceFolder._title || 'root');
        
        // Store reference to source for updates
        standaloneMenu._mirrorSource = sourceFolder;
        standaloneMenu._lastMirrorState = null;
        
        // Initial mirror
        this.updateMirror(standaloneMenu);
        
        // Try event-based approach first, fall back to polling if needed
        console.log('About to call setupEventBasedMirroring');
        if (this.setupEventBasedMirroring(sourceFolder, standaloneMenu)) {
            console.log('Using event-based mirroring for', standaloneMenu._title);
        } else {
            // Fallback to periodic checking for changes
            console.log('Using polling-based mirroring for', standaloneMenu._title);
            const checkInterval = 100; // Check every 100ms
            standaloneMenu._mirrorUpdateInterval = setInterval(() => {
                this.updateMirror(standaloneMenu);
            }, checkInterval);
        }
        
        // Clean up when menu is destroyed
        const originalDestroy = standaloneMenu.destroy.bind(standaloneMenu);
        standaloneMenu.destroy = () => {
            if (standaloneMenu._mirrorUpdateInterval) {
                clearInterval(standaloneMenu._mirrorUpdateInterval);
                standaloneMenu._mirrorUpdateInterval = null;
            }
            if (standaloneMenu._mirrorEventCleanup) {
                standaloneMenu._mirrorEventCleanup();
                standaloneMenu._mirrorEventCleanup = null;
            }
            originalDestroy();
        };
    }

    /**
     * Set up event-based mirroring by hooking into GUI methods
     * @param {GUI} sourceFolder - Source GUI folder to monitor
     * @param {GUI} standaloneMenu - Target standalone menu to update
     * @returns {boolean} True if event-based mirroring was successfully set up
     */
    setupEventBasedMirroring(sourceFolder, standaloneMenu) {
        try {
            // Store all hooked methods for cleanup
            const allHookedMethods = [];
            
            // Recursively hook into all folders and sub-folders
            this.hookFolderRecursively(sourceFolder, standaloneMenu, allHookedMethods);
            
            // Store cleanup function
            standaloneMenu._mirrorEventCleanup = () => {
                // Restore all original methods
                allHookedMethods.forEach(({ folder, methodName, originalMethod }) => {
                    folder[methodName] = originalMethod;
                });
            };
            
            return true;
        } catch (error) {
            console.warn('Failed to set up event-based mirroring:', error);
            return false;
        }
    }

    /**
     * Recursively hook into a folder and all its sub-folders
     * @param {GUI} folder - The folder to hook into
     * @param {GUI} standaloneMenu - Target standalone menu to update
     * @param {Array} allHookedMethods - Array to store hooked methods for cleanup
     */
    hookFolderRecursively(folder, standaloneMenu, allHookedMethods) {
        console.log('hookFolderRecursively called for folder:', folder._title || 'root', 'controllers:', folder.controllers.length);
        
        const methodsToHook = ['add', 'addColor', 'addFolder', 'remove'];
        
        // Hook into GUI methods that modify the structure
        methodsToHook.forEach(methodName => {
            if (typeof folder[methodName] === 'function') {
                const originalMethod = folder[methodName].bind(folder);
                
                // Store for cleanup
                allHookedMethods.push({ folder, methodName, originalMethod });
                
                folder[methodName] = (...args) => {
                    const result = originalMethod(...args);
                    
                    // If we just added a folder, hook into it too
                    if (methodName === 'addFolder' && result) {
                        setTimeout(() => {
                            this.hookFolderRecursively(result, standaloneMenu, allHookedMethods);
                        }, 0);
                    }
                    
                    // If we just added a controller, hook its destroy method
                    if ((methodName === 'add' || methodName === 'addColor') && result && typeof result.destroy === 'function') {
                        if (folder._controllerHookFunction) {
                            folder._controllerHookFunction(result);
                        }
                    }
                    
                    // Defer update to next tick to allow GUI to stabilize
                    setTimeout(() => this.updateMirror(standaloneMenu), 0);
                    return result;
                };
            }
        });
        
        // Hook into controller destroy method for any existing controllers
        console.log('About to call hookControllerDestroy for folder:', folder._title || 'root');
        this.hookControllerDestroy(folder, standaloneMenu);
        
        // Recursively hook into existing sub-folders
        console.log('Processing sub-folders, count:', folder.folders.length);
        folder.folders.forEach(subfolder => {
            this.hookFolderRecursively(subfolder, standaloneMenu, allHookedMethods);
        });
    }

    /**
     * Hook into controller destroy methods to detect when controllers are removed
     * @param {GUI} sourceFolder - Source GUI folder
     * @param {GUI} standaloneMenu - Target standalone menu
     */
    hookControllerDestroy(sourceFolder, standaloneMenu) {
        const hookController = (controller) => {
            if (controller._mirrorHooked) return; // Already hooked
            controller._mirrorHooked = true;
            
            const originalDestroy = controller.destroy.bind(controller);
            controller.destroy = () => {
                originalDestroy();
                // Defer update to next tick
                setTimeout(() => this.updateMirror(standaloneMenu), 0);
            };
        };
        
        // Hook existing controllers in this folder
        console.log('hookControllerDestroy: sourceFolder.controllers.length =', sourceFolder.controllers.length);
        sourceFolder.controllers.forEach((controller, index) => {
            console.log(`Hooking controller ${index}:`, controller);
            hookController(controller);
        });
        
        // Store the hook function so the recursive method can use it for new controllers
        sourceFolder._controllerHookFunction = hookController;
    }

    /**
     * Update the mirror to match the current state of the source
     * @param {GUI} standaloneMenu - The mirrored menu to update
     */
    updateMirror(standaloneMenu) {
        const sourceFolder = standaloneMenu._mirrorSource;
        if (!sourceFolder) return;
        
        // Create a signature of the current source state
        const currentState = this.createGUISignature(sourceFolder);
        
        // Compare with last known state
        if (standaloneMenu._lastMirrorState !== currentState) {
            // State has changed, rebuild the mirror
            this.rebuildMirror(sourceFolder, standaloneMenu);
            standaloneMenu._lastMirrorState = currentState;
        }
    }

    /**
     * Create a signature string representing the current state of a GUI folder
     * @param {GUI} folder - The GUI folder to create a signature for
     * @returns {string} A signature representing the folder's structure
     */
    createGUISignature(folder) {
        const parts = [];
        
        // Add controller signatures
        folder.controllers.forEach(controller => {
            const name = controller._name || 'unnamed';
            const type = controller.constructor.name;
            const visible = controller._hidden ? 'hidden' : 'visible';
            parts.push(`ctrl:${name}:${type}:${visible}`);
        });
        
        // Add folder signatures recursively
        folder.folders.forEach(subfolder => {
            const name = subfolder._title || 'unnamed';
            const open = subfolder._closed ? 'closed' : 'open';
            const subSignature = this.createGUISignature(subfolder);
            parts.push(`folder:${name}:${open}:${subSignature}`);
        });
        
        return parts.join('|');
    }

    /**
     * Completely rebuild the mirror to match the source
     * @param {GUI} sourceFolder - Source GUI folder
     * @param {GUI} standaloneMenu - Target standalone menu to rebuild
     */
    rebuildMirror(sourceFolder, standaloneMenu) {
        // Clear existing controllers and folders
        this.clearMirror(standaloneMenu);
        
        // Rebuild from source
        this.mirrorGUIControls(sourceFolder, standaloneMenu);
    }

    /**
     * Clear all controllers and folders from a GUI menu
     * @param {GUI} menu - The GUI menu to clear
     */
    clearMirror(menu) {
        // Remove all controllers
        while (menu.controllers.length > 0) {
            const controller = menu.controllers[menu.controllers.length - 1];
            controller.destroy();
        }
        
        // Remove all folders
        while (menu.folders.length > 0) {
            const folder = menu.folders[menu.folders.length - 1];
            folder.destroy();
        }
    }

    /**
     * Recursively mirror GUI controls from source to target
     * @param {GUI} source - Source GUI folder
     * @param {GUI} target - Target GUI folder
     */
    mirrorGUIControls(source, target) {
        // Mirror all controllers
        source.controllers.forEach(controller => {
            try {
                // Get the controller properties
                const object = controller.object;
                const property = controller.property;
                const name = controller._name;
                
                // Create the mirrored controller based on type
                let mirroredController;
                
                if (controller.constructor.name === 'ColorController') {
                    mirroredController = target.addColor(object, property);
                } else if (controller.constructor.name === 'OptionController') {
                    // For dropdown/select controllers
                    mirroredController = target.add(object, property, controller._values);
                } else if (controller.constructor.name === 'NumberController') {
                    // For numeric controllers with min/max
                    if (controller._min !== undefined && controller._max !== undefined) {
                        mirroredController = target.add(object, property, controller._min, controller._max, controller._step);
                    } else {
                        mirroredController = target.add(object, property);
                    }
                } else {
                    // For boolean and other basic controllers
                    mirroredController = target.add(object, property);
                }
                
                // Copy controller properties
                if (mirroredController) {
                    mirroredController.name(name);
                    
                    // Copy tooltip if it exists
                    if (controller._tooltip) {
                        mirroredController.tooltip(controller._tooltip);
                    }
                    
                    // Copy listen state
                    if (controller._listening) {
                        mirroredController.listen();
                    }
                    
                    // Copy elastic properties for numeric controllers
                    if (controller._elastic && mirroredController.elastic) {
                        mirroredController.elastic(controller._elastic.max, controller._elastic.maxMax, controller._elastic.allowNegative);
                    }
                    
                    // Copy onChange handler by referencing the original controller's onChange
                    if (controller._onChange) {
                        mirroredController.onChange(controller._onChange);
                    }
                }
            } catch (error) {
                console.warn(`Failed to mirror controller '${controller._name}':`, error);
            }
        });
        
        // Mirror all folders recursively
        source.folders.forEach(folder => {
            const folderName = folder._title;
            const mirroredFolder = target.addFolder(folderName);
            
            // Recursively mirror the folder contents
            this.mirrorGUIControls(folder, mirroredFolder);
            
            // Copy folder open/closed state
            if (!folder._closed) {
                mirroredFolder.open();
            }
        });
    }

    /**
     * Example of mirroring the Flow Orbs menu with dynamic updates
     */
    setupFlowOrbsMirrorExample() {
        // First check if there are any Flow Orbs nodes in the scene
        let flowOrbsNode = null;
        NodeMan.iterate((id, node) => {
            if (node.constructor.name === 'CNodeFlowOrbs' || node.constructor.name === 'CNodeSpriteGroup') {
                if (node.gui && node.gui._title === 'Flow Orbs') {
                    flowOrbsNode = node;
                    return false; // Break iteration
                }
            }
        });

        if (!flowOrbsNode) {
            console.log("No Flow Orbs node found - creating example mirror of effects menu instead");
            // Mirror the effects menu as an example with dynamic updates
            this.mirroredFlowOrbsMenu = this.mirrorGUIFolder("effects", "Mirrored Effects", 400, 200);
            return;
        }

        // Create a standalone menu that mirrors the Flow Orbs controls with dynamic updates
        const standaloneMenu = Globals.menuBar.createStandaloneMenu("Mirrored Flow Orbs", 400, 200);
        
        // Set up dynamic mirroring for the Flow Orbs GUI
        this.setupDynamicMirroring(flowOrbsNode.gui, standaloneMenu);
        
        // Store reference for potential cleanup
        this.mirroredFlowOrbsMenu = standaloneMenu;
        
        console.log("Created dynamically mirrored Flow Orbs menu");
    }

    /**
     * Create a dynamic mirror for any node's GUI
     * @param {string} nodeId - The ID of the node whose GUI to mirror
     * @param {string} menuTitle - Title for the mirrored menu
     * @param {number} x - X position for the menu
     * @param {number} y - Y position for the menu
     * @returns {GUI|null} The created mirrored menu or null if node not found
     */
    mirrorNodeGUI(nodeId, menuTitle, x = 200, y = 200) {
        const node = NodeMan.get(nodeId);
        if (!node || !node.gui) {
            console.error(`Node '${nodeId}' not found or has no GUI`);
            return null;
        }

        // Create a standalone menu
        const standaloneMenu = Globals.menuBar.createStandaloneMenu(menuTitle, x, y);
        
        // Set up dynamic mirroring
        this.setupDynamicMirroring(node.gui, standaloneMenu);
        
        // Add a method to manually refresh the mirror
        standaloneMenu.refreshMirror = () => {
            this.updateMirror(standaloneMenu);
        };
        
        console.log(`Created dynamic mirror for node '${nodeId}' GUI`);
        return standaloneMenu;
    }

    /**
     * Global utility function to create dynamic mirrors
     * Can be called from console: CustomManager.createDynamicMirror('nodeId', 'Mirror Title')
     * @param {string} sourceType - Either 'menu' for guiMenus or 'node' for node GUI
     * @param {string} sourceName - Name of the menu in guiMenus or node ID
     * @param {string} title - Title for the mirrored menu
     * @param {number} x - X position
     * @param {number} y - Y position
     * @returns {GUI|null} The created mirrored menu
     */
    createDynamicMirror(sourceType, sourceName, title, x = 200, y = 200) {
        if (sourceType === 'menu') {
            return this.mirrorGUIFolder(sourceName, title, x, y);
        } else if (sourceType === 'node') {
            return this.mirrorNodeGUI(sourceName, title, x, y);
        } else {
            console.error(`Invalid source type '${sourceType}'. Use 'menu' or 'node'.`);
            return null;
        }
    }

    /**
     * Demo function to show how to mirror different GUI menus
     */
    showMirrorMenuDemo() {
        // Create a modal dialog showing available menus and how to mirror them
        const availableMenus = Object.keys(guiMenus);
        
        let message = "GUI Menu Mirroring Demo\n\n";
        message += "Available menus to mirror:\n";
        availableMenus.forEach(menuName => {
            message += `• ${menuName}\n`;
        });
        
        message += "\nExample usage:\n";
        message += "// Mirror the view menu to a standalone popup\n";
        message += "this.mirrorGUIFolder('view', 'My View Controls', 300, 300);\n\n";
        message += "// Mirror the objects menu\n";
        message += "this.mirrorGUIFolder('objects', 'Object Controls', 500, 100);\n\n";
        message += "The mirrored menu will have all the same controls and functionality as the original,\n";
        message += "but in a draggable standalone window.\n\n";
        message += "Would you like to create a demo mirror of the 'view' menu?";
        
        if (confirm(message)) {
            // Create a demo mirror of the view menu
            const demoMenu = this.mirrorGUIFolder("view", "Demo View Mirror", 500, 300);
            if (demoMenu) {
                alert("Demo mirror created! You can drag it around and use all the controls.\nCheck the console for more details.");
            }
        }
    }

    updateViewFromPreset() {
        // update the views from the current view preset
        const preset = this.viewPresets[this.currentViewPreset];
        if (preset) {
            // set the views
            // ViewMan.updateViewFromPreset("video", preset.video);
            // ViewMan.updateViewFromPreset("mainView", preset.mainView);
            // ViewMan.updateViewFromPreset("lookView", preset.lookView);
            // ViewMan.updateViewFromPreset("chatView", preset.lookView);
            // Iterate over the views and set them
            for (const viewName in preset) {
                if (NodeMan.exists(viewName)) {
                    ViewMan.updateViewFromPreset(viewName, preset[viewName]);
                }
            }


            forceUpdateUIText(); // force update the text in the views, as they might have changed
        } else {
            console.warn("No view preset found for " + this.currentViewPreset);
        }
    }


    removeAllTracks() {
        TrackManager.iterate( (id, track) => {
            TrackManager.disposeRemove(id)
        })
        setRenderOne(true);

    }


    calculateBestPairs() {
        // given the camera position for lookCamera at point A and B
        // calculate the LOS for each object from the camerea, at A and B
        // then interate over the objects and find the best pairs

        const targetAngle = 0.6;

        const A = Sit.aFrame;
        const B = Sit.bFrame;

        const lookCamera = NodeMan.get("lookCamera");
        const lookA = lookCamera.p(A);
        const lookB = lookCamera.p(B);
        // TODO - A and B above don't work, we need to use a track like CNodeLOSFromCamera, or simulate the camera (which is what CNodeLOSFromCamera does)
        // but for fixed camera for now, it's okay.

        const trackList = [];

        // Now iterate over the objects tracks
        TrackManager.iterate((id, track) => {

            const node = track.trackNode;

            // get the object position at times A and B
            const posA = node.p(A);
            const posB = node.p(B);

            // get the two vectors from look A and B to the object

            const losA = posA.clone().sub(lookA).normalize();
            const losB = posB.clone().sub(lookB).normalize();

            trackList.push({
                id: id,
                node: node,
                posA: posA,
                posB: posB,
                losA: losA,
                losB: losB,

            });

            console.log("Track " + id + " A: " + posA.toArray() + " B: " + posB.toArray() + " LOSA: " + losA.toArray() + " LOSB: " + losB.toArray());

        })

        // Now iterate over the track list and find the best pairs
        // for now add two absolute deffrences between the target angle
        // and the angle between the two LOS vectors


        let bestPair = [null, null];
        let bestDiff = 1000000;

        this.bestPairs = []

        // outer loop, iterate over the track list
        for (let i = 0; i < trackList.length-1; i++) {
            const obj1 = trackList[i];

            // inner loop, iterate over the object list
            for (let j = i + 1; j < trackList.length; j++) {
                const obj2 = trackList[j];

                // get the angle between the two LOS vectors at A and B
                const angleA = degrees(Math.acos(obj1.losA.dot(obj2.losA)));
                const angleB = degrees(Math.acos(obj1.losB.dot(obj2.losB)));

                // get the absolute difference from the target angle
                const diffA = Math.abs(angleA - targetAngle);
                const diffB = Math.abs(angleB - targetAngle);

                console.log("Pair " + obj1.id + " " + obj2.id + " A: " + angleA.toFixed(2) + " B: " + angleB.toFixed(2) + " Diff A: " + diffA.toFixed(2) + " Diff B: " + diffB.toFixed(2));

                const metric = diffA + diffB;

                // store all pairs as object in bestPairs
                this.bestPairs.push({
                    obj1: obj1,
                    obj2: obj2,
                    angleA: angleA,
                    angleB: angleB,
                    diffA: diffA,
                    diffB: diffB,
                    metric: metric,
                });


                // if the diff is less than the best diff, then store it
                if (metric < bestDiff) {
                    bestDiff = diffA + diffB;
                    bestPair = [obj1, obj2];
                }


            }
        }

        // sort the best pairs by metric
        this.bestPairs.sort((a, b) => {
            return a.metric - b.metric;
        });




        console.log("Best pair: " + bestPair[0].id + " " + bestPair[1].id + " Diff: " + bestDiff.toFixed(10));
        console.log("Best angles: " + bestPair[0].losA.angleTo(bestPair[1].losA).toFixed(10) + " " + bestPair[0].losB.angleTo(bestPair[1].losB).toFixed(10));

        // // for the best pair draw debug arrows from lookA and lookB to the objects
        //
        // // red fro the first one
        // DebugArrowAB("Best 0A", lookA, bestPair[0].posA, "#FF0000", true, GlobalScene)
        // DebugArrowAB("Best 0B", lookB, bestPair[0].posB, "#FF8080", true, GlobalScene)
        //
        // // green for the second one
        // DebugArrowAB("Best 1A", lookA, bestPair[1].posA, "#00ff00", true, GlobalScene)
        // DebugArrowAB("Best 1B", lookB, bestPair[1].posB, "#80ff80", true, GlobalScene)


        // do debug arrows for the top 10
        for (let i = 0; i < Math.min(10, this.bestPairs.length); i++) {
            const obj1 = this.bestPairs[i].obj1;
            const obj2 = this.bestPairs[i].obj2;

            DebugArrowAB("Best "+i+"A", lookA, obj1.posA, "#FF0000", true, GlobalScene)
            DebugArrowAB("Best "+i+"B", lookB, obj1.posB, "#FF8080", true, GlobalScene)

            DebugArrowAB("Best "+i+"A", lookA, obj2.posA, "#00ff00", true, GlobalScene)
            DebugArrowAB("Best "+i+"B", lookB, obj2.posB, "#80ff80", true, GlobalScene)

            // and a white arrow between them
            DebugArrowAB("Best "+i+"AB", obj1.posA, obj2.posA, "#FFFFFF", true, GlobalScene)

        }

    }


    toggleExtendToGround() {
        console.log("Toggle Extend to Ground");
        let anyExtended = false;
        NodeMan.iterate((id, node) => {
            if (node instanceof CNodeDisplayTrack) {
                anyExtended ||= node.extendToGround;
            }
        })

        NodeMan.iterate((id, node) => {
            if (node instanceof CNodeDisplayTrack) {
                node.extendToGround = !anyExtended;
                node.recalculate();
            }
        })
        setRenderOne(true);

    }

    loginAttempt() {
        FileManager.loginAttempt(this.serialize, this.serializeButton, this.buttonText, this.buttonColor);
    };


    refreshLookViewTracks() {
        // intere over all nodes, and find all CNodeTrackGUI, and call setTrackVisibility
        NodeMan.iterate((id, node) => {
            if (node instanceof CNodeTrackGUI) {
                if (Globals.showAllTracksInLook) {
                    node.setTrackVisibility(true);
                } else {
                    node.setTrackVisibility(node.showTrackInLook);
                }
            }
        });
        setRenderOne(true)
    }


    getCustomSitchString(local = false) {
        // the output object
        // since we are going to use JSON.stringify, then when it is loaded again we do NOT need
        // the ad-hox parse functions that we used to have
        // and can just use JSON.parse directly on the string
        // any existing one that loads already will continue to work
        // but this allows us to use more complex objects without updating the parser

        // process.env.VERSION is a string number like "1.0.0"
        // convert it into an integer like 10000


        assert(process.env.BUILD_VERSION_NUMBER !== undefined, "BUILD_VERSION_NUMBER must be defined in the environment");
        const versionParts = process.env.BUILD_VERSION_NUMBER.split('.').map(Number);
        const versionNumber = versionParts[0] * 1000000 + versionParts[1] * 1000 + versionParts[2];

        let out = {
            stringified: true,
            isASitchFile: true,
            exportVersion: process.env.BUILD_VERSION_STRING,
            exportTag: process.env.VERSION,
            exportTagNumber: versionNumber, // this is an integer like 1000000 for 1.0.0
        }

        // merge in the current Sit object
        // which might have some changes?

        if (Sit.canMod) {
            // for a modded sitch, we just need to store the name of the sitch we are modding
            // TODO: are there some things in the Sit object that we need to store?????
            out = {...out,
                modding: Sit.name }
        }
        else
        {
            // but for a custom sitch, we need to store the whole Sit object (which automatically stores changes)
            out = {
                ...out,
                ...Sit}
        }

        // the custom sitch is a special case
        // and allows dropped videos and other files
        // (we might want to allow this for modded sitches too, later)
        if (Sit.isCustom) {
            // if there's a dropped video url
            if (NodeMan.exists("video")) {
                console.log("Exporting: Found video node")
                const videoNode = NodeMan.get("video")
                if (videoNode.staticURL) {
                    console.log("Exporting: Found video node with staticURL = ",videoNode.staticURL)
                    out.videoFile = videoNode.staticURL;
                } else {
                    console.log("Exporting: Found video node, but no staticURL")
                    if (local && videoNode.fileName) {
                        console.log("Exporting: LOCAL Found video node with filename = ",videoNode.fileName)
                        out.videoFile = videoNode.fileName;
                    }
                }
            } else {
                console.log("Exporting: No video node found")
            }


            // modify the terrain model directly, as we don't want to load terrain twice
            // For a modded sitch this has probably not changed
            if (out.TerrainModel !== undefined) {
                // note we now get these from the TerrainUI node
                // previously they were duplicated in both nodes, but now just in the TerrainUI node
                // the naming convention is to support historical saves.
                const terrainModel = NodeMan.get("terrainUI");
                out.TerrainModel = {
                    ...out.TerrainModel,
                    lat: terrainModel.lat,
                    lon: terrainModel.lon,
                    zoom: terrainModel.zoom,
                    nTiles: terrainModel.nTiles,
                    tileSegments: terrainModel.tileSegments,
                    mapType: terrainModel.mapType,
                    elevationType: terrainModel.elevationType,
                    elevationScale: terrainModel.elevationScale,
                    dynamic: terrainModel.dynamic,
                }
            }

            // the files object is the rehosted files
            // files will be reference in sitches using their original file names
            // we have rehosted them, so we need to create a new "files" object
            // that uses the rehosted file names
            // maybe special case for the video file ?
            let files = {}
            for (let id in FileManager.list) {
                const file = FileManager.list[id]
                if (local) {
                    // if we are saving locally, then we don't need to rehost the files
                    // so just save the original name
                    files[id] = file.filename
                } else {
                    files[id] = file.staticURL
                }
            }
            out.loadedFiles = files;
        }

        // calculate the modifications to be applied to nodes AFTER the files are loaded
        // anything with a modSerialize function will be serialized
        let mods = {}
        NodeMan.iterate((id, node) => {

            if (node.modSerialize !== undefined) {
                const nodeMod = node.modSerialize()

                // check it has rootTestRemove, and remove it if it's empty
                // this is a test to ensure serialization of an object incorporates he parents in the hierarchy
                assert(nodeMod.rootTestRemove !== undefined, "Not incorporating ...super.modSerialzie.  rootTestRemove is not defined for node:" + id+ "Class name "+node.constructor.name)
                // remove it
                delete nodeMod.rootTestRemove

                // check if empty {} object, don't need to store that
                if (Object.keys(nodeMod).length > 0) {

                    // if there's just one, and it's "visible: true", then don't store it
                    // as it's the default
                    if (Object.keys(nodeMod).length === 1 && nodeMod.visible === true) {
                        // skip
                    } else {
                        mods[node.id] = nodeMod;
                    }
                }
            }
        })
        out.mods = mods;

        // now the "par" values, which are deprecated, but still used in some places
        // so we need to serialize some of them
        const parNeeded = [
            "frame",
            "paused",
            "mainFOV",


            // these are JetGUI.js specific, form SetupJetGUI
            // VERY legacy stuff which most sitching will not have
            "pingPong",

            "podPitchPhysical",
            "podRollPhysical",
            "deroFromGlare",
            "jetPitch",

            "el",
            "glareStartAngle",
            "initialGlareRotation",
            "scaleJetPitch",
            "speed",  // this is the video speed
            "podWireframe",
            "showVideo",
            "showChart",
            "showKeyboardShortcuts",
            "showPodHead",
            "showPodsEye",
            "showCueData",

            "jetOffset",
            "TAS",
            "integrate",
        ]

        const SitNeeded = [
            "file",
            "starScale",
            "satScale",
            "flareScale",
            "satCutOff",
            "markerIndex",
            "sitchName",  // the same for the save file of the custom sitch
            "aFrame",
            "bFrame",
        ]

        const globalsNeeded = [
            "showMeasurements",
            "showLabelsMain",
            "showLabelsLook",
            "objectScale",
            "showAllTracksInLook"
        ]

        let pars = {}
        for (let key of parNeeded) {
            if (par[key] !== undefined) {
                pars[key] = par[key]
            }
        }

        // add any "showHider" par toggles
        // see KeyBoardHandler.js, function showHider
        // these are three.js objects that can be toggled on and off
        // so iterate over all the objects in the scene, and if they have a showHiderID
        // then store the visible state using that ID (which is what the variable in pars will be)
        // traverse GlobalScene.children recursively to do the above
        const traverse = (object) => {
            if (object.showHiderID !== undefined) {
                pars[object.showHiderID] = object.visible;
            }
            for (let child of object.children) {
                traverse(child);
            }
        }

        traverse(GlobalScene);
        out.pars = pars;

        let globals = {}
        for (let key of globalsNeeded) {
            if (Globals[key] !== undefined) {
                globals[key] = Globals[key]
            }
        }
        out.globals = globals;

        // this will be accessible in Sit.Sit, eg. Sit.Sit.file
        let SitVars = {}
        for (let key of SitNeeded) {
            if (Sit[key] !== undefined) {
                SitVars[key] = Sit[key]
            }
        }
        out.Sit = SitVars;





        // MORE STUFF HERE.......

        out.modUnits = Units.modSerialize()

        out.guiMenus = Globals.menuBar.modSerialize()


        // convert to a string
        const str = JSON.stringify(out, null, 2)
        return str;
    }

    serialize(name, version, local = false) {
        console.log("Serializing custom sitch")

        assert (Sit.canMod || Sit.isCustom, "one of Sit.canMod or Sit.isCustom must be true to serialize a sitch")
        assert (!Sit.canMod || !Sit.isCustom, "one of Sit.canMod or Sit.isCustom must be false to serialize a sitch")

        if (local) {
            // if we are saving locally, then we don't need to rehost the files
            // so just save the stringified sitch
            // with the loaded files using their original names
            const str = this.getCustomSitchString(true);

            // savem it with a dialog to select the name


            return new Promise((resolve, reject) => {
                saveFilePrompted(new Blob([str]), name + ".json").then((filename) => {
                        console.log("Saved as " + filename)
                    // change sit.name to the filename
                    // with .sitch.js removed
                    Sit.sitchName = filename.replace(".json", "")

                    console.log("Setting Sit.sitchName to "+Sit.sitchName)
                        resolve(filename);
                    }).catch((error) => {
                        console.log("Error or cancel in saving file local:", error);
                        reject(error);
                    })
            })


            //            saveAs(new Blob([str]), name + ".json")
            // return a promise that resolves to true
            // just because saveSitchNamed expects a promise
            // return Promise.resolve(true)
        }


        return FileManager.rehostDynamicLinks(true).then(() => {
            const str = this.getCustomSitchString();
//            console.log(str)

            if (name === undefined) {
                name = "Custom.js"
            }

            // and rehost it, showing a link
            // TODO:  Note, if the file is unchanged from the last time it was rehosted,
            // TODO: then the URL will be the same

            return FileManager.rehoster.rehostFile(name, str, version + ".js").then((staticURL) => {
                console.log("Sitch rehosted as " + staticURL);

                this.staticURL = staticURL;

                // and make a URL that points to the new sitch
                let paramName = "custom"
                if (Sit.canMod) {
                    name = Sit.name + "_mod.js"
                    paramName = "mod"
                }
                this.customLink = SITREC_APP + "?"+paramName+"=" + staticURL;

                //
                window.history.pushState({}, null, this.customLink);

            })
        })
    }


    getPermalink() {
        // Return the Promise chain
        return getShortURL(this.customLink).then((shortURL) => {
            // Ensure the short URL starts with 'http' or 'https'
            if (!shortURL.startsWith("http")) {
                shortURL = "https://" + shortURL;
            }
            createCustomModalWithCopy(shortURL)();
        }).catch((error) => {
            console.log("Error in getting permalink:", error);
        });
    }



    // after setting up a custom scene, call this to perform the mods
    // i.e. load the files, and then apply the mods
    deserialize(sitchData) {
        console.log("Deserializing text-base sitch")

        Globals.exportTagNumber = sitchData.exportTagNumber ?? 0;

        console.log("Sitch exportTagNumber: " + Globals.exportTagNumber)

        const loadingPromises = [];
        if (sitchData.loadedFiles) {
            // load the files as if they have been drag-and-dropped in
            for (let id in sitchData.loadedFiles) {
                loadingPromises.push(FileManager.loadAsset(Sit.loadedFiles[id], id).then(
                    (result) => {
                        console.log("Loaded " + id +"filename: " + FileManager.list[id].filename + " with data length: " + FileManager.list[id].data.length)
                        Globals.dontAutoZoom = true;
                        DragDropHandler.handleParsedFile(id, FileManager.list[id].data)
                        Globals.dontAutoZoom = false;
                    }
                ))
            }
        }

        // wait for the files to load
        Promise.all(loadingPromises).then(() => {

            // We supress recalculation while we apply the mods
            // otherwise we get multiple recalculations of the same thing
            // here we are applying the mods, and then we will recalculate everything
            Globals.dontRecalculate = true;

            // apply the units first, as some controllers are dependent on them
            // i.e. Target Speed, which use a GUIValue for speed in whatever units
            // if the set the units later, then it will convert the speed to the new units
            if (sitchData.modUnits) {
                Units.modDeserialize(sitchData.modUnits)
            }

            // now we've either got
            console.log("Promised files loaded in Custom Manager deserialize")
            if (sitchData.mods) {
                // apply the mods
                for (let id in sitchData.mods) {

                    if (!NodeMan.exists(id)) {
                        console.warn("Node "+id+" does not exist in the current sitch (deprecated?), so cannot apply mod")
                        continue;
                    }

                    const node = NodeMan.get(id)
                    if (node.modDeserialize !== undefined) {
                        //console.log("Applying mod to node:" + id+ " with data:"+sitchData.mods[id]  )

                        // bit of a patch, don't deserialise the dateTimeStart node
                        // if we've overridden the time in the URL
                        // see the check for urlParams.get("datetime") in index.js
                        if (id !== "dateTimeStart" || !Globals.timeOverride) {
                            node.modDeserialize(Sit.mods[id]);
                        }
                    }
                }

                setSitchEstablished(true); // flag that we've done some editing, so any future drag-and-drop will not mess with the sitch

            }

            // apply the pars
            if (sitchData.pars) {
                for (let key in sitchData.pars) {
                    par[key] = sitchData.pars[key]
                }
            }

            // and the globals
            if (sitchData.globals) {
                for (let key in sitchData.globals) {
//                    console.warn("Applying global "+key+" with value "+sitchData.globals[key])
                    Globals[key] = sitchData.globals[key]
                }
            }

            // and Sit
            if (sitchData.Sit) {
                for (let key in sitchData.Sit) {
//                    console.log("Applying Sit "+key+" with value "+sitchData.Sit[key])
                    Sit[key] = sitchData.Sit[key]
                }
            }

            refreshLabelsAfterLoading();
            this.refreshLookViewTracks();


            if (sitchData.guiMenus) {
                Globals.menuBar.modDeserialize(sitchData.guiMenus)
            }


            Globals.dontRecalculate = false;

            // recalculate everything after the mods
            // in case there's some missing dependency
            // like the CSwitches turning off if they are not used
            // which they don't know immediately
            NodeMan.recalculateAllRootFirst()

            // and we do it twice as sometimes there's initialization ordering issues
            // like the Tracking overlay depending on the FOV, but coming before the lookCamera
            NodeMan.recalculateAllRootFirst()
            setRenderOne(3);

        })


    }




    preRenderUpdate(view) {
        if (!Sit.isCustom) return;

        //
        // infoDiv.style.display = 'block';
        // infoDiv.innerHTML = "Look Camera<br>"
        // let camera = NodeMan.get("lookCamera").camera
        // infoDiv.innerHTML += "Position: " + camera.position.x.toFixed(2) + ", " + camera.position.y.toFixed(2) + ", " + camera.position.z.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "Rotation: " + camera.rotation.x.toFixed(2) + ", " + camera.rotation.y.toFixed(2) + ", " + camera.rotation.z.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "FOV: " + camera.fov.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "Aspect: " + camera.aspect.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "Near: " + camera.near.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "Far: " + camera.far.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "Zoom: " + camera.zoom.toFixed(2) + "<br>"
        //
        //
        // infoDiv.innerHTML += "<br><br>Main Camera<br>"
        // camera = NodeMan.get("mainCamera").camera
        // infoDiv.innerHTML += "Position: " + camera.position.x.toFixed(2) + ", " + camera.position.y.toFixed(2) + ", " + camera.position.z.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "Rotation: " + camera.rotation.x.toFixed(2) + ", " + camera.rotation.y.toFixed(2) + ", " + camera.rotation.z.toFixed(2) + "<br>"
        // infoDiv.innerHTML += "FOV: " + camera.fov.toFixed(2) + "<br>"
        //
        // infoDiv.innerHTML += "<br>Sit.lat: " + Sit.lat.toFixed(2) + " Sit.lon " + Sit.lon.toFixed(2) + "<br>"
        //


        // special logic for custom model visibility
        // if the custom model is following the same track as this one, then turn it off

        let targetObject = NodeMan.get("targetObject", false);
        if (targetObject === undefined) {
            targetObject = NodeMan.get("traverseObject");
        }



        // iterate over the NodeMan objects
        // if the object has a displayTargetSphere, then check if it's following the same track
        // as the camera track, and if so, turn it off
        NodeMan.iterate((id, node) => {
            // is it derived from CNode3D?
            if (node instanceof CNode3DObject) {
                const ob = node._object;
                disableIfNearCameraTrack(ob, view.camera)

                const tob = targetObject._object;
                // rather messy logic now
                // if we've got a target object then disable THAT if it's too close to this object
                if (ob !== tob) {
                    const targetObjectDist = ob.position.distanceTo(tob.position);
                    if (targetObjectDist < 10 && tob.customOldVisible === undefined) {

                        // removed for now, as it messes with windblown object that come close to the camera
                        // tob.customOldVisible = ob.visible;
                        // tob.visible = false;
//                        console.warn("TODO: Disabling target object as it's too close to this object")
                    }
                }
            }

        })
    }

    postRenderUpdate(view) {
        if (!Sit.isCustom) return;
        NodeMan.iterate((id, node) => {
            if (node instanceof CNode3DObject) {
                restoreIfDisabled(node._object, view.camera)
            }
        })
    }


// per-frame update code for custom sitches
    update(f) {


        UpdateHUD(""
            +"+/- - Zoom in/out<br>"
            +"C - Move Camera<br>"
            +"T - Move Terrain<br>"
            +"Shift-C - Ground Camera<br>"
            +"Shift-T - Ground Terrain<br>"
            +"; - Decrease Start Time<br>"
            +"' - Increase Start Time<br>"
            +"[ - Decrease Start Time+<br>"
            +"] - Increase Start Time+<br>"
            + (Globals.onMac ? "Shift/Ctrl/Opt/Cmd - speed<br>" : "Shift/Ctrl/Alt/Win - speed<br>")


        )


        // if the camera is following a track, then turn off the object display for that track
        // in the lookView

        const cameraPositionSwitch = NodeMan.get("CameraPositionController");
        // get the selected node
        const choice = cameraPositionSwitch.choice;
        // if the selected node is the track position controller
        // if (choice === "Follow Track") {
        //     // turn off the object display for the camera track in the lookView
        //     // by iterating over all the tracks and setting the layer mask
        //     // for the display objects that are associated with the track objects
        //     // that match the camera track
        //     const trackPositionMethodNode = cameraPositionSwitch.inputs[choice];
        //     const trackSelectNode = trackPositionMethodNode.inputs.sourceTrack;
        //     const currentTrack = trackSelectNode.inputs[trackSelectNode.choice]
        //     TrackManager.iterate((id, trackObject) => {
        //         if (trackObject.trackNode.id === currentTrack.id) {
        //             assert(trackObject.displayTargetSphere !== undefined, "displayTargetSphere is undefined for trackObject:" + trackObject.trackNode.id);
        //             trackObject.displayTargetSphere.changeLayerMask(LAYER.MASK_HELPERS);
        //             //console.log("Setting layer mask to MASK_HELPERS for node:" + trackObject.trackNode.id)
        //         } else {
        //             trackObject.displayTargetSphere.changeLayerMask(LAYER.MASK_LOOKRENDER);
        //             //console.log("Setting layer mask to MASK_LOOKRENDER for node:" + trackObject.trackNode.id)
        //         }
        //         if (trackObject.centerNode !== undefined) {
        //             if (trackObject.centerNode.id == currentTrack.id) {
        //                 trackObject.displayCenterSphere.changeLayerMask(LAYER.MASK_HELPERS);
        //                 //    console.log("Setting layer mask to MASK_HELPERS for node:" + trackObject.centerNode.id)
        //             } else {
        //                 trackObject.displayCenterSphere.changeLayerMask(LAYER.MASK_LOOKRENDER);
        //                 //    console.log("Setting layer mask to MASK_LOOKRENDER ("+LAYER.MASK_LOOKRENDER+") for node:" + trackObject.centerNode.id)
        //             }
        //         }
        //     })
        // }


        // handle hold down the t key to move the terrain square around
        if (NodeMan.exists("terrainUI")) {
            const terrainUI = NodeMan.get("terrainUI")
            if (isKeyHeld('t')) {

                // we assume if they set some terrain then they don't want the automatic
                // moving of the terrain and time done
                setSitchEstablished(true);

                const mainView = ViewMan.get("mainView")
                const cursorPos = mainView.cursorSprite.position.clone();
                // convert to LLA
                const ecef = EUSToECEF(cursorPos)
                const LLA = ECEFToLLAVD_Sphere(ecef)

                // only if different
                if (terrainUI.lat !== LLA.x || terrainUI.lon !== LLA.y) {

                    terrainUI.lat = LLA.x
                    terrainUI.lon = LLA.y
                    terrainUI.flagForRecalculation();
                    terrainUI.tHeld = true;
                    terrainUI.startLoading = false;
                }
            } else {
                if (terrainUI.tHeld) {
                    terrainUI.tHeld = false;
                    terrainUI.startLoading = true;
                }
            }
        }
    }
}


function disableIfNearCameraTrack(ob, camera) {
    const dist = ob.position.distanceTo(camera.position)
    if (dist < 0.001) {  // slack WAS 5m, for smoothed vs unsmoothed tracks
        ob.customOldVisible = ob.visible;
        ob.visible = false;
    } else {
        ob.customOldVisible = undefined;

    }
}

function restoreIfDisabled(ob) {
    if (ob.customOldVisible !== undefined) {
        ob.visible = ob.customOldVisible;
        ob.customOldVisible = undefined;
    }
}


