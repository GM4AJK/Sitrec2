import {assert} from "./assert";
import {boxMark, DebugArrowAB, removeDebugArrow} from "./threeExt";
import {LLAToEUS} from "./LLA-ECEF-ENU";
import {GlobalScene} from "./LocalFrame";
import {pointOnSphereBelow} from "./SphericalMath";
import {loadTextureWithRetries} from "./js/map33/material/QuadTextureMaterial";
import {convertTIFFToElevationArray} from "./TIFFUtils";
import {fromArrayBuffer} from 'geotiff';
import {getPixels} from "./js/get-pixels-mick";
import {MeshBasicMaterial} from "three/src/materials/MeshBasicMaterial";
import {PlaneGeometry} from "three/src/geometries/PlaneGeometry";
import {Mesh} from "three/src/objects/Mesh";
import {MeshStandardMaterial} from "three/src/materials/MeshStandardMaterial";
import {Sphere} from "three/src/math/Sphere";
import {CanvasTexture} from "three/src/textures/CanvasTexture";
import {NearestFilter} from "three/src/constants";

const tileMaterial = new MeshBasicMaterial({wireframe: true, color: "#408020"})

// Static cache for materials to avoid loading the same texture multiple times
const materialCache = new Map();

export class QuadTreeTile {
    constructor(map, z, x, y, size) {
        // check values are within range
        assert(z >= 0 && z <= 20, 'z is out of range, z=' + z)
        //   assert(x >= 0 && x < Math.pow(2, z), 'x is out of range, x='+x)
        assert(y >= 0 && y < Math.pow(2, z), 'y is out of range, y=' + y)

        this.map = map
        this.z = z
        this.x = x
        this.y = y
        this.size = size || this.map.options.tileSize
        //   this.elevationURLString = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"
        this.shape = null
        this.elevation = null
        this.seamX = false
        this.seamY = false
        this.loaded = false // Track if this tile has finished loading
        this.isLoading = false // Track if this tile is currently loading textures
        this.isLoadingElevation = false // Track if this tile is currently loading elevation data
        this.highestAltitude = 0;
    }


    getWorldSphere() {

        if (this.worldSphere !== undefined) {
            return this.worldSphere;
        }

        const xTile = this.x;
        const yTile = this.y;
        const zoomTile = this.z;

        const latSW = this.map.options.mapProjection.getNorthLatitude(yTile, zoomTile);
        const lonSW = this.map.options.mapProjection.getLeftLongitude(xTile, zoomTile);
        const latNW = this.map.options.mapProjection.getNorthLatitude(yTile + 1, zoomTile);
        const lonNW = this.map.options.mapProjection.getLeftLongitude(xTile, zoomTile);
        const latSE = this.map.options.mapProjection.getNorthLatitude(yTile, zoomTile);
        const lonSE = this.map.options.mapProjection.getLeftLongitude(xTile + 1, zoomTile);
        const latNE = this.map.options.mapProjection.getNorthLatitude(yTile + 1, zoomTile);
        const lonNE = this.map.options.mapProjection.getLeftLongitude(xTile + 1, zoomTile);

        // convert to EUS
        const alt = 0;
        const vertexSW = LLAToEUS(latSW, lonSW, alt)
        const vertexNW = LLAToEUS(latNW, lonNW, alt)
        const vertexSE = LLAToEUS(latSE, lonSE, alt)
        const vertexNE = LLAToEUS(latNE, lonNE, alt)

        // find the center of the tile
        const center = vertexSW.clone().add(vertexNW).add(vertexSE).add(vertexNE).multiplyScalar(0.25);

        // find the largest distance from the center to any corner
        const radius = Math.max(
            center.distanceTo(vertexSW),
            center.distanceTo(vertexNW),
            center.distanceTo(vertexSE),
            center.distanceTo(vertexNE)
        )

        // create a bounding sphere centered at the center of the tile with the radius
        this.worldSphere = new Sphere(center, radius);
        return this.worldSphere;

        // if (!tile.mesh.geometry.boundingSphere) {
        //     tile.mesh.geometry.computeBoundingSphere();
        // }
        // const worldSphere = tile.mesh.geometry.boundingSphere.clone();
        // worldSphere.applyMatrix4(tile.mesh.matrixWorld);
        // return worldSphere;
    }


    // The "key" is portion of the URL that identifies the tile
    // in the form of "z/x/y"
    // where z is the zoom level, and x and y are the horizontal
    // (E->W) and vertical (N->S) tile positions
    // it's used here as a key to the tileCache
    key() {
        return `${this.z}/${this.x}/${this.y}`
    }

    // Neighbouring tiles are used to resolve seams between tiles
    keyNeighX() {
        return `${this.z}/${this.x + 1}/${this.y}`
    }

    keyNeighY() {
        return `${this.z}/${this.x}/${this.y + 1}`
    }

    elevationURL() {
        return this.map.terrainNode.elevationURLDirect(this.z, this.x, this.y)

    }

    textureUrl() {
        return this.map.terrainNode.textureURLDirect(this.z, this.x, this.y)
    }


    buildGeometry() {
        const geometry = new PlaneGeometry(
            this.size,
            this.size,
            this.map.options.tileSegments,
            this.map.options.tileSegments
        )

        this.geometry = geometry
    }


    removeDebugGeometry() {
        if (this.debugArrows !== undefined) {
            this.debugArrows.forEach(arrow => {
                removeDebugArrow(arrow)
            })
        }
        this.debugArrows = []
        
        // Remove loading indicators if they exist
        if (this.loadingIndicator !== undefined) {
            GlobalScene.remove(this.loadingIndicator);
            this.loadingIndicator.geometry.dispose();
            this.loadingIndicator.material.dispose();
            this.loadingIndicator = undefined;
        }
        
        if (this.elevationLoadingIndicator !== undefined) {
            GlobalScene.remove(this.elevationLoadingIndicator);
            this.elevationLoadingIndicator.geometry.dispose();
            this.elevationLoadingIndicator.material.dispose();
            this.elevationLoadingIndicator = undefined;
        }
    }

    // Dispose of this tile's resources (but keep materials in cache for reuse)
    dispose() {
        // Remove debug geometry first
        this.removeDebugGeometry();
        
        // Remove mesh from scene if it exists
        if (this.mesh) {
            if (this.mesh.parent) {
                this.mesh.parent.remove(this.mesh);
            }
            
            // Dispose geometry (but not material since it's cached)
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
            }
            
            // Note: We don't dispose the material here since it's cached
            // and may be used by other tiles. Use static methods to manage cache.
            
            this.mesh = undefined;
        }
        
        // Clear other references
        this.geometry = undefined;
        this.elevation = undefined;
        this.worldSphere = undefined;
        this.loaded = false;
        this.isLoading = false;
        this.isLoadingElevation = false;
    }

    // Update debug geometry when loading state changes
    updateDebugGeometry() {
        if (this.map && this.map.terrainNode && this.map.terrainNode.UI && this.map.terrainNode.UI.debugElevationGrid) {
            // Get the current debug color from the map
            const debugColor = this.map.debugColor || "#FF00FF";
            const debugAltitude = this.map.debugAltitude || 0;
            this.buildDebugGeometry(debugColor, debugAltitude);
        }
    }



    buildDebugGeometry(color ="#FF00FF", altitude = 0) {
        // patch in a debug rectangle around the tile using arrows
        // this is useful for debugging the tile positions - especially elevation vs map
        // arrows are good as they are more visible than lines

        if (this.active === false) {
            color = "#808080" // grey if not active
        }

        this.removeDebugGeometry()

        if (!this.map.terrainNode.UI.debugElevationGrid) return;


        const xTile = this.x;
        const yTile = this.y;
        const zoomTile = this.z;


//    console.log ("Building Debug Geometry for tile "+xTile+","+yTile+" at zoom "+zoomTile)
//    console.log ("Constructor of this.map.options.mapProjection = "+this.map.options.mapProjection.constructor.name)
//    console.log ("Constructor of this.map.options.mapProjection = "+this.map.options.mapProjection.constructor.name)


        // get LLA of the tile corners
        const latSW = this.map.options.mapProjection.getNorthLatitude(yTile, zoomTile);
        const lonSW = this.map.options.mapProjection.getLeftLongitude(xTile, zoomTile);
        const latNW = this.map.options.mapProjection.getNorthLatitude(yTile + 1, zoomTile);
        const lonNW = this.map.options.mapProjection.getLeftLongitude(xTile, zoomTile);
        const latSE = this.map.options.mapProjection.getNorthLatitude(yTile, zoomTile);
        const lonSE = this.map.options.mapProjection.getLeftLongitude(xTile + 1, zoomTile);
        const latNE = this.map.options.mapProjection.getNorthLatitude(yTile + 1, zoomTile);
        const lonNE = this.map.options.mapProjection.getLeftLongitude(xTile + 1, zoomTile);

        // convert to EUS
        const alt = 10000 + altitude;
        const vertexSW = LLAToEUS(latSW, lonSW, alt)
        const vertexNW = LLAToEUS(latNW, lonNW, alt)
        const vertexSE = LLAToEUS(latSE, lonSE, alt)
        const vertexNE = LLAToEUS(latNE, lonNE, alt)

        // use these four points to draw debug lines at 10000m above the tile
        //DebugArrowAB("UFO Ground V", jetPosition, groundVelocityEnd, "#00ff00", displayWindArrows, GlobalScene) // green = ground speed


        const id1 = "DebugTile" + color + (xTile * 1000 + yTile) + "_1"
        const id2 = "DebugTile" + color + (xTile * 1000 + yTile) + "_2"
        const id3 = "DebugTile" + color + (xTile * 1000 + yTile) + "_3"
        const id4 = "DebugTile" + color + (xTile * 1000 + yTile) + "_4"
        this.debugArrows.push(id1)
        this.debugArrows.push(id2)
        this.debugArrows.push(id3)
        this.debugArrows.push(id4)


        DebugArrowAB(id1, vertexSW, vertexNW, color, true, GlobalScene)
        DebugArrowAB(id2, vertexSW, vertexSE, color, true, GlobalScene)
        DebugArrowAB(id3, vertexNW, vertexNE, color, true, GlobalScene)
        DebugArrowAB(id4, vertexSE, vertexNE, color, true, GlobalScene)

        // and down arrows at the corners
        const vertexSWD = pointOnSphereBelow(vertexSW)
        const vertexNWD = pointOnSphereBelow(vertexNW)
        const vertexSED = pointOnSphereBelow(vertexSE)
        const vertexNED = pointOnSphereBelow(vertexNE)

        const id5 = "DebugTile" + color + (xTile * 1000 + yTile) + "_5"
        const id6 = "DebugTile" + color + (xTile * 1000 + yTile) + "_6"
        const id7 = "DebugTile" + color + (xTile * 1000 + yTile) + "_7"
        const id8 = "DebugTile" + color + (xTile * 1000 + yTile) + "_8"

        this.debugArrows.push(id5)
        this.debugArrows.push(id6)
        this.debugArrows.push(id7)
        this.debugArrows.push(id8)

        // all down arrows in yellow
        DebugArrowAB(id5, vertexSW, vertexSWD, color, true, GlobalScene)
        DebugArrowAB(id6, vertexNW, vertexNWD, color, true, GlobalScene)
        DebugArrowAB(id7, vertexSE, vertexSED, color, true, GlobalScene)
        DebugArrowAB(id8, vertexNE, vertexNED, color, true, GlobalScene)

        // Add loading indicators in top-left corner
        const offsetFactor = 0.1; // 10% inward from corner
        const indicatorSize = Math.abs(vertexNE.x - vertexNW.x) * 0.08; // 8% of tile width
        
        // Red square for texture loading
        if (this.isLoading) {
            const loadingX = vertexNW.x + (vertexNE.x - vertexNW.x) * offsetFactor;
            const loadingY = vertexNW.y + (vertexSW.y - vertexNW.y) * offsetFactor;
            const loadingZ = vertexNW.z;
            
            this.loadingIndicator = boxMark(
                {x: loadingX, y: loadingY, z: loadingZ}, 
                indicatorSize, indicatorSize, indicatorSize, 
                "#FF0000", // Red color for texture loading
                GlobalScene
            );
            this.loadingIndicator.layers.mask = 0x1; // Make it visible on the helpers layer
        }
        
        // Blue square for elevation loading (positioned next to red square)
        if (this.isLoadingElevation) {
            const elevationX = vertexNW.x + (vertexNE.x - vertexNW.x) * (offsetFactor + 0.12); // Offset to the right
            const elevationY = vertexNW.y + (vertexSW.y - vertexNW.y) * offsetFactor;
            const elevationZ = vertexNW.z;
            
            this.elevationLoadingIndicator = boxMark(
                {x: elevationX, y: elevationY, z: elevationZ}, 
                indicatorSize, indicatorSize, indicatorSize, 
                "#0000FF", // Blue color for elevation loading
                GlobalScene
            );
            this.elevationLoadingIndicator.layers.mask = 0x1; // Make it visible on the helpers layer
        }

    }


    // recalculate the X,Y, Z values for all the verticles of a tile
    // at this point we are Z-up
    // OLD VERSION - inefficient for tiles of different sizes
    recalculateCurveOld(radius) {
        var geometry = this.geometry;
        if (this.mesh !== undefined) {
            geometry = this.mesh.geometry;
            //    console.log("Recalculating Mesh Geometry"+geometry)
        } else {
            //    console.log("Recalculating First Geometry"+geometry)
        }

        assert(geometry !== undefined, 'Geometry not defined in QuadTreeMap.js')

        // we will be calculating the tile vertex positions in EUS
        // but they will be relative to the tileCenter
        //
        const tileCenter = this.mesh.position;

        // for a 100x100 mesh, that's 100 squares on a side
        // but an extra row and column of vertices
        // so 101x101 points = 10201 points
        //

        const nPosition = Math.sqrt(geometry.attributes.position.count) // size of side of mesh in points

        const xTile = this.x;
        const yTile = this.y;
        const zoomTile = this.z;


        for (let i = 0; i < geometry.attributes.position.count; i++) {

            const xIndex = i % nPosition
            const yIndex = Math.floor(i / nPosition)

            // calculate the fraction of the tile that the vertex is in
            let yTileFraction = yIndex / (nPosition - 1)
            let xTileFraction = xIndex / (nPosition - 1)

        //    assert(xTileFraction >= 0 && xTileFraction < 1, 'xTileFraction out of range in QuadTreeMap.js')

            // clamp the fractions to keep it in the tile bounds
            // this is to avoid using adjacent tiles when we have perfect match
            // HOWEVER, not going to fully help with dynamic subdivision seams
            if (xTileFraction >= 1) xTileFraction = 1 - 1e-6;
            if (yTileFraction >= 1) yTileFraction = 1 - 1e-6;


            // get that in world tile coordinates
            const xWorld = xTile + xTileFraction;
            const yWorld = yTile + yTileFraction;

            // convert that to lat/lon
            const lat = this.map.options.mapProjection.getNorthLatitude(yWorld, zoomTile);
            const lon = this.map.options.mapProjection.getLeftLongitude(xWorld, zoomTile);

            // get the elevation, independent of the display map coordinate system
            let elevation = this.map.getElevationInterpolated(lat, lon, zoomTile);

            // clamp to sea level to avoid z-fighting with ocean tiles
            if (elevation < 0) elevation = 0;

            if (elevation > this.highestAltitude) {
                this.highestAltitude = elevation;
            }

           // elevation = Math.random()*100000

            // convert that to EUS
            const vertexESU = LLAToEUS(lat, lon, elevation)

            // subtract the center of the tile
            const vertex = vertexESU.sub(tileCenter)

            assert(!isNaN(vertex.x), 'vertex.x is NaN in QuadTreeMap.js i=' + i)
            assert(!isNaN(vertex.y), 'vertex.y is NaN in QuadTreeMap.js')
            assert(!isNaN(vertex.z), 'vertex.z is NaN in QuadTreeMap.js')

            // set the vertex position in tile space
            geometry.attributes.position.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }

        // Generate elevation color texture if needed (using interpolated elevation data)
        this.generateElevationColorTextureInterpolated();
        
        // Also check if we can now use actual elevation tile data instead of interpolated
        this.checkAndApplyElevationColorTexture();

        // Removed this as it's expensive. And seems not needed for just curve flattenog.
        // might be an ideal candidate for multi-threading
        geometry.computeVertexNormals()

        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()

        geometry.attributes.position.needsUpdate = true;
    }

    // NEW OPTIMIZED VERSION - works with elevation tiles at same or lower zoom levels
    // Tries exact coordinate match first, then searches parent tiles (lower zoom) and uses tile fractions
    // Applies elevation data directly from elevation tiles with bilinear interpolation
    recalculateCurve(radius) {

        this.highestAltitude = 0;

         if (this.map.options.elevationMap.options.elevationType === "Flat") {
             return this.recalculateCurveFlat(radius)
         }

        var geometry = this.geometry;
        if (this.mesh !== undefined) {
            geometry = this.mesh.geometry;
        }

        assert(geometry !== undefined, 'Geometry not defined in QuadTreeTile.js')

        // Get the tile center for relative positioning
        const tileCenter = this.mesh.position;

        // Find elevation tile - try exact match first, then higher zoom levels
        let elevationTile = null;
        let elevationZoom = this.z;
        let tileOffsetX = 0;
        let tileOffsetY = 0;
        let tileFractionX = 1.0;
        let tileFractionY = 1.0;
        
        // First try exact match
        elevationTile = this.map.elevationMap?.tileCache?.[this.key()];
        
        if (!elevationTile || !elevationTile.elevation) {
            // Try lower zoom levels (parent tiles with less detailed but available elevation data)
            for (let searchZoom = this.z - 1; searchZoom >= 0; searchZoom--) {
                // Calculate which parent tile covers this tile
                const zoomDiff = this.z - searchZoom;
                const tilesPerParent = Math.pow(2, zoomDiff);
                
                // Find the parent tile coordinates
                const elevationX = Math.floor(this.x / tilesPerParent);
                const elevationY = Math.floor(this.y / tilesPerParent);
                const elevationKey = `${searchZoom}/${elevationX}/${elevationY}`;
                const candidateTile = this.map.elevationMap.tileCache[elevationKey];
                
                if (candidateTile && candidateTile.elevation) {
                    elevationTile = candidateTile;
                    elevationZoom = searchZoom;
                    // Calculate which portion of the parent tile this texture tile represents
                    tileOffsetX = this.x % tilesPerParent;
                    tileOffsetY = this.y % tilesPerParent;
                    tileFractionX = 1.0 / tilesPerParent;
                    tileFractionY = 1.0 / tilesPerParent;
//                    console.log(`Using parent elevation tile ${elevationKey} (zoom ${searchZoom}) for texture tile ${this.key()}`);
                    break;
                }
            }
        }
        
        if (!elevationTile || !elevationTile.elevation) {
            // No elevation tile found at any zoom level, fall back to old method
//            console.warn(`No elevation tile found for ${this.key()} at any zoom level, falling back to interpolated method`);
            return this.recalculateCurveOld(radius);
        }

        // Get dimensions
        const nPosition = Math.sqrt(geometry.attributes.position.count); // size of side of mesh in points
        const elevationSize = Math.sqrt(elevationTile.elevation.length); // size of elevation data

        // Log the tile information for debugging
        if (elevationZoom !== this.z) {
//            console.log(`Tile ${this.key()}: using elevation zoom ${elevationZoom} (${elevationSize}x${elevationSize}) for texture zoom ${this.z} (${nPosition}x${nPosition}), fraction: ${tileFractionX.toFixed(3)}x${tileFractionY.toFixed(3)}`);
        } else if (nPosition !== elevationSize && nPosition !== elevationSize + 1) {
//            console.log(`Tile ${this.key()}: geometry ${nPosition}x${nPosition} vertices, elevation ${elevationSize}x${elevationSize} data points`);
        }

        // Apply elevation data directly to vertices
        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const xIndex = i % nPosition;
            const yIndex = Math.floor(i / nPosition);

            // Calculate the fraction of the tile that the vertex is in
            let yTileFraction = yIndex / (nPosition - 1);
            let xTileFraction = xIndex / (nPosition - 1);

            // Clamp fractions to tile bounds
            if (xTileFraction >= 1) xTileFraction = 1 - 1e-6;
            if (yTileFraction >= 1) yTileFraction = 1 - 1e-6;

            // Get world tile coordinates
            const xWorld = this.x + xTileFraction;
            const yWorld = this.y + yTileFraction;

            // Convert to lat/lon
            const lat = this.map.options.mapProjection.getNorthLatitude(yWorld, this.z);
            const lon = this.map.options.mapProjection.getLeftLongitude(xWorld, this.z);

            // Get elevation with bilinear interpolation from the elevation tile data
            // Map vertex position to elevation data coordinates, accounting for tile fraction and offset
            // If we're using a higher-zoom elevation tile, we need to map to the correct portion
            let elevationLocalX, elevationLocalY;
            
            if (elevationZoom === this.z) {
                // Same zoom level - direct mapping
                elevationLocalX = xTileFraction * (elevationSize - 1);
                elevationLocalY = yTileFraction * (elevationSize - 1);
            } else {
                // Lower zoom level (parent tile) - map to the specific portion of the parent
                // Calculate the offset within the parent tile and add the texture tile fraction
                const parentOffsetX = (tileOffsetX + xTileFraction) * tileFractionX;
                const parentOffsetY = (tileOffsetY + yTileFraction) * tileFractionY;
                elevationLocalX = parentOffsetX * (elevationSize - 1);
                elevationLocalY = parentOffsetY * (elevationSize - 1);
            }
            
            // Get the four surrounding elevation data points for interpolation
            const x0 = Math.floor(elevationLocalX);
            const x1 = Math.min(elevationSize - 1, x0 + 1);
            const y0 = Math.floor(elevationLocalY);
            const y1 = Math.min(elevationSize - 1, y0 + 1);
            
            // Get the fractional parts for interpolation
            const fx = elevationLocalX - x0;
            const fy = elevationLocalY - y0;
            
            // Sample the four corner elevation values
            const e00 = elevationTile.elevation[y0 * elevationSize + x0];
            const e01 = elevationTile.elevation[y0 * elevationSize + x1];
            const e10 = elevationTile.elevation[y1 * elevationSize + x0];
            const e11 = elevationTile.elevation[y1 * elevationSize + x1];
            
            // Bilinear interpolation
            const e0 = e00 + (e01 - e00) * fx;
            const e1 = e10 + (e11 - e10) * fx;
            let elevation = e0 + (e1 - e0) * fy;
            
            // Apply z-scale if available
            if (this.map.elevationMap.options.zScale) {
                elevation *= this.map.elevationMap.options.zScale;
            }

            // Clamp to sea level to avoid z-fighting with ocean tiles
            if (elevation < 0) elevation = 0;

            if (elevation > this.highestAltitude) {
                this.highestAltitude = elevation;
            }

            // Convert to EUS coordinates
            const vertexESU = LLAToEUS(lat, lon, elevation);

            // Subtract the center of the tile for relative positioning
            const vertex = vertexESU.sub(tileCenter);

            assert(!isNaN(vertex.x), 'vertex.x is NaN in QuadTreeTile.js i=' + i);
            assert(!isNaN(vertex.y), 'vertex.y is NaN in QuadTreeTile.js');
            assert(!isNaN(vertex.z), 'vertex.z is NaN in QuadTreeTile.js');

            // Set the vertex position in tile space
            geometry.attributes.position.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }

        // Generate elevation color texture if needed
        this.generateElevationColorTexture(geometry, elevationTile, elevationSize, tileOffsetX, tileOffsetY, tileFractionX, tileFractionY, elevationZoom);

        // Update geometry
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.attributes.position.needsUpdate = true;

    }

    // Flat version of recalculateCurve that assumes elevation is always 0
    // This skips all elevation tile lookups and interpolation for better performance
    // when using flat terrain
    recalculateCurveFlat(radius) {
        this.highestAltitude = 0;

        var geometry = this.geometry;
        if (this.mesh !== undefined) {
            geometry = this.mesh.geometry;
        }

        assert(geometry !== undefined, 'Geometry not defined in QuadTreeTile.js')

        // Get the tile center for relative positioning
        const tileCenter = this.mesh.position;

        // Get dimensions
        const nPosition = Math.sqrt(geometry.attributes.position.count); // size of side of mesh in points

        // Apply flat elevation (0) to all vertices
        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const xIndex = i % nPosition;
            const yIndex = Math.floor(i / nPosition);

            // Calculate the fraction of the tile that the vertex is in
            let yTileFraction = yIndex / (nPosition - 1);
            let xTileFraction = xIndex / (nPosition - 1);

            // Clamp fractions to tile bounds
            if (xTileFraction >= 1) xTileFraction = 1 - 1e-6;
            if (yTileFraction >= 1) yTileFraction = 1 - 1e-6;

            // Get world tile coordinates
            const xWorld = this.x + xTileFraction;
            const yWorld = this.y + yTileFraction;

            // Convert to lat/lon
            const lat = this.map.options.mapProjection.getNorthLatitude(yWorld, this.z);
            const lon = this.map.options.mapProjection.getLeftLongitude(xWorld, this.z);

            // Use flat elevation (0)
            const elevation = 0;

            // Convert to EUS coordinates
            const vertexESU = LLAToEUS(lat, lon, elevation);

            // Subtract the center of the tile for relative positioning
            const vertex = vertexESU.sub(tileCenter);

            assert(!isNaN(vertex.x), 'vertex.x is NaN in QuadTreeTile.js i=' + i);
            assert(!isNaN(vertex.y), 'vertex.y is NaN in QuadTreeTile.js');
            assert(!isNaN(vertex.z), 'vertex.z is NaN in QuadTreeTile.js');

            // Set the vertex position in tile space
            geometry.attributes.position.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }

        // Generate elevation color texture if needed (all blue since elevation is 0)
        this.generateElevationColorTextureFlat();

        // Update geometry
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.attributes.position.needsUpdate = true;
    }

    buildMaterial() {
        const url = this.textureUrl();
        
        // Check if we already have a cached material for this URL
        if (materialCache.has(url)) {
            return Promise.resolve(materialCache.get(url));
        }
        
        // If not cached, load the texture and create the material
        return loadTextureWithRetries(url).then((texture) => {
            const material = new MeshStandardMaterial({map: texture, color: "#ffffff"});
            // Cache the material for future use
            materialCache.set(url, material);
            return material;
        });
    }

    // Static method to clear the entire material cache
    static clearMaterialCache() {
        // Dispose of all cached materials and their textures
        materialCache.forEach((material, url) => {
            if (material.map) {
                material.map.dispose();
            }
            material.dispose();
        });
        materialCache.clear();
        console.log('Material cache cleared');
    }

    // Static method to remove a specific material from cache
    static removeMaterialFromCache(url) {
        if (materialCache.has(url)) {
            const material = materialCache.get(url);
            if (material.map) {
                material.map.dispose();
            }
            material.dispose();
            materialCache.delete(url);
            console.log(`Material removed from cache: ${url}`);
        }
    }

    // Static method to get cache statistics
    static getMaterialCacheStats() {
        return {
            size: materialCache.size,
            urls: Array.from(materialCache.keys())
        };
    }


    updateDebugMaterial() {
        // create a 512x512 canvas we can render things to and then use as a texture
        // this is useful for debugging the tile positions
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        // ctx.fillStyle = "#404040";
        // ctx.fillRect(0, 0, canvas.width, canvas.height);

        const color1 = "#505050";
        const color2 = "#606060";
        // draw a checkerboard pattern
        for (let y = 0; y < canvas.height; y += 64) {
            for (let x = 0; x < canvas.width; x += 64) {
                ctx.fillStyle = (x / 64 + y / 64) % 2 === 0 ? color1 : color2;
                ctx.fillRect(x, y, 64, 64);
            }
        }

        // draw a border around the canvas 1 pixel wide
        ctx.strokeStyle = "#a0a0a0";

        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);



        // draw the word "Debug" in the center of the canvas
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "48px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const text = this.key();
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        // create a texture from the canvas
        const texture = new CanvasTexture(canvas);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        const material = new MeshBasicMaterial({map: texture});



        this.mesh.material = material;
        this.mesh.material.needsUpdate = true; // ensure the material is updated

        // return the material wrapped in a Promise
        return new Promise((resolve) => {
            resolve(material);
        });
    }

    updateWireframeMaterial() {
        // Create a wireframe material
        const material = new MeshBasicMaterial({
            color: "#ffffff",
            wireframe: true
        });

        this.mesh.material = material;
        this.mesh.material.needsUpdate = true; // ensure the material is updated

        // return the material wrapped in a Promise
        return new Promise((resolve) => {
            resolve(material);
        });
    }

    generateElevationColorTexture(geometry, elevationTile, elevationSize, tileOffsetX, tileOffsetY, tileFractionX, tileFractionY, elevationZoom) {

        // Only generate elevation color texture if the current map source is elevation color
        const sourceDef = this.map.terrainNode.UI.getSourceDef();
        if (!sourceDef.isElevationColor) {
            return;
        }

        // Ensure mesh exists before trying to apply texture
        if (!this.mesh) {
            console.warn(`Cannot generate elevation color texture for tile ${this.key()}: mesh not initialized`);
            return;
        }

        console.log(`Generating elevation color texture for tile ${this.key()}, elevationSize: ${elevationSize}, elevationZoom: ${elevationZoom}, tileZoom: ${this.z}`);
        console.log(`Mesh exists: ${!!this.mesh}, Mesh material: ${this.mesh ? this.mesh.material.constructor.name : 'N/A'}`);

        // Create a canvas for the elevation color texture
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Create image data for pixel manipulation
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;

        let minElevation = Infinity;
        let maxElevation = -Infinity;
        let bluePixels = 0;
        let greenPixels = 0;

        // Process each pixel in the canvas
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const pixelIndex = (y * canvas.width + x) * 4;

                // Calculate the fraction of the tile that this pixel represents
                const xTileFraction = x / (canvas.width - 1);
                const yTileFraction = y / (canvas.height - 1);

                // Get elevation data coordinates, accounting for tile fraction and offset
                let elevationLocalX, elevationLocalY;
                
                if (elevationZoom === this.z) {
                    // Same zoom level - direct mapping
                    elevationLocalX = xTileFraction * (elevationSize - 1);
                    elevationLocalY = yTileFraction * (elevationSize - 1);
                } else {
                    // Lower zoom level (parent tile) - map to the specific portion of the parent
                    const parentOffsetX = (tileOffsetX + xTileFraction) * tileFractionX;
                    const parentOffsetY = (tileOffsetY + yTileFraction) * tileFractionY;
                    elevationLocalX = parentOffsetX * (elevationSize - 1);
                    elevationLocalY = parentOffsetY * (elevationSize - 1);
                }
                
                // Get the four surrounding elevation data points for interpolation
                const x0 = Math.floor(elevationLocalX);
                const x1 = Math.min(elevationSize - 1, x0 + 1);
                const y0 = Math.floor(elevationLocalY);
                const y1 = Math.min(elevationSize - 1, y0 + 1);
                
                // Get the fractional parts for interpolation
                const fx = elevationLocalX - x0;
                const fy = elevationLocalY - y0;
                
                // Sample the four corner elevation values
                const e00 = elevationTile.elevation[y0 * elevationSize + x0];
                const e01 = elevationTile.elevation[y0 * elevationSize + x1];
                const e10 = elevationTile.elevation[y1 * elevationSize + x0];
                const e11 = elevationTile.elevation[y1 * elevationSize + x1];
                
                // Bilinear interpolation
                const e0 = e00 + (e01 - e00) * fx;
                const e1 = e10 + (e11 - e10) * fx;
                let elevation = e0 + (e1 - e0) * fy;
                
                // Apply z-scale if available
                if (this.map.elevationMap.options.zScale) {
                    elevation *= this.map.elevationMap.options.zScale;
                }

                // Track elevation range for debugging
                minElevation = Math.min(minElevation, elevation);
                maxElevation = Math.max(maxElevation, elevation);

                // Color based on elevation: <=1m is blue, >1m is green
                if (elevation <= 1) {
                    // Blue for water/low elevation
                    data[pixelIndex] = 0;     // Red
                    data[pixelIndex + 1] = 0; // Green
                    data[pixelIndex + 2] = 255; // Blue
                    bluePixels++;
                } else {
                    // Green for land/higher elevation
                    data[pixelIndex] = 0;     // Red
                    data[pixelIndex + 1] = 255; // Green
                    data[pixelIndex + 2] = 0;   // Blue
                    greenPixels++;
                }
                data[pixelIndex + 3] = 255; // Alpha (fully opaque)
            }
        }

        console.log(`Elevation range: ${minElevation.toFixed(2)}m to ${maxElevation.toFixed(2)}m, Blue pixels: ${bluePixels}, Green pixels: ${greenPixels}`);

        // If all elevations are 0, it means elevation data is invalid - skip texture generation
        if (minElevation === 0 && maxElevation === 0) {
            console.log(`Invalid elevation data (all zeros) for tile ${this.key()}, skipping texture generation`);
            return;
        }

        // If all elevations are the same (but not zero), create a test pattern
        if (minElevation === maxElevation) {
            console.log(`All elevations are the same (${minElevation}), creating test pattern`);
            // Create a checkerboard pattern for testing
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const pixelIndex = (y * canvas.width + x) * 4;
                    const isEven = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) === 0;
                    if (isEven) {
                        // Red squares
                        data[pixelIndex] = 255;     // Red
                        data[pixelIndex + 1] = 0;   // Green
                        data[pixelIndex + 2] = 0;   // Blue
                    } else {
                        // Yellow squares
                        data[pixelIndex] = 255;     // Red
                        data[pixelIndex + 1] = 255; // Green
                        data[pixelIndex + 2] = 0;   // Blue
                    }
                    data[pixelIndex + 3] = 255; // Alpha
                }
            }
        }

        // Put the image data onto the canvas
        ctx.putImageData(imageData, 0, 0);

        // Dispose of old material if it exists
        if (this.mesh.material && this.mesh.material.map) {
            this.mesh.material.map.dispose();
        }
        if (this.mesh.material && this.mesh.material !== tileMaterial) {
            this.mesh.material.dispose();
        }

        // Create a texture from the canvas and apply it to the mesh
        const texture = new CanvasTexture(canvas);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.needsUpdate = true;
        const material = new MeshBasicMaterial({map: texture});

        // Dispose of the old material properly
        const oldMaterial = this.mesh.material;
        if (oldMaterial && oldMaterial !== tileMaterial) {
            if (oldMaterial.map) {
                oldMaterial.map.dispose();
            }
            oldMaterial.dispose();
        }
        
        // Apply the new material
        this.mesh.material = material;
        this.mesh.material.needsUpdate = true;
        
        // Force a complete refresh by temporarily removing and re-adding to scene
        if (this.mesh.parent && this.added) {
            const parent = this.mesh.parent;
            parent.remove(this.mesh);
            parent.add(this.mesh);
        }
        
        console.log(`Applied elevation color texture to tile ${this.key()}, material type: ${material.constructor.name}, has texture: ${!!material.map}`);
    }

    // Generate elevation color texture for flat terrain (all blue since elevation is 0)
    generateElevationColorTextureFlat() {
        // Only generate elevation color texture if the current map source is elevation color
        const sourceDef = this.map.terrainNode.UI.getSourceDef();
        if (!sourceDef.isElevationColor) {
            return;
        }

        // Ensure mesh exists before trying to apply texture
        if (!this.mesh) {
            console.warn(`Cannot generate flat elevation color texture for tile ${this.key()}: mesh not initialized`);
            return;
        }

        // If we have elevation data, use the full generateElevationColorTexture method
        if (this.elevation) {
            console.log(`Generating elevation color texture for tile ${this.key()} using direct elevation data`);
            const elevationSize = Math.sqrt(this.elevation.length);
            this.generateElevationColorTexture(
                this.mesh.geometry,
                this, // Use this tile as the elevation source
                elevationSize,
                0, 0, 1, 1, // No offset or fraction needed for direct data
                this.z
            );
            return;
        }

        console.log(`Generating flat elevation color texture for tile ${this.key()} (no elevation data)`);

        // Create a canvas for the elevation color texture
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Create image data for pixel manipulation
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;

        // Fill entire canvas with blue (elevation = 0, which is ≤1m)
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0;     // Red
            data[i + 1] = 0; // Green
            data[i + 2] = 255; // Blue
            data[i + 3] = 255; // Alpha
        }

        // Put the image data onto the canvas
        ctx.putImageData(imageData, 0, 0);

        // Dispose of old material if it exists
        if (this.mesh.material && this.mesh.material.map) {
            this.mesh.material.map.dispose();
        }
        if (this.mesh.material && this.mesh.material !== tileMaterial) {
            this.mesh.material.dispose();
        }

        // Create a texture from the canvas and apply it to the mesh
        const texture = new CanvasTexture(canvas);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.needsUpdate = true;
        const material = new MeshBasicMaterial({map: texture});

        // Dispose of the old material properly
        const oldMaterial = this.mesh.material;
        if (oldMaterial && oldMaterial !== tileMaterial) {
            if (oldMaterial.map) {
                oldMaterial.map.dispose();
            }
            oldMaterial.dispose();
        }
        
        // Apply the new material
        this.mesh.material = material;
        this.mesh.material.needsUpdate = true;
        
        // Force a complete refresh by temporarily removing and re-adding to scene
        if (this.mesh.parent && this.added) {
            const parent = this.mesh.parent;
            parent.remove(this.mesh);
            parent.add(this.mesh);
        }
        
        console.log(`Applied flat elevation color texture (all blue) to tile ${this.key()}`);
    }

    // Generate elevation color texture using interpolated elevation data (fallback method)
    generateElevationColorTextureInterpolated() {
        // Only generate elevation color texture if the current map source is elevation color
        const sourceDef = this.map.terrainNode.UI.getSourceDef();
        if (!sourceDef.isElevationColor) {
            return;
        }

        // Ensure mesh exists before trying to apply texture
        if (!this.mesh) {
            console.warn(`Cannot generate interpolated elevation color texture for tile ${this.key()}: mesh not initialized`);
            return;
        }

        console.log(`Generating interpolated elevation color texture for tile ${this.key()}`);

        // Create a canvas for the elevation color texture
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Create image data for pixel manipulation
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;

        let minElevation = Infinity;
        let maxElevation = -Infinity;
        let bluePixels = 0;
        let greenPixels = 0;

        // Process each pixel in the canvas
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const pixelIndex = (y * canvas.width + x) * 4;

                // Calculate the fraction of the tile that this pixel represents
                const xTileFraction = x / (canvas.width - 1);
                const yTileFraction = y / (canvas.height - 1);

                // Get world tile coordinates
                const xWorld = this.x + xTileFraction;
                const yWorld = this.y + yTileFraction;

                // Convert to lat/lon
                const lat = this.map.options.mapProjection.getNorthLatitude(yWorld, this.z);
                const lon = this.map.options.mapProjection.getLeftLongitude(xWorld, this.z);

                // Get elevation using the interpolated method (same as recalculateCurveOld)
                let elevation = this.map.getElevationInterpolated(lat, lon, this.z);

                // Clamp to sea level
                if (elevation < 0) elevation = 0;

                // Track elevation range for debugging
                minElevation = Math.min(minElevation, elevation);
                maxElevation = Math.max(maxElevation, elevation);

                // Color based on elevation: ≤1m is blue, >1m is green
                if (elevation <= 1) {
                    // Blue for water/low elevation
                    data[pixelIndex] = 0;     // Red
                    data[pixelIndex + 1] = 0; // Green
                    data[pixelIndex + 2] = 255; // Blue
                    bluePixels++;
                } else {
                    // Green for land/higher elevation
                    data[pixelIndex] = 0;     // Red
                    data[pixelIndex + 1] = 255; // Green
                    data[pixelIndex + 2] = 0;   // Blue
                    greenPixels++;
                }
                data[pixelIndex + 3] = 255; // Alpha (fully opaque)
            }
        }

        console.log(`Interpolated elevation range: ${minElevation.toFixed(2)}m to ${maxElevation.toFixed(2)}m, Blue pixels: ${bluePixels}, Green pixels: ${greenPixels}`);

        // If all elevations are 0, it means no elevation data is loaded yet - skip texture generation
        if (minElevation === 0 && maxElevation === 0) {
            console.log(`No elevation data loaded yet for tile ${this.key()}, skipping texture generation`);
            return;
        }

        // If all elevations are the same (but not zero), create a test pattern
        if (minElevation === maxElevation) {
            console.log(`All interpolated elevations are the same (${minElevation}), creating test pattern`);
            // Create a checkerboard pattern for testing
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const pixelIndex = (y * canvas.width + x) * 4;
                    const isEven = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) === 0;
                    if (isEven) {
                        // Purple squares (different from the main method)
                        data[pixelIndex] = 128;     // Red
                        data[pixelIndex + 1] = 0;   // Green
                        data[pixelIndex + 2] = 128; // Blue
                    } else {
                        // Orange squares
                        data[pixelIndex] = 255;     // Red
                        data[pixelIndex + 1] = 165; // Green
                        data[pixelIndex + 2] = 0;   // Blue
                    }
                    data[pixelIndex + 3] = 255; // Alpha
                }
            }
        }

        // Put the image data onto the canvas
        ctx.putImageData(imageData, 0, 0);

        // Dispose of old material if it exists
        if (this.mesh.material && this.mesh.material.map) {
            this.mesh.material.map.dispose();
        }
        if (this.mesh.material && this.mesh.material !== tileMaterial) {
            this.mesh.material.dispose();
        }

        // Create a texture from the canvas and apply it to the mesh
        const texture = new CanvasTexture(canvas);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.needsUpdate = true;
        const material = new MeshBasicMaterial({map: texture});

        // Dispose of the old material properly
        const oldMaterial = this.mesh.material;
        if (oldMaterial && oldMaterial !== tileMaterial) {
            if (oldMaterial.map) {
                oldMaterial.map.dispose();
            }
            oldMaterial.dispose();
        }
        
        // Apply the new material
        this.mesh.material = material;
        this.mesh.material.needsUpdate = true;
        
        // Force a complete refresh by temporarily removing and re-adding to scene
        if (this.mesh.parent && this.added) {
            const parent = this.mesh.parent;
            parent.remove(this.mesh);
            parent.add(this.mesh);
        }
        
        console.log(`Applied interpolated elevation color texture to tile ${this.key()}`);
    }

    applyMaterial() {
        const sourceDef = this.map.terrainNode.UI.getSourceDef();
        if (sourceDef.isDebug) {


            this.updateDebugMaterial();
            this.loaded = true; // mark the tile as loaded

            this.map.scene.add(this.mesh); // add the mesh to the scene
            this.added = true; // mark the tile as added to the scene
            
            // Return early for debug materials
            return Promise.resolve(this.mesh.material);
        }
        
        // Handle wireframe material
        if (sourceDef.name === "Wireframe") {
            this.updateWireframeMaterial();
            this.loaded = true; // mark the tile as loaded

            this.map.scene.add(this.mesh); // add the mesh to the scene
            this.added = true; // mark the tile as added to the scene
            
            // Return early for wireframe materials
            return Promise.resolve(this.mesh.material);
        }

        // Handle elevation color material
        if (sourceDef.isElevationColor) {
            // For elevation color, we need to wait for elevation data and then generate the texture
            // For now, use the debug info texture showing tile coordinates
            this.updateDebugMaterial().then((material) => {
                this.loaded = true;
                this.map.scene.add(this.mesh);
                this.added = true;
                
                // Check if elevation data is already available and apply elevation color texture
                this.checkAndApplyElevationColorTexture();
            });
            
            // The actual elevation color texture will be applied when recalculateCurve() is called
            // or when elevation data becomes available
            return Promise.resolve(this.mesh.material);
        }

        // Set loading state and update debug geometry
        this.isLoading = true;
        this.updateDebugGeometry();

        return new Promise((resolve, reject) => {
            if (this.textureUrl() != null) {
                this.buildMaterial().then((material) => {
                    this.mesh.material = material
                    if (! this.map.scene) {
                        console.warn("QuadTreeTile.applyMaterial: map.scene is not defined, not adding mesh to scene (changed levels?)")
                        this.loaded = true; // Mark as loaded even if scene is not available
                        this.isLoading = false;
                        this.updateDebugGeometry();
                        return resolve(material);
                    }
                    this.map.scene.add(this.mesh); // add the mesh to the scene
                    this.added = true; // mark the tile as added to the scene
                    this.loaded = true;
                    this.isLoading = false; // Clear loading state
                    this.updateDebugGeometry(); // Update debug geometry to remove loading indicator
                    resolve(material)
                }).catch((error) => {
                    // Even if material loading fails, mark tile as "loaded" to prevent infinite pending state
                    this.loaded = true;
                    this.isLoading = false; // Clear loading state on error
                    this.updateDebugGeometry(); // Update debug geometry to remove loading indicator
                    reject(error);
                })
            } else {
                // No texture URL available, but tile is still considered "loaded"
                this.loaded = true;
                this.isLoading = false;
                this.updateDebugGeometry();
                resolve(null)
            }
        });
    }

    buildMesh() {
        this.mesh = new Mesh(this.geometry, tileMaterial)
    }


////////////////////////////////////////////////////////////////////////////////////
    async fetchElevationTile(signal) {
        const elevationURL = this.elevationURL();

        if (signal?.aborted) {
            throw new Error('Aborted');
        }

        // Set elevation loading state and update debug geometry
        this.isLoadingElevation = true;
        this.updateDebugGeometry();

        if (!elevationURL) {
            // No elevation URL - this is normal for flat terrain
            // Mark the tile as having no elevation data
            this.elevation = null;
            this.elevationLoadFailed = false; // Not a failure, just no elevation source
            this.isLoadingElevation = false;
            this.updateDebugGeometry();
            return this;
        }

//        console.log(`Fetching elevation data for tile ${this.key()} from ${elevationURL}`);

        try {
            if (elevationURL.endsWith('.png')) {
                await this.handlePNGElevation(elevationURL);
            } else {
                await this.handleGeoTIFFElevation(elevationURL);
            }
            this.isLoadingElevation = false; // Clear elevation loading state
            this.updateDebugGeometry(); // Update debug geometry to remove elevation loading indicator
            return this;
        } catch (error) {
            console.error('Error fetching elevation data:', error);
            this.isLoadingElevation = false; // Clear elevation loading state on error
            this.updateDebugGeometry(); // Update debug geometry to remove elevation loading indicator
            throw error;
        }
    }

    async handleGeoTIFFElevation(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const tiff = await fromArrayBuffer(arrayBuffer); // Use GeoTIFF library to parse the array buffer
        const image = await tiff.getImage();

        const width = image.getWidth();
        const height = image.getHeight();
        console.log(`GeoTIFF x = ${this.x} y = ${this.y}, z = ${this.z}, width=${width}, height=${height}`);

        const processedElevation = convertTIFFToElevationArray(image);
        this.computeElevationFromGeoTIFF(processedElevation, width, height);


    }

    async handlePNGElevation(url) {
        return new Promise((resolve, reject) => {
            getPixels(url, (err, pixels) => {
                if (err) {
                    reject(new Error(`PNG processing error: ${err.message}`));
                    return;
                }
                this.computeElevationFromRGBA(pixels);
                resolve();
            });
        });
    }

    computeElevationFromRGBA(pixels) {
        this.shape = pixels.shape;
        const elevation = new Float32Array(pixels.shape[0] * pixels.shape[1]);
        for (let i = 0; i < pixels.shape[0]; i++) {
            for (let j = 0; j < pixels.shape[1]; j++) {
                const ij = i + pixels.shape[0] * j;
                const rgba = ij * 4;
                elevation[ij] =
                    pixels.data[rgba] * 256.0 +
                    pixels.data[rgba + 1] +
                    pixels.data[rgba + 2] / 256.0 -
                    32768.0;
            }
        }
        this.elevation = elevation;
    }

    computeElevationFromGeoTIFF(elevationData, width, height) {
        if (!elevationData || elevationData.length !== width * height) {
            throw new Error('Invalid elevation data dimensions');
        }

        this.shape = [width, height];
        this.elevation = elevationData;

        // Validate elevation data
        const stats = {
            min: Infinity,
            max: -Infinity,
            nanCount: 0
        };

        for (let i = 0; i < elevationData.length; i++) {
            const value = elevationData[i];
            if (Number.isNaN(value)) {
                stats.nanCount++;
            } else {
                stats.min = Math.min(stats.min, value);
                stats.max = Math.max(stats.max, value);
            }
        }

        // Log statistics for debugging
        console.log('Elevation statistics:', {
            width,
            height,
            min: stats.min,
            max: stats.max,
            nanCount: stats.nanCount,
            totalPoints: elevationData.length
        });
    }

    // Check if elevation data is available and apply elevation color texture if needed
    checkAndApplyElevationColorTexture() {
        // Only proceed if we're in elevation color mode
        const sourceDef = this.map.terrainNode.UI.getSourceDef();
        if (!sourceDef.isElevationColor) {
            return;
        }

        // Only proceed if mesh exists
        if (!this.mesh) {
            return;
        }

        // Check if elevation data is available for this tile or parent tiles
        let elevationTile = null;
        let elevationZoom = this.z;
        let tileOffsetX = 0;
        let tileOffsetY = 0;
        let tileFractionX = 1.0;
        let tileFractionY = 1.0;
        
        // First try exact match
        elevationTile = this.map.elevationMap?.tileCache?.[this.key()];
        
        if (!elevationTile || !elevationTile.elevation) {
            // Try lower zoom levels (parent tiles with less detailed but available elevation data)
            for (let searchZoom = this.z - 1; searchZoom >= 0; searchZoom--) {
                // Calculate which parent tile covers this tile
                const zoomDiff = this.z - searchZoom;
                const tilesPerParent = Math.pow(2, zoomDiff);
                
                // Find the parent tile coordinates
                const elevationX = Math.floor(this.x / tilesPerParent);
                const elevationY = Math.floor(this.y / tilesPerParent);
                const elevationKey = `${searchZoom}/${elevationX}/${elevationY}`;
                const candidateTile = this.map.elevationMap?.tileCache?.[elevationKey];
                
                if (candidateTile && candidateTile.elevation) {
                    elevationTile = candidateTile;
                    elevationZoom = searchZoom;
                    // Calculate which portion of the parent tile this texture tile represents
                    tileOffsetX = this.x % tilesPerParent;
                    tileOffsetY = this.y % tilesPerParent;
                    tileFractionX = 1.0 / tilesPerParent;
                    tileFractionY = 1.0 / tilesPerParent;
                    break;
                }
            }
        }
        
        // If elevation data is available, generate the elevation color texture
        if (elevationTile && elevationTile.elevation) {
            console.log(`Applying elevation color texture immediately for tile ${this.key()} using elevation zoom ${elevationZoom}`);
            const elevationSize = Math.sqrt(elevationTile.elevation.length);
            this.generateElevationColorTexture(this.mesh.geometry, elevationTile, elevationSize, tileOffsetX, tileOffsetY, tileFractionX, tileFractionY, elevationZoom);
        } else {
            console.log(`No elevation data available yet for tile ${this.key()}, will wait for elevation tile to load`);
        }
    }


//////////////////////////////////////////////////////////////////////////////////

    setPosition(center) {

        // We are ignoring the passed "Center", and just calculating a local origin from the midpoint of the Lat, Lon extents

        const lat1 = this.map.options.mapProjection.getNorthLatitude(this.y, this.z);
        const lon1 = this.map.options.mapProjection.getLeftLongitude(this.x, this.z);
        const lat2 = this.map.options.mapProjection.getNorthLatitude(this.y + 1, this.z);
        const lon2 = this.map.options.mapProjection.getLeftLongitude(this.x + 1, this.z);
        const lat = (lat1 + lat2) / 2;
        const lon = (lon1 + lon2) / 2;

        const p = LLAToEUS(lat, lon, 0);

        this.mesh.position.copy(p)

        // we need to update the matrices, otherwise collision will not work until rendered
        // which can lead to odd asynchronous bugs where the last tiles loaded
        // don't have matrices set, and so act as holes, but this varies with loading order
        this.mesh.updateMatrix()
        this.mesh.updateMatrixWorld() //
    }

    // resolveSeamY(neighbor) {
    //     const tPosition = this.mesh.geometry.attributes.position.count
    //     const nPosition = Math.sqrt(tPosition)
    //     const nPositionN = Math.sqrt(
    //         neighbor.mesh.geometry.attributes.position.count
    //     )
    //     if (nPosition !== nPositionN) {
    //         console.error("resolveSeamY only implemented for geometries of same size")
    //         return
    //     }
    //
    //     // the positions are relative to the tile centers
    //     // so we need to adjust by the offset
    //     const tileCenter = this.mesh.position;
    //     const neighborCenter = neighbor.mesh.position;
    //     const offset = neighborCenter.clone().sub(tileCenter);
    //
    //     for (let i = tPosition - nPosition; i < tPosition; i++) {
    //         // copy the entire position vector
    //         this.mesh.geometry.attributes.position.setXYZ(
    //             i,  // this is the index of the vertex in the mesh
    //             neighbor.mesh.geometry.attributes.position.getX(i - (tPosition - nPosition)) + offset.x,
    //             neighbor.mesh.geometry.attributes.position.getY(i - (tPosition - nPosition)) + offset.y,
    //             neighbor.mesh.geometry.attributes.position.getZ(i - (tPosition - nPosition)) + offset.z
    //         )
    //     }
    // }
    //
    // // TODO: this fixes the seams, but is not quite right, there are angular and texture discontinuities:
    // // http://localhost/sitrec/?custom=http://localhost/sitrec-upload/99999999/Custom-8c549374795aec6f133bfde7f25bad93.json
    // resolveSeamX(neighbor) {
    //     const tPosition = this.mesh.geometry.attributes.position.count
    //     const nPosition = Math.sqrt(tPosition)
    //     const nPositionN = Math.sqrt(
    //         neighbor.mesh.geometry.attributes.position.count
    //     )
    //     if (nPosition !== nPositionN) {
    //         console.error("resolveSeamX only implemented for geometries of same size")
    //         return
    //     }
    //
    //     // the positions are relative to the tile centers
    //     // so we need to adjust by the offset
    //     const tileCenter = this.mesh.position;
    //     const neighborCenter = neighbor.mesh.position;
    //     const offset = neighborCenter.clone().sub(tileCenter);
    //
    //     for (let i = nPosition - 1; i < tPosition; i += nPosition) {
    //         // copy the entire position vector
    //         this.mesh.geometry.attributes.position.setXYZ(
    //             i,  // this is the index of the vertex in the mesh
    //             neighbor.mesh.geometry.attributes.position.getX(i - nPosition + 1) + offset.x,
    //             neighbor.mesh.geometry.attributes.position.getY(i - nPosition + 1) + offset.y,
    //             neighbor.mesh.geometry.attributes.position.getZ(i - nPosition + 1) + offset.z
    //         )
    //     }
    // }
    //
    // resolveSeams(cache, doNormals = true) {
    //     let worked = false
    //     const neighY = cache[this.keyNeighY()]
    //     const neighX = cache[this.keyNeighX()]
    //     if (this.seamY === false && neighY && neighY.mesh) {
    //         this.resolveSeamY(neighY)
    //         this.seamY = true
    //         worked = true
    //     }
    //     if (this.seamX === false && neighX && neighX.mesh) {
    //         this.resolveSeamX(neighX)
    //         this.seamX = true
    //         worked = true
    //     }
    //     if (worked) {
    //         this.mesh.geometry.attributes.position.needsUpdate = true
    //         if (doNormals)
    //             this.mesh.geometry.computeVertexNormals()
    //     }
    // }


}