// SyntheticTrackCreator.js
// Generic system for creating and managing synthetic tracks in the 3D view
// Allows users to create tracks through context menus and associate them with 3D objects

import {guiMenus, NodeMan, Sit} from "./Globals";
import {CNodeSplineEditor} from "./nodes/CNodeSplineEdit";
import {Vector3} from "three";
import {ECEFToLLAVD} from "./LLA-ECEF-ENU";
import {CNodeDisplayTrack} from "./nodes/CNodeDisplayTrack";

export class SyntheticTrackCreator {
    constructor() {
        this.tracks = new Map(); // Map of trackID -> track data
        this.nextTrackID = 1;
    }

    /**
     * Create a new synthetic track
     * @param {Object} options - Track creation options
     * @param {Vector3} options.startPoint - Starting point in EUS coordinates
     * @param {string} options.name - Optional name for the track
     * @param {string} options.objectID - Optional 3D object to associate with track
     * @param {boolean} options.editMode - Whether to start in edit mode (default: true)
     * @param {string} options.curveType - Type of curve: "linear", "catmull", "chordal", "centripetal" (default: "chordal")
     * @param {number} options.color - Track color as hex (default: 0xffff00)
     * @param {number} options.lineWidth - Track line width (default: 2)
     * @returns {Object} The created track object
     */
    createTrack(options) {
        const trackID = `syntheticTrack_${this.nextTrackID++}`;
        const name = options.name || `Track ${this.nextTrackID - 1}`;
        const curveType = options.curveType || "chordal";
        const editMode = options.editMode !== undefined ? options.editMode : true;
        const color = options.color || 0xffff00;
        const lineWidth = options.lineWidth || 2;
        
        // Get the main view ID (CNodeSplineEditor expects a view ID string, not the object)
        const viewID = "mainView"; // or could check if "view" exists as fallback
        const view = NodeMan.get(viewID);
        if (!view) {
            console.error("SyntheticTrackCreator: No view found");
            return null;
        }
        
        // Get the scene from the view
        const scene = view.scene;
        if (!scene) {
            console.error("SyntheticTrackCreator: View has no scene");
            return null;
        }

        // Prepare initial points - CNodeSplineEditor expects [frame, x, y, z] format
        // Start with just 1 point - user can add more later
        const initialPoints = [];
        if (options.startPoint) {
            const sp = options.startPoint;
            // Start with a single point at frame 0
            initialPoints.push([0, sp.x, sp.y, sp.z]);
        }
        
        // Smart fallback: Use linear interpolation if we don't have enough points for spline curves
        // - 1-3 points: Use linear interpolation (PointEditor)
        // - 4+ points: Use requested curve type (SplineEditor with catmull/chordal/centripetal)
        let effectiveCurveType = curveType;
        if (initialPoints.length < 4 && curveType !== "linear") {
            effectiveCurveType = "linear";
            console.log(`SyntheticTrackCreator: Using linear interpolation (only ${initialPoints.length} point(s), need 4 for ${curveType})`);
        }
        
        // Create spline editor node (the data track)
        // This must be created BEFORE the GUI folder so the display track can find it
        const splineEditorNode = new CNodeSplineEditor({
            id: trackID,
            type: effectiveCurveType,  // Use the effective type (may fallback to linear)
            scene: scene,
            camera: "mainCamera",
            view: viewID,  // Pass the view ID string, not the object
            frames: Sit.frames,
            initialPoints: initialPoints,
        });
        
        // Set the menu text for display
        splineEditorNode.menuText = name;
        
        // Get the SplineEditor instance
        const splineEditor = splineEditorNode.splineEditor;
        
        // Create a display track for visualization
        // The display track will create the GUI folder automatically
        const displayTrackID = trackID + "_display";
        const displayTrack = new CNodeDisplayTrack({
            id: displayTrackID,
            track: trackID,
            color: [
                ((color >> 16) & 0xff) / 255,
                ((color >> 8) & 0xff) / 255,
                (color & 0xff) / 255
            ],
            width: lineWidth,
        });
        
        // Now get the GUI folder that was created by the display track
        const guiFolder = guiMenus.contents.getFolder(displayTrackID);
        
        // Set the folder's display name to the user-friendly name
        guiFolder.$title.innerText = name;
        
        // Add synthetic track menu options to the folder
        guiFolder.add({
            toggleEditMode: () => {
                const track = this.tracks.get(trackID);
                if (track && track.splineEditor) {
                    const isEnabled = track.splineEditor.enabled;
                    if (isEnabled) {
                        this.disableEditMode(trackID);
                    } else {
                        this.enableEditMode(trackID);
                    }
                }
            }
        }, 'toggleEditMode').name('Toggle Edit Mode');
        
        guiFolder.add({
            deleteTrack: () => {
                if (confirm(`Delete synthetic track "${name}"?`)) {
                    this.deleteTrack(trackID);
                }
            }
        }, 'deleteTrack').name('Delete Track');
        
        guiFolder.add({
            exportLLA: () => {
                const llaPoints = this.exportTrackLLA(trackID);
                console.log(`Track ${name} LLA points:`, llaPoints);
                // Copy to clipboard as JSON
                const json = JSON.stringify(llaPoints, null, 2);
                navigator.clipboard.writeText(json).then(() => {
                    console.log('Track LLA data copied to clipboard');
                }).catch(err => {
                    console.error('Failed to copy to clipboard:', err);
                });
            }
        }, 'exportLLA').name('Export LLA');
        
        // Create track object
        const track = {
            trackID,
            name,
            splineEditorNode,
            splineEditor,
            displayTrack,
            displayTrackID,
            objectID: options.objectID,
            guiFolder: splineEditorNode.gui, // Use the GUI folder from the spline editor
            color,
            curveType,
        };
        
        // Store in tracks map
        this.tracks.set(trackID, track);
        
        // Associate with object if provided
        if (options.objectID) {
            this.associateObjectWithTrack(options.objectID, trackID);
        }
        
        // Enable edit mode if requested
        if (editMode) {
            this.enableEditMode(trackID);
        }
        
        console.log(`Created synthetic track: ${trackID} (${name})`);
        
        return track;
    }
    
    /**
     * Enable edit mode for a track
     * @param {string} trackID - ID of the track to edit
     */
    enableEditMode(trackID) {
        const track = this.tracks.get(trackID);
        if (!track) {
            console.warn(`Track ${trackID} not found`);
            return;
        }
        
        track.splineEditor.setEnable(true);
        console.log(`Edit mode enabled for track: ${trackID}`);
    }
    
    /**
     * Disable edit mode for a track
     * @param {string} trackID - ID of the track to stop editing
     */
    disableEditMode(trackID) {
        const track = this.tracks.get(trackID);
        if (!track) {
            console.warn(`Track ${trackID} not found`);
            return;
        }
        
        track.splineEditor.setEnable(false);
        console.log(`Edit mode disabled for track: ${trackID}`);
    }
    
    /**
     * Associate a 3D object with a track
     * @param {string} objectID - ID of the object
     * @param {string} trackID - ID of the track
     */
    associateObjectWithTrack(objectID, trackID) {
        const track = this.tracks.get(trackID);
        if (!track) {
            console.warn(`Track ${trackID} not found`);
            return;
        }
        
        track.objectID = objectID;
        
        // Get the object node
        const objectNode = NodeMan.get(objectID);
        if (objectNode) {
            // Set the object's track input to follow this track
            if (objectNode.inputs && objectNode.inputs.track !== undefined) {
                objectNode.inputs.track = trackID;
                objectNode.recalculateCascade();
            }
            
            console.log(`Associated object ${objectID} with track ${trackID}`);
        } else {
            console.warn(`Object ${objectID} not found`);
        }
    }
    
    /**
     * Delete a synthetic track
     * @param {string} trackID - ID of the track to delete
     */
    deleteTrack(trackID) {
        const track = this.tracks.get(trackID);
        if (!track) {
            console.warn(`Track ${trackID} not found`);
            return;
        }
        
        // Disable edit mode first
        this.disableEditMode(trackID);
        
        // Remove display track
        if (track.displayTrackID) {
            NodeMan.unlinkDisposeRemove(track.displayTrackID);
        }
        
        // Remove GUI folder
        if (track.guiFolder) {
            track.guiFolder.destroy();
        }
        
        // Remove from NodeManager
        NodeMan.unlinkDisposeRemove(trackID);
        
        // Remove from our tracks map
        this.tracks.delete(trackID);
        
        console.log(`Deleted synthetic track: ${trackID}`);
    }
    
    /**
     * Export track data in LLA format
     * @param {string} trackID - ID of the track to export
     * @returns {Array} Array of LLA points {lat, lon, alt}
     */
    exportTrackLLA(trackID) {
        const track = this.tracks.get(trackID);
        if (!track) {
            console.warn(`Track ${trackID} not found`);
            return [];
        }
        
        const points = track.splineEditor.positions || [];
        return points.map(point => {
            // Convert EUS to LLA
            const lla = ECEFToLLAVD(point);
            return {
                lat: lla.x,
                lon: lla.y,
                alt: lla.z
            };
        });
    }
    
    /**
     * Get all synthetic tracks
     * @returns {Map} Map of trackID -> track data
     */
    getAllTracks() {
        return this.tracks;
    }
    
    /**
     * Check if a track is a synthetic track
     * @param {string} trackID - ID to check
     * @returns {boolean} True if it's a synthetic track
     */
    isSyntheticTrack(trackID) {
        return trackID && trackID.startsWith('syntheticTrack_');
    }
    
    /**
     * Get track by ID
     * @param {string} trackID - ID of the track
     * @returns {Object|null} Track object or null if not found
     */
    getTrack(trackID) {
        return this.tracks.get(trackID) || null;
    }
}

// Create singleton instance
export const syntheticTrackCreator = new SyntheticTrackCreator();