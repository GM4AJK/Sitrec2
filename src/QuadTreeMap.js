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
    subdivideTiles(view, subdivideSize = 2000) {


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
            });

            if (pendingLoads > 0) {
                debugLog(`[${view.id || 'View'}] Total Tiles: ${totalTileCount}, Active Tiles: ${activeTileCount}, Inactive Tiles: ${inactiveTileCount}, Pending Loads: ${pendingLoads}`);
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


            if (tile.z < 3) {
                thisViewScreenSize = 10000000000; // force subdivision of first three
                thisViewVisible = true; // force visibility for first three zoom levels
            }


            // Check if this view needs subdivision
            let shouldSubdivide = false;

            // it needs to be both visible and large
            if (thisViewVisible && thisViewScreenSize > subdivideSize) {
                shouldSubdivide = true;
            }

            // if this view needs subdivision, create child tiles with appropriate layer masks
            if (shouldSubdivide && (tile.tileLayers & tileLayers) && tile.z < this.maxZoom) {

                this.activateTile(tile.x * 2, tile.y * 2, tile.z + 1, tileLayers); // activate the child tile
                this.activateTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1, tileLayers); // activate the child tile
                this.activateTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1, tileLayers); // activate the child tile
                this.activateTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1, tileLayers); // activate the child tile

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
            if (!(tile.tileLayers & tileLayers) && !shouldSubdivide) {
                // if the tile is inactive in this view and the screen size is small enough, merge the tile
                // we will merge the children tiles into this tile
                // but only if they are all active in this view
                const child1 = this.getTile(tile.x * 2, tile.y * 2, tile.z + 1);
                const child2 = this.getTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1);
                const child3 = this.getTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1);
                const child4 = this.getTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1);


                if (child1 && child2 && child3 && child4 &&
                    (child1.tileLayers & tileLayers) && (child2.tileLayers & tileLayers) &&
                    (child3.tileLayers & tileLayers) && (child4.tileLayers & tileLayers)) {


                    // merge the children into this tile
                    // since we have childern, we know that activating the tile will be instant as the material will be loaded
                    this.activateTile(tile.x, tile.y, tile.z, tileLayers); // activate this parent tile
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




