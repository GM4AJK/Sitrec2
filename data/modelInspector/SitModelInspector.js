export const SitModelInspector = {
    name: "modelinspector",                    // the name of the sitch, which we can use with "include_"
    menuName: "Model Inspector",   // Name displayed in the menu
    isTextable: true,               // true if we can export and edit this sitch as a custom sitch
    isTool: true,


    startTime: "2004-11-14T20:30:00.000Z",
    timeZone: "MST",

    // Terrain Lat/Lon is the center of the map
    // zoom is the zoom level of the map (1-15 for Mapbox)
    // nTiles is the size of the square region to load (in tiles, so here 4x4)
    // tileSegments is optional in the range 1..256 and is the resolution of the height map
    terrain: {lat: 40.2572028, lon: -109.893759, zoom: 14, nTiles: 4, tileSegments: 256},

    // a single camera, with the position and heading define by two LLA points
    mainCamera: {
        startCameraPositionLLA:[40.257709,-109.890459,1609.477159],
        startCameraTargetLLA:[40.261860,-109.900708,1442.610726],
    },

    canvasResolution: {kind: "GUIValue", value: 1600, start: 10, end: 2000, step: 1, desc: "Resolution"},

    // a full screen view. The size and position are fractions of the window size
    // background is the color of the sky.
    mainView: {
        left: 0.0, top: 0, width: 0.5, height: 1, background: [0.53, 0.81, 0.92],
        canvasWidth: "canvasResolution", canvasHeight: "canvasResolution",
        effects: {
            // these are nodes, but simplifed setup
            // so we have the shader name, and the uniforms
            // note some shaders nodes require extra calculations, like for resolution
//        FLIRShader: {},
            hBlur: {
                inputs: {
                    h: {kind: "GUIValue", value: 0.2, start: 0.0, end: 1.0, step: 0.01, desc: "Blur Horizontal"}
                }
            },
            Copy: {},
        },
        showCursor: false,
    },

    ambientLight: 0.8,


    fixedCameraPosition: {kind: "PositionLLA", LLA: [40.254018,-109.880925,1700], gui: "camera", key:"C"},
    fixedTargetPosition: {kind: "PositionLLA", LLA: [40.257957,-109.891099,1600], gui: "target", key:"X"},
  //  fixedTargetPosition: {kind: "PositionXYZ", XYZ: [0,1600,0]},
    lookCamera:  {fov: 30},
    followTrack: {track:"fixedCameraPosition"},
    lookAtTrack: {track: "fixedTargetPosition"},

    lookView: {left:0.5, top:0, width:0.5,height:1, background: [0.53, 0.81, 0.92],},

    targetObject: {kind: "3DObject",

        //model:"F/A-18F",
        geometry:"tictac",

        size: 1,
        radius: 2.6,
        totalLength:12.2,

        width: 3,
        height: 4,
        depth: 10,

        material: "lambert",
        color: "#FFFFFF",
        emissive: '#404040',
        widthSegments:20,
        heightSegments:20,

    },
    fixPosition: {kind: "TrackPosition", object: "targetObject", sourceTrack: "fixedTargetPosition"},

    axes: {kind:"DebugMatrixAxes", object: "targetObject", length: 25},

    arrowToSun: {kind: "CelestialArrow", body: "Sun", object: "targetObject", length: 10, color: "#FFFF00"},

    theSun: {kind: "Sunlight"},
   // theSky: {kind: "DaySky"},

    // focus track
    focusTracks: {
        "Default": "default",
        "3D Object": "fixedTargetPosition",

        "select": "fixedTargetPosition"
    },


    labelView: {dateTimeY:90},

    useRealisticLights: true,
    nightSky: true, // for now we need to set this to true to get the realistic lights to work

    paused: true,
    useGlobe: true,
    dragDropHandler: true,
    

}
