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
        this.isLoading = false // Track if this tile is currently loading textures
        this.isLoadingElevation = false // Track if this tile is currently loading elevation data
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
                    console.log(`Using parent elevation tile ${elevationKey} (zoom ${searchZoom}) for texture tile ${this.key()}`);
                    break;
                }
            }
        }
        
        if (!elevationTile || !elevationTile.elevation) {
            // No elevation tile found at any zoom level, fall back to old method
            console.warn(`No elevation tile found for ${this.key()} at any zoom level, falling back to interpolated method`);
            return this.recalculateCurveOld(radius);
        }

        // Get dimensions
        const nPosition = Math.sqrt(geometry.attributes.position.count); // size of side of mesh in points
        const elevationSize = Math.sqrt(elevationTile.elevation.length); // size of elevation data

        // Log the tile information for debugging
        if (elevationZoom !== this.z) {
            console.log(`Tile ${this.key()}: using elevation zoom ${elevationZoom} (${elevationSize}x${elevationSize}) for texture zoom ${this.z} (${nPosition}x${nPosition}), fraction: ${tileFractionX.toFixed(3)}x${tileFractionY.toFixed(3)}`);
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

        // Update geometry
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.attributes.position.needsUpdate = true;

    }


    // returns the four children tiles of this tile
    // this is used to build the QuadTextureMaterial
    // and all we do is get the four URLs of the children's textures
    // and then combine them in
    // children() {
    //     return [
    //         new QuadTreeTile(this.map, this.z + 1, this.x * 2, this.y * 2),
    //         new QuadTreeTile(this.map, this.z + 1, this.x * 2, this.y * 2 + 1),
    //         new QuadTreeTile(this.map, this.z + 1, this.x * 2 + 1, this.y * 2),
    //         new QuadTreeTile(this.map, this.z + 1, this.x * 2 + 1, this.y * 2 + 1),
    //     ]
    // }

    // QuadTextureMaterial uses four textures from the children tiles
    // (which are not actually loaded, but we have the URLs)
    // there's a custom shader to combine them together
    //
    buildMaterial() {

        const url = this.textureUrl();
        return loadTextureWithRetries(url).then((texture) => {
            return new MeshStandardMaterial({map: texture, color: "#ffffff"});
        })


        // const url = this.mapUrl();
        // // If url is a texture or a promise that resolves to a texture, handle accordingly
        // if (url) {
        //   // If url is already a texture, use it directly
        //   if (url.isTexture) {
        //     return Promise.resolve(new MeshStandardMaterial({ map: url, color: "#ffffff" }));
        //   }
        //   // If url is a string (URL), load the texture asynchronously
        //   if (typeof url === "string") {
        //     return new Promise((resolve, reject) => {
        //       const loader = new TextureLoader();
        //       loader.load(
        //           url,
        //           texture => resolve(new MeshStandardMaterial({ map: texture, color: "#ffffff" })),
        //           undefined,
        //           err => reject(err)
        //       );
        //     });
        //   }
        // }


        // If no url, use the QuadTextureMaterial which returns a Promise resolving to a material
        //  const urls = this.children().map(tile => tile.mapUrl());
        //  return QuadTextureMaterial(urls);
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

        // Set loading state and update debug geometry
        this.isLoading = true;
        this.updateDebugGeometry();

        return new Promise((resolve, reject) => {
            if (this.textureUrl(0, 0, 0) != null) {
                this.buildMaterial().then((material) => {
                    this.mesh.material = material
                    if (! this.map.scene) {
                        console.warn("QuadTreeTile.applyMaterial: map.scene is not defined, not adding mesh to scene (changed levels?)")
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
                    this.isLoading = false; // Clear loading state on error
                    this.updateDebugGeometry(); // Update debug geometry to remove loading indicator
                    reject(error);
                })
            } else {
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