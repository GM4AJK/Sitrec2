import {LLAToEUS, wgs84} from "./LLA-ECEF-ENU";
import {assert} from "./assert";
import {QuadTreeTile} from "./QuadTreeTile";
import {QuadTreeMap} from "./QuadTreeMap";

class QuadTreeMapTexture extends QuadTreeMap {
    constructor(scene, terrainNode, geoLocation, options = {}) {

        super(terrainNode, geoLocation, options)

        this.scene = scene; // the scene to add the tiles to
        this.dynamic = options.dynamic ?? false; // if true, use dynamic tile loading

        this.elOnly = options.elOnly ?? false;
        this.elevationMap = options.elevationMap;

        // Track loading promises to properly call loadedCallback when all tiles are loaded
        // This only makes sense if not dynamic
        this.pendingTileLoads = new Set();

        // this.initTilePositions(this.options.deferLoad) // now in super

        this.initTiles();
        
        // Call loadedCallback when all initial tiles have finished loading their materials
        if (this.loadedCallback) {
            // Use setTimeout to allow initTiles() to complete and any initial tiles to be created
            setTimeout(() => {
                this.checkAndCallLoadedCallback();
            }, 0);
        }


    }

    // Check if all tiles have finished loading and call the loadedCallback if so
    checkAndCallLoadedCallback() {
        // If there are no pending tile loads and we haven't called the callback yet
        if (this.pendingTileLoads.size === 0 && !this.loaded && this.loadedCallback) {
            this.loaded = true;
            this.loadedCallback();
        }
    }

    // Track a tile's loading promise
    trackTileLoading(tileKey, promise) {
        // Only track loading if we haven't already called the loaded callback
        if (!this.loaded) {
            this.pendingTileLoads.add(tileKey);
            
            promise.finally(() => {
                this.pendingTileLoads.delete(tileKey);
                this.checkAndCallLoadedCallback();
            });
        }
        
        return promise;
    }

    canSubdivide(tile) {
        return (tile.mesh !== undefined && tile.mesh.geometry !== undefined)
    }


    // generate the geometry for all tiles in the tile cache
    // note this does not load the textures, just generates the geometry
    // so initially we get wireframe tiles
    generateTileGeometry() {
        Object.values(this.tileCache).forEach(tile => {
            tile.buildGeometry()
            tile.buildMesh()
            tile.setPosition(this.center)
            tile.recalculateCurve(wgs84.RADIUS)
            this.scene.add(tile.mesh)
            tile.active = true; // mark the tile as active
        })
    }


    // startLoadingTiles() {
    //
    //     // for each tile call applyMaterial
    //     // that will asynchronously fetch the map tile then apply the material to the mesh
    //
    //     Object.values(this.tileCache).forEach(tile => {
    //         tile.applyMaterial()
    //     })
    //
    //     // not really loaded, this is a patch.
    //     // really would need to collate the promises from applyMaterial and then await them.
    //     if (this.loadedCallback) {
    //         // wait a loop and call the callback
    //         setTimeout(() => {
    //             this.loadedCallback();
    //             this.loaded = true;
    //         }, 0) // execute after the current event loop
    //     }
    // }

    recalculateCurveMap(radius, force = false) {

        if (!force && radius == this.radius) {
            console.log('map33 recalculateCurveMap Radius is the same - no need to recalculate, radius = ' + radius);
            return;
        }

        if (!this.loaded) {
            console.error('Map not loaded yet - only call recalculateCurveMap after loadedCallback')
            return;
        }
        this.radius = radius
        Object.values(this.tileCache).forEach(tile => {
            tile.recalculateCurve(radius)
        })
    }


    clean() {
        console.log("QuadTreeMap clean()");

        // abort the pending loading of tiles
        this.controller.abort();

        Object.values(this.tileCache).forEach(tile => {
            tile.removeDebugGeometry(); // any debug arrows, etc
            if (tile.mesh !== undefined) {
                this.scene.remove(tile.mesh)
                tile.mesh.geometry.dispose();
                if (tile.mesh.material.uniforms !== undefined) {
                    assert(tile.mesh.material.uniforms !== undefined, 'Uniforms not defined');

                    ['mapSW', 'mapNW', 'mapSE', 'mapNE'].forEach(key => {
                        tile.mesh.material.uniforms[key].value.dispose();
                    });

                }

                tile.mesh.material.dispose()
            }
        })
        this.tileCache = {}
        this.pendingTileLoads.clear(); // Clear pending loads when cleaning up
        this.loaded = false; // Reset loaded state
        this.scene = null; // MICK - added to help with memory management
    }

    // interpolate the elevation at a lat/lon
    // does not handle interpolating between tiles (i.e. crossing tile boundaries)
    getElevationInterpolated(lat, lon, desiredZoom = null) {

        if (!this.elevationMap) {
            console.warn("No elevation map available for interpolation");
            return 0; // default to sea level if no elevation map
        }

        return this.elevationMap.getElevationInterpolated(lat, lon, desiredZoom);
    }


    deactivateTile(x, y, z, instant = false) {
        const key = `${z}/${x}/${y}`;
        let tile = this.tileCache[key];
        if (tile === undefined) {
            return;
        }
        if (tile.active) {
//      console.log("Deactivating tile", key, "from cache");
            tile.active = false; // mark the tile as inactive

            if (instant) {
                // remove the tile immediately
                this.scene.remove(tile.mesh);

            }


            //   removeDebugSphere(key)
        }
    }

    // if tile exists, activate it, otherwise create it
    activateTile(x, y, z) {
        const key = `${z}/${x}/${y}`;
        let tile = this.tileCache[key];
        if (tile) {
            if (tile.active) {
                // tile is already activated, do nothing
                return;
            }
            // tile already exists, just activate it
            // maybe later rebuild a mesh if we unloaded it
//      console.log("Activating tile", key, "already exists in cache");
            this.scene.add(tile.mesh); // add the mesh to the scene
            tile.added = true; // mark the tile as added to the scene
            this.refreshDebugGeometry(tile); // Update debug geometry for reactivated tiles
        } else {
            // create a new tile
//        console.log("Creating new tile", key);
            tile = new QuadTreeTile(this, z, x, y);

            tile.buildGeometry();
            tile.buildMesh();

            // calculate the LLA position of the center of the tile
            const lat1 = this.options.mapProjection.getNorthLatitude(tile.y, tile.z);
            const lon1 = this.options.mapProjection.getLeftLongitude(tile.x, tile.z);
            const lat2 = this.options.mapProjection.getNorthLatitude(tile.y + 1, tile.z);
            const lon2 = this.options.mapProjection.getLeftLongitude(tile.x + 1, tile.z);
            const lat = (lat1 + lat2) / 2;
            const lon = (lon1 + lon2) / 2;
            const center = LLAToEUS(lat, lon, 0);

            tile.setPosition(center); // ???
            tile.recalculateCurve(wgs84.RADIUS)
            this.tileCache[key] = tile;

            // Track the async texture loading
            const materialPromise = tile.applyMaterial().catch(error => {
                console.error(`Failed to load texture for tile ${key}:`, error);
                // Tile will remain with wireframe material if texture loading fails
            });
            
            // Track this tile's loading promise
            this.trackTileLoading(key, materialPromise);
            this.refreshDebugGeometry(tile);


        }

        // if (tile.z === 6)
        //   DebugSphere(`Tile ${key}`, tile.mesh.position, tile.mesh.geometry.boundingSphere.radius, "#ff0000", GlobalScene,LAYER.MASK_HELPERS , true)

        tile.active = true;
        assert(this.scene !== undefined, 'Scene is undefined in QuadTreeMapTexture.activateTile');
        return tile;
    }


}

export {QuadTreeMapTexture};