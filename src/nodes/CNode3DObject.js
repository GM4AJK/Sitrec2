// CNode3DObject.js - CNode3DObject
// a 3D object node - a sphere, cube, etc., with generated geometry and material from the input parameters
// encapsulates a THREE.Object3D object, like:
// - THREE.Mesh (default)
// - THREE.LineSegments (if wireframe or edges)

import {CNode3DLight} from "./CNode3DLight";
import {CNode3DGroup} from "./CNode3DGroup";
import * as LAYER from "../LayerMasks";
import {fastComputeVertexNormals} from "../FastComputeVertexNormals";
import {
    Box3,
    BoxGeometry,
    CapsuleGeometry,
    CircleGeometry,
    Color,
    ConeGeometry,
    CurvePath,
    CylinderGeometry,
    DodecahedronGeometry,
    EdgesGeometry,
    IcosahedronGeometry,
    LatheGeometry,
    LineCurve3,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshPhongMaterial,
    MeshPhysicalMaterial,
    OctahedronGeometry,
    QuadraticBezierCurve3,
    RingGeometry,
    SphereGeometry,
    TetrahedronGeometry,
    TorusGeometry,
    TorusKnotGeometry,
    TubeGeometry,
    Vector2,
    Vector3,
    WireframeGeometry
} from "three";
import {FileManager, Globals, guiMenus, NodeMan, setRenderOne, Sit} from "../Globals";
import {assert} from "../assert";
import {disposeScene, propagateLayerMaskObject} from "../threeExt";
import {loadGLTFModel} from "./CNode3DModel";
import {V3} from "../threeUtils";
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {CNodeLabel3D, CNodeMeasureAB} from "./CNodeLabels3D";
import {EUSToLLA} from "../LLA-ECEF-ENU";

// Note these files are CASE SENSIVE. Mac OS is case insensitive, so be careful. (e.g. F-15.glb will not work on my deployed server)
export const ModelFiles = {
// TODO: X1-B
    "737 MAX 8 BA":         { file: 'data/models/737 MAX 8 BA.glb',},
    "A340-600":             { file: 'data/models/A340-600.glb',},
    "A-10":                 { file: 'data/models/A-10.glb',},
    "AC690 Rockwell":       { file: 'data/models/AC690.glb',},
    "Bell 206 Helicopter":  { file: 'data/models/Bell-206.glb',},
    "F/A-18F" :             { file: 'data/models/FA-18F.glb',},
    "F-15":                 { file: 'data/models/f-15.glb',},
    "Lear 75":              { file: 'data/models/Lear-75.glb',},
    "MiG-29":               { file: 'data/models/MiG-29.glb',},
    "MQ-9 (loaded)":        { file: 'data/models/MQ9.glb',},
    "MQ-9 (clean)":         { file: 'data/models/MQ9-clean.glb',},
    "SR-71":                { file: 'data/models/SR-71.glb',},
 //   "737 MAX 8 (White)":    { file: 'data/models/737_MAX_8_White.glb',},
 //   "777-200ER (Malyasia)": { file: 'data/models/777-200ER-Malaysia.glb',},
//    "DC-10":                { file: 'data/models/DC-10.glb',},
   // "WhiteCube":            { file: 'data/models/white-cube.glb',},
   // "PinkCube":             { file: 'data/models/pink-cube.glb',},
   // "ATFLIR":               { file: 'data/models/ATFLIR.glb',},

    "X-37":                 { file: 'data/models/X-37.glb',},
    "Saucer":               { file: 'data/models/saucer01a.glb',},
    "LCS":                 { file: 'data/models/LCS.glb',},

}


// Custom geometries

// SuperEggGeometry
// https://en.wikipedia.org/wiki/Superellipsoid

class SuperEggGeometry extends LatheGeometry {
    constructor(radius = 1, length = 1, sharpness = 5.5, widthSegments = 20, heightSegments = 20) {
        // Generate points for the profile curve of the superegg
        const points = [];
        for (let i = 0; i <= heightSegments; i++) {
            const t = (i / heightSegments) * Math.PI - Math.PI / 2; // Range from -π/2 to π/2
            const y = Math.sin(t) * length; // Y-coordinate, scaled by length
            const x = Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** (2 / sharpness) * radius; // X-coordinate scaled by radius
            points.push(new Vector2(x, y));
        }

        // Create LatheGeometry by revolving the profile curve around the y-axis
        super(points, widthSegments);

        this.type = 'SuperEggGeometry';
        this.parameters = {
            radius: radius,
            length: length,
            sharpness: sharpness,
            widthSegments: widthSegments,
            heightSegments: heightSegments
        };
    }
}

// wrapper to use the CapsuleGeometry with a total length instead of cylinder length
class CapsuleGeometryTL {
    constructor(radius=0.5, totalLength = 5, capSegments = 20, radialSegments = 20) {
        return new CapsuleGeometry(radius, totalLength-radius*2, capSegments, radialSegments);
    }
}

// EllipsoidGeometry
// Creates an ellipsoid by scaling a sphere geometry
class EllipsoidGeometry extends SphereGeometry {
    constructor(radius = 1, aspect = 1, widthSegments = 32, heightSegments = 16) {
        // Create a sphere with the base radius
        super(radius, widthSegments, heightSegments);
        
        // Scale the Y-axis by the aspect ratio to create an ellipsoid
        this.scale(1, aspect, 1);
        
        this.type = 'EllipsoidGeometry';
        this.parameters = {
            radius: radius,
            aspect: aspect,
            widthSegments: widthSegments,
            heightSegments: heightSegments
        };
    }
}

// Procedural TicTac model from a capsule and two legs
class TicTacGeometry {
    constructor(radius = 1, totalLength = 1, capSegments = 20, radialSegments = 20, legRadius = 0.1, legLength1 = 0.1, legLength2 = 0.1, legCurveRadius = 0.1, legOffset = 0.1, legSpacing = 0.1) {

        const capsule = new CapsuleGeometry(radius, totalLength-radius*2, capSegments, radialSegments);

        // get the offset of the legs, radius*0.95 so it overlaps the capsule to avoid gaps
        const leg1Start = V3(0, legOffset + legSpacing/2, radius*0.95);
        const leg2Start = V3(0, legOffset - legSpacing/2, radius*0.95);

        // get relative positions of the leg mid and end
        const legMid = V3(0, 0,          legLength1);
        const legEnd = V3(0, legLength2, legLength1);

        // calculate the two sets of mid and end
        const leg1Mid = leg1Start.clone().add(legMid);
        const leg1End = leg1Start.clone().add(legEnd);
        const leg2Mid = leg2Start.clone().add(legMid);
        const leg2End = leg2Start.clone().add(legEnd);

        legCurveRadius = Math.min(legCurveRadius, legLength1);
        legCurveRadius = Math.min(legCurveRadius, Math.abs(legLength2));

        const tube1 = createTube(leg1Start, leg1Mid, leg1End, legRadius, legCurveRadius);
        const tube2 = createTube(leg2Start, leg2Mid, leg2End, legRadius, legCurveRadius);

        const geometries = [capsule,tube1, tube2];
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);

        return mergedGeometry;
    }

}

// Function to compute a point on a line segment at a given distance from an endpoint
function computePointAtDistance(p1, p2, distance) {
    const direction = new Vector3().subVectors(p1, p2).normalize();
    return new Vector3().addVectors(p2, direction.multiplyScalar(distance));
}

// Function to create a cap geometry at a given position with a specified radius
function createCapGeometry(position, radius, direction) {
    const geometry = new CircleGeometry(radius, 32);
    geometry.lookAt(direction);
    geometry.translate(position.x, position.y, position.z);
    return geometry;
}

// Function to create a bent tube geometry with the given parameters
function createTube(A, B, C, R, K) {

    // Compute points A1 and C1
    const A1 = computePointAtDistance(A, B, K);
    const C1 = computePointAtDistance(C, B, K);

    // Create straight line segments A-A1 and C1-C
    const straightSegment1 = new LineCurve3(A, A1);
    const straightSegment2 = new LineCurve3(C1, C);

    // Create quadratic Bézier curve segment A1-B-C1
    const bezierCurve = new QuadraticBezierCurve3(A1, B, C1);

    // Combine the segments into a single curve
    const curvePath = new CurvePath();
    curvePath.add(straightSegment1);
    curvePath.add(bezierCurve);
    curvePath.add(straightSegment2);

    // Create tube geometry
    const tubeGeometry = new TubeGeometry(curvePath, 64, R, 8, false);

    // Create cap geometries
    const capGeometryStart = createCapGeometry(A, R, A.clone().sub(B));
    const capGeometryEnd = createCapGeometry(C, R, C.clone().sub(B));

    const geometries = [tubeGeometry, capGeometryStart, capGeometryEnd];
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);

    return mergedGeometry;

}





// Describe the parameters of each geometry type
// any numeric entry is [default, min, max, step]
// as described here: https://threejs.org/docs/#api/en/geometries/BoxGeometry
const gTypes = {
    sphere: {
        g: SphereGeometry,
        params: {
            radius: [[0.5, 0.01, 100, 0.01], "Radius of the sphere"],
            widthSegments: [10, 4, 40, 1],
            heightSegments: [10, 3, 40, 1],
        }
    },
    ellipsoid: {
        g: EllipsoidGeometry,
        params: {
            radius: [[0.5, 0.01, 100, 0.01], "Horizontal radius of the ellipsoid"],
            aspect: [[1.0, 0.01, 5.0, 0.001], "Aspect ratio - vertical radius / horizontal radius"],
            widthSegments: [32, 4, 64, 1],
            heightSegments: [16, 3, 32, 1],
        }
    },
    box: {
        g: BoxGeometry,
        params: {
            width: [1, 0.01, 100, 0.01],
            height: [1, 0.01, 100, 0.01],
            depth: [1, 0.01, 100, 0.01],
        }
    },
    capsule: {
        g: CapsuleGeometryTL,
        params: {
            radius: [0.5, 0.01, 20, 0.01],
            totalLength: [5, 0.01, 30, 0.01],
            capSegments: [20, 4, 40, 1],
            radialSegments: [20, 4, 40, 1],
        }
    },

    circle: {
        g: CircleGeometry,
        params: {
            radius: [0.5, 0.01, 100, 0.01],
            segments: [10, 3, 100, 1],
        }
    },

    cone: {
        g: ConeGeometry,
        params: {
            radius: [0.5, 0.01, 100, 0.01],
            height: [1, 0, 100, 0.01],
            radialSegments: [10, 4, 40, 1],
            heightSegments: [10, 3, 40, 1],
        }
    },

    cylinder: {
        g: CylinderGeometry,
        params: {
            radiusTop: [0.5, 0.01, 100, 0.01],
            radiusBottom: [0.5, 0.01, 100, 0.01],
            height: [1, 0, 100, 0.01],
            radialSegments: [10, 4, 40, 1],
            heightSegments: [10, 3, 40, 1],
            openEnded: false,
            thetaStart: [0, 0, 2 * Math.PI, 0.01],
            thetaLength: [2 * Math.PI, 0, 2 * Math.PI, 0.1],
        }
    },

    dodecahedron: {
        g: DodecahedronGeometry,
        params: {
            radius: [0.5, 0.1, 100, 0.01],
            detail: [0, 0, 5, 1],
        }
    },

    icosahedron: {
        g: IcosahedronGeometry,
        params: {
            radius: [0.5, 0.01, 100, 0.01],
            detail: [0, 0, 5, 1],
        }
    },

    octahedron: {
        g: OctahedronGeometry,
        params: {
            radius: [0.5, 0.01, 100, 0.01],
            detail: [0, 0, 5, 1],
        }
    },

    ring: {
        g: RingGeometry,
        params: {
            innerRadius: [0.25, 0.0, 100, 0.01],
            outerRadius: [0.5, 0.01, 100, 0.01],
            thetaSegments: [10, 3, 100, 1],
            phiSegments: [10, 3, 100, 1],
            thetaStart: [0, 0, 2 * Math.PI, 0.01],
            thetaLength: [2 * Math.PI, 0, 2 * Math.PI, 0.1],

        }

    },

    tetrahedron: {
        g: TetrahedronGeometry,
        params: {
            radius: [0.5, 0.1, 100, 0.01],
            detail: [0, 0, 5, 1],
        }
    },

    torus: {
        g: TorusGeometry,
        params: {
            radius: [0.5, 0.01, 100, 0.01],
            tube: [0.15, 0.001, 100, 0.001],
            radialSegments: [10, 3, 100, 1],
            tubularSegments: [20, 3, 100, 1],
            arc: [Math.PI * 2, 0, Math.PI * 2, 0.1],
        }
    },

    torusknot: {
        g: TorusKnotGeometry,
        params: {
            radius: [0.5, 0.01, 100, 0.01],
            tube: [0.15, 0.01, 100, 0.01],
            tubularSegments: [64, 3, 100, 1],
            radialSegments: [8, 3, 100, 1],
            p: [2, 1, 10, 1],
            q: [3, 1, 10, 1],
        }
    },

    superegg: {
        g: SuperEggGeometry,
        params: {
            radius: [0.5, 0.01, 30, 0.01],
            length: [4, 0.01, 20, 0.01],
            sharpness: [5.5, 0.1, 10, 0.1],
            widthSegments: [20, 4, 40, 1],
            heightSegments: [20, 3, 40, 1],
        }

    },

    tictac: {
        g: TicTacGeometry,
        params: {
            radius: [2.6, 0.01, 30, 0.01],
            totalLength: [12.2, 0.01, 50, 0.01],
            capSegments: [20, 4, 40, 1],
            radialSegments: [30, 4, 40, 1],
            legRadius: [0.28, 0.001, 5, 0.001],
            legLength1: [1.4, 0.001, 10, 0.001],
            legLength2: [1.4, -5, 5, 0.001],
            legCurveRadius: [0.88, 0.0, 5, 0.001],
            legOffset: [-0.45, -10, 10, 0.001],
            legSpacing: [6.2, 0.0, 20, 0.001],
        }


    }

}

// material types for meshes
const materialTypes = {
    basic: {
        m: MeshBasicMaterial,
        params: {
            color: ["white", "Base Color"],
            fog: [true, "Enable Fog"],
        }
    },

    // lambert, with no maps, essentially just combines the color and emissive
    lambert: {
        m: MeshLambertMaterial,
        params: {
            color: ["white", "Base Color"],
            emissive: ["black", "Emissive color - i.e. the self illuminated color"],
            emissiveIntensity: [[1,0,1,0.01],"Intensity of self-illuiminated color"],
            flatShading: [false, "Enable flat shading - i.e. no smooth shading"],
            fog: [true, "Enable Fog"],

        }
    },

    phong: {
        m: MeshPhongMaterial,
        params: {
            color: ["white", "Base Color"],
            emissive: ["black", "Emissive color - i.e. the self illuminated color"],
            emissiveIntensity: [[1,0,1,0.01],"Intensity of self-illuminated color"],
            specularcolor: ["white", "Base Color"],
            shininess: [[30,0,100,0.1], "Shininess of the specular highlight"],
            flatShading: [false, "Enable flat shading - i.e. no smooth shading"],
            fog: [true, "Enable Fog"],
        }
    },

    physical: {
        m: MeshPhysicalMaterial,
        params: {
            color: ["white", "Base Color"],
            clearcoat: [[1, 0, 1, 0.01], "Clearcoat intensity"],
            clearcoatRoughness: [[0, 0, 1, 0.01], "Clearcoat roughness"],
            emissive: ["black", "Emissive color - i.e. the self illuminated color"],
            emissiveIntensity: [[1, 0, 1, 0.01], "Intensity of self-illuminated color"],
            specularcolor: ["white", "Specular Color"],
            specularIntensity: [[1,0,1,0.01], "Intensity of the specular highlight"],
            sheen: [[0, 0, 1, 0.01], "Sheen intensity"],
            sheenRoughness: [[0.5, 0, 1, 0.01], "Sheen roughness"],
            sheenColor: ["black", "Sheen color"],
            flatShading: [false, "Enable flat shading - i.e. no smooth shading"],
            fog: [true, "Enable Fog"],
            reflectivity: [[1, 0, 1, 0.01], "Reflectivity"],
            transmission: [[0, 0, 1, 0.01], "Transmission"],
            ior: [[1.5, 1, 2.33, 0.01], "Index of Refraction"],
            roughness: [[0.5, 0, 1, 0.01], "Roughness"],
            metalness: [[0.5, 0, 1, 0.01], "Metalness"],
        }
    }

}

const commonMaterialParams = {
    material: [["basic", "lambert", "phong", "physical"],"Type of Material lighting"],
    wireframe: [false, "Display geometry object as a wireframe"],
    edges: [false, "Display geometry object as edges"],
    depthTest: [true, "Enable depth testing"],
    opacity: [[1,0,1,0.01], "Opacity of the object"],
    transparent: [false,"Enable transparency"],
}

const commonParams = {
    geometry: [["sphere", 
        "ellipsoid",
        "box", 
        "capsule", 
        "circle", 
        "cone", 
        "cylinder", 
        "dodecahedron", 
        "icosahedron", 
        "octahedron", 
        "ring", 
        "tictac", 
        "tetrahedron", 
        "torus", 
        "torusknot", 
        "superegg"], "Type of Generated Geometry"],
    rotateX: [[0, -180, 180, 1], "Rotation about the X-axis"],
    rotateY: [[0, -180, 180, 1], "Rotation about the Y-axis"],
    rotateZ: [[0, -180, 180, 1], "Rotation about the Z-axis"],
    applyMaterial: [false, "Apply Material to the 3D model, overriding the loaded materials"],
   // color: "white",
}




export class CNode3DObject extends CNode3DGroup {
    constructor(v) {
        v.layers ??= LAYER.MASK_LOOKRENDER;
        v.color ??= "white"
        v.size ??= 1;

        // patch DON'T convert the color to a constant node
        const oldColor = v.color;
        super(v);
        v.color = oldColor;

        this.input("size", true); // size input is optional

        this.color = v.color;
        this.layers = v.layers; // usually undefined, as the camera handles layers

        let menuName = this.props.name ?? this.id;
        this.gui = guiMenus.objects.addFolder("3D Ob: " + menuName).close()
        this.common = {}
        this.geometryParams = {};
        this.materialParams = {};

        this.common.material = v.material ?? "lambert";
        this.materialFolder = this.gui.addFolder("Material").open();
        this.materialFolder.isCommon = true; //temp patch - not needed?  not a controller???
        this.addParams(commonMaterialParams, this.common, this.materialFolder, true);
        this.rebuildMaterial();

        this.modelOrGeometry = v.modelOrGeometry;
        // if we don't have one, infer it from the presence of either "model" or geometry" in the parameters
        if (this.modelOrGeometry === undefined) {
            if (v.model !== undefined) {
                this.modelOrGeometry = "model";
            } else {
                this.modelOrGeometry = "geometry";
            }
        }

        this.modelOrGeometryMenu = this.gui.add(this, "modelOrGeometry", ["geometry", "model"]).listen().name("Model or Geometry").onChange((v) => {
            this.rebuild();
            setRenderOne(true)
        }).tooltip("Select whether to use a 3D Model or a generated geometry for this object")
            .listen();

        this.modelOrGeometryMenu.isCommon = true;

        this.selectModel = v.model ?? "F/A-18F";
        this.modelMenu = this.gui.add(this, "selectModel", Object.keys(ModelFiles)).name("Model").onChange((v) => {
            this.modelOrGeometry = "model"
            this.rebuild();
            setRenderOne(true)
        })
            .listen()
            .tooltip("Selecte a 3D Model to use for this object");

        this.modelMenu.isCommon = true;

        // add the common parameters to the GUI
        // note we set isCommon to true to flag them as common
        // so they don't get deleted when we rebuild the GUI after object type change
        this.addParams(commonParams, this.common, this.gui, true); // add the common parameters to the GUI

        this.displayBoundingBox = false;

        this.gui.add(this, "displayBoundingBox").name("Display Bounding Box").listen().onChange((v) => {
            this.rebuild();
            setRenderOne(true)
        })
            .tooltip("Display the bounding box of the object with dimensions")
            .isCommon = true;

        // Add export to KML button
       this.gui.add(this, "exportToKML").name("Export to KML")
            .tooltip("Export this 3D object as a KML file for Google Earth")
            .isCommon = true;

        this.rebuild();

        // move the material folder to the end
        this.materialFolder.moveToEnd();

        if (v.label !== undefined) {
            this.addLabel(v.label)
        }
    }


    // We can use objects as data sources for things like labels
    // so we need to be able to get the value of the object
    // Note this just gets the CURRENT position of the object
    getValueFrame(frameFloat) {
        return {position: this.group.position.clone()};
    }

    show(visible) {
        super.show(visible);
        if (this.label !== undefined) {
            this.label.show(visible)
        }
    }


    addLabel( label ) {

        this.label = new CNodeLabel3D({
            id: this.id + "_label",
            text: label,
            position: this,
            layers: (Globals.showLabelsMain ? LAYER.MASK_MAIN : 0) | (Globals.showLabelsLook ? LAYER.MASK_LOOK : 0),
            offsetY:40, // this is vertical offset in screen pixels.
            color: "white",
            size:12,
            groupNode: "LabelsGroupNode",

        })

    }

    // Export the 3D object as a KML file for Google Earth
    async exportToKML() {
        try {
            // Get the current position of the object in EUS coordinates
            const eusPosition = this.group.position.clone();
            
            // Convert EUS position to LLA (Latitude, Longitude, Altitude)
            const lla = EUSToLLA(eusPosition);
            const latitude = lla.x;   // degrees
            const longitude = lla.y;  // degrees  
            const altitude = lla.z;   // meters above sea level
            
            // Get object properties
            const objectName = this.props.name || this.id;
            const geometryType = this.common.geometry || 'sphere';
            
            // Get sitch name for filename prefix
            const sitchName = Sit.sitchName || Sit.name;
            // Generate COLLADA file content
            const colladaResult = this.generateColladaContent(objectName, geometryType);
            const colladaContent = colladaResult.content;
            const colladaFilename = `${objectName}_${geometryType}.dae`;
            
            // Create KML content that references the COLLADA model in files/ directory
            const kmlContent = this.generateKMLContent(objectName, latitude, longitude, altitude, geometryType, `files/${colladaFilename}`);
            
            // Create a KMZ file containing doc.kml and files/model.dae with sitch name prefix
            const kmzFilename = `${sitchName}_${objectName}_${geometryType}.kmz`;
            
            await this.saveAsKMZ(kmlContent, colladaContent, objectName, geometryType, kmzFilename);
            console.log(`KMZ file exported successfully as: ${kmzFilename}`);
            console.log(`COLLADA contains ${colladaResult.vertexCount} vertices, ${colladaResult.triangleCount} triangles`);
            console.log(`Material: ${colladaResult.materialInfo.color}, opacity: ${colladaResult.materialInfo.opacity}`);
            
            alert(`3D object exported successfully!\n\nFile saved:\n- ${kmzFilename} (KMZ archive with embedded 3D model)\n\nIMPORTANT:\n1. Open the KMZ file directly in Google Earth\n2. The 3D object will appear at the specified location\n3. No extraction needed - everything is packaged together!\n\nNote: KMZ is the standard format for 3D models in Google Earth.`);
            
        } catch (error) {
            console.error('Error exporting to KML:', error);
            alert('Error exporting to KML: ' + error.message);
        }
    }

    // Generate KML content for the 3D object
    generateKMLContent(name, latitude, longitude, altitude, geometryType, colladaFilename) {
        // Get object dimensions based on geometry type
        const dimensions = this.getObjectDimensions(geometryType);
        
        // Get material properties
        const materialInfo = this.getMaterialInfo();
        
        // Create description with object details
        const description = `
            <![CDATA[
            <h3>3D Object: ${name}</h3>
            <p><strong>Type:</strong> ${geometryType}</p>
            <p><strong>Position:</strong></p>
            <ul>
                <li>Latitude: ${latitude.toFixed(6)}°</li>
                <li>Longitude: ${longitude.toFixed(6)}°</li>
                <li>Altitude: ${altitude.toFixed(2)} m</li>
            </ul>
            <p><strong>Dimensions:</strong></p>
            <ul>
                ${dimensions.map(dim => `<li>${dim.name}: ${dim.value.toFixed(3)} ${dim.unit}</li>`).join('')}
            </ul>
            <p><strong>Material:</strong></p>
            <ul>
                <li>Type: ${materialInfo.type}</li>
                <li>Color: ${materialInfo.color}</li>
                <li>Opacity: ${materialInfo.opacity.toFixed(2)}</li>
                ${materialInfo.transparent ? '<li>Transparent: Yes</li>' : ''}
            </ul>
            <p><em>Exported from Sitrec</em></p>
            ]]>
        `;

        // Get object scale for proper sizing in Google Earth
        const scale = this.getObjectScale();

        // Generate KML with 3D model reference
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
        <name>${name} - ${geometryType}</name>
        <description>3D Object exported from Sitrec</description>
        
        <Placemark>
            <name>${name}</name>
            <description>${description}</description>
            <Model>
                <altitudeMode>absolute</altitudeMode>
                <Location>
                    <longitude>${longitude}</longitude>
                    <latitude>${latitude}</latitude>
                    <altitude>${altitude}</altitude>
                </Location>
                <Orientation>
                    <heading>0</heading>
                    <tilt>0</tilt>
                    <roll>0</roll>
                </Orientation>
                <Scale>
                    <x>${scale.x}</x>
                    <y>${scale.y}</y>
                    <z>${scale.z}</z>
                </Scale>
                <Link>
                    <href>${colladaFilename}</href>
                </Link>
            </Model>
        </Placemark>
    </Document>
</kml>`;

        return kml;
    }

    // Get object dimensions based on geometry type
    getObjectDimensions(geometryType) {
        const dimensions = [];
        
        switch (geometryType) {
            case 'sphere':
                if (this.geometryParams.radius !== undefined) {
                    dimensions.push({ name: 'Radius', value: this.geometryParams.radius, unit: 'm' });
                }
                break;
                
            case 'ellipsoid':
                if (this.geometryParams.radius !== undefined) {
                    dimensions.push({ name: 'Horizontal Radius', value: this.geometryParams.radius, unit: 'm' });
                }
                if (this.geometryParams.aspect !== undefined && this.geometryParams.radius !== undefined) {
                    dimensions.push({ name: 'Vertical Radius', value: this.geometryParams.radius * this.geometryParams.aspect, unit: 'm' });
                }
                break;
                
            case 'box':
                if (this.geometryParams.width !== undefined) {
                    dimensions.push({ name: 'Width', value: this.geometryParams.width, unit: 'm' });
                }
                if (this.geometryParams.height !== undefined) {
                    dimensions.push({ name: 'Height', value: this.geometryParams.height, unit: 'm' });
                }
                if (this.geometryParams.depth !== undefined) {
                    dimensions.push({ name: 'Depth', value: this.geometryParams.depth, unit: 'm' });
                }
                break;
                
            case 'capsule':
                if (this.geometryParams.radius !== undefined) {
                    dimensions.push({ name: 'Radius', value: this.geometryParams.radius, unit: 'm' });
                }
                if (this.geometryParams.totalLength !== undefined) {
                    dimensions.push({ name: 'Total Length', value: this.geometryParams.totalLength, unit: 'm' });
                }
                break;
                
            case 'cylinder':
                if (this.geometryParams.radiusTop !== undefined) {
                    dimensions.push({ name: 'Top Radius', value: this.geometryParams.radiusTop, unit: 'm' });
                }
                if (this.geometryParams.radiusBottom !== undefined) {
                    dimensions.push({ name: 'Bottom Radius', value: this.geometryParams.radiusBottom, unit: 'm' });
                }
                if (this.geometryParams.height !== undefined) {
                    dimensions.push({ name: 'Height', value: this.geometryParams.height, unit: 'm' });
                }
                break;
                
            default:
                // For other geometry types, try to get common parameters
                if (this.geometryParams.radius !== undefined) {
                    dimensions.push({ name: 'Radius', value: this.geometryParams.radius, unit: 'm' });
                }
                if (this.geometryParams.height !== undefined) {
                    dimensions.push({ name: 'Height', value: this.geometryParams.height, unit: 'm' });
                }
                break;
        }
        
        return dimensions;
    }

    // Save KML file with proper file type configuration
    async saveKMLFile(contents, suggestedName = 'object.kml') {
        try {
            // Use the File System Access API with KML file type
            const fileHandle = await window.showSaveFilePicker({
                suggestedName,
                types: [{
                    description: 'KML Files',
                    accept: {
                        'application/vnd.google-earth.kml+xml': ['.kml'],
                        'text/xml': ['.kml'],
                    }
                }]
            });

            const writable = await fileHandle.createWritable();
            await writable.write(contents);
            await writable.close();

            console.log('KML file saved successfully!');
            return fileHandle.name;

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('File save was cancelled by user');
                throw new Error('File save cancelled');
            } else {
                console.error('Error saving KML file:', error);
                throw error;
            }
        }
    }

    // Get material information for KML description
    getMaterialInfo() {
        const material = this.material || this.object?.material;
        if (!material) {
            return {
                type: 'Unknown',
                color: '#ffffff',
                opacity: 1.0,
                transparent: false
            };
        }

        // Convert Three.js color to hex string
        const colorHex = material.color ? `#${material.color.getHexString()}` : '#ffffff';
        
        return {
            type: this.common.material || 'basic',
            color: colorHex,
            opacity: material.opacity || 1.0,
            transparent: material.transparent || false
        };
    }

    // Get object scale for KML model
    getObjectScale() {
        // Get the geometry bounds to determine appropriate scaling
        const geometry = this.geometry;
        if (geometry && geometry.boundingBox) {
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            const size = Math.max(
                box.max.x - box.min.x,
                box.max.y - box.min.y,
                box.max.z - box.min.z
            );
            
            // Scale to ensure the model is visible in Google Earth (target size ~10-100 meters)
            let scale = 1.0;
            if (size < 1) {
                scale = 10.0; // Scale up very small objects
            } else if (size > 100) {
                scale = 50.0 / size; // Scale down very large objects
            }
            
            return { x: scale, y: scale, z: scale };
        }
        
        // Default scale - use 1.0 for normal sized objects
        return { x: 1.0, y: 1.0, z: 1.0 };
    }

    // Generate COLLADA (.dae) file content
    generateColladaContent(name, geometryType) {
        let geometry, material;
        
        // Handle both procedural geometry and loaded models
        if (this.modelOrGeometry === "model" && this.model) {
            // For loaded models, extract geometry from the first mesh
            let firstMesh = null;
            this.model.traverse((child) => {
                if (child.isMesh && !firstMesh) {
                    firstMesh = child;
                }
            });
            
            if (!firstMesh) {
                throw new Error('No mesh found in the loaded model');
            }
            
            geometry = firstMesh.geometry;
            material = firstMesh.material;
            geometryType = 'model';
        } else {
            // For procedural geometry
            geometry = this.geometry;
            material = this.material || this.object?.material;
            
            if (!geometry) {
                throw new Error('No geometry available for COLLADA export');
            }

            // Check if object is in wireframe or edges mode
            if (this.common.wireframe || this.common.edges) {
                throw new Error('Cannot export wireframe or edges geometry to COLLADA. Please disable wireframe/edges mode and try again.');
            }
        }

        // Get geometry data
        const vertices = this.getVerticesFromGeometry(geometry);
        const normals = this.getNormalsFromGeometry(geometry);
        const indices = this.getIndicesFromGeometry(geometry);
        
        // Get material properties
        const materialInfo = this.getMaterialInfo();
        
        // Generate unique IDs
        const geometryId = `${name}-geometry`;
        const materialId = `${name}-material`;
        const effectId = `${name}-effect`;
        
        // Create COLLADA XML content
        const collada = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
    <asset>
        <contributor>
            <authoring_tool>Sitrec</authoring_tool>
        </contributor>
        <created>${new Date().toISOString()}</created>
        <modified>${new Date().toISOString()}</modified>
        <unit name="meter" meter="1"/>
        <up_axis>Y_UP</up_axis>
    </asset>
    
    <library_effects>
        <effect id="${effectId}">
            <profile_COMMON>
                <technique sid="common">
                    <phong>
                        <emission>
                            <color sid="emission">0.0 0.0 0.0 1.0</color>
                        </emission>
                        <ambient>
                            <color sid="ambient">0.2 0.2 0.2 1.0</color>
                        </ambient>
                        <diffuse>
                            <color sid="diffuse">${this.colorToRGBA(materialInfo.color, materialInfo.opacity)}</color>
                        </diffuse>
                        <specular>
                            <color sid="specular">0.5 0.5 0.5 1.0</color>
                        </specular>
                        <shininess>
                            <float sid="shininess">20.0</float>
                        </shininess>
                        ${materialInfo.transparent && materialInfo.opacity < 1.0 ? `
                        <transparent opaque="A_ONE">
                            <color sid="transparent">1.0 1.0 1.0 1.0</color>
                        </transparent>
                        <transparency>
                            <float sid="transparency">${materialInfo.opacity}</float>
                        </transparency>` : ''}
                    </phong>
                </technique>
            </profile_COMMON>
        </effect>
    </library_effects>
    
    <library_materials>
        <material id="${materialId}" name="${name}-material">
            <instance_effect url="#${effectId}"/>
        </material>
    </library_materials>
    
    <library_geometries>
        <geometry id="${geometryId}" name="${name}-geometry">
            <mesh>
                <source id="${geometryId}-positions">
                    <float_array id="${geometryId}-positions-array" count="${vertices.length}">
                        ${vertices.join(' ')}
                    </float_array>
                    <technique_common>
                        <accessor source="#${geometryId}-positions-array" count="${vertices.length / 3}" stride="3">
                            <param name="X" type="float"/>
                            <param name="Y" type="float"/>
                            <param name="Z" type="float"/>
                        </accessor>
                    </technique_common>
                </source>
                
                <source id="${geometryId}-normals">
                    <float_array id="${geometryId}-normals-array" count="${normals.length}">
                        ${normals.join(' ')}
                    </float_array>
                    <technique_common>
                        <accessor source="#${geometryId}-normals-array" count="${normals.length / 3}" stride="3">
                            <param name="X" type="float"/>
                            <param name="Y" type="float"/>
                            <param name="Z" type="float"/>
                        </accessor>
                    </technique_common>
                </source>
                
                <vertices id="${geometryId}-vertices">
                    <input semantic="POSITION" source="#${geometryId}-positions"/>
                </vertices>
                
                <triangles material="material0" count="${indices.length / 3}">
                    <input semantic="VERTEX" source="#${geometryId}-vertices" offset="0"/>
                    <input semantic="NORMAL" source="#${geometryId}-normals" offset="0"/>
                    <p>${indices.join(' ')}</p>
                </triangles>
            </mesh>
        </geometry>
    </library_geometries>
    
    <library_visual_scenes>
        <visual_scene id="Scene" name="Scene">
            <node id="${name}" name="${name}" type="NODE">
                <instance_geometry url="#${geometryId}">
                    <bind_material>
                        <technique_common>
                            <instance_material symbol="material0" target="#${materialId}"/>
                        </technique_common>
                    </bind_material>
                </instance_geometry>
            </node>
        </visual_scene>
    </library_visual_scenes>
    
    <scene>
        <instance_visual_scene url="#Scene"/>
    </scene>
</COLLADA>`;

        return {
            content: collada,
            vertexCount: vertices.length / 3,
            triangleCount: indices.length / 3,
            materialInfo: materialInfo
        };
    }

    // Extract vertices from Three.js geometry
    getVerticesFromGeometry(geometry) {
        const positions = geometry.attributes.position;
        if (!positions) {
            throw new Error('Geometry has no position attribute');
        }
        
        // Convert vertices and ensure they're properly scaled for Google Earth
        const vertices = Array.from(positions.array);
        const transformedVertices = [];
        
        // Transform vertices to ensure proper orientation for Google Earth
        // Google Earth uses Y-up coordinate system
        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];
            const z = vertices[i + 2];
            
            // Keep the same coordinate system but ensure reasonable scale
            transformedVertices.push(x, y, z);
        }
        
        return transformedVertices;
    }

    // Extract normals from Three.js geometry
    getNormalsFromGeometry(geometry) {
        let normals = geometry.attributes.normal;
        if (!normals) {
            // Compute normals if they don't exist - using optimized version
            fastComputeVertexNormals(geometry);
            normals = geometry.attributes.normal;
        }
        return Array.from(normals.array);
    }

    // Extract indices from Three.js geometry
    getIndicesFromGeometry(geometry) {
        const index = geometry.index;
        if (index) {
            return Array.from(index.array);
        } else {
            // Generate indices for non-indexed geometry
            const vertexCount = geometry.attributes.position.count;
            const indices = [];
            for (let i = 0; i < vertexCount; i++) {
                indices.push(i);
            }
            return indices;
        }
    }

    // Convert hex color to RGBA string for COLLADA
    colorToRGBA(hexColor, opacity = 1.0) {
        // Remove # if present
        const hex = hexColor.replace('#', '');
        
        // Parse RGB values
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        
        return `${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)} ${opacity.toFixed(6)}`;
    }

    // Save KML and COLLADA files as a KMZ archive with proper structure
    async saveAsKMZ(kmlContent, colladaContent, objectName, geometryType, suggestedName) {
        try {
            // Import JSZip dynamically
            const JSZip = (await import('jszip')).default;
            
            const kmz = new JSZip();
            
            // Add doc.kml file to root of KMZ (required name for KMZ format)
            kmz.file('doc.kml', kmlContent);
            
            // Create files/ directory and add COLLADA file
            const colladaFilename = `${objectName}_${geometryType}.dae`;
            kmz.file(`files/${colladaFilename}`, colladaContent);
            
            // Generate KMZ blob (which is just a ZIP with .kmz extension)
            const kmzBlob = await kmz.generateAsync({type: 'blob'});
            
            // Use File System Access API to save KMZ
            const fileHandle = await window.showSaveFilePicker({
                suggestedName,
                types: [{
                    description: 'Google Earth KMZ Files',
                    accept: {
                        'application/vnd.google-earth.kmz': ['.kmz'],
                        'application/zip': ['.kmz'],
                    }
                }]
            });

            const writable = await fileHandle.createWritable();
            await writable.write(kmzBlob);
            await writable.close();

            console.log('KMZ file saved successfully!');
            return fileHandle.name;

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('KMZ file save was cancelled by user');
                throw new Error('KMZ file save cancelled');
            } else {
                console.error('Error saving KMZ file:', error);
                throw error;
            }
        }
    }

    modSerialize() {
        return {
            ...super.modSerialize(),
            color: this.color,
            modelOrGeometry: this.modelOrGeometry,
            model: this.selectModel,
            common: this.common,
            geometryParams: this.geometryParams,
            materialParams: this.materialParams,
            // might need a modelParams


        }
    }

    modDeserialize(v) {
        super.modDeserialize(v)
        this.color = v.color;
        this.modelOrGeometry = v.modelOrGeometry;
        this.selectModel = v.model;



        // copy the values from v.common, v.geometryParams, v.materialParams
        // to this.common, this.geometryParams, this.materialParams
        // we need to copy the values, not just assign the object
        // because the GUI is referencing the values in this.common, etc
        // and so creating a new object would break the GUI
        for (const key in v.common) {
            this.common[key] = v.common[key];
        }

        if (this.modelOrGeometry === "geometry") {
            // we do an initial rebuild of geometry to set up the parameters
            // with this.common.geometry
            // otherwise parameters will get reset to defaults
            this.rebuild();
        }

        for (const key in v.geometryParams) {
            this.geometryParams[key] = v.geometryParams[key];
        }
        for (const key in v.materialParams) {
            this.materialParams[key] = v.materialParams[key];
        }

        // might need a modelParams

        this.rebuildMaterial();
        this.rebuild();



    }

//   // this is the function that adds the parameters to the GUI
    // it takes the geometryParams and materialParams objects
    // and adds them to the GUI
    // it also sets the default values for the parameters
    // and sets the tooltip for the parameters
    // the geometryParams and materialParams objects are passed in as arrays
    // so they can be used as a template for the GUI
    // the first element is the default value, the second element is the tooltip
    // the third element is the min value, the fourth element is the max value
    // the fifth element is the step value
    // the sixth element is the type of parameter (string, number, boolean, array)
    // the seventh element is the name of the parameter
    addParams(geometryParams, toHere, gui, isCommon=false) {
        const v = this.props;
        for (const key in geometryParams) {
            let params = geometryParams[key][0];
            let tip = geometryParams[key][1];


            // if the geometryParams[key] is an array of four numbers, then
            // set paramps to that array, and set tip to the key
            if (geometryParams[key].length === 4) {
                params = geometryParams[key];
                tip = key;
            }

            if (v[key] === undefined) {
                // if no value is given, then use the first value in the array
                // (the default value)
                // or the value itself if it's not an array
                if (Array.isArray(params) && key !== "color") {
                    v[key] = params[0];
                } else {
                    v[key] = params;
                }
            }
            toHere[key] = v[key];

            let controller;

            const colorNames = ["color", "emissive", "specularColor", "sheenColor"]
            if (colorNames.includes(key)) {
                // assume string values are colors
                // (might need to have an array of names of color keys, like "emissive"
              // add color picker
                // its going to be to controlling toHere[key]
                // which will be this.common.color
                // first we need to ensure it's in the correct format for lil-gui
                // which expect a hex string like "#RRGGBB"

                let passedColor = toHere[key];
                let color3;
                if (Array.isArray(passedColor)) {
                    // the only format three.js can't handle is an array
                    color3 = new Color(passedColor[0], passedColor[1], passedColor[2]);
                } else {
                    // otherwise it's a hex string, or a three.js color
                    color3 = new Color(passedColor);
                }
                toHere[key] = "#" + color3.getHexString();
                controller = gui.addColor(toHere, key).name(key).listen()
                    .onChange((v) => {
                        this.rebuild();
                        setRenderOne(true)
                    }).tooltip(tip);

            } else if (Array.isArray(params)) {

                const elastic = ["radius", "length", "height", "width", "depth", "tube", "innerRadius", "outerRadius", "height", "totalLength", "radiusTop", "radiusBottom",];
                const isElastic = elastic.includes(key);


                // is the firsts value in the array a number?
                if (typeof params[0] === "number") {
                    // and make a gui slider for the parameter
                    controller = gui.add(toHere, key, params[1], params[2], params[3]).name(key).listen()
                        .onChange((v) => {
                            this.rebuild();
                            setRenderOne(true)
                        }).tooltip(tip);
                    if (isElastic) {
                        // elastic means the range will expand 2x when you go of the right end
                        // and reset to the minimum when you go off the left end
                        // Upper limit not too important, so we just set it to 1000x the default
                        controller.elastic(params[2]/100, params[2] * 1000)
                    }

                } else {
                    // assume it's a string, so a drop-down
                    // make a drop-down for the parameter
                    controller = gui.add(toHere, key, params).name(key).listen()
                        .onChange((v) => {
                            if (key === "geometry") {
                                this.modelOrGeometry = "geometry"
                            }
                            this.rebuild();
                            setRenderOne(true)
                        }).tooltip(tip);
                }

            } else {
                // if it's not an array, then it's a boolean
                // so make a checkbox
                controller = gui.add(toHere, key).name(key).listen()
                    .onChange((v) => {
                        this.rebuild();
                        setRenderOne(true);
                        // Note: updateControlVisibility() is already called in rebuild(), so no need to call it again
                    }).tooltip(tip);
            }

            controller.isCommon = isCommon;

        }
    }

    updateControlVisibility() {
        // Define controller visibility rules
        // Each entry: [controllerProperty, showInModelMode, customLogic]
        const controllerVisibilityRules = [
            ['applyMaterial', true, null], // Show in model mode, hide in geometry mode
            ['selectModel', true, null], // Show in model mode, hide in geometry mode
            ['geometry', false, null], // Hide in model mode, show in geometry mode
            ['exportToKML', false, null], // Hide in model mode, show in geometry mode
        ];

        // Apply visibility rules for standard controllers
        controllerVisibilityRules.forEach(([controllerProperty, showInModelMode]) => {

            //  find the controller in this.gui.children
            // then show/hide it depending on the rule
            const controller = this.gui.children.find(c => c.property === controllerProperty);

            const isModelMode = this.modelOrGeometry === "model";

            if (controller) {
                if ((isModelMode && showInModelMode) || (!isModelMode && !showInModelMode)) {
                    controller.show();
                } else {
                    controller.hide();
                }
            } else {
                console.error(`Controller property '${controllerProperty}' not found in this.gui in updateControlVisibility`)
            }
        });

        // Handle material folder with custom logic (depends on both mode and applyMaterial setting)
        if (this.materialFolder) {
            if (this.modelOrGeometry === "model" && !this.common.applyMaterial) {
                this.materialFolder.hide();
            } else {
                this.materialFolder.show();
            }
        }
    }




    rebuild() {
        let newType = false;
        if (this.modelOrGeometry !== this.lastModelOrGeometry) {
            this.lastModelOrGeometry = this.modelOrGeometry;
            newType = true;
        }

        this.updateControlVisibility();

        // remove the BB measure, in case we don't rebuild them
        NodeMan.disposeRemove(this.measureX, true);
        this.measureX  = undefined;
        NodeMan.disposeRemove(this.measureY, true);
        this.measureY  = undefined;
        NodeMan.disposeRemove(this.measureZ, true);
        this.measureZ  = undefined;


        const v = this.props;

        const common = this.common;

        this.rebuildMaterial();


        if (this.modelOrGeometry === "model") {
            // Remove geometry parameters from UI when switching to model mode
            if (newType) {
                this.destroyNonCommonUI(this.gui);
            }

            // load the model if differ  ent, this will be async
            // here this.selectModel is the NAME of the model (id or drag and drop filename
            // and this.currentModel points to a model def object (which currently just just a file)
            // so this.currentModel.file is the filename of the last loaded file
            const model = ModelFiles[this.selectModel];

            if (model !== this.currentModel || newType) {

                // if the new model and the old model are BOTH dynamic
                // then we need to remove the old model from the file manager and the GUI
                // Otherwise we'll accumulate models that will get loaded but are not used
                // if the new model has not been loaded yet, then we also need to remove the old model
                // we do that test first, as isUnhosted will assert if the file doesn't exist

                if (this.currentModel
                    && FileManager.isUnhosted(this.currentModel.file)
                    && (!FileManager.exists(this.selectModel) || FileManager.isUnhosted(this.selectModel))
                ) {
                    console.log(`Removing unhosted file: ${this.currentModel.file}, replacing with ${model.file}`)
                    FileManager.disposeRemove(this.currentModel.file);
                    // will need to remove from GUI. after we implement adding it ...

                }


                this.currentModel = model;


                //const loader = new GLTFLoader();
                console.log("LOADING NEW GLTF model: ", model.file);

                Globals.pendingActions++;
                loadGLTFModel(model.file, gltf => {
                    // since it's async, we might now be rendering a geometry
                    // If so, then don't add the model to the group
                    if (this.modelOrGeometry === "model") {

                        // destroy the existing object AFTER the new one is loaded
                        // otherwise we might start loading a new object before the last one had finished loading
                        // so the first one will still get added
                        this.destroyObject();
                        this.destroyLights();

                        this.model = gltf.scene;

                        if (Globals.shadowsEnabled) {
                            this.model.castShadow = true;
                            this.model.receiveShadow = true;
                        }

                        this.extractLightsFromModel(this.model);

                        this.group.add(this.model);
                        this.propagateLayerMask()
                        this.recalculate()
                        this.applyMaterialToModel();
                        this.rebuildBoundingBox();
                        console.log("ADDED TO SCENE : ", model.file);
                        setRenderOne(true);

                    }
                    Globals.pendingActions--;
                });
            }


            if (this.common.applyMaterial) {
                this.applyMaterialToModel();
            } else {
                // restore the original materials
                if (this.model) {
                    this.model.traverse((child) => {
                        if (child.isMesh && child.originalMaterial) {
                            child.material = child.originalMaterial;
                            child.originalMaterial = undefined;
                        }
                    });
                }
            }
            this.rebuildBoundingBox();
            return;
        }


        this.destroyObject();
        this.destroyLights();

        // set up inputs based on the geometry type
        // add the defaults if a parameter is missing
        // and add UI controls for the parameters
        const geometryType = common.geometry.toLowerCase();
        const geometryDef = gTypes[geometryType];
        assert(geometryDef !== undefined, "Unknown geometry type: " + geometryType)
        const geometryParams = geometryDef.params;
        // for all the parameters in the geometry type
        // add them to the geometryParams object
        // (either the passed value, or a default)



        // if the geometry or material type has changed, or if we're switching from model to geometry mode
        // then delete all the geometry-specific parameters and re-create them
        if (this.lastGeometry !== common.geometry || newType) {
            this.destroyNonCommonUI(this.gui);

            // and re-create them
            this.geometryParams = {}
            this.addParams(geometryParams, this.geometryParams, this.gui);

            // move the material folder to the end after adding geometry parameters
            this.materialFolder.moveToEnd();

            this.lastGeometry = common.geometry;
        }


        // // map them to the variables in this.geometryParams
        const params = Object.keys(this.geometryParams)
            .map(key => this.geometryParams[key]);

        this.geometry = new geometryDef.g(...params);

        // Apply special geometry-specific rotation adjustments to the geometry itself
        // These are baked-in rotations that are specific to certain geometry types
        const geometryRotateX = ((common.geometry === "capsule" || common.geometry === "tictac") ? 90 : 0);
        if (geometryRotateX) {
            this.geometry.rotateX(geometryRotateX * Math.PI / 180);
        }

        // Note: User-defined rotations (rotateX, rotateY, rotateZ) are now applied 
        // as transforms in preRender() instead of being baked into the geometry

        if (common.wireframe) {
            this.wireframe = new WireframeGeometry(this.geometry);
            this.object = new LineSegments(this.wireframe);
        } else if (common.edges) {
            this.wireframe = new EdgesGeometry(this.geometry);
            this.object = new LineSegments(this.wireframe);
        } else {
            this.object = new Mesh(this.geometry, this.material);
        }

        // const matColor = new Color(common.color)
        // this.object.material.color = matColor;

        this.object.material.depthTest = common.depthTest ?? true;
        this.object.material.opacity = common.opacity ?? 1;
        this.object.material.transparent = common.transparent ?? (v.opacity < 1.0);

        if (Globals.shadowsEnabled) {
            this.object.castShadow = true;
            this.object.receiveShadow = true;
        }
        this.group.add(this.object);
        this.propagateLayerMask()
        this.recalculate()

        this.rebuildBoundingBox();

    }


    lightNamesToIgnore = [
        "Sky_Dome",
        "Light",  // the default light name in the blender cube scene, so often used, but not needed
        "Moon_Light",
        "Lensflare_Source",
        "Sun_light",


    ]

    // model is a THREE.Scene loaded from a GLTF
    // it will have children which are lights
    // we detect them and turn them off
    extractLightsFromModel(model) {
        this.destroyLights();
        model.traverse((child) => {
            if (child.isLight) {
                // turn off the light
                child.visible = false;

                // check if the light name is in the list of names to ignore
                if (this.lightNamesToIgnore.includes(child.name)) {
                    // if it is, then just skip it
                    return;
                }

                //check if it's a point light
                if (child.isPointLight) {
                    // if it's a point light, we can use it as a CNode3DLight
                    // so we create a CNode3DLight for it
                    // and add it to the group
                    // this will allow us to control the light from the GUI
                    // and also to turn it on/off
                }

                const light = new CNode3DLight({
                    id: this.id + "_" + child.name,
                    light: child,
                    scene: this.group,
                })

                this.lights.push(light);

            }
        });

    }


    rebuildBoundingBox(force = true)
    {

        // if we are displauing a bonding box, then do it
        if (this.displayBoundingBox) {

            // only recalculate the box if forced
            if (force) {


                if (this.modelOrGeometry === "model") {
                    // the model might not be loaded yet
                    // so just skip it if it's not
                    if (this.model !== undefined) {
                        // detach from the group
                        this.group.remove(this.model);

                        // ensure the matrix is up to date
                        this.model.updateMatrixWorld(true);

                        // store the original matrix
                        const matrix = this.model.matrix.clone();
                        // set the matrix to the identity
                        this.model.matrix.identity();
                        // update the world matrix
                        this.model.updateWorldMatrix(true, true);


                        this.boundingBox = new Box3();
                        this.boundingBox.setFromObject(this.model);

                        // restore the original matrix
                        this.model.matrix.copy(matrix);
                        this.model.updateWorldMatrix(true, true);
                        // re-attach to the group
                        this.group.add(this.model);

                        if (this.layers) {
                            this.group.layers.mask = this.layers;
                            propagateLayerMaskObject(this.group);
                        }
                    }

                } else {
                    this.object.geometry.computeBoundingBox();
                    this.boundingBox = this.object.geometry.boundingBox;
                }
            }

            if (!this.boundingBox) {
                return;
            }


            const min = this.boundingBox.min.clone();
            const max = this.boundingBox.max.clone();

            // transform them by this.group
            min.applyMatrix4(this.group.matrixWorld);
            max.applyMatrix4(this.group.matrixWorld);

            // calculate all the corners of the bounding box
            const corners = [];
            for (let i = 0; i < 8; i++) {
                const x = i & 1 ? max.x : min.x;
                const y = i & 2 ? max.y : min.y;
                const z = i & 4 ? max.z : min.z;
                corners.push(V3(x, y, z));
            }

            // calculate three edges of the bounding box about
            // the corner which is closest to the camera

            const cameraNode = NodeMan.get("mainCamera");
            const camPos = cameraNode.camera.position;
            let closest = 0;
            let closestDist = 1000000;
            for (let i = 0; i < 8; i++) {
                const dist = corners[i].distanceTo(camPos);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = i;
                }
            }

            // only rebuild it if the closest corner has changed
            // or forced (some external change, like size)
            if (force || this.lastClosest !== closest) {

                this.lastClosest = closest;

                // now we have the closest corner, we can calculate the three edges
                const AX = corners[closest];
                const BX = corners[closest ^ 1];
                const AY = corners[closest];
                const BY = corners[closest ^ 2];
                const AZ = corners[closest];
                const BZ = corners[closest ^ 4];

                //
                NodeMan.disposeRemove(this.measureX, true);
                NodeMan.disposeRemove(this.measureY, true);
                NodeMan.disposeRemove(this.measureZ, true);

                this.measureX = new CNodeMeasureAB({
                    id: this.id + "_AX",
                    A: AX,
                    B: BX,
                    color: "#ff8080",
                    text: "X",
                    unitType: "small"
                })
                this.measureY = new CNodeMeasureAB({
                    id: this.id + "_AY",
                    A: AY,
                    B: BY,
                    color: "#80ff80",
                    text: "X",
                    unitType: "small"
                })
                this.measureZ = new CNodeMeasureAB({
                    id: this.id + "_AZ",
                    A: AZ,
                    B: BZ,
                    color: "#8080ff",
                    text: "X",
                    unitType: "small"
                })
            }
        }
    }

    rebuildMaterial()
    {
        const materialType = this.common.material.toLowerCase();
        const materialDef = materialTypes[materialType];
        assert(materialDef !== undefined, "Unknown material type: " + materialType)

        // if the material type has changed, then delete all the material-specific parameters
        // and re-create them for the new material type
        if (this.lastMaterial !== materialType) {

            // remove all the non-common children of the material folder
            this.destroyNonCommonUI(this.materialFolder)




            this.lastMaterial = materialType
            const materialParams = materialDef.params;
            this.materialParams = {}
            this.addParams(materialParams, this.materialParams, this.materialFolder);
        }

        if (this.material)  {
            this.material.dispose();
        }

        //this.lastMaterial = this.common.material;
        this.material = new materialDef.m({
            //  color: this.common.color,
            ...this.materialParams
        });
    }

    applyMaterialToModel() {
        // iterate over all the meshes in the model
        // and apply this.material to them

        if (this.model === undefined || !this.common.applyMaterial) {
            return;
        }
        this.model.traverse((child) => {
            if (child.isMesh) {
                if (child.originalMaterial === undefined) {
                    // save the original material so we can restore it later
                    child.originalMaterial = child.material;
                }
                child.material = this.material.clone();
                // // if the material has a map, then set the colorSpace to NoColorSpace
                // if (child.material.map) {
                //     child.material.map.colorSpace = NoColorSpace;
                // }
                // if (child.material.emissiveMap) {
                //     child.material.emissiveMap.colorSpace = NoColorSpace;
                // }
            }
        });

    }


    destroyNonCommonUI(gui) {
        // delete the non-common children of this.gui
        // iterate backwards so we can delete as we go
        for (let i = gui.controllers.length - 1; i >= 0; i--) {
            let c = gui.controllers[i];
            if (!c.isCommon) {
                c.destroy();
                // Explicitly remove the controller from the array if destroy() didn't do it
                if (gui.controllers[i] === c) {
                    gui.controllers.splice(i, 1);
                }
            }
        }
    }

    destroyObject() {
        if (this.object) {
            this.object.geometry.dispose();
            this.object.material.dispose();
            this.group.remove(this.object);
            this.object = undefined;
        }

        // remove any lights from the model
        this.destroyLights();

        if (this.material) {
            this.material.dispose();
        }

        if (this.model) {
            this.group.remove(this.model);
            disposeScene(this.model)
            this.model = undefined
        }

    }

    destroyLights() {
        if (this.lights !== undefined) {
            // if we have lights, then dispose them
            for (const light of this.lights) {
                NodeMan.disposeRemove(light, true);
            }
        }
        this.lights = [];
    }

    preRender(view) {
        // Apply user-defined rotations as transforms to the group
        // This works for both geometries and models, providing consistent behavior
        const common = this.common;
        if (!common) return; // Safety check
        
        const target = this.group;
        if (target && (common.rotateX || common.rotateY || common.rotateZ)) {
            this.needsUndo = true;
            
            // Store the original position and quaternion
            this.origPosition = target.position.clone();
            this.origQuaternion = target.quaternion.clone();
            this.origScale = target.scale.clone();
            
            // Apply user-defined rotations by multiplying rotation matrices

            // Y first, it's the heading/yaw
            if (common.rotateY) {
                target.rotateY(common.rotateY * Math.PI / 180);
            }

            // X next, it's the pitch
            if (common.rotateX) {
                target.rotateX(common.rotateX * Math.PI / 180);
            }

            // Z last, it's the roll/bank
            if (common.rotateZ) {
                target.rotateZ(common.rotateZ * Math.PI / 180);
            }
            
            // Update matrices after rotation changes
            target.updateMatrix();
            target.updateMatrixWorld();
        }
    }
    
    postRender(view) {
        // Restore the original transformation state
        if (this.needsUndo && this.group && this.origQuaternion) {
            // Restore the original position, quaternion, and scale
            this.group.position.copy(this.origPosition);
            this.group.quaternion.copy(this.origQuaternion);
            this.group.scale.copy(this.origScale);
            
            // Update matrices after restoring state
            this.group.updateMatrix();
            this.group.updateMatrixWorld();
            this.needsUndo = false;
        }
    }

    dispose() {
        if (this.label) {
            NodeMan.disposeRemove(this.label, true);
        }
        this.gui.destroy();
        this.destroyObject();
        super.dispose();
    }

    recalculate() {
        const scale = this.in.size.v0 * Globals.objectScale;
        this.group.scale.setScalar(scale);
    }

    update(f) {
        super.update(f);

        // if (this.spriteText) {
        //     this.spriteText.position.copy(this._object.position);
        //     this.spriteText.position.y += 0.1;
        // }

       // this.rebuildBoundingBox(false);
    }


}
