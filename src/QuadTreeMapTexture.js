import {LLAToEUS, wgs84} from "./LLA-ECEF-ENU";
import {assert} from "./assert";
import {QuadTreeTile} from "./QuadTreeTile";
import {QuadTreeMap} from "./QuadTreeMap";
import {setRenderOne} from "./Globals";
import * as LAYER from "./LayerMasks";

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
        setRenderOne(true);
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
            
            // Clean up skirt mesh
            if (tile.skirtMesh !== undefined) {
                this.scene.remove(tile.skirtMesh);
                tile.skirtMesh.geometry.dispose();
                // Note: skirtMaterial is shared, so we don't dispose it here
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


    deactivateTile(x, y, z, layerMask = 0, instant = false) {

        const key = `${z}/${x}/${y}`;
        let tile = this.tileCache[key];
        if (tile === undefined) {
            return;
        }
        
        // If no specific layer mask provided, clear all layers (backward compatibility)
        if (layerMask === 0) {
            tile.tileLayers = 0;
        } else {
            // Clear only the specified layer bits using bitwise AND with NOT mask
            tile.tileLayers = tile.tileLayers & (~layerMask);
        }
        this.setTileLayerMask(tile, tile.tileLayers);

        if (instant && tile.tileLayers === 0) {
            // remove the tile immediately (if inactive in all views)
            this.scene.remove(tile.mesh);
            if (tile.skirtMesh) {
                this.scene.remove(tile.skirtMesh);
            }
            tile.added = false;
        }

        //   removeDebugSphere(key)
    }

    // if tile exists, activate it, otherwise create it
    activateTile(x, y, z, layerMask = 0) {
        const key = `${z}/${x}/${y}`;
        let tile = this.tileCache[key];


        if (tile) {
            // tile already exists, just activate it
            // maybe later rebuild a mesh if we unloaded it

            if (tile.tileLayers === 0) {
                // Tile was deactivated, re-add to scene
                this.scene.add(tile.mesh); // add the mesh to the scene
                if (tile.skirtMesh) {
                    this.scene.add(tile.skirtMesh); // add the skirt mesh to the scene
                }
                tile.added = true; // mark the tile as added to the scene
            }
            
            // Combine the new layer mask with existing layers (don't overwrite)
            if (layerMask > 0) {
                tile.tileLayers = (tile.tileLayers || 0) | layerMask;
            } else {
                // Default case: activate for all layers
                tile.tileLayers = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
            }

            // Update the actual layer mask on the tile
            if (tile.mesh) {
                this.setTileLayerMask(tile, tile.tileLayers);
            }
            
            this.refreshDebugGeometry(tile); // Update debug geometry for reactivated tiles
            setRenderOne(true);
            return tile;
        }

        // create a new tile
        tile = new QuadTreeTile(this, z, x, y);

        tile.buildGeometry();
        tile.buildMesh();

        // Set the tile's layer mask BEFORE applying material to ensure it's available in addAfterLoaded()
        console.log(`activateTile: ${key} - layerMask=${layerMask}, existing tileLayers=${tile.tileLayers}`);
        if (layerMask > 0) {
            // OR the new layer mask with existing layers to support multiple views
            tile.tileLayers = (tile.tileLayers || 0) | layerMask;
            console.log(`activateTile: ${key} - set tileLayers to ${tile.tileLayers.toString(2)} (${tile.tileLayers}) via layerMask`);
        } else {
            // Default case: activate for all layers
            tile.tileLayers = LAYER.MASK_MAIN | LAYER.MASK_LOOK;
            console.log(`activateTile: ${key} - set tileLayers to ${tile.tileLayers.toString(2)} (${tile.tileLayers}) via default`);
        }

        // Apply the layer mask to the tile's mesh objects immediately
        this.setTileLayerMask(tile, tile.tileLayers);

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
        setRenderOne(true);

        return tile;
    }


}

export {QuadTreeMapTexture};