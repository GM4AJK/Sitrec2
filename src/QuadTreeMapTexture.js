import {LLAToEUS} from "./LLA-ECEF-ENU";
import {QuadTreeTile} from "./QuadTreeTile";
import {QuadTreeMap} from "./QuadTreeMap";
import {setRenderOne} from "./Globals";
import {showError} from "./showError";
import {CanvasTexture} from "three/src/textures/CanvasTexture";
import {NearestFilter} from "three/src/constants";
import {createTerrainDayNightMaterial} from "./js/map33/material/TerrainDayNightMaterial";

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
            this.loadedCallbackTimeout = setTimeout(() => {
                this.checkAndCallLoadedCallback();
            }, 0);
        }


    }

    // Check if all tiles have finished loading and call the loadedCallback if so
    checkAndCallLoadedCallback() {
        // If there are no pending tile loads and we haven't called the callback yet
        // Also check that the map hasn't been cleaned up (scene would be null)
        if (this.pendingTileLoads.size === 0 && !this.loaded && this.loadedCallback && this.scene !== null) {
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
            showError('Map not loaded yet - only call recalculateCurveMap after loadedCallback')
            return;
        }
        this.radius = radius
        // Fire off all tile normal calculations in background (non-blocking)
        const promises = this.getAllTiles().map(tile => 
            tile.recalculateCurve(radius).catch(error => {
                console.warn(`Failed to recalculate curve for tile ${tile.key()}:`, error);
            })
        );
        setRenderOne(true);
    }


    clean() {
        console.log("QuadTreeMap clean()");

        // abort the pending loading of tiles
        this.controller.abort();
        
        // Cancel any pending loadedCallback timeout
        if (this.loadedCallbackTimeout) {
            clearTimeout(this.loadedCallbackTimeout);
            this.loadedCallbackTimeout = null;
        }

        this.getAllTiles().forEach(tile => {
            tile.removeDebugGeometry(); // any debug arrows, etc
            // Abort any in-flight elevation computations on individual tiles
            if (tile.elevationAbortController) {
                tile.elevationAbortController.abort();
            }
            if (tile.mesh !== undefined) {
                this.scene.remove(tile.mesh)
                tile.mesh.geometry.dispose();
                
                // Dispose the texture if it exists
                if (tile.mesh.material.uniforms?.map?.value) {
                    tile.mesh.material.uniforms.map.value.dispose();
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
        let tile = this.getTile(x, y, z);
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


        if (instant) {
            // defer updating the mesh mask.
            // if all the children are loaded, then the parent will be updated automatically
            // (this will be called again from the "first pass" code in subdivideTiles)
            this.setTileLayerMask(tile, tile.tileLayers);
        }

        // If tile is no longer active in any view, cancel any pending loads and mark timestamp
        if (tile.tileLayers === 0) {
            tile.cancelPendingLoads();
            // Track when tile became inactive for pruning purposes
            if (!tile.inactiveSince) {
                tile.inactiveSince = Date.now();
            }
        }

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
    activateTile(x, y, z, layerMask = 0, useParentData = false) {
//        console.log(`activateTile Texture ${z}/${x}/${y} layerMask=${layerMask} useParentData=${useParentData} maxZoom=${this.maxZoom}`);
        
        // Don't create tiles beyond the effective max zoom (considering maxDetails)
        const effectiveMaxZoom = this.getEffectiveMaxZoom();
        if (z > effectiveMaxZoom) {
            return null;
        }
        
        let tile = this.getTile(x, y, z);


        if (tile) {
            // Don't activate tile if it's currently being cancelled - let the system retry later
            if (tile.isCancelling) {
                return false;
            }
            
            // tile already exists, just activate it
            // maybe later rebuild a mesh if we unloaded it

            // Combine the new layer mask with existing layers (don't overwrite)
            if (layerMask > 0) {
                tile.tileLayers = (tile.tileLayers || 0) | layerMask;
                
                // If tile was deactivated (tileLayers was 0), re-add to scene
                if (!tile.added) {
                    this.scene.add(tile.mesh); // add the mesh to the scene
                    if (tile.skirtMesh) {
                        this.scene.add(tile.skirtMesh); // add the skirt mesh to the scene
                    }
                    tile.added = true; // mark the tile as added to the scene
                }
            } else {
                // layerMask=0 means load tile data but don't make it visible (e.g., for ancestor tiles)
                tile.tileLayers = 0;
            }
            
            // Clear inactive timestamp since tile is now active
            tile.inactiveSince = undefined;

            // Update the actual layer mask on the tile
            if (tile.mesh) {
                this.setTileLayerMask(tile, tile.tileLayers);
            }
            
            // Check if the tile needs its texture loaded (e.g., if it was aborted previously)
            if (tile.mesh?.material?.wireframe && 
                tile.textureUrl() && !tile.isLoading && !tile.isCancelling) {
//                console.log(`Reactivated tile ${tile.key()} needs texture loading`);
                const key = `${z}/${x}/${y}`;
                const materialPromise = tile.applyMaterial().catch(error => {
                    // Don't log abort errors or cancellation errors - they're expected when tiles are cancelled
                    if (error.message !== 'Aborted' && error.message !== 'Tile is being cancelled') {
                        showError(`Failed to load texture for reactivated tile ${key}:`, error);
                    }
                });
                this.trackTileLoading(`${key}-reactivated`, materialPromise);
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
//        console.log(`activateTile: ${key} - layerMask=${layerMask}, existing tileLayers=${tile.tileLayers}`);
        if (layerMask > 0) {
            // OR the new layer mask with existing layers to support multiple views
            tile.tileLayers = (tile.tileLayers || 0) | layerMask;
     //       console.log(`activateTile: ${key} - set tileLayers to ${tile.tileLayers.toString(2)} (${tile.tileLayers}) via layerMask`);
        } else {
            // layerMask=0 means load tile data but don't make it visible (e.g., for ancestor tiles)
            tile.tileLayers = 0;
     //       console.log(`activateTile: ${key} - set tileLayers to ${tile.tileLayers.toString(2)} (${tile.tileLayers}) via layerMask=0`);
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
        // Fire off normal calculation in background (non-blocking)
        tile.recalculateCurve().catch(error => {
            console.warn(`Failed to recalculate curve for tile ${z}/${x}/${y}:`, error);
        });
        this.setTile(x, y, z, tile);
        
        // Set up parent relationship in tree structure
        const parent = this.getParent(tile);
        if (parent) {
            tile.parent = parent;
            // Note: children array is set up in subdivideTile when all 4 children are created
        }

        const key = `${z}/${x}/${y}`;

        // If z is below minZoom, create a dummy tile with black texture
        if (z < this.minZoom) {
            // Create a black texture
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, 256, 256);
            
            const blackTexture = new CanvasTexture(canvas);
            blackTexture.minFilter = NearestFilter;
            blackTexture.magFilter = NearestFilter;
            
            // Use the same shader material as regular tiles for consistency
            const material = createTerrainDayNightMaterial(blackTexture, 0.3);
            
            tile.mesh.material = material;
            tile.updateSkirtMaterial();
            tile.loaded = true;
            
            // Add to scene immediately
            this.scene.add(tile.mesh);
            if (tile.skirtMesh) {
                this.scene.add(tile.skirtMesh);
            }
            tile.added = true;
            
            this.refreshDebugGeometry(tile);
            setRenderOne(true);
            return tile;
        }

        // If z is above maxZoom, try to create tile from ancestor data at maxZoom
        if (z > this.maxZoom) {
            // Calculate which tile at maxZoom would contain this tile
            const zoomDiff = z - this.maxZoom;
            const scale = Math.pow(2, zoomDiff);
            const ancestorX = Math.floor(x / scale);
            const ancestorY = Math.floor(y / scale);
            const ancestorZ = this.maxZoom;
            
            // Check if the ancestor tile at maxZoom exists and is loaded
            let ancestorTile = this.getTile(ancestorX, ancestorY, ancestorZ);
            
            // If ancestor doesn't exist or isn't loaded yet, force-load it
            if (!ancestorTile || !ancestorTile.loaded || 
                !ancestorTile.mesh?.material?.map || ancestorTile.mesh.material.wireframe) {
                
                // Activate the ancestor tile to trigger loading (if it doesn't exist)
                // Pass layerMask=0 so ancestor is loaded but NOT visible in the scene
                if (!ancestorTile) {
                    ancestorTile = this.activateTile(ancestorX, ancestorY, ancestorZ, 0, false);
                }
                
                // If ancestor is still loading, mark this tile as pending and return
                // The tile will be reactivated once the ancestor loads
                if (!ancestorTile.loaded || !ancestorTile.mesh?.material?.map || 
                    ancestorTile.mesh.material.wireframe) {
                    
                    // Mark tile as pending ancestor load
                    tile.pendingAncestorLoad = true;
                    tile.ancestorTileKey = `${ancestorZ}/${ancestorX}/${ancestorY}`;
                    
                    // Set up a callback to retry once ancestor loads
                    // We'll check periodically or use a promise-based approach
                    const checkAncestorLoaded = () => {
                        const loadedAncestor = this.getTile(ancestorX, ancestorY, ancestorZ);
                        if (loadedAncestor && loadedAncestor.loaded && 
                            loadedAncestor.mesh?.material?.map && 
                            !loadedAncestor.mesh.material.wireframe) {
                            
                            // Ancestor is now loaded, extract texture and update this tile
                            const currentTile = this.getTile(x, y, z);
                            if (currentTile && currentTile.pendingAncestorLoad) {
                                const ancestorMaterial = currentTile.buildMaterialFromAncestor(loadedAncestor);
                                if (ancestorMaterial) {
                                    // Dispose old wireframe material
                                    if (currentTile.mesh.material) {
                                        currentTile.mesh.material.dispose();
                                    }
                                    
                                    // Apply new material from ancestor
                                    currentTile.mesh.material = ancestorMaterial;
                                    currentTile.updateSkirtMaterial();
                                    currentTile.usingParentData = true;
                                    currentTile.loaded = true;
                                    currentTile.pendingAncestorLoad = false;
                                    
                                    this.refreshDebugGeometry(currentTile);
                                    setRenderOne(true);
                                }
                            }
                        }
                    };
                    
                    // If ancestor has a loading promise, wait for it
                    if (ancestorTile.isLoading) {
                        // Poll for completion (simple approach)
                        const pollInterval = setInterval(() => {
                            if (!ancestorTile.isLoading) {
                                clearInterval(pollInterval);
                                checkAncestorLoaded();
                            }
                        }, 100);
                        
                        // Timeout after 10 seconds to prevent infinite polling
                        setTimeout(() => clearInterval(pollInterval), 10000);
                    }
                    
                    // Add tile to scene with wireframe material as placeholder
                    // This ensures the tile occupies space and old tiles are properly replaced
                    tile.updateWireframeMaterial();
                    tile.loaded = false; // Mark as not fully loaded
                    
                    this.scene.add(tile.mesh);
                    if (tile.skirtMesh) {
                        this.scene.add(tile.skirtMesh);
                    }
                    tile.added = true;
                    
                    this.refreshDebugGeometry(tile);
                    setRenderOne(true);
                    return tile;
                }
            }
            
            // Ancestor is loaded, try to extract texture from it
            if (ancestorTile && ancestorTile.mesh && ancestorTile.mesh.material && 
                ancestorTile.mesh.material.map && !ancestorTile.mesh.material.wireframe) {
                // Extract texture from ancestor tile
                const ancestorMaterial = tile.buildMaterialFromAncestor(ancestorTile);
                if (ancestorMaterial) {
                    tile.mesh.material = ancestorMaterial;
                    tile.updateSkirtMaterial();
                    tile.usingParentData = true; // Mark as using ancestor data
                    tile.loaded = true;
                    
                    // Add to scene immediately
                    this.scene.add(tile.mesh);
                    if (tile.skirtMesh) {
                        this.scene.add(tile.skirtMesh);
                    }
                    tile.added = true;
                    
                    this.refreshDebugGeometry(tile);
                    setRenderOne(true);
                    return tile;
                }
            }
            
            // Fallback: If we still can't get ancestor data, add tile with wireframe
            // This ensures the tile occupies space and old tiles are properly replaced
            tile.pendingAncestorLoad = true;
            tile.updateWireframeMaterial();
            tile.loaded = false;
            
            this.scene.add(tile.mesh);
            if (tile.skirtMesh) {
                this.scene.add(tile.skirtMesh);
            }
            tile.added = true;
            
            this.refreshDebugGeometry(tile);
            setRenderOne(true);
            return tile;
        }

        // LAZY LOADING: Try to create child tile using parent's texture data
        // This allows child tiles to appear instantly with lower-quality parent texture,
        // then upgrade to high-res later when visible (via triggerLazyLoadIfNeeded)
        if (useParentData && z > 0) {
            const parentTile = tile.parent;
            
            // Verify parent has a loaded texture that we can extract data from
            // Requirements:
            // 1. Parent tile exists and has a mesh with material
            // 2. Material has a texture map (material.map)
            // 3. Material is not wireframe (texture has actually loaded, not placeholder)
            //
            // This check is critical for the race condition fix - it ensures we only
            // attempt to use parent data when the parent texture is actually available.
            // The deferred subdivision logic in subdivideTiles() ensures this is true.
            if (parentTile && parentTile.mesh && parentTile.mesh.material && 
                parentTile.mesh.material.map && !parentTile.mesh.material.wireframe) {
                // Extract and downsample parent texture for this child tile
                const parentMaterial = tile.buildMaterialFromParent(parentTile);
                if (parentMaterial) {
                    tile.mesh.material = parentMaterial;
                    tile.updateSkirtMaterial();
                    tile.usingParentData = true;
                    tile.needsHighResLoad = true; // Mark for high-res loading when visible
                    tile.loaded = true; // Consider it "loaded" with parent data
                    
                    // Add to scene immediately - no waiting for texture load!
                    this.scene.add(tile.mesh);
                    if (tile.skirtMesh) {
                        this.scene.add(tile.skirtMesh);
                    }
                    tile.added = true;
                    
                    this.refreshDebugGeometry(tile);
                    setRenderOne(true);
                    return tile;
                }
            }
            // If parent data not available, fall through to normal loading path
        }

        // Track the async texture loading (normal path or fallback if parent data unavailable)
        const materialPromise = tile.applyMaterial().catch(error => {
            // Don't log abort errors or cancellation errors - they're expected when tiles are cancelled
            if (error.message !== 'Aborted' && error.message !== 'Tile is being cancelled') {
                showError(`Failed to load texture for tile ${key}:`, error);
            } else if (error.message === 'Aborted') {
                // Check if the tile is active again - this should now be rare since we prevent reactivation during cancellation
                if (tile.tileLayers > 0) {
                    showError(`Tile ${key} ABORTED load texture but is still active - this should not happen with the new prevention logic.`);
                }
            }
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