import {wgs84} from "./LLA-ECEF-ENU";
import {Matrix4} from "three/src/math/Matrix4";
import {Frustum} from "three/src/math/Frustum";
import {debugLog} from "./Globals";
import {isLocal} from "./configUtils";
import {altitudeAboveSphere, distanceToHorizon, hiddenByGlobe} from "./SphericalMath";


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
        Object.values(this.tileCache).forEach(tile => {
            this.debugColor = color
            this.debugAltitude = altitude
            tile.buildDebugGeometry(this.debugColor, this.debugAltitude)
        })
    }

    removeDebugGrid() {
        Object.values(this.tileCache).forEach(tile => {
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
                    this.activateTile(x, y, this.zoom) // activate the tile
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
                this.activateTile(i, j, this.zoom) // activate the tile
            }
        }
    }


    // go through the tile cache and subdivide or merge each tile if needed
    // "needed" is based on the zoom level and the tile size on screen
    // passed in an array of views, from which we get the cameras and viewports sizes
    // we use multiple views to handle multiple cameras
    // this is used to dynamically subdivide tiles based on the camera views
    // so we account for ALL active camera (typically one or two)
    // different quadtrees (i.e. tesxtures and elevations) can have diferent subdivideSize
    // which is the screen size (of a bounding sphere) above which we start subdividing tiles
    subdivideTiles(views, subdivideSize  = 2000) {


        // debug counting and output to debugLog
        if (isLocal) {
            let totalTileCount = Object.keys(this.tileCache).length; // count of tiles in the cache
            let pendingLoads = 0; // count of pending loads
            let activeTileCount = 0; // count of active tiles
            let inactiveTileCount = 0; // count of inactive tiles

            for (const key in this.tileCache) {
                const tile = this.tileCache[key];

                if (tile.active) {
                    activeTileCount++;
                } else {
                    inactiveTileCount++;
                }

                if (tile.isLoading) {
                    pendingLoads++; // increment the pending load counter
                }
            }

            if (pendingLoads > 0) {
                debugLog(`Total Tiles: ${totalTileCount}, Active Tiles: ${activeTileCount}, Inactive Tiles: ${inactiveTileCount}, Pending Loads: ${pendingLoads}`);
            }
        }



        // get array of cameras from the views

        const cameras = views.map(view => view.cameraNode.camera);

        for (const camera of cameras) {
            camera.updateMatrixWorld();
            const frustum = new Frustum();
            frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(
                camera.projectionMatrix, camera.matrixWorldInverse
            ));
            camera.viewFrustum = frustum; // store the frustum in the camera for later use
        }
        //})


        // First pass: Check for parent tiles that can now be deactivated because their children are loaded
        // Only do this for texture maps, not elevation maps, since elevation tiles are used by texture tiles at different zoom levels
        if (this.constructor.name === 'QuadTreeMapTexture') {
            for (const key in this.tileCache) {
                const tile = this.tileCache[key];

                // Skip if tile is not active or doesn't have potential children
                if (!tile.active || tile.z >= this.maxZoom) continue;

                // Check if all four children exist and are loaded
                const child1 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2}`];
                const child2 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2 + 1}`];
                const child3 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2}`];
                const child4 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2 + 1}`];

                if (child1 && child2 && child3 && child4 &&
                    child1.active && child2.active && child3.active && child4.active &&
                    child1.loaded && child2.loaded && child3.loaded && child4.loaded) {
                    // All children are active and loaded, safe to deactivate parent texture tile
                    this.deactivateTile(tile.x, tile.y, tile.z);
                }
            }
        }

        // Second pass: go over the tile cache for subdivision/merging

        for (const key in this.tileCache) {
            const tile = this.tileCache[key];

            // if the tile is active, but not visible, then we can deactivate it
            // if it has a mesh and all the children are loaded
            if (tile.added && !tile.active && tile.mesh) {
                const child1 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2}`];
                const child2 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2 + 1}`];
                const child3 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2}`];
                const child4 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2 + 1}`];
                // if all four child tiles are loaded, then we can remove this tile from the scene
                if (child1 && child2 && child3 && child4 &&
                    child1.loaded && child2.loaded && child3.loaded && child4.loaded) {
                    this.scene.remove(tile.mesh); // remove the tile mesh from the scene
                    tile.added = false; // mark the tile as not added
                    this.refreshDebugGeometry(tile);
                }


            }

            if (!this.canSubdivide(tile)) {
                continue;
            }

            // we check two types of tiles:
            // 1. active tiles - these are tiles that are currently being displayed
            // 2. tiles that are not active, but have four active children

            let checkType = "none";
            if (tile.active) {
                checkType = "active";
            } else {
                // check if the tile has four active children
                const child1 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2}`];
                const child2 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2 + 1}`];
                const child3 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2}`];
                const child4 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2 + 1}`];

                if (child1 && child2 && child3 && child4 &&
                    child1.active && child2.active && child3.active && child4.active) {
                    checkType = "inactive";
                }
            }

            if (checkType === "none") {
                continue; // skip tiles that are not active and don't have active children
            }

            // the tile of the world sphere is used to
            // 1) determine visibility
            // 2) calculate the size of the tile on screen (using the radius and distance)
            let worldSphere = tile.getWorldSphere();

            let screenSize = 0;           // largest size on screen in pixels
            let largestVisible = false;   // true if the tile is visible in the camera that gives the largest screen size
            for (const camera of cameras) {

                // First check the frustum intersection with the tile's world sphere
                // this gives us a ROUGH (but conservative) estimate of whether the tile is visible
                if (camera.viewFrustum.intersectsSphere(worldSphere)) {
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
                        const thisScreenSize = screenFraction * 1024; // DUMMY: assume 1024 is the screen size in pixels, this should be configurable

                        if (thisScreenSize > screenSize) {


                            largestVisible = true;
                            screenSize = thisScreenSize; // take the largest screen size from all cameras

                            // if (this.constructor.name === 'QuadTreeMapTexture') {
                            //     DebugSphere("Subdivider", worldSphere.center.clone(), radius, "#ff0000", undefined, undefined, true)
                            // }

                        }
                    }
                }
            }


            if (tile.z < 3) {
                screenSize = 10000000000; // force subdivision of first three
                largestVisible = true; // force subdivision of first three
            }


            // if the screen size is too big , subdivide the tile if visible
            if (largestVisible && tile.active && tile.z < this.maxZoom && screenSize > subdivideSize) {

                //   console.log("Subdividing tile", key, "screenSize:", screenSize, "subdivideSize:", subdivideSize, "fov:", fov, "distance:", distance);

                this.activateTile(tile.x * 2, tile.y * 2, tile.z + 1); // activate the child tile
                this.activateTile(tile.x * 2, tile.y * 2 + 1, tile.z + 1); // activate the child tile
                this.activateTile(tile.x * 2 + 1, tile.y * 2, tile.z + 1); // activate the child tile
                this.activateTile(tile.x * 2 + 1, tile.y * 2 + 1, tile.z + 1); // activate the child tile

                // Only deactivate parent if all children are loaded to prevent gaps in coverage
                if (this.constructor.name === 'QuadTreeMapTexture') {




                    const child1 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2}`];
                    const child2 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2 + 1}`];
                    const child3 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2}`];
                    const child4 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2 + 1}`];

                    if (child1 && child2 && child3 && child4 &&
                        child1.loaded && child2.loaded && child3.loaded && child4.loaded) {
                        this.deactivateTile(tile.x, tile.y, tile.z); // deactivate parent texture tile only when children are ready
                    }
                } else {
                    // original logic for elevation tiles
                    this.deactivateTile(tile.x, tile.y, tile.z); // deactivate this tile
                }


               // return; // just doing one tile at a time, might want to change this later
            }

            if (!tile.active && (!largestVisible || screenSize <= subdivideSize)) {
                // if the tile is inactive and the screen size is small enough, merge the tile
                // we will merge the children tiles into this tile
                // but only if they are all active
                const child1 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2}`];
                const child2 = this.tileCache[`${tile.z + 1}/${tile.x * 2}/${tile.y * 2 + 1}`];
                const child3 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2}`];
                const child4 = this.tileCache[`${tile.z + 1}/${tile.x * 2 + 1}/${tile.y * 2 + 1}`];


                if (child1 && child2 && child3 && child4 &&
                    child1.active && child2.active && child3.active && child4.active) {

                    //    console.log("Merging tile", key, "screenSize:", screenSize, "subdivideSize:", subdivideSize, "fov:", fov, "distance:", distance);

                    // merge the children into this tile
                    this.activateTile(tile.x, tile.y, tile.z); // activate this tile
                    this.deactivateTile(child1.x, child1.y, child1.z, true); // deactivate the child tile
                    this.deactivateTile(child2.x, child2.y, child2.z, true); // deactivate the child tile
                    this.deactivateTile(child3.x, child3.y, child3.z, true); // deactivate the child tile
                    this.deactivateTile(child4.x, child4.y, child4.z, true); // deactivate the child tile

                    // we can do  more, as this is a lightweight operation
                    // return;
                }
            }


        }


    }


}




