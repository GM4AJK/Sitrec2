import {wgs84} from "./LLA-ECEF-ENU";
import {Matrix4} from "three/src/math/Matrix4";
import {Frustum} from "three/src/math/Frustum";
import {debugLog} from "./Globals";
import {isLocal} from "./configUtils";
import {altitudeAboveSphere, distanceToHorizon, hiddenByGlobe} from "./SphericalMath";
import * as LAYER from "./LayerMasks";


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// QuadTreeMap is the base class of a QuadTreeMapTexture and a QuadTreeMapElevation
export class QuadTreeMap {
    constructor(terrainNode, geoLocation, options) {
        this.options = this.getOptions(options)
        this.nTiles = this.options.nTiles
        this.zoom = this.options.zoom
        this.tileSize = this.options.tileSize
        this.radius = wgs84.RADIUS; // force this
        this.loadedCallback = options.loadedCallback; // function to call when map is all loaded
        this.loaded = false; // mick flag to indicate loading is finished
        this.tileCache = {};
        this.terrainNode = terrainNode
        this.geoLocation = geoLocation
        this.dynamic = options.dynamic || false; // if true, we use a dynamic tile grid
        this.maxZoom = options.maxZoom ?? 15; // default max zoom level
        this.lastLoggedStats = new Map(); // Track last logged stats per view to reduce console spam
        this.inactiveTileTimeout = 1000; // Time in ms before pruning inactive tiles (1 seconds)
        this.currentStats = new Map(); // Store current stats per view for debug display

    }

    // Helper methods for nested cache access
    getTile(x, y, z) {
        return this.tileCache[z] && this.tileCache[z][x] && this.tileCache[z][x][y];
    }

    setTile(x, y, z, tile) {
        if (!this.tileCache[z]) this.tileCache[z] = {};
        if (!this.tileCache[z][x]) this.tileCache[z][x] = {};
        this.tileCache[z][x][y] = tile;
    }

    deleteTile(x, y, z) {
        if (this.tileCache[z] && this.tileCache[z][x] && this.tileCache[z][x][y]) {
            delete this.tileCache[z][x][y];
            // Clean up empty objects to prevent memory leaks
            if (Object.keys(this.tileCache[z][x]).length === 0) {
                delete this.tileCache[z][x];
                if (Object.keys(this.tileCache[z]).length === 0) {
                    delete this.tileCache[z];
                }
            }
        }
    }

    // Helper to get all tiles (for Object.values() replacement)
    getAllTiles() {
        const tiles = [];
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                for (const y in this.tileCache[z][x]) {
                    tiles.push(this.tileCache[z][x][y]);
                }
            }
        }
        return tiles;
    }

    // Helper to get tile count (more efficient than getAllTileKeys().length)
    getTileCount() {
        let count = 0;
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                count += Object.keys(this.tileCache[z][x]).length;
            }
        }
        return count;
    }

    // Helper to get all tile keys (for Object.keys() replacement)
    getAllTileKeys() {
        const keys = [];
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                for (const y in this.tileCache[z][x]) {
                    keys.push(`${z}/${x}/${y}`);
                }
            }
        }
        return keys;
    }

    // Helper to iterate over all tiles
    forEachTile(callback) {
        for (const z in this.tileCache) {
            for (const x in this.tileCache[z]) {
                for (const y in this.tileCache[z][x]) {
                    callback(this.tileCache[z][x][y]);
                }
            }
        }
    }

    initTiles() {
        if (this.dynamic) {
            this.initTilePositionsDynamic()
         } else {
             this.initTilePositions()
         }
    }

    refreshDebugGeometry(tile) {
        if (this.terrainNode.UI.debugElevationGrid) {
            tile.buildDebugGeometry(this.debugColor, this.debugAltitude)
        }
    }

    refreshDebugGrid(color, altitude = 0) {
        this.getAllTiles().forEach(tile => {
            this.debugColor = color
            this.debugAltitude = altitude
            tile.buildDebugGeometry(this.debugColor, this.debugAltitude)
        })
    }

    removeDebugGrid() {
        this.getAllTiles().forEach(tile => {
            tile.removeDebugGeometry()
        })
    }

    getOptions(providedOptions) {
        const options = Object.assign({}, this.defaultOptions, providedOptions)
        options.tileSegments = Math.min(256, Math.round(options.tileSegments))
        return options
    }

    defaultOptions = {
        nTiles: 3,
        zoom: 11,
        tileSize: 600,
        tileSegments: 100,
        zScale: 1,
    }

    initTilePositions() {
        this.center = this.options.mapProjection.geo2Tile(this.geoLocation, this.zoom)
        const tileOffset = Math.floor(this.nTiles / 2)
        this.controller = new AbortController();
        for (let i = 0; i < this.nTiles; i++) {
            for (let j = 0; j < this.nTiles; j++) {
                const x = this.center.x + i - tileOffset;
                const y = this.center.y + j - tileOffset;
                // only add tiles that are within the bounds of the map
                // we allow the x values out of range
                // because longitude wraps around
                if (y > 0 && y < Math.pow(2, this.zoom)) {
                    // For initialization, use default mask that includes both main and look views
                    this.activateTile(x, y, this.zoom, LAYER.MASK_MAIN | LAYER.MASK_LOOK) // activate the tile
                }
            }
        }
    }


// dynamic setup just uses 1x1 tile, at 0,0 at zoom 0
    initTilePositionsDynamic(deferLoad = false) {
        this.center = this.options.mapProjection.geo2Tile(this.geoLocation, this.zoom)
        this.controller = new AbortController();

        this.zoom = 0;

        for (let i = 0; i < 1; i++) {
            for (let j = 0; j < 1; j++) {
                // For initialization, use default mask that includes both main and look views
                this.activateTile(i, j, this.zoom, LAYER.MASK_MAIN | LAYER.MASK_LOOK) // activate the tile
            }
        }
    }


    // go through the tile cache and subdivide or merge each tile if needed
    // "needed" is based on the zoom level and the tile size on screen
    // passed in a single view, from which we get the camera and viewport size
    // this is called once per view to handle per-view subdivision
    // different quadtrees (i.e. textures and elevations) can have different subdivideSize
    // which is the screen size (of a bounding sphere) above which we start subdividing tiles
    subdivideTilesOld(view, subdivideSize = 2000) {


        // If the elevation source is "Flat", then we don't need to subdivide
        if (this.constructor.name === 'QuadTreeMapElevation' && this.options.elevationType === "Flat") {
            return;
        }

        // prepare single view data
        const camera = view.cameraNode.camera;
        const tileLayers = view.tileLayers;

        // debug counting and output to debugLog
        if (isLocal) {
            let totalTileCount = this.getTileCount(); // count of tiles in the cache
            let pendingLoads = 0; // count of pending loads
            let lazyLoading = 0; // count of tiles using parent data and needing high-res
            let activeTileCount = 0; // count of tiles active in this view
            let inactiveTileCount = 0; // count of tiles inactive in this view

            this.forEachTile((tile) => {
                // Check if tile is active in this view using layer mask
                if (tile.tileLayers && (tile.tileLayers & tileLayers)) {
                    activeTileCount++;
                } else {
                    inactiveTileCount++;
                }

                if (tile.isLoading) {
                    pendingLoads++; // increment the pending load counter
                }
                
                if (tile.usingParentData && tile.needsHighResLoad) {
                    lazyLoading++; // increment the lazy loading counter
                }
            });

            if (pendingLoads > 0) {
                debugLog(`[${view.id || 'View'}] Total: ${totalTileCount}, Active: ${activeTileCount}, Inactive: ${inactiveTileCount}, Pending: ${pendingLoads}, Lazy: ${lazyLoading}`);
            }
        }

        // Cleanup pass: Cancel pending loads for tiles that are no longer active in any view
        this.forEachTile((tile) => {
            if (!tile.tileLayers && (tile.isLoading || tile.isLoadingElevation)) {
                tile.cancelPendingLoads();
            }
        });


        // we need to make sure the fustrum is up to date, as we use it to determine visiblity.
        camera.updateMatrixWorld();
        const frustum = new Frustum();
        frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        ));
        camera.viewFrustum = frustum; // store the frustum in the camera for later use
        //})


        // First pass: Check for parent tiles that can now be deactivated because
        // their children are loaded and active in this layer
        // Only do this for texture maps, not elevation maps, since elevation tiles
        // are used by texture tiles at different zoom levels
        // (i.e. elevation tiles are never deactivated if they have active children)
        // Note: the deactivation here is on a per-layer basis
        // the tile will only get removed from the scene when its on no layers
        if (this.constructor.name === 'QuadTreeMapTexture') {
            this.forEachTile((tile) => {

                // if (tile.mesh) {
                //     if (tile.mesh.layers.mask !== tile.tileLayers) {
                //         const key = `${tile.z}/${tile.x}/${tile.y}`; // Generate key only when needed for error
                //         const timeSinceSet = tile.mesh._lastLayerSetTime ? Date.now() - tile.mesh._lastLayerSetTime : 'unknown';
                //         const lastSetMask = tile.mesh._lastLayerSetMask || 'unknown';
                //         showError(`LAYERS MISMATCH DETECTED: key=${key}, loaded=(${tile.loaded}), mesh.layers.mask=${tile.mesh.layers.mask.toString(2)} (${tile.mesh.layers.mask}), tile.tileLayers=${tile.tileLayers.toString(2)} (${tile.tileLayers})`);
                //         showError(`Debug info: lastSetMask=${lastSetMask.toString ? lastSetMask.toString(2) : lastSetMask}, timeSinceSet=${timeSinceSet}ms`);
                //         console.trace('Stack trace for layers mismatch:');
                //     }
                //     const key = `${tile.z}/${tile.x}/${tile.y}`; // Generate key only when needed for assertion
                //     assert(tile.mesh.layers.mask === tile.tileLayers, `Tile layers mismatch. key=${key}, loaded=(${tile.loaded}), tile. mesh.layers.mask=${tile.mesh.layers.mask.toString(2)}, tile.tileLayers=${tile.tileLayers.toString(2)}`)
                // }


                // Skip if tile is not active in this layer
                // if (!(tile.tileLayers & tileLayers)) return;

                // If we cant have children (at max zoom), then no need for the child checks.
                if (tile.z >= this.maxZoom) return;

                // if the parent tile is still loading, hold off on checking children
                // we don't want to deactivate a parent tile before its texture is loaded
                if (tile.isLoading) return;

                // Check if all four children exist and are loaded
                const child1 = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1);
                const child2 = this.getTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1);
                const child3 = this.getTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1);
                const child4 = this.getTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1);

                if (child1 && child2 && child3 && child4 &&
                    (child1.tileLayers & tileLayers) && (child2.tileLayers & tileLayers) &&
                    (child3.tileLayers & tileLayers) && (child4.tileLayers & tileLayers)
                    && child1.loaded && child2.loaded && child3.loaded && child4.loaded
                    && child1.added && child2.added && child3.added && child4.added
                ) {
                    // All children are active in this view and loaded, and aded to the scene
                    // safe to FULLY deactivate parent texture tile for this view
                    this.deactivateTile(tile.x, tile.y, tile.z, tileLayers, true);
                }
            });
        }

        // Second pass: go over the tile cache for subdivision/merging

        this.forEachTile((tile) => {

            // if the tile is added but not active in ANY view, then we can remove it from scene
            // if it has a mesh and all the children are loaded
            if (tile.added && !(tile.tileLayers) && tile.mesh) {
                // Cancel any pending loads for this inactive tile
                tile.cancelPendingLoads();
                
                const child1 = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1);
                const child2 = this.getTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1);
                const child3 = this.getTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1);
                const child4 = this.getTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1);
                // if all four child tiles are loaded, then we can remove this tile from the scene
                if (child1 && child2 && child3 && child4 &&
                    child1.loaded && child2.loaded && child3.loaded && child4.loaded) {
                    this.scene.remove(tile.mesh); // remove the tile mesh from the scene
                    if (tile.skirtMesh) {
                        this.scene.remove(tile.skirtMesh); // remove the skirt mesh from the scene
                    }
                    tile.added = false; // mark the tile as not added
                    this.refreshDebugGeometry(tile);
                }


            }

            if (!this.canSubdivide(tile)) {
                return;
            }

            // Check if this tile has children that might need merging
            const hasChildren = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1) !== undefined;
            
            // Skip tiles that are not active in any view, UNLESS they have children
            // (we need to process inactive parents to check if their children should be merged)
            if (!tile.tileLayers && !hasChildren) {
                return;
            }

            // the world sphere of the tile is used to
            // 1) determine visibility
            // 2) calculate the size of the tile on screen (using the radius and distance)
            let worldSphere = tile.getWorldSphere();

            let thisViewScreenSize = 0;
            let thisViewVisible = false;

            // First check the frustum intersection with the tile's world sphere
            // this gives us a ROUGH (but conservative) estimate of whether the tile is visible
            const frustumIntersects = camera.viewFrustum.intersectsSphere(worldSphere);
            if (frustumIntersects) {
                const radius = worldSphere.radius;
                const distance = camera.position.distanceTo(worldSphere.center);

                // now check to see if the tile is hidden behind the curve of the earth
                const cameraPos = camera.position.clone(); // clone the position vector
                const cameraAltitude = altitudeAboveSphere(cameraPos)

                // closest possible distance would be a near corner of the tile
                const closestDistance = Math.max(0,distance - radius);
                // we are going to check if the highest point, set at the closest distance
                // is visible behind the curve of the earth

                // Globe hidden amount from altitude and distance
                const horizon = distanceToHorizon(cameraAltitude);

                // we do the check if the closest distance is nearer than the horizon
                // or if the amount hiddens is less than the highest point of the tile
                if (horizon > closestDistance
                    || hiddenByGlobe(cameraAltitude, closestDistance) <= tile.highestAltitude ) {


                    // get the size of the tile on screen

                    const fov = camera.getEffectiveFOV() * Math.PI / 180; // radians

                    const height = 2 * Math.tan(fov / 2) * distance;
                    const screenFraction = (2 * radius) / height;
                    thisViewScreenSize = screenFraction * 1024; // DUMMY: assume 1024 is the screen size in pixels, this should be configurable
                    thisViewVisible = true;

                    // if (this.constructor.name === 'QuadTreeMapTexture') {
                    //     DebugSphere("Subdivider", worldSphere.center.clone(), radius, "#ff0000", undefined, undefined, true)
                    // }
                }
            }


            // Store the actual visibility before forcing it for subdivision
            const actuallyVisible = thisViewVisible;
            
            if (tile.z < 3) {
                thisViewScreenSize = 10000000000; // force subdivision of first three
                thisViewVisible = true; // force visibility for subdivision logic
            }

            // If tile is visible in this view and using parent data, trigger high-res load
            // Use actuallyVisible (not thisViewVisible) to avoid loading high-res for tiles that are only
            // "visible" due to forced subdivision at low zoom levels
            if (actuallyVisible && tile.usingParentData && tile.needsHighResLoad && 
                !tile.isLoading && !tile.isCancelling && 
                (tile.tileLayers & tileLayers) && // Only load if tile is active in this view
                this.constructor.name === 'QuadTreeMapTexture') {
                tile.needsHighResLoad = false; // Clear flag to prevent repeated loads
                const key = `${tile.z}/${tile.x}/${tile.y}`;

                // Load high-res texture in background
                const materialPromise = tile.applyMaterial().then(() => {
                    tile.usingParentData = false; // Mark as using high-res data now
                }).catch(error => {
                    // Reset flag to retry - whether it's an abort or real error
                    tile.needsHighResLoad = true;
                });
                
                this.trackTileLoading(`${key}-highres`, materialPromise);
            }

            // Check if this view needs subdivision
            let shouldSubdivide = false;

            // it needs to be both visible and large
            if (thisViewVisible && thisViewScreenSize > subdivideSize) {
                shouldSubdivide = true;
            }

            // if this view needs subdivision, create child tiles with appropriate layer masks
            if (shouldSubdivide && (tile.tileLayers & tileLayers) && tile.z < this.maxZoom) {

                // For texture maps, use parent data for immediate subdivision
                // For elevation maps, use normal loading (elevation already uses parent fallback)
                const useParentData = this.constructor.name === 'QuadTreeMapTexture' && tile.loaded;
                
                this.activateTile(tile.x * 2, tile.y * 2, tile.z + 1, tileLayers, useParentData); // activate the child tile
                this.activateTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1, tileLayers, useParentData); // activate the child tile
                this.activateTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1, tileLayers, useParentData); // activate the child tile
                this.activateTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1, tileLayers, useParentData); // activate the child tile

                // Only immediately deactivate parent if all children are loaded, to prevent gaps in coverage
                if (this.constructor.name === 'QuadTreeMapTexture') {

                    const child1 = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1);
                    const child2 = this.getTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1);
                    const child3 = this.getTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1);
                    const child4 = this.getTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1);

                    if (child1 && child2 && child3 && child4 &&
                        child1.loaded && child2.loaded && child3.loaded && child4.loaded) {
                        this.deactivateTile(tile.x, tile.y, tile.z, tileLayers); // deactivate parent texture tile only when children are ready for this view
                    }
                } else {
                    // original logic for elevation tiles
                    this.deactivateTile(tile.x, tile.y, tile.z, tileLayers); // deactivate this tile for this view
                }


                // wait, this will not work, as we ar in an iterator!!!! return just goes to the next one
                return; // just doing one tile group (four tiles) at a time, might want to change this later
            }

            // Check if we should merge the children - the tile does not need subdivision
            if (!shouldSubdivide) {
                // Check if children exist and are all active in this view
                const child1 = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1);
                const child2 = this.getTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1);
                const child3 = this.getTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1);
                const child4 = this.getTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1);

                // Only merge if ALL children are active in this view
                // This ensures we only merge tiles that belong to this view
                if (child1 && child2 && child3 && child4 &&
                    (child1.tileLayers & tileLayers) && (child2.tileLayers & tileLayers) &&
                    (child3.tileLayers & tileLayers) && (child4.tileLayers & tileLayers)) {

                    // merge the children into this tile
                    // since we have children, we know that activating the tile will be instant as the material will be loaded
                    // This will activate the parent in this view (if not already active) or maintain its existing layers
                    this.activateTile(tile.x, tile.y, tile.z, tileLayers); // activate/ensure parent tile is active in this view
                    this.deactivateTile(child1.x, child1.y, child1.z, tileLayers, true); // deactivate the child tile for this view, instantly
                    this.deactivateTile(child2.x, child2.y, child2.z, tileLayers, true); // deactivate the child tile for this view, instantly
                    this.deactivateTile(child3.x, child3.y, child3.z, tileLayers, true); // deactivate the child tile for this view, instantly
                    this.deactivateTile(child4.x, child4.y, child4.z, tileLayers, true); // deactivate the child tile for this view, instantly

                    // we can do  more, as this is a lightweight operation
                    // return;
                }
            }
        });


    }

    /**
     * Rewritten subdivideTiles - cleaner architecture with clear separation of concerns
     * This method manages the quadtree subdivision/merging based on view visibility and screen size
     */
    subdivideTiles(view, subdivideSize = 2000) {
        // Skip subdivision for flat elevation maps
        if (this.constructor.name === 'QuadTreeMapElevation' && this.options.elevationType === "Flat") {
            return;
        }

        const camera = view.cameraNode.camera;
        const tileLayers = view.tileLayers;
        const isTextureMap = this.constructor.name === 'QuadTreeMapTexture';

        // Setup camera frustum for visibility checks
        camera.updateMatrixWorld();
        const frustum = new Frustum();
        frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(
            camera.projectionMatrix, camera.matrixWorldInverse
        ));
        camera.viewFrustum = frustum;

        // PASS 1: Debug logging and cleanup
        if (isLocal) {
            this.logDebugStats(tileLayers, view.id);
        }
        this.cleanupInactiveTiles();

        // PASS 2: Deactivate parent tiles whose children are fully loaded (texture maps only)
        if (isTextureMap) {
            this.deactivateParentsWithLoadedChildren(tileLayers);
        }

        // PASS 3: Remove inactive tiles from scene
        this.removeInactiveTilesFromScene();

        // PASS 3.5: Prune complete sets of inactive tiles
        // Enable for both texture and elevation maps to prevent memory leaks
        this.pruneInactiveTileSets();

        // PASS 4: Process each tile for subdivision/merging and lazy loading
        this.forEachTile((tile) => {
            if (!this.canSubdivide(tile)) return;

            const hasChildren = this.hasAnyChildren(tile);
            
            // Skip inactive tiles without children
            if (!tile.tileLayers && !hasChildren) return;

            // Calculate visibility and screen size
            const visibility = this.calculateTileVisibility(tile, camera);
            
            // Handle lazy loading for visible tiles using parent data
            if (isTextureMap && visibility.actuallyVisible) {
                this.triggerLazyLoadIfNeeded(tile, tileLayers);
            }

            // Determine if subdivision is needed
            const shouldSubdivide = this.shouldSubdivideTile(tile, visibility, subdivideSize);

            if (shouldSubdivide && (tile.tileLayers & tileLayers) && tile.z < this.maxZoom) {
                this.subdivideTile(tile, tileLayers, isTextureMap);
                return; // Process one subdivision at a time
            }

            // Check for merging children back to parent
            if (!shouldSubdivide && hasChildren) {
                this.mergeChildrenIfPossible(tile, tileLayers);
            }
        });
    }

    /**
     * Log debug statistics about tile states
     */
    logDebugStats(tileLayers, viewId) {
        let totalTileCount = this.getTileCount();
        let pendingLoads = 0;
        let lazyLoading = 0;
        let activeTileCount = 0;
        let inactiveTileCount = 0;

        this.forEachTile((tile) => {
            if (tile.tileLayers && (tile.tileLayers & tileLayers)) {
                activeTileCount++;
            } else {
                inactiveTileCount++;
            }
            if (tile.isLoading) pendingLoads++;
            // Only count active tiles in lazy loading count
            if (tile.usingParentData && tile.needsHighResLoad && (tile.tileLayers & tileLayers)) {
                lazyLoading++;
            }
        });

        // Store current stats for debug display
        const viewKey = viewId || 'View';
        const currentStats = { totalTileCount, activeTileCount, inactiveTileCount, pendingLoads, lazyLoading };
        this.currentStats.set(viewKey, currentStats);
        
        // Only log if counts changed from last time
        if (pendingLoads > 0 || lazyLoading > 0) {
            const lastStats = this.lastLoggedStats.get(viewKey);
            
            // Check if any value changed
            if (!lastStats || 
                lastStats.totalTileCount !== totalTileCount ||
                lastStats.activeTileCount !== activeTileCount ||
                lastStats.inactiveTileCount !== inactiveTileCount ||
                lastStats.pendingLoads !== pendingLoads ||
                lastStats.lazyLoading !== lazyLoading) {
                
                debugLog(`[${viewKey}] Total: ${totalTileCount}, Active: ${activeTileCount}, Inactive: ${inactiveTileCount}, Pending: ${pendingLoads}, Lazy: ${lazyLoading}`);
                this.lastLoggedStats.set(viewKey, currentStats);
            }
        }
    }

    /**
     * Cancel pending loads for tiles that are no longer active in any view
     */
    cleanupInactiveTiles() {
        this.forEachTile((tile) => {
            if (!tile.tileLayers && (tile.isLoading || tile.isLoadingElevation)) {
                tile.cancelPendingLoads();
            }
        });
    }

    /**
     * Deactivate parent tiles when all their children are loaded and active
     * Children with parent data are OK - they're valid for display, just lower quality
     * The key is that children are loaded (even if using parent data) and added to scene
     */
    deactivateParentsWithLoadedChildren(tileLayers) {
        this.forEachTile((tile) => {
            if (tile.z >= this.maxZoom) return;
            if (tile.isLoading) return;

            const children = this.getChildren(tile);
            if (!children) return;

            // Children must be loaded and added (parent data is OK - it's valid for display)
            const allChildrenReady = children.every(child => 
                child && 
                (child.tileLayers & tileLayers) && 
                child.loaded && 
                child.added
            );

            if (allChildrenReady) {
                this.deactivateTile(tile.x, tile.y, tile.z, tileLayers, true);
            }
        });
    }

    /**
     * Remove tiles from scene that are inactive in all views
     */
    removeInactiveTilesFromScene() {
        this.forEachTile((tile) => {
            if (!tile.added || tile.tileLayers || !tile.mesh) return;

            tile.cancelPendingLoads();

            const children = this.getChildren(tile);
            if (!children) return;

            const allChildrenLoaded = children.every(child => child && child.loaded);
            if (allChildrenLoaded) {
                this.scene.remove(tile.mesh);
                if (tile.skirtMesh) {
                    this.scene.remove(tile.skirtMesh);
                }
                tile.added = false;
                
                // Reset lazy loading flags when tile is removed from scene
                // This prevents inactive tiles from being counted in lazy loading stats
                if (tile.usingParentData) {
                    tile.needsHighResLoad = false;
                }
                
                this.refreshDebugGeometry(tile);
            }
        });
    }

    /**
     * Prune complete sets of four sibling tiles that have been inactive for too long
     * Only prunes if all four siblings exist, are inactive, have no children, and have been inactive long enough
     */
    pruneInactiveTileSets() {
        const now = Date.now();
        let prunedCount = 0;
        
        // Iterate through all tiles to find parent tiles with complete sets of inactive children
        this.forEachTile((tile) => {
            // Check if this tile has all four children
            const children = this.getChildren(tile);
            if (!children) return;
            
            // Check if all four children meet pruning criteria:
            // 1. Inactive (tileLayers === 0)
            // 2. Have no children of their own
            // 3. Have been inactive for longer than the timeout
            const allChildrenPrunable = children.every(child => {
                if (child.tileLayers !== 0) return false; // Still active
                if (this.hasAnyChildren(child)) return false; // Has children
                if (!child.inactiveSince) return false; // No timestamp (shouldn't happen)
                if (now - child.inactiveSince < this.inactiveTileTimeout) return false; // Not old enough
                return true;
            });
            
            if (allChildrenPrunable) {
                // Delete all four children as a set
                children.forEach(child => {
                    // Clean up the tile
                    if (child.mesh) {
                        this.scene.remove(child.mesh);
                        // Dispose of geometry and material to free memory
                        if (child.mesh.geometry) child.mesh.geometry.dispose();
                        if (child.mesh.material) {
                            if (child.mesh.material.map) child.mesh.material.map.dispose();
                            child.mesh.material.dispose();
                        }
                    }
                    if (child.skirtMesh) {
                        this.scene.remove(child.skirtMesh);
                        if (child.skirtMesh.geometry) child.skirtMesh.geometry.dispose();
                        if (child.skirtMesh.material) child.skirtMesh.material.dispose();
                    }
                    
                    // Cancel any pending loads
                    child.cancelPendingLoads();
                    
                    // Remove from cache
                    this.deleteTile(child.x, child.y, child.z);
                    prunedCount++;
                });
            }
        });
        
        if (prunedCount > 0 && isLocal) {
            debugLog(`Pruned ${prunedCount} inactive tiles (${prunedCount / 4} sets of 4)`);
        }
    }

    /**
     * Calculate visibility and screen size for a tile
     */
    calculateTileVisibility(tile, camera) {
        const worldSphere = tile.getWorldSphere();
        let screenSize = 0;
        let visible = false;
        let actuallyVisible = false;

        // Check frustum intersection
        const frustumIntersects = camera.viewFrustum.intersectsSphere(worldSphere);
        
        if (frustumIntersects) {
            const radius = worldSphere.radius;
            const distance = camera.position.distanceTo(worldSphere.center);
            const cameraAltitude = altitudeAboveSphere(camera.position.clone());
            const closestDistance = Math.max(0, distance - radius);
            const horizon = distanceToHorizon(cameraAltitude);

            // Check if visible over horizon
            if (horizon > closestDistance || 
                hiddenByGlobe(cameraAltitude, closestDistance) <= tile.highestAltitude) {
                
                const fov = camera.getEffectiveFOV() * Math.PI / 180;
                const height = 2 * Math.tan(fov / 2) * distance;
                const screenFraction = (2 * radius) / height;
                screenSize = screenFraction * 1024;
                visible = true;
                actuallyVisible = true;
            }
        }

        // Force subdivision for first 3 zoom levels
        if (tile.z < 3) {
            screenSize = 10000000000;
            visible = true;
            // actuallyVisible remains unchanged - used for lazy loading
        }

        return { 
            screenSize, 
            visible, 
            actuallyVisible, 
            frustumIntersects 
        };
    }

    /**
     * Trigger lazy loading for tiles using parent data
     * This is called only for tiles that are actuallyVisible (not forced visible for subdivision)
     */
    triggerLazyLoadIfNeeded(tile, tileLayers) {
        // Only load if tile is using parent data, needs high-res, not currently loading, and active in this view
        const needsLoad = tile.usingParentData && 
                         tile.needsHighResLoad &&
                         !tile.isLoading && 
                         !tile.isCancelling &&
                         (tile.tileLayers & tileLayers);

        // Trigger high-res load if all conditions are met
        if (needsLoad) {
            tile.needsHighResLoad = false; // Clear flag to prevent repeated triggers
            const key = `${tile.z}/${tile.x}/${tile.y}`;

            const materialPromise = tile.applyMaterial().then(() => {
                tile.usingParentData = false; // Mark as using high-res data now
            }).catch(error => {
                // Reset flag to retry - whether it's an abort or real error
                tile.needsHighResLoad = true;
            });
            
            this.trackTileLoading(`${key}-highres`, materialPromise);
        }
    }

    /**
     * Determine if a tile should be subdivided
     */
    shouldSubdivideTile(tile, visibility, subdivideSize) {
        return visibility.visible && visibility.screenSize > subdivideSize;
    }

    /**
     * Subdivide a tile into 4 children
     */
    subdivideTile(tile, tileLayers, isTextureMap) {
        const useParentData = isTextureMap && tile.loaded;
        
        // Create 4 child tiles
        this.activateTile(tile.x * 2, tile.y * 2, tile.z + 1, tileLayers, useParentData);
        this.activateTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1, tileLayers, useParentData);
        this.activateTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1, tileLayers, useParentData);
        this.activateTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1, tileLayers, useParentData);

        // For texture maps: Deactivate parent if all children are loaded and added
        // (even if using parent data - that's valid for display, just lower quality)
        if (isTextureMap) {
            const children = this.getChildren(tile);
            if (children && children.every(child => child && child.loaded && child.added)) {
                this.deactivateTile(tile.x, tile.y, tile.z, tileLayers, true); // instant=true to hide parent immediately
            }
            // Otherwise parent stays active until children are ready
            // (deactivateParentsWithLoadedChildren will handle it on next frame)
        } else {
            // Elevation maps: always deactivate parent immediately
            this.deactivateTile(tile.x, tile.y, tile.z, tileLayers);
        }
    }

    /**
     * Merge children back to parent if they're all active in this view
     */
    mergeChildrenIfPossible(tile, tileLayers) {
        const children = this.getChildren(tile);
        if (!children) return;

        const allChildrenActiveInView = children.every(child => 
            child && (child.tileLayers & tileLayers)
        );

        if (allChildrenActiveInView) {
            this.activateTile(tile.x, tile.y, tile.z, tileLayers);
            children.forEach(child => {
                if (child) {
                    this.deactivateTile(child.x, child.y, child.z, tileLayers, true);
                }
            });
        }
    }

    /**
     * Check if tile has any children
     */
    hasAnyChildren(tile) {
        return this.getTile(tile.x * 2, tile.y * 2, tile.z + 1) !== undefined;
    }

    /**
     * Get all 4 children of a tile (returns null if any are missing)
     */
    getChildren(tile) {
        const child1 = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1);
        const child2 = this.getTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1);
        const child3 = this.getTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1);
        const child4 = this.getTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1);
        
        if (!child1 || !child2 || !child3 || !child4) return null;
        return [child1, child2, child3, child4];
    }

    // Set the layer mask on a tile's mesh objects
    setTileLayerMask(tile, layerMask) {
        if (tile.mesh) {
            tile.mesh.layers.disableAll();
            tile.mesh.layers.mask = layerMask;
        }
        if (tile.skirtMesh) {
            tile.skirtMesh.layers.disableAll();
            tile.skirtMesh.layers.mask = layerMask;
        }
    }


}




