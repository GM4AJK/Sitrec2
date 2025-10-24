import {CNode3DGroup} from "./CNode3DGroup";
import {GlobalNightSkyScene, GlobalScene, GlobalSunSkyScene, setupNightSkyScene, setupSunSkyScene} from "../LocalFrame";
import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Group,
    Matrix4,
    Points,
    Ray,
    Raycaster,
    Scene,
    ShaderMaterial,
    Sphere,
    Sprite,
    SpriteMaterial,
    TextureLoader,
    Vector3
} from "three";
import {degrees, radians} from "../utils";
import {FileManager, GlobalDateTimeNode, Globals, guiMenus, guiShowHide, NodeMan, setRenderOne, Sit} from "../Globals";
import {
    DebugArrow,
    DebugArrowAB,
    DebugWireframeSphere,
    getPointBelow,
    propagateLayerMaskObject,
    removeDebugArrow,
    setLayerMaskRecursive
} from "../threeExt";
import {
    ECEF2EUS,
    ECEFToLLAVD_Sphere,
    EUSToECEF,
    getLST,
    LLAToEUSRadians,
    raDecToAzElRADIANS,
    wgs84
} from "../LLA-ECEF-ENU";
// npm install three-text2d --save-dev
// https://github.com/gamestdio/three-text2d
//import { MeshText2D, textAlign } from 'three-text2d'
import * as LAYER from "../LayerMasks";
import {par} from "../par";

import SpriteText from '../js/three-spritetext';
import {CNodeDisplayGlobeCircle} from "./CNodeDisplayGlobeCircle";
import {assert} from "../assert.js";
import {intersectSphere2, V3} from "../threeUtils";
import {
    calculateGST,
    celestialToECEF,
    getJulianDate,
    getSiderealTime,
    raDec2Celestial,
    raDecToAltAz
} from "../CelestialMath";
import {DragDropHandler} from "../DragDropHandler";
import {ViewMan} from "../CViewManager";
import {bestSat, CTLEData} from "../TLEUtils";
import {SITREC_APP, SITREC_SERVER} from "../configUtils";
import {CNodeLabeledArrow} from "./CNodeLabels3D";
import {CNodeDisplaySkyOverlay} from "./CNodeDisplaySkyOverlay";
import {EventManager} from "../CEventManager";
import {CNodeViewUI} from "./CNodeViewUI";
//import { eci_to_geodetic } from '../../pkg/eci_convert.js';
// npm install satellite.js --save-dev
import * as satellite from 'satellite.js';
import {sharedUniforms} from "../js/map33/material/SharedUniforms";

// installed with
// npm install astronomy-engine --save-dev
// in the project dir (using terminal in PHPStorm)
import * as Astronomy from "astronomy-engine";

// Star field rendering system
import {CStarField} from "./CStarField";
import {CCelestialElements} from "./CCelestialElements";


// other source of stars, if we need more (for zoomed-in pics)
// https://www.astronexus.com/hyg

// TLE Data is in fixed positions in a 69 character string, which is how the satellite.js library expects it
// but sometimes we get it with spaces removed, as it's copied from a web page
// so we need to fix that
// 1 48274U 21035A 21295.90862762 .00005009 00000-0 62585-4 0 9999
// 2 48274 41.4697 224.1728 0006726 240.5427 202.4055 15.60684462 27671
// becomes
// 0000000001111111111222222222233333333334444444444555555555566666666667777777777
// 1234567890123456789012345678901234567890123456789012345678901234567890123456789
// 1 48274U 21035A   21295.90862762  .00005009  00000-0  62585-4 0  9999
// 2 48274  41.4697 224.1728 0006726 240.5427 202.4055 15.60684462 27671


// 0000000001111111111222222222233333333334444444444555555555566666666667777777777
// 1234567890123456789012345678901234567890123456789012345678901234567890123456789
// 1 48274U 21035A 21296.86547910 .00025288 00000-0 29815-3 0 9999
// 1 48274U 21035A   21296.86547910  .00025288  00000-0  29815-3 0  9999
// 2 48274 41.4699 218.3498 0006788 245.5794 180.5604 15.60749710 27823
// 2 48274  41.4699 218.3498 0006788 245.5794 180.5604 15.60749710 27823

// 0 STARLINK-1007
// 1 44713U 19074A   23216.03168702  .00031895  00000-0  21481-2 0  9995
// 2 44713  53.0546 125.3135 0001151  98.9698 261.1421 15.06441263205939


// NightSkyFiles - loaded when Sit.nightSky is true, defined in ExtraFiles.js
// export const NightSkyFiles = {
//     IAUCSN: "nightsky/IAU-CSN.txt",
//     BSC5: "nightsky/BSC5.bin",
// }


export class CNodeDisplayNightSky extends CNode3DGroup {

    constructor(v) {
        if (v.id === undefined) v.id = "NightSkyNode"
        super(v);
        //     this.checkInputs(["cloudData", "material"])
        this.addInput("startTime",GlobalDateTimeNode)

        this.planets =      ["Sun",     "Moon",    "Mercury", "Venus",   "Mars",     "Jupiter", "Saturn", "Uranus",  "Neptune", "Pluto"]
        this.planetColors = ["#FFFF40", "#FFFFFF", "#FFFFFF", "#80ff80", "#ff8080", "#FFFF80", "#FF80FF", "#FFFFFF", "#FFFFFF", "#FFFFFF"]

        if (GlobalNightSkyScene === undefined) {
            setupNightSkyScene(new Scene())
        }
        if (GlobalSunSkyScene === undefined) {
            setupSunSkyScene(new Scene())
        }

   //     GlobalNightSkyScene.matrixWorldAutoUpdate = false

        const satGUI = guiMenus.satellites

        // globe used for collision
        // and specifying the center of the Earth
        this.globe = new Sphere(new Vector3(0,-wgs84.RADIUS,0), wgs84.POLAR_RADIUS)

        this.camera = NodeMan.get("lookCamera").camera;
        assert(this.camera, "CNodeDisplayNightSky needs a look camera")

        this.mainCamera = NodeMan.get("mainCamera").camera;
        assert(this.mainCamera, "CNodeDisplayNightSky needs a main camera")

        // Create star field instance for rendering stars
        this.starField = new CStarField({
            starLimit: Sit.starLimit ?? 6.5,
            starScale: Sit.starScale ?? 1.0,
            sphereRadius: 100
        });

        // Create celestial elements instance (grid, constellations)
        this.celestialElements = new CCelestialElements({
            sphereRadius: 100
        });

        satGUI.add(this,"updateLEOSats").name("Load LEO Satellites For Date")
            .onChange(function (x) {this.parent.close()})
            .tooltip("Get the latest LEO Satellite TLE data for the set simulator date/time. This will download the data from the internet, so it may take a few seconds.\nWill also enable the satellites to be displayed in the night sky.")

        satGUI.add(this,"updateStarlink").name("Load CURRENT Starlink")
            .onChange(function (x) {this.parent.close()})
            .tooltip("Get the CURRENT (not historical, now, real time) Starlink satellite positions. This will download the data from the internet, so it may take a few seconds.\n")

        satGUI.add(this,"updateSLOWSats").name("(Experimental) Load SLOW Satellites")
            .onChange(function (x) {this.parent.close()})
            .tooltip("Get the latest SLOW Satellite TLE data for the set simulator date/time. This will download the data from the internet, so it may take a few seconds.\nWill also enable the satellites to be displayed in the night sky. Might time-out for recent dates")

        satGUI.add(this,"updateALLSats").name("(Experimental) Load ALL Satellites")
            .onChange(function (x) {this.parent.close()})
            .tooltip("Get the latest Satellite TLE data for ALL the satellites for the set simulator date/time. This will download the data from the internet, so it may take a few seconds.\nWill also enable the satellites to be displayed in the night sky. Might time-out for recent dates")


        this.flareAngle = 5
        satGUI.add(this, 'flareAngle', 0, 20, 0.1).listen().name("Flare Angle Spread").tooltip("Maximum angle of the reflected view vector for a flare to be visible\ni.e. the range of angles between the vector from the satellite to the sun and the vector from the camera to the satellite reflected off the bottom of the satellite (which is parallel to the ground)")
        this.addSimpleSerial("flareAngle")


        this.penumbraDepth = 5000
        satGUI.add(this, 'penumbraDepth', 0, 100000, 1).listen().name("Earth's Penumbra Depth")
            .tooltip("Vertical depth in meters over which a satellite fades out as it enters the Earth's shadow")
        this.addSimpleSerial("penumbraDepth")



        this.showSunArrows = Sit.showSunArrows;
        this.sunArrowGroup = new Group();
        this.sunArrowGroup.visible = this.showSunArrows;
        GlobalScene.add(this.sunArrowGroup)
        satGUI.add(this, "showSunArrows").listen().onChange(()=>{
            setRenderOne(true);
            this.sunArrowGroup.visible = this.showSunArrows;
        }).name("Sun Angle Arrows")
            .tooltip("When glare is detected, show arrows from camera to satellite, and then satellite to sun")
        this.addSimpleSerial("showSunArrows")

        this.celestialGUI = guiShowHide.addFolder("Celestial").close().tooltip("night sky related things");

        this.addCelestialArrow("Venus")
        this.addCelestialArrow("Mars")
        this.addCelestialArrow("Jupiter")
        this.addCelestialArrow("Saturn")
        this.addCelestialArrow("Sun")
        this.addCelestialArrow("Moon")

        this.celestialArrowsOnTraverse = false;
        this.celestialGUI.add(this, "celestialArrowsOnTraverse")
            .listen()
            .onChange((x)=>{
                if (x) {
                    this.updateCelestialArrowsTo("traverseObject")
                } else {
                    this.updateCelestialArrowsTo("lookCamera")
                }
            })
            .name("Vectors On Traverse")
            .tooltip("If checked, the vectors are shown relative to the traverse object. Otherwise they are shown relative to the look camera.");


        this.celestialArrowsInLookView = false;
        this.celestialGUI.add(this, "celestialArrowsInLookView")
            .listen()
            .onChange((x)=>{
                if (x) {
                    this.updateCelestialArrowsMask(LAYER.MASK_LOOKRENDER)
                } else {
                    this.updateCelestialArrowsMask(LAYER.MASK_HELPERS)
                }
            })
            .name("Vectors in Look View")
            .tooltip("If checked, the vectors are shown in the Look View Otherwise just the main view.");


        this.flareRegionGroup = new Group();
        // get a string of the current time in MS
        const timeStamp = new Date().getTime().toString();
        this.flareRegionGroup.debugTimeStamp = timeStamp;
        this.flareRegionGroup.visible = this.showFlareRegion;
        GlobalScene.add(this.flareRegionGroup)

        this.flareBandGroup = new Group();

        new CNodeDisplayGlobeCircle({
            id: "globeCircle1",
            normal: new Vector3(1, 0, 0),
            color: [1,1,0],
            width: 2,
            offset: 3000000,
            container: this.flareBandGroup,
        })

        new CNodeDisplayGlobeCircle({
            id: "globeCircle2",
            normal: new Vector3(1, 0, 0),
            color: [0,1,0],
            width: 2,
            offset: 5000000,
            container: this.flareBandGroup,
        })

        GlobalScene.add(this.flareBandGroup)


     //   why no work???
        setLayerMaskRecursive(this.flareBandGroup, LAYER.MASK_HELPERS);



        this.showSatellites = true;
        this.showStarlink = true;
        this.showISS = true;
        this.showBrightest = true;
        this.showOtherSatellites = false;
        this.showSatelliteTracks = Sit.showSatelliteTracks ?? false;
        this.showSatelliteGround = Sit.showSatelliteGround ?? false;
        this.showSatelliteNames = false;
        this.showSatelliteNamesMain = false;
        this.showFlareRegion = Sit.showFlareRegion;
        this.showFlareBand = Sit.showFlareBand;
        this.showFlareTracks = Sit.showFlareTracks ?? false;


        this.showAllLabels = false;

        this.showSatelliteList = "";


        const satelliteOptions = [
            { key: "showSatellites", name: "Overall Satellites Flag",           action: () => {this.satelliteGroup.visible = this.showSatellites; this.filterSatellites() }},
            { key: "showStarlink", name: "Starlink",                            action: () => this.filterSatellites() },
            { key: "showISS", name: "ISS",                                      action: () => this.filterSatellites() },
            { key: "showBrightest", name: "Celestrack's Brightest",             action: () => this.filterSatellites() },
            { key: "showOtherSatellites", name: "Other Satellites",             action: () => this.filterSatellites() },
            { key: "showSatelliteList", name: "List",                           action: () => this.filterSatellites() },
            { key: "showSatelliteTracks", name: "Satellite Arrows",             action: () => this.satelliteTrackGroup.visible = this.showSatelliteTracks },
            { key: "showFlareTracks", name: "Flare Lines",                      action: () => this.satelliteFlareTracksGroup.visible = this.showFlareTracks },
            { key: "showSatelliteGround", name: "Satellite Ground Arrows",      action: () => this.satelliteGroundGroup.visible = this.showSatelliteGround },
            { key: "showSatelliteNames", name: "Satellite Names (Look View)",   action: () => this.updateSatelliteNamesVisibility() },
            { key: "showSatelliteNamesMain", name: "Satellite Names (Main View)", action: () => this.updateSatelliteNamesVisibility() },
            { key: "showAllLabels", name: "Show all Labels",                     action: () => this.flareRegionGroup.visible = this.showFlareRegion},
            { key: "showFlareRegion", name: "Flare Region",                     action: () => this.flareRegionGroup.visible = this.showFlareRegion},
            { key: "showFlareBand", name: "Flare Band",                         action: () => this.flareBandGroup.visible = this.showFlareBand},

        ];

        satelliteOptions.forEach(option => {
            satGUI.add(this, option.key).listen().onChange(() => {
                setRenderOne(true);
                option.action();
            }).name(option.name);
            this.addSimpleSerial(option.key);
        });

        this.flareBandGroup.visible = this.showFlareBand;

        // NOTE: older vars set from Sit
        // they will get saves as all of Sit is saved
        // the addSimpleSerial calls were doing nothing

        // Create star brightness slider and store reference
        this.guiStarScale = guiMenus.view.add(Sit,"starScale",0,3,0.01).name("Star Brightness").listen()
            .tooltip("Scale factor for the brightness of the stars. 1 is normal, 0 is invisible, 2 is twice as bright, etc.")
            .onChange(() => {
                setRenderOne(true);
                // Update star field scale
                this.starField.updateScale(Sit.starScale);
                if (Sit.lockStarPlanetBrightness) {
                    Sit.planetScale = Sit.starScale;
                    this.guiPlanetScale.updateDisplay();
                }
            })
       // this.addSimpleSerial("starScale")

        if (Sit.starLimit === undefined)
            Sit.starLimit = 15; // default to 15 if not set


        guiMenus.view.add(Sit,"starLimit",-2,15,0.01).name("Star Limit").listen()
            .tooltip("Brightness limit for stars to be displayed")
            .onChange(() => {
                setRenderOne(true);
                this.starField.updateStarVisibility(Sit.starLimit, this.celestialSphere);
            })

       // this.addSimpleSerial("starLimit")

        if (Sit.planetScale === undefined)
            Sit.planetScale = 1; // default to 1 if not set

        if (Sit.lockStarPlanetBrightness === undefined)
            Sit.lockStarPlanetBrightness = true; // default to true (locked) if not set

        // Create planet brightness slider and store reference
        this.guiPlanetScale = guiMenus.view.add(Sit,"planetScale",0,3,0.01).name("Planet Brightness").listen()
            .tooltip("Scale factor for the brightness of the planets (except Sun and Moon). 1 is normal, 0 is invisible, 2 is twice as bright, etc.")
            .onChange(() => {
                if (Sit.lockStarPlanetBrightness) {
                    Sit.starScale = Sit.planetScale;
                    this.guiStarScale.updateDisplay();
                }
            })

        // Add lock checkbox
        guiMenus.view.add(Sit,"lockStarPlanetBrightness").name("Lock Star Planet Brightness").listen()
            .tooltip("When checked, the Star Brightness and Planet Brightness sliders are locked together")

        satGUI.add(Sit,"satScale",0,6,0.01).name("Sat Brightness").listen()
            .tooltip("Scale factor for the brightness of the satellites. 1 is normal, 0 is invisible, 2 is twice as bright, etc.")
       // this.addSimpleSerial("satScale");

        satGUI.add(Sit,"flareScale",0,1,0.001).name("Flare Brightness").listen()
            .tooltip("Scale factor for the additional brightness of flaring satellites. 0 is nothing")


        satGUI.add(Sit,"satCutOff",0,0.5,0.001).name("Sat Cut-Off").listen()
            .tooltip("Satellites dimmed to this level or less will not be displayed")
       // this.addSimpleSerial("satCutOff");


        this.arrowRange = 4000
        satGUI.add(this,"arrowRange",10,10000,1).name("Display Range (km)").listen()
            .tooltip("Satellites beyond this distance will not have their names or arrows displayed")
            .onChange(() => {
                this.filterSatellites();
                setRenderOne(true);
            })
        this.addSimpleSerial("arrowRange");



        // Sun Direction will get recalculated based on data
        this.toSun = V3(0,0,1)
        this.fromSun = V3(0,0,-1)



        this.celestialSphere = new Group();
        GlobalNightSkyScene.add(this.celestialSphere)
        
        // Create a separate celestial sphere for the day sky scene
        this.celestialDaySphere = new Group();
        if (GlobalSunSkyScene) {
            GlobalSunSkyScene.add(this.celestialDaySphere);
        }

        this.satelliteGroup = new Group();
        GlobalScene.add(this.satelliteGroup)

        // a sub-group for the satellite tracks
        this.satelliteTrackGroup = new Group();
        this.satelliteGroup.add(this.satelliteTrackGroup)
        this.satelliteFlareTracksGroup = new Group();
        this.satelliteGroup.add(this.satelliteFlareTracksGroup)
        this.satelliteGroundGroup = new Group();
        this.satelliteGroup.add(this.satelliteGroundGroup)


        this.satelliteTextGroup = new Group();
        this.updateSatelliteNamesVisibility();

        GlobalScene.add(this.satelliteTextGroup)

        this.satelliteTextGroup.matrixWorldAutoUpdate = false


//        console.log("Loading stars")
        this.starField.addToScene(this.celestialSphere)

//        console.log("Loading planets")
        this.addPlanets(this.celestialSphere, this.celestialDaySphere)



        // if (FileManager.exists("starLink")) {
        //     console.log("parsing starlink")
        //     this.replaceTLE(FileManager.get("starLink"))
        // }

        // the file used is now passed in as a parameter "starlink"
        // this is the id of the file in the FileManager
        // which might be the filename, or an ID.
        if (v.starLink !== undefined) {
            console.log("parsing starlink "+v.starLink)
            if (FileManager.exists(v.starLink)) {
                this.replaceTLE(FileManager.get(v.starLink))
            } else {
                if (v.starLink !== "starLink")
                    console.warn("Starlink file/ID "+v.starLink+" does not exist")
            }
        }

//        console.log("Adding celestial grid")
        this.equatorialSphereGroup = new Group();
        this.celestialSphere.add(this.equatorialSphereGroup);
        this.celestialElements.addCelestialSphereLines(this.equatorialSphereGroup, 10);
        this.showEquatorialGrid = (v.showEquatorialGrid !== undefined) ? v.showEquatorialGrid : true;


        this.celestialGUI.add(this,"showEquatorialGrid" ).listen().onChange(()=>{
            setRenderOne(true);
            this.updateVis()
        }).name("Equatorial Grid")
        this.addSimpleSerial("showEquatorialGrid")


        this.constellationsGroup = new Group();
        this.celestialSphere.add(this.constellationsGroup);
        this.showConstellations = (v.showConstellations !== undefined) ? v.showConstellations : true;
        this.celestialGUI.add(this,"showConstellations" ).listen().onChange(()=>{
            setRenderOne(true);
            this.updateVis()
        }).name("Constellation Lines")
        this.addSimpleSerial("showConstellations")
        this.celestialElements.addConstellationLines(this.constellationsGroup)
        
        this.showStars = (v.showStars !== undefined) ? v.showStars : true;
        this.celestialGUI.add(this,"showStars" ).listen().onChange(()=>{
            setRenderOne(true);
            this.updateVis()
        }).name("Render Stars")
        this.addSimpleSerial("showStars")

        this.celestialElements.addConstellationNames(this.constellationsGroup);

        // For the stars to show up in the lookView
        // we need to enable the layer for everything in the celestial sphere.
        this.celestialSphere.layers.enable(LAYER.LOOK);  // probably not needed
        propagateLayerMaskObject(this.celestialSphere)


        // Not longer used?
        // this.useDayNight = (v.useDayNight !== undefined) ? v.useDayNight : true;
        // guiShowHide.add(this,"useDayNight" ).listen().onChange(()=>{
        //     setRenderOne(true);
        // }).name("Day/Night Sky")


        this.showEquatorialGridLook = (v.showEquatorialGridLook !== undefined) ? v.showEquatorialGridLook : true;
        this.celestialGUI.add(this,"showEquatorialGridLook" ).listen().onChange(()=>{
            setRenderOne(true);
            this.updateVis()

        }).name("Equatorial Grid in Look View")
        this.addSimpleSerial("showEquatorialGridLook")

        // same for the flare region
        this.showFlareRegionLook =  false;
        satGUI.add(this,"showFlareRegionLook" ).listen().onChange(()=>{
            if (this.showFlareRegionLook) {
                this.flareRegionGroup.layers.mask=LAYER.MASK_LOOKRENDER;
            } else {
                this.flareRegionGroup.layers.mask=LAYER.MASK_HELPERS;
            }
            propagateLayerMaskObject(this.flareRegionGroup);
        }).name("Flare Region in Look View");
        this.addSimpleSerial("showFlareRegionLook");


        this.updateVis()


        this.recalculate()

        this.rot = 0


        const labelMainViewPVS = new CNodeViewUI({id: "labelMainViewPVS", overlayView: ViewMan.list.mainView.data});
        // labelMainViewPVS.addText("videoLabelp1", "L = Lat/Lon from cursor",    10, 2, 1.5, "#f0f00080")
        // labelMainViewPVS.addText("videoLabelp2", ";&' or [&] ' advance start time", 12, 4, 1.5, "#f0f00080")
        // labelMainViewPVS.addText("videoLabelp3", "Drag and drop .txt or .tle files", 12, 6, 1.5, "#f0f00080")
        // labelMainViewPVS.setVisible(true)

        //
        // labelMainViewPVS.addText("videoLabelp1", "",    10, 2, 1.5, "#f0f00080").update(function() {
        //     this.text = "sitchEstablished = "+Globals.sitchEstablished;
        // })


        par.validPct = 0;
        const nightSky = this;
        labelMainViewPVS.addText("videoLabelInRange", "xx",    100, 2, 1.5, "#f0f00080", "right").update(function() {

            this.text = "";

            const TLEData = nightSky.TLEData;
            if (TLEData !== undefined && TLEData.satData !== undefined && TLEData.satData.length > 0) {
                // format dates as YYYY-MM-DD HH:MM
                this.text = "TLEs: "+TLEData.startDate.toISOString().slice(0, 19).replace("T", " ") + " - " +
                    TLEData.endDate.toISOString().slice(0, 19).replace("T", " ") + "   ";
            }

            this.text += par.validPct ? "In Range:" + par.validPct.toFixed(1) + "%"  : "";

        });

//        console.log("Done with CNodeDisplayNightSky constructor")
    }

    updateSatelliteNamesVisibility() {
        this.satelliteTextGroup.visible = this.showSatelliteName || this.showSatelliteNameMain;
        this.satelliteTextGroup.layers.mask =
            (this.showSatelliteNames ? LAYER.MASK_LOOK : 0)
            | (this.showSatelliteNamesMain ? LAYER.MASK_MAIN : 0)
        propagateLayerMaskObject(this.satelliteTextGroup);
    }

    // See updateArrow
    addCelestialArrow(name) {
        const flagName = "show"+name+"Arrow";
        const groupName = name+"ArrowGroup";
        const obName = name+"ArrowOb";

        this[flagName] = Sit[flagName] ?? false;
        this[groupName] = new CNode3DGroup({id: groupName});
        this[groupName].show(this[flagName]);

        this[obName] = new CNodeLabeledArrow({
            id: obName,
            visible: this[flagName],
            start: "lookCamera",
            direction: V3(0,0,1),
            length: -200,
            color: this.planetColors[this.planets.indexOf(name)],
            groupNode: groupName,
            label: name,
            labelPosition: "1",
            offsetY: 20,
            // checkDisplayOutputs: true,
        })


        this.celestialGUI.add(this, flagName).listen().onChange(()=>{
            setRenderOne(true);
            this[groupName].show(this[flagName]);
        }).name(name+" Vector");
        this.addSimpleSerial(flagName)
    }

    // Update all celestial arrows to use a new start object
    updateCelestialArrowsTo(startObject) {

        this.planets.forEach(name => {
            const obName = name + "ArrowOb";
            if (this[obName]) {
                // Remove the old input connection and add the new one
                this[obName].removeInput("start");
                this[obName].addInput("start", startObject);
            }
        });

        // it takes two frames for this to have an effect
        setRenderOne(2);
    }

    // Update all celestial arrows to use a new start object
    updateCelestialArrowsMask(mask) {

        this.planets.forEach(name => {
            const groupName = name+"ArrowGroup";
            if (this[groupName]) {
                this[groupName].group.layers.mask = mask;
                this[groupName].propagateLayerMask()
            }
        });

        // it takes two frames for this to have an effect
        setRenderOne(2);
    }



    brightest = [
        [
            "00694",
            "ATLAS CENTAUR 2"
        ],
        [
            "00733",
            "THOR AGENA D R/B"
        ],
        [
            "00877",
            "SL-3 R/B"
        ],
        [
            "02802",
            "SL-8 R/B"
        ],
        [
            "03230",
            "SL-8 R/B"
        ],
        [
            "03597",
            "OAO 2"
        ],
        [
            "03669",
            "ISIS 1"
        ],
        [
            "04327",
            "SERT 2"
        ],
        [
            "05118",
            "SL-3 R/B"
        ],
        [
            "05560",
            "ASTEX 1"
        ],
        [
            "05730",
            "SL-8 R/B"
        ],
        [
            "06073",
            "COSMOS 482 DESCENT CRAFT"
        ],
        [
            "06153",
            "OAO 3 (COPERNICUS)"
        ],
        [
            "06155",
            "ATLAS CENTAUR R/B"
        ],
        [
            "08459",
            "SL-8 R/B"
        ],
        [
            "10114",
            "SL-3 R/B"
        ],
        [
            "10967",
            "SEASAT 1"
        ],
        [
            "11267",
            "SL-14 R/B"
        ],
        [
            "11574",
            "SL-8 R/B"
        ],
        [
            "11672",
            "SL-14 R/B"
        ],
        [
            "12139",
            "SL-8 R/B"
        ],
        [
            "12465",
            "SL-3 R/B"
        ],
        [
            "12585",
            "METEOR PRIRODA"
        ],
        [
            "12904",
            "SL-3 R/B"
        ],
        [
            "13068",
            "SL-3 R/B"
        ],
        [
            "13154",
            "SL-3 R/B"
        ],
        [
            "13403",
            "SL-3 R/B"
        ],
        [
            "13553",
            "SL-14 R/B"
        ],
        [
            "13819",
            "SL-3 R/B"
        ],
        [
            "14032",
            "COSMOS 1455"
        ],
        [
            "14208",
            "SL-3 R/B"
        ],
        [
            "14372",
            "COSMOS 1500"
        ],
        [
            "14699",
            "COSMOS 1536"
        ],
        [
            "14820",
            "SL-14 R/B"
        ],
        [
            "15483",
            "SL-8 R/B"
        ],
        [
            "15772",
            "SL-12 R/B(2)"
        ],
        [
            "15945",
            "SL-14 R/B"
        ],
        [
            "16182",
            "SL-16 R/B"
        ],
        [
            "16496",
            "SL-14 R/B"
        ],
        [
            "16719",
            "COSMOS 1743"
        ],
        [
            "16792",
            "SL-14 R/B"
        ],
        [
            "16882",
            "SL-14 R/B"
        ],
        [
            "16908",
            "AJISAI (EGS)"
        ],
        [
            "17295",
            "COSMOS 1812"
        ],
        [
            "17567",
            "SL-14 R/B"
        ],
        [
            "17589",
            "COSMOS 1833"
        ],
        [
            "17590",
            "SL-16 R/B"
        ],
        [
            "17912",
            "SL-14 R/B"
        ],
        [
            "17973",
            "COSMOS 1844"
        ],
        [
            "18153",
            "SL-14 R/B"
        ],
        [
            "18187",
            "COSMOS 1867"
        ],
        [
            "18421",
            "COSMOS 1892"
        ],
        [
            "18749",
            "SL-14 R/B"
        ],
        [
            "18958",
            "COSMOS 1933"
        ],
        [
            "19046",
            "SL-3 R/B"
        ],
        [
            "19120",
            "SL-16 R/B"
        ],
        [
            "19210",
            "COSMOS 1953"
        ],
        [
            "19257",
            "SL-8 R/B"
        ],
        [
            "19573",
            "COSMOS 1975"
        ],
        [
            "19574",
            "SL-14 R/B"
        ],
        [
            "19650",
            "SL-16 R/B"
        ],
        [
            "20261",
            "INTERCOSMOS 24"
        ],
        [
            "20262",
            "SL-14 R/B"
        ],
        [
            "20323",
            "DELTA 1 R/B"
        ],
        [
            "20443",
            "ARIANE 40 R/B"
        ],
        [
            "20453",
            "DELTA 2 R/B(1)"
        ],
        [
            "20465",
            "COSMOS 2058"
        ],
        [
            "20466",
            "SL-14 R/B"
        ],
        [
            "20511",
            "SL-14 R/B"
        ],
        [
            "20580",
            "HST"
        ],
        [
            "20625",
            "SL-16 R/B"
        ],
        [
            "20663",
            "COSMOS 2084"
        ],
        [
            "20666",
            "SL-6 R/B(2)"
        ],
        [
            "20775",
            "SL-8 R/B"
        ],
        [
            "21088",
            "SL-8 R/B"
        ],
        [
            "21397",
            "OKEAN-3"
        ],
        [
            "21422",
            "COSMOS 2151"
        ],
        [
            "21423",
            "SL-14 R/B"
        ],
        [
            "21574",
            "ERS-1"
        ],
        [
            "21610",
            "ARIANE 40 R/B"
        ],
        [
            "21819",
            "INTERCOSMOS 25"
        ],
        [
            "21876",
            "SL-8 R/B"
        ],
        [
            "21938",
            "SL-8 R/B"
        ],
        [
            "21949",
            "USA 81"
        ],
        [
            "22219",
            "COSMOS 2219"
        ],
        [
            "22220",
            "SL-16 R/B"
        ],
        [
            "22236",
            "COSMOS 2221"
        ],
        [
            "22285",
            "SL-16 R/B"
        ],
        [
            "22286",
            "COSMOS 2228"
        ],
        [
            "22566",
            "SL-16 R/B"
        ],
        [
            "22626",
            "COSMOS 2242"
        ],
        [
            "22803",
            "SL-16 R/B"
        ],
        [
            "22830",
            "ARIANE 40 R/B"
        ],
        [
            "23087",
            "COSMOS 2278"
        ],
        [
            "23088",
            "SL-16 R/B"
        ],
        [
            "23343",
            "SL-16 R/B"
        ],
        [
            "23405",
            "SL-16 R/B"
        ],
        [
            "23561",
            "ARIANE 40+ R/B"
        ],
        [
            "23705",
            "SL-16 R/B"
        ],
        [
            "24298",
            "SL-16 R/B"
        ],
        [
            "24883",
            "ORBVIEW 2 (SEASTAR)"
        ],
        [
            "25400",
            "SL-16 R/B"
        ],
        [
            "25407",
            "SL-16 R/B"
        ],
        [
            "25544",
            "ISS (ZARYA)"
        ],
        [
            "25732",
            "CZ-4B R/B"
        ],
        [
            "25860",
            "OKEAN-O"
        ],
        [
            "25861",
            "SL-16 R/B"
        ],
        [
            "25876",
            "DELTA 2 R/B"
        ],
        [
            "25977",
            "HELIOS 1B"
        ],
        [
            "25994",
            "TERRA"
        ],
        [
            "26070",
            "SL-16 R/B"
        ],
        [
            "26474",
            "TITAN 4B R/B"
        ],
        [
            "27386",
            "ENVISAT"
        ],
        [
            "27422",
            "IDEFIX & ARIANE 42P R/B"
        ],
        [
            "27424",
            "AQUA"
        ],
        [
            "27432",
            "CZ-4B R/B"
        ],
        [
            "27597",
            "MIDORI II (ADEOS-II)"
        ],
        [
            "27601",
            "H-2A R/B"
        ],
        [
            "28059",
            "CZ-4B R/B"
        ],
        [
            "28222",
            "CZ-2C R/B"
        ],
        [
            "28353",
            "SL-16 R/B"
        ],
        [
            "28415",
            "CZ-4B R/B"
        ],
        [
            "28480",
            "CZ-2C R/B"
        ],
        [
            "28499",
            "ARIANE 5 R/B"
        ],
        [
            "28738",
            "CZ-2D R/B"
        ],
        [
            "28931",
            "ALOS (DAICHI)"
        ],
        [
            "28932",
            "H-2A R/B"
        ],
        [
            "29228",
            "RESURS-DK 1"
        ],
        [
            "29252",
            "GENESIS 1"
        ],
        [
            "29507",
            "CZ-4B R/B"
        ],
        [
            "31114",
            "CZ-2C R/B"
        ],
        [
            "31598",
            "COSMO-SKYMED 1"
        ],
        [
            "31789",
            "GENESIS 2"
        ],
        [
            "31792",
            "COSMOS 2428"
        ],
        [
            "31793",
            "SL-16 R/B"
        ],
        [
            "33504",
            "KORONAS-FOTON"
        ],
        [
            "37731",
            "CZ-2C R/B"
        ],
        [
            "38341",
            "H-2A R/B"
        ],
        [
            "39358",
            "SHIJIAN-16 (SJ-16)"
        ],
        [
            "39679",
            "SL-4 R/B"
        ],
        [
            "39766",
            "ALOS-2"
        ],
        [
            "41038",
            "YAOGAN-29"
        ],
        [
            "41337",
            "ASTRO-H (HITOMI)"
        ],
        [
            "42758",
            "HXMT (HUIYAN)"
        ],
        [
            "43521",
            "CZ-2C R/B"
        ],
        [
            "43641",
            "SAOCOM 1A"
        ],
        [
            "43682",
            "H-2A R/B"
        ],
        [
            "46265",
            "SAOCOM 1B"
        ],
        [
            "48274",
            "CSS (TIANHE)"
        ],
        [
            "48865",
            "COSMOS 2550"
        ],
        [
            "52794",
            "CZ-2C R/B"
        ],
        [
            "54149",
            "GSLV R/B"
        ],
        [
            "57800",
            "XRISM"
        ],
        [
            "59588",
            "ACS3"
        ]
    ];

    filterSatellites() {
        if (this.TLEData === undefined) return;


        // first get the satellte list into an array of NORAD numbers
        const satList = this.showSatelliteList.split(",").map(x => x.trim());
        const list = [];
        // this can be names or numbers, convert to numbers
        for (let i = 0; i < satList.length; i++) {
            const num = parseInt(satList[i]);
            if (isNaN(num)) {
                const matching = this.TLEData.getMatchingRecords(satList[i])
                // add the "matching" array to the list
                if (matching.length > 0) {
                    for (const number of matching) {
                        // if the number is not already in the list, add it
                        if (!list.includes(number)) {
                            list.push(number);
                        }
                    }
                }

            } else {
                list.push(num);
            }
        }



        // iterate over the satellites and flag visiblity
        // based on the name and the GUI flags
        for (const satData of this.TLEData.satData) {

            // this is just a clean time to remove the debug arrows
            // they will get recreated of all visible satellites
            this.removeSatelliteArrows(satData);

            satData.visible = false;
            satData.userFiltered = false;
            let filterHit = false;

            if (!this.showSatellites)
                continue;


            if (satData.name.startsWith("STARLINK")) {
                filterHit = true;
                if (this.showStarlink) {
                    satData.visible = true;
                    continue;
                }
            }

            if (satData.name.startsWith("ISS (ZARYA)")) {
                filterHit = true;
                if (this.showISS) {
                    satData.visible = true;
                    satData.userFiltered = true;
                    continue;
                }
            }

            // check the number against the brightest list
            if (this.showBrightest) {
                for (const [num, name] of this.brightest) {
                    if (satData.number === parseInt(num)) {
                        filterHit = true;
                            satData.visible = true;
                            satData.userFiltered = true;

                            continue;
                        }
                }
            }

            // check the number against the user supplied list
            // comma separated list of names or NORAD numbers
            if (this.showSatelliteList) {
                for (const number of list) {
                    if (satData.number === parseInt(number)) {
                        filterHit = true;
                        satData.visible = true;
                        satData.userFiltered = true;

                        continue;
                    }
                }
            }


            if (!filterHit && this.showOtherSatellites) {
                satData.visible = true;
                continue;
            }


        }
    }



    updateStarlink() {
        const url=SITREC_SERVER+"proxy.php?request=CURRENT_STARLINK";
        console.log("Getting starlink from "+url)
        const id = "starLink_current.tle";
        this.loadSatellites(url, id);
    }

    updateLEOSats() {
        this.updateSats("LEO");
    }

    updateSLOWSats() {
        this.updateSats("SLOW");
    }

    updateALLSats() {
        this.updateSats("ALL");
    }

    updateSats(satType) {
        // get the start time
        const startTime = GlobalDateTimeNode.dateNow;

        // go back one day so the TLE's are all before the current time
        // server will add one day to the date to cover things.
        // Say this is day D, we request D-1
        // the server will ask for that +2, so we get
        // D-1 to D+1
        // but this essentiall gives us D-1 to all of D, which is what we want
        // this still gives us some times in D that are in the future,
        // but those are handled by the bestSat function
        startTime.setDate(startTime.getDate()-1);

        // convert to YYYY-MM-DD
        const dateStr = startTime.toISOString().split('T')[0];
        // get the file from the proxyStarlink URL
        // note this is NOT a dynamic file
        // it fixed based on the date
        // so we don't need to rehost it
//        const url = SITREC_SERVER+"proxyStarlink.php?request="+dateStr+"&type=LEO";
        const url = SITREC_SERVER+"proxyStarlink.php?request="+dateStr+"&type="+satType;

        // TODO: remove the old starlink from the file manager.

        console.log("Getting satellites from "+url)
        const id = "starLink_"+dateStr+".tle";
        this.loadSatellites(url, id);

    }

    loadSatellites(url, id) {
        FileManager.loadAsset(url, id).then((data) => {
            // this.replaceTLE(data)

            const fileInfo = FileManager.list[id];

            // give it a proper filename so when it's re-loaded
            // it can be parsed correctly
            fileInfo.filename = id;

            // kill the static URL to force a rehost with this name
            fileInfo.staticURL = null;

            fileInfo.dynamicLink = true;

            DragDropHandler.handleParsedFile(id, fileInfo.data)
        });
    }

    updateVis() {

        this.equatorialSphereGroup.visible = this.showEquatorialGrid;
        this.constellationsGroup.visible = this.showConstellations;
        if (this.starSprites) {
            this.starSprites.visible = this.showStars;
        }

        // equatorial lines might not want to be in the look view
        this.equatorialSphereGroup.layers.mask = this.showEquatorialGridLook ? LAYER.MASK_MAINRENDER : LAYER.MASK_HELPERS;

        this.sunArrowGroup.visible = this.showSunArrows;
        this.VenusArrowGroup.show(this.showVenusArrow);
        this.MarsArrowGroup.show(this.showMarsArrow);
        this.JupiterArrowGroup.show(this.showJupiterArrow);
        this.SunArrowGroup.show(this.showSunArrow);
        this.MoonArrowGroup.show(this.showMoonArrow);
        this.flareRegionGroup.visible = this.showFlareRegion;
        this.flareBandGroup.visible = this.showFlareBand;
        this.satelliteGroup.visible = this.showSatellites;
        this.satelliteTrackGroup.visible = this.showSatelliteTracks;
        this.satelliteFlareTracksGroup.visible = this.showSatelliteFlares;
        this.satelliteGroundGroup.visible = this.showSatelliteGround;
        this.satelliteTextGroup.visible = this.showSatelliteNames;


        propagateLayerMaskObject(this.equatorialSphereGroup)
    }

    modDeserialize(v) {
        super.modDeserialize(v);
        // a guid value's .listen() only updates the gui, so we need to do it manually
        // perhaps better to flag the gui system to update it?
        this.filterSatellites();
        this.updateVis();
        this.updateSatelliteNamesVisibility();


    }

    update(frame) {

        if (this.useDayNight) {
            const sun = Globals.sunTotal / Math.PI;
            this.sunLevel = sun;
            const blue = new Vector3(0.53, 0.81, 0.92)
            blue.multiplyScalar(sun)
            this.skyColor = new Color(blue.x, blue.y, blue.z)
        }


        // Reset both celestial spheres to identity
        this.celestialSphere.quaternion.identity()
        this.celestialSphere.updateMatrix()
        
        if (this.celestialDaySphere) {
            this.celestialDaySphere.quaternion.identity()
            this.celestialDaySphere.updateMatrix()
        }

        // do adjustements for date/time, and maybe precession, here
        // .....

        // The ESU Coordinate system is right handed Y-Up
        // X = East
        // Y = Up
        // Z = South (-Z = North)

        // With the identity transform, the Celestial Sphere (CS) has:
        // RA of 0 along the X axis, i.e. EAST
        // Dec of 90 ia along the Y Axis, i.e. UP

        // The CS is in Standard ECEF, right handed, Z = up

        // a good test is where the north star ends up. No matter what date, etc,
        // Polaris has dec of about 89°, and should always be north, tilted down by the latitude


        var nowDate = this.in.startTime.dateNow;
        const fieldRotation = getSiderealTime(nowDate, 0) - 90

        // we just use the origin of the local ESU coordinate systems
        // to tilt the stars by latitude and rotate them by longitude
        const lat1 = radians(Sit.lat);
        const lon1 = radians(Sit.lon);

        // note, rotateOnAxis is in LOCAL space, so we can't just chain them here
        // we need to rotate around the WORLD Z then the WORLD X

//         // Create a matrix for rotation around Y-axis by 180° to get north in the right place
        const rotationMatrixY = new Matrix4();
        rotationMatrixY.makeRotationY(radians(180));
//
// // Create a matrix for rotation around Z-axis by the longitude (will alls include data/time here)
        const rotationMatrixZ = new Matrix4();
        rotationMatrixZ.makeRotationZ(radians(Sit.lon + fieldRotation));
//
// // Create a matrix for rotation around X-axis by the latitude (tilt)
        const rotationMatrixX = new Matrix4();
        rotationMatrixX.makeRotationX(radians(Sit.lat));
//
//         //Combine them, so they are applied in the order Y, Z, X
//         rotationMatrixX.multiply(rotationMatrixZ.multiply(rotationMatrixY))
//
//         // apply them
//         this.celestialSphere.applyMatrix4(rotationMatrixX)

        // Apply rotation matrices to the night sky celestial sphere
        this.celestialSphere.applyMatrix4(rotationMatrixY)
        this.celestialSphere.applyMatrix4(rotationMatrixZ)
        this.celestialSphere.applyMatrix4(rotationMatrixX)
        
        // The day sky sphere should use the same transformations as the night sky sphere
        // since both are rendered with camera at origin and should show celestial objects
        // in the same positions
        if (this.celestialDaySphere) {
            this.celestialDaySphere.applyMatrix4(rotationMatrixY)
            this.celestialDaySphere.applyMatrix4(rotationMatrixZ)
            this.celestialDaySphere.applyMatrix4(rotationMatrixX)
        }


        var nowDate = this.in.startTime.dateNow

        // Use lookCamera position for observer instead of fixed Sit coordinates
        const cameraPos = this.camera.position;
        const cameraEcef = EUSToECEF(cameraPos);
        const cameraLLA = ECEFToLLAVD_Sphere(cameraEcef);
        let observer = new Astronomy.Observer(cameraLLA.x, cameraLLA.y, cameraLLA.z);
        // update the planets position for the current time
        for (const [name, planet] of Object.entries(this.planetSprites)) {
            // Update both the regular sprite and day sky sprite in one call
            this.updatePlanetSprite(name, planet.sprite, nowDate, observer, 100, planet.daySkySprite)
        }

        if (this.showSatellites && this.TLEData) {
            // Update satellites to correct position for nowDate
            // for (const [index, sat] of Object.entries(this.TLEData.satData)) {
            //     const success = this.updateSatelliteSprite(sat.spriteText, sat, nowDate)
            // }

            this.updateAllSatellites(nowDate)
        }
//        console.log (`out of ${numSats}, ${valid} of them are valid`)


//        this.updateSatelliteScales(this.camera)

        //const fromSun = this.fromSun

        if (this.showFlareBand && NodeMan.exists("globeCircle1")) {
            const globeCircle1 = NodeMan.get("globeCircle1")
            globeCircle1.normal = this.fromSun.clone().normalize();
            globeCircle1.rebuild();
            const globeCircle2 = NodeMan.get("globeCircle2")
            globeCircle2.normal = this.fromSun.clone().normalize();
            globeCircle2.rebuild();
        }
    }

    updateSatelliteScales(view) {

        const camera = view.camera;
        const isLookView = (view.id === "lookView");

        // for optimization we are not updating every scale on every frame
        if (camera.satTimeStep === undefined) {
            camera.satTimeStep = 5; // was 5
            camera.satStartTime = 0;
        } else {
            camera.satStartTime++
            if (camera.satStartTime >= camera.satTimeStep)
                camera.satStartTime = 0;
        }

        const toSun = this.toSun;
        const fromSun = this.fromSun
        // For the globe, we position it at the center of a sphere or radius wgs84.RADIUS
        // but for the purposes of occlusion, we use the POLAR_RADIUS
        // erring on not missing things
        // this is a slight fudge, but most major starlink satellites sightings are over the poles
        // and atmospheric refraction also makes more visible.

        const raycaster = new Raycaster();
        raycaster.layers.mask  |= LAYER.MASK_MAIN | LAYER.MASK_LOOK;

        var hitPoint = new Vector3();
        var hitPoint2 = new Vector3();
        // get the forward vector (-z) of the camera matrix, for perp distance
        const cameraForward = new Vector3(0,0,-1).applyQuaternion(camera.quaternion);

        if ( this.showSatellites && this.TLEData) {


            // // we scale ALL the text sprites, as it's per camera
            // for (let i = 0; i < this.TLEData.satData.length; i++) {
            //     const satData = this.TLEData.satData[i];
            //     if (satData.visible) {
            //         const satPosition = satData.eus;
            //         // scaling based on the view camera
            //         // whereas later scaling is done with the look Camera?????
            //         const camToSat = satPosition.clone().sub(camera.position)
            //         // get the perpendicular distance to the satellite, and use that to scale the name
            //         const distToSat = camToSat.dot(cameraForward);
            //         const nameScale = 0.025 * distToSat * tanHalfFOV;
            //         satData.spriteText.scale.set(nameScale * satData.spriteText.aspect, nameScale, 1);
            //     } else {
            //         satData.spriteText.scale.set(0,0,0);
            //     }
            // }


            // sprites are scaled in pixels, so we need to scale them based on the view height

            let scale= Sit.satScale;
            scale = view.adjustPointScale(scale*2);
            this.satelliteMaterial.uniforms.satScale.value = scale;

            const positions = this.satelliteGeometry.attributes.position.array;
            const magnitudes = this.satelliteGeometry.attributes.magnitude.array;

            for (let i = camera.satStartTime; i < this.TLEData.satData.length; i++) {
                const satData = this.TLEData.satData[i];

                // bit of a hack for visiblity, just set the scale to 0
                // and skip the update
                // TODO: the first few
                if (!satData.visible) {
                    magnitudes[i] = 0
                    continue;
                }

                // satellites might have invalid positions if we load a TLE that's not close to the time we are calculating for
                // this would be updated when updating the satellites position
                if (satData.invalidPosition) {
                    continue;
                }

                // stagger updates unless it has an arrow.
                if ((i - camera.satStartTime) % camera.satTimeStep !== 0 && !satData.hasSunArrow) {
       //             continue;
                }

                assert(satData.eus !== undefined, `satData.eus is undefined, i= ${i}, this.TLEData.satData.length = ${this.TLEData.satData.length} `)

                const satPosition = satData.eus;

//                let scale = 0.1;                // base value for scale
                let scale = 0.04;                // base value for scale
                let darknessMultiplier = 0.3    // if in dark, multiply by this
                var fade = 1

                raycaster.set(satPosition, toSun)
                if (intersectSphere2(raycaster.ray, this.globe, hitPoint, hitPoint2)) {

                    const midPoint = hitPoint.clone().add(hitPoint2).multiplyScalar(0.5)
                    const originToMid = midPoint.clone().sub(this.globe.center)
                    const occludedMeters = this.globe.radius - originToMid.length()
                    if (occludedMeters < this.penumbraDepth) {

                        // fade will give us a value from 1 (no fade) to 0 (occluded)
                        fade = 1 - occludedMeters/this.penumbraDepth

                        scale *= darknessMultiplier + (1 - darknessMultiplier) * fade
                    } else {
                        fade = 0;
                        scale *= darknessMultiplier;
                        this.removeSatSunArrows(satData);
                    }
                }

                if (!isLookView) {
                    scale *= 2;
                }

                // fade will be 1 for full visible sats, < 1 as they get hidden
                if (fade > 0) {

                    // checking for flares
                    // we take the vector from the camera to the sat
                    // then reflect that about the vecotr from the globe center to the sat
                    // then measure the angle between that and the toSun vector
                    // if it's samall (<5°?) them glint

                    const camToSat = satPosition.clone().sub(this.camera.position)

                    // check if it's visible
                    raycaster.set(this.camera.position, camToSat)
                    var belowHorizon = intersectSphere2(raycaster.ray, this.globe, hitPoint, hitPoint2)
                    if (!belowHorizon) {


                        const globeToSat = satPosition.clone().sub(this.globe.center).normalize()
                        const reflected = camToSat.clone().reflect(globeToSat).normalize()
                        const dot = reflected.dot(toSun)
                        const glintAngle = Math.abs(degrees(Math.acos(dot)))

                        const altitudeKM = (satPosition.clone().sub(this.globe.center).length() - wgs84.RADIUS) / 1000

                        // if (altitudeKM < 450) {
                        //     scale *= 3 // a bit of a dodgy patch to make low atltitde trains stand out.
                        // }


                        // attenuate by distance if in look view
                        // use
                        if (isLookView) {
                            const distToSat = camToSat.length();
                            scale *= 3000000 / distToSat;

                            // if it's the ISS, scale it up a bit
                            if (satData.number === 25544) {
                                scale *= 3; // ISS is quite a bit bigger
                            }
                        }

                        const spread = this.flareAngle
                        const ramp = spread * 0.25; //
                        const middle  = spread -  ramp;  // angle at which the flare is brightest, constant
                        const glintSize = Sit.flareScale; //
                        if (glintAngle < spread) {
                            // we use the square of the angle (measured from the start of the spread)
                            // as the extra flare, to concentrate it in the middle
                            //const glintScale = 1 + fade * glintSize * (spread - glintAngle) * (spread - glintAngle) / (spread * spread)

                            //const glintScale = 1 + 4 * fade * glintSize * Math.abs(spread - glintAngle)  / (spread)

                            let glintScale;
                            let d = Math.abs(glintAngle);
                            if (d < middle) {
                                // if the angle is less than the middle, use set to the maximum (glintSize)
                                glintScale = fade * glintSize;
                            } else {
                                d = d - middle; // shift the angle to over the ramp region
                                glintScale = fade * glintSize * (ramp - d ) * (ramp-d)/ (ramp * ramp);
                            }

                            scale += glintScale

                            // arrows from camera to sat, and from sat to sun
                            var arrowHelper = DebugArrowAB(satData.name, this.camera.position, satPosition, (belowHorizon?"#303030":"#FF0000"), true, this.sunArrowGroup, 10, LAYER.MASK_HELPERS)
                            var arrowHelper2 = DebugArrowAB(satData.name + "sun", satPosition,
                                satPosition.clone().add(toSun.clone().multiplyScalar(10000000)), "#c08000", true, this.sunArrowGroup, 10, LAYER.MASK_HELPERS)
                           // var arrowHelper3 = DebugArrowAB(satData.name + "reflected", satPosition,
                           //     satPosition.clone().add(reflected.clone().multiplyScalar(10000000)), "#00ff00", true, this.sunArrowGroup, 0.025, LAYER.MASK_HELPERS)

                            // and maybe one for flare tracks
                            if (this.showFlareTracks) {
                                // we use the reflected vector, as that's the one that will be seen by the observer
                                // so we can see the flare track
                                let A = satData.eusA.clone()
                                let dir = satData.eusB.clone().sub(satData.eusA).normalize()
                                DebugArrow(satData.name + "flare", dir, satData.eus, 100000, "#FFFF00", true, this.satelliteFlareTracksGroup, 20, LAYER.MASK_LOOKRENDER)
                            }

                            satData.hasSunArrow = true;
                        } else {
                            this.removeSatSunArrows(satData);

                            // do the scale again to incorporate al
                            // satData.sprite.scale.set(scale, scale, 1);

                        }
                    } else {



                        this.removeSatSunArrows(satData);
                    }
                }



                if (isLookView && scale < Sit.satCutOff) {
                    scale = 0;
                }

                // we store to look view scale, so we can filter out those names
                if (isLookView) {
                    satData.lastScale = scale;
                }

                magnitudes[i] = scale
            }
            this.satelliteGeometry.attributes.magnitude.needsUpdate = true;
        }
    }

    // per-viewport satellite sprite text update for scale and screen offset
    updateSatelliteText(view) {
        const layerMask = this.satelliteTextGroup.layers.mask;
        if (!layerMask) {
            // if not visible in either the main or helpers layer, skip the update
            return;
        }


        const camera = view.camera;
        const cameraForward = new Vector3(0,0,-1).applyQuaternion(camera.quaternion);
        const cameraPos = camera.position;
        const tanHalfFOV = Math.tan(radians(camera.fov/2))

        const viewScale = 0.025 * view.divParent.clientHeight / view.heightPx;

        if (this.TLEData === undefined) {
            console.warn("TLEData is undefined in updateSatelliteText (Not loaded yet?)")
            return;
        }

        assert(this.TLEData !== undefined, "TLEData is undefined in updateSatelliteText")

        const lookPos = NodeMan.get("lookCamera").camera.position;
        const numSats = this.TLEData.satData.length;
        for (let i = 0; i < numSats; i++) {
            const satData = this.TLEData.satData[i];

            // if the satellite is not visible, skip it
            // user filtered sats are either in the list, or ar e the brightest or the ISS (if those are enabled)
            // if the satellite is not user filtered, skip it
            if (satData.visible
                && ( satData.userFiltered || satData.eus.distanceTo(lookPos) < this.arrowRange*1000)
                && ( satData.lastScale > 0 || this.showAllLabels ) // if the scale is 0, we don't show the label, unless showAllLabels is true
            ) {
            //if (satData.visible) {
                if (!satData.spriteText) {
                    // if the sprite is not created, create it
                    // this is done in the TLEData constructor, but might not be called
                    // if the TLEData is loaded after the CNodeDisplayNightSky is created
                    var name = satData.name.replace("0 STARLINK", "SL").replace("STARLINK", "SL");
                    // strip whitespae off the end
                    name = name.replace(/\s+$/, '');
                    satData.spriteText = new SpriteText(name, 0.01, "white", {depthTest:true} );

                    // propagate the layer mask
                    satData.spriteText.layers.mask = layerMask;

                    this.satelliteTextGroup.add(satData.spriteText);
                }
                const sprite = satData.spriteText;

                const satPosition = satData.eus;
                // scaling based on the view camera
                // whereas satellite dot scaling is done with the look Camera?????
                const camToSat = satPosition.clone().sub(cameraPos)
                // get the perpendicular distance to the satellite, and use that to scale the name
                const distToSat = camToSat.dot(cameraForward);
                const nameScale = viewScale * distToSat * tanHalfFOV;
                sprite.scale.set(nameScale * sprite.aspect, nameScale, 1);

                const pos = satData.eus;
                const offsetPost = view.offsetScreenPixels(pos, 0, 30);
                sprite.position.copy(offsetPost);
            } else {
               // if not visible dispose it
               if (satData.spriteText) {
                    // remove the sprite from the group
                    this.satelliteTextGroup.remove(satData.spriteText);
                    satData.spriteText.dispose();
                    satData.spriteText = null;
               }


               //satData.spriteText.scale.set(0,0,0);
            }
        }
    }









    removePlanets(scene, dayScene = null) {
        // Remove existing planet sprites from scenes to prevent duplicates
        if (this.planetSprites) {
            for (const [planet, planetData] of Object.entries(this.planetSprites)) {
                if (planetData.sprite) {
                    if (scene) scene.remove(planetData.sprite);
                    if (planetData.sprite.material) {
                        if (planetData.sprite.material.map) {
                            planetData.sprite.material.map.dispose();
                        }
                        planetData.sprite.material.dispose();
                    }
                }
                if (planetData.daySkySprite && dayScene) {
                    dayScene.remove(planetData.daySkySprite);
                    if (planetData.daySkySprite.material) {
                        if (planetData.daySkySprite.material.map) {
                            planetData.daySkySprite.material.map.dispose();
                        }
                        planetData.daySkySprite.material.dispose();
                    }
                }
            }
        }
        this.planetSprites = {};
    }

    addPlanets(scene, dayScene = null) {

        assert(Sit.lat !== undefined, "addPlanets needs Sit.lat")
        assert(Sit.lon !== undefined, "addPlanets needs Sit.lon")

        // Remove existing planet sprites first to prevent duplicates
        this.removePlanets(scene, dayScene);

        // Safety check: if planetSprites already has entries, something went wrong
        if (this.planetSprites && Object.keys(this.planetSprites).length > 0) {
            console.warn("CNodeDisplayNightSky: planetSprites not empty after removePlanets, forcing cleanup");
            this.planetSprites = {};
        }

        // Setup the sprite material

        const starMap = new TextureLoader().load(SITREC_APP+'data/images/nightsky/MickStar.png'); // Load a star texture

        const sunMap = new TextureLoader().load(SITREC_APP+'data/images/nightsky/MickSun.png'); // Load a star texture

        // alternative way to load a texture, using the file manager, and the "files" list in the Sit
        //const sunMapImg = FileManager.get("sun");
        //const sunMap = new Texture(sunMapImg)
        //sunMap.needsUpdate = true; // Load a star texture

        const moonMap = new TextureLoader().load(SITREC_APP+'data/images/nightsky/MickMoon.png'); // Load a star texture
//        const spriteMaterial = new SpriteMaterial({map: spriteMap, color: 0x00ff00});

        const sphereRadius = 100; // 100m radius

        let date = this.in.startTime.dateNow;

        // Use lookCamera position for observer instead of fixed Sit coordinates
        const cameraPos = this.camera.position;
        const cameraEcef = EUSToECEF(cameraPos);
        const cameraLLA = ECEFToLLAVD_Sphere(cameraEcef);
        let observer = new Astronomy.Observer(cameraLLA.x, cameraLLA.y, cameraLLA.z);

        this.planetSprites = {}

        var n = 0;
        for (const planet of this.planets) {

            var spriteMap = starMap;
            if (planet === "Sun") spriteMap = sunMap
            if (planet === "Moon") spriteMap = moonMap

            const color = this.planetColors[n++];
            const spriteMaterial = new SpriteMaterial({map: spriteMap, color: color});
            const sprite = new Sprite(spriteMaterial);

            // Create day sky sprite if needed
            // this is rendered AFTER the atmosphere polygon (with dayScene),
            // and is the exact same position, etc as the night sprite

            let daySkySprite = null;
            if ((planet === "Sun" || planet === "Moon") && dayScene) {
                const sunSpriteMaterial = new SpriteMaterial({map: spriteMap, color: color});
                daySkySprite = new Sprite(sunSpriteMaterial);
                dayScene.add(daySkySprite);
            }

            // Update both sprites at once
            this.updatePlanetSprite(planet, sprite, date, observer, sphereRadius, daySkySprite);
            this.planetSprites[planet].color = color;

            // Add sprite to scene
            scene.add(sprite);

        }
    }

    /*
// Actual data used.
0 STARLINK-1007
1 44713U 19074A   23216.03168702  .00031895  00000-0  21481-2 0  9995
2 44713  53.0546 125.3135 0001151  98.9698 261.1421 15.06441263205939

// Sample given by ChatGPT
1 25544U 98067A   21274.58668981  .00001303  00000-0  29669-4 0  9991
2 25544  51.6441 179.2338 0008176  49.9505 310.1752 15.48903444320729
     */


    replaceTLE(tle) {
        this.removeSatellites()
        this.TLEData = new CTLEData(tle)
        this.addSatellites(this.satelliteGroup, this.satelliteTextGroup)
        this.filterSatellites()
        EventManager.dispatchEvent("tleLoaded", {})
        setRenderOne(2); // force a render update after loading the TLE data, allowing two frames for the update to take effect
    }

    removeSatellites() {
        if (this.TLEData !== undefined) {

            if (this.satelliteGeometry) {
                this.satelliteGeometry.dispose();
                this.satelliteGeometry = null;
            }
            if (this.satelliteMaterial) {
                if (this.satelliteMaterial.uniforms.starTexture.value) {
                    this.satelliteMaterial.uniforms.starTexture.value.dispose();
                }
                this.satelliteMaterial.dispose();
                this.satelliteMaterial = null;
            }

            if (this.satellites) {
                this.satelliteGroup.remove(this.satellites);
                this.satellites = null;
            }

            // we no longer use individual sprites for the satellites
            // but they are still used for text.
            for (const [index, satData] of Object.entries(this.TLEData.satData)) {
                // satData.sprite.material.dispose();
                // this.satelliteGroup.remove(sat.sprite)
                //sat.sprite = null;

                if (satData.spriteText) {
                    satData.spriteText.dispose();
                    this.satelliteTextGroup.remove(satData.spriteText)
                    satData.spriteText = null;
                }

                this.removeSatSunArrows(satData);
                this.removeSatelliteArrows(satData);

                // remove the debug arrows

            }
            this.satData = undefined;
        }
    }



    addSatellites(scene, textGroup) {
        assert(Sit.lat !== undefined, "addSatellites needs Sit.lat");
        assert(Sit.lon !== undefined, "addSatellites needs Sit.lon");

        // Define geometry for satellites
        this.satelliteGeometry = new BufferGeometry();


        const len = this.TLEData.satData.length;

        // Allocate arrays for positions and colors
        let positions = new Float32Array(len * 3); // x, y, z for each satellite
        let colors = new Float32Array(len * 3); // r, g, b for each satellite
        let magnitudes = new Float32Array(len); // magnitude for each satellite

        // Custom shaders
        const customVertexShader = `
    varying vec3 vColor;
    uniform float minSize;
    uniform float maxSize;
    uniform float cameraFOV;
    uniform float satScale;
    attribute float magnitude;
    attribute vec3 color;
    varying float vDepth;

    void main() {
        vColor = color;
        
        // if magnitude is 0 then do not draw it
        if (magnitude == 0.0) {
            gl_Position = vec4(0,0,0,0);
            gl_PointSize = 0.0;
            return;
        }

        float size = mix(minSize, maxSize, magnitude);
        size *= satScale;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size;
        vDepth = gl_Position.w;
    }`;

        const customFragmentShader = `
    varying vec3 vColor;
    uniform float nearPlane;
    uniform float farPlane;
    varying float vDepth;
    uniform sampler2D starTexture;

    void main() {
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float alpha = 1.0 - dot(uv, uv);
        if (alpha < 0.0) discard;

        vec4 textureColor = texture2D(starTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, 1.0) * textureColor * alpha;

        float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
        gl_FragDepthEXT = z * 0.5 + 0.5;
    }`;

        // Custom material for satellites
        this.satelliteMaterial = new ShaderMaterial({
            vertexShader: customVertexShader,
            fragmentShader: customFragmentShader,
            uniforms: {
                minSize: { value: 0.0 },  // was 1.0, but we want to scale to zero if needed
                maxSize: { value: 20.0 },
                starTexture: { value: new TextureLoader().load(SITREC_APP+'data/images/nightsky/MickStar.png') },
                cameraFOV: { value: 30 },
                satScale: { value: Sit.satScale/window.devicePixelRatio },
                ...sharedUniforms,
            },
            transparent: true,
            depthTest: true,
        });

        // uodate colors and add the satellite texst sprites
        for (let i = 0; i < this.TLEData.satData.length; i++) {
            const sat = this.TLEData.satData[i];

            // Calculate satellite position
            const position = V3();

            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            magnitudes[i] = 0.1;



            sat.eus = V3();


            // colro of the sprite is based on the name length
            // TODO: this is for Starlink, but we can generalize it
            var name = sat.name.replace("0 STARLINK", "SL").replace("STARLINK", "SL");
            // strip whitespae off the end
            name = name.replace(/\s+$/, '');
            // const spriteText = new SpriteText(name, 0.01, "white", {depthTest:true} );
            // spriteText.layers.mask = LAYER.MASK_LOOK  ;
            //
            // sat.spriteText = spriteText;
            // textGroup.add(spriteText);

            // Assign a color to each satellite (example: random color)


            // SL-0000 names have are yellow, SL-00000 are orange
            // use the length of the name 7 or 8 to determine the color
            let color = new Color(0xF0F0FF); // default blueish white
            let length = name.length;
            if (sat.name.includes("STARLINK")) {
                color = new Color(0xFFFFC0);
                if (length > 7) {
                    color = new Color(0xFFA080);
                }
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

        }

        // Attach data to geometry
        this.satelliteGeometry.setAttribute('position', new BufferAttribute(positions, 3));
        this.satelliteGeometry.setAttribute('color', new BufferAttribute(colors, 3));
        this.satelliteGeometry.setAttribute('magnitude', new BufferAttribute(magnitudes, 1));

        // Create point cloud for satellites
        this.satellites = new Points(this.satelliteGeometry, this.satelliteMaterial);

        // Disable frustum culling for satellites
        this.satellites.frustumCulled = false;

        // Add to scene
        scene.add(this.satellites);
    }


    // To get the EUS we need to get the LLA position
    // as the satellite.js library assumes an elliptical Earth
    // see discussion: https://www.metabunk.org/threads/the-secret-of-skinwalker-ranch-s03e09-uap-disappearing-into-thin-air-satellite-going-behind-cloud-entering-earths-shadow.13469/post-316283
    calcSatEUS(sat, date) {
        const positionAndVelocity = satellite.propagate(sat, date);
        if (positionAndVelocity && positionAndVelocity.position) {
            const gmst = satellite.gstime(date);
            // get geodetic (LLA) coordinates directly from satellite.js
            const GD = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
            const altitude = GD.height*1000; // convert from km to meters

//            const pv = positionAndVelocity.position;
//            const GD = eci_to_geodetic(pv.x, pv.y, pv.z, gmst);
//            const altitude = GD[2]*1000; // convert from km to meters

            // if the altitude is less than 100km, then it's in the atmosphere so we don't show it
            if (altitude < 100000) {
                return null;
            }

            // if it's significantly (10%) greater than geostationary orbit (35,786 km), then it's probably an error
            // so we don't show it
            if (altitude > 40000000) {
                return null;
            }

            const EUS = LLAToEUSRadians(GD.latitude, GD.longitude, altitude);
//            const EUS = LLAToEUSRadians(GD[1], GD[0], altitude);
            return EUS;


        } else {
            return null;
        }
    }

    updateAllSatellites(date) {

        const timeMS = date.getTime();

        this.timeStep = 2000
        const numSats = this.TLEData.satData.length;

        // if there's only a few satellites, use a smaller time step
        if (numSats < 100) {
            this.timeStep = 100;
        } else {
            this.timeStep = numSats; // scale it by the number of satellites
        }

        assert (this.satelliteGeometry !== undefined, "updateAllSatellites needs a geometry");

        // Get the position attribute from the geometry
        const positions = this.satelliteGeometry.attributes.position.array;
        const magnitudes = this.satelliteGeometry.attributes.magnitude.array;

        const lookPos = NodeMan.get("lookCamera").camera.position;

        let validCount = 0;
        let visibleCount = 0;
        for (let i = 0; i < numSats; i++) {
            const satData = this.TLEData.satData[i];
            const satrec = bestSat(satData.satrecs, date);

            // Satellites move in nearly straight lines
            // so interpolate every few seconds
            if (satData.timeA === undefined || timeMS < satData.timeA || timeMS > satData.timeB) {

                satData.timeA = timeMS;
                if (satData.timeB === undefined) {
                    // for the first one we spread it out
                    // so we end up updating about the same number of satellites per frame
                    satData.timeB = timeMS + Math.floor(1 + this.timeStep * (i/numSats));
                } else {
                    satData.timeB = timeMS + this.timeStep;
                }
                const dateB = new Date(satData.timeB)
                satData.eusA = this.calcSatEUS(satrec, date)
                satData.eusB = this.calcSatEUS(satrec, dateB)
            }



            // if the position can't be calculated then A and/or B will be null
            // so just skip over this
            if (satData.eusA !== null && satData.eusB !== null) {

                // calculate the velocity from A to B in m/s
                const velocity = satData.eusB.clone().sub(satData.eusA).multiplyScalar(1000 / (satData.timeB - satData.timeA)).length();

                // Starlink is typically 7.5 km/s, so if it's much higher than that, then it's probably an error
                // I use 11,000 as an upper limit to include highly elliptical orbits, see:
                // https://space.stackexchange.com/questions/48830/what-is-the-fastest-satellite-in-earth-orbit
                // Geostationary satellites are around 3 km/s, so we can use that as a lower limit
                //
                if (velocity < 2500 || velocity > 11000) {
                    // if the velocity is too high, then we assume it's an error and skip it
                    satData.invalidPosition = true;
                } else {

                    // Otherwise, we have a valid A and B, so do a linear interpolation
                    //satData.eus = satData.eusA.clone().add(satData.eusB.clone().sub(satData.eusA).multiplyScalar(
                    //    (timeMS - satData.timeA) / (satData.timeB - satData.timeA)
                    //));

                    // for optimization do this directly
                    // Calculate the normalized time value
                    var t = (timeMS - satData.timeA) / (satData.timeB - satData.timeA);

                    // Perform the linear interpolation (lerp)
                    satData.eus.lerpVectors(satData.eusA, satData.eusB, t);

                    // Update the position in the geometry's attribute
                    positions[i * 3] = satData.eus.x;
                    positions[i * 3 + 1] = satData.eus.y;
                    positions[i * 3 + 2] = satData.eus.z;
                    satData.invalidPosition = false;

                    satData.currentPosition = satData.eus.clone();

                    if (satData.spriteText) {
                        satData.spriteText.position.set(satData.eus.x, satData.eus.y, satData.eus.z);
                    }


                    let arrowsDrawn = false;
                    if (satData.visible && satData.eusA.distanceTo(lookPos) < this.arrowRange*1000) {
                        // draw an arrow from the satellite in the direction of its velocity (yellow)
                        if (this.showSatelliteTracks) {
                            let A = satData.eusA.clone()
                            let dir = satData.eusB.clone().sub(satData.eusA).normalize()
                            DebugArrow(satData.name + "_t", dir, satData.eus, 500000, "#FFFF00", true, this.satelliteTrackGroup, 20, LAYER.MASK_LOOKRENDER)
                            arrowsDrawn = true;
                            satData.hasArrowsNeedingCleanup = true;
                        }

                        // Arrow from satellite to ground (red)
                        if (this.showSatelliteGround) {
                            let A = satData.eusA.clone()
                            let B = getPointBelow(A)
                            DebugArrowAB(satData.name + "_g", A, B, "#00FF00", true, this.satelliteGroundGroup, 20, LAYER.MASK_LOOKRENDER)
                            arrowsDrawn = true;
                            satData.hasArrowsNeedingCleanup = true;
                        }
                    }

                    if (!arrowsDrawn) {
                        this.removeSatelliteArrows(satData);
                    }


                }
            } else {
                // if the new position is invalid, then we make it invisible
                // so we will need to flag it as invalid
                satData.invalidPosition = true;
            }

            if (satData.invalidPosition || !satData.visible) {
                this.removeSatSunArrows(satData);
                // to make it invisible, we set the magnitude to 0 and position to a million km away
                magnitudes[i] = 0;
                positions[i * 3] = 1000000000;
            } else {
                validCount++
            }


            if (satData.visible) {
                visibleCount++;
            }

        }

        par.validPct = validCount / visibleCount * 100;

        // Notify THREE.js that the positions have changed
        this.satelliteGeometry.attributes.position.needsUpdate = true;
    }

    removeSatelliteArrows(satData) {
        if (satData.hasArrowsNeedingCleanup) {
            removeDebugArrow(satData.name + "_t");
            removeDebugArrow(satData.name + "_g");
            satData.hasArrowsNeedingCleanup = false;
        }
    }

    removeSatSunArrows(satData)   {
        if (satData.hasSunArrow) {
            removeDebugArrow(satData.name)
            removeDebugArrow(satData.name + "sun")
            removeDebugArrow(satData.name + "reflected")
            removeDebugArrow(satData.name + "flare")
            satData.hasSunArrow = false;
        }
    }



    // Note, here we are claculating the ECEF position of planets on the celestial sphere
    // these are NOT the actual positions in space
    updatePlanetSprite(planet, sprite, date, observer, sphereRadius, daySkySprite = undefined) {
        //  const celestialInfo = Astronomy.Search(planet, date, observer, 1);
        const celestialInfo = Astronomy.Equator(planet, date, observer, false, true);
        const illumination = Astronomy.Illumination(planet, date)
        const ra = (celestialInfo.ra) / 24 * 2 * Math.PI;   // Right Ascension NOTE, in hours, so 0..24 -> 0..2π
        const dec = radians(celestialInfo.dec); // Declination
        const mag = illumination.mag; // Magnitude
        const equatorial = raDec2Celestial(ra, dec, sphereRadius)


        let color = "#FFFFFF";
        if (this.planetSprites[planet] !== undefined) {
            color = this.planetSprites[planet].color;
        }


        // Set the position and scale of the sprite
        sprite.position.set(equatorial.x, equatorial.y, equatorial.z);
        var scale = 10 * Math.pow(10, -0.4 * (mag - -5));
        if (scale > 1) scale= 1;
        if (planet === "Sun") scale = 1.9;
        if (planet === "Moon") scale = 1.9;
        
        // Apply planet brightness scale to all planets except Sun and Moon
        // Using logarithmic (magnitude-based) scaling for consistent brightness adjustment
        if (planet !== "Sun" && planet !== "Moon") {
            scale *= Math.pow(10, 0.4 * Math.log10(Sit.planetScale));
        }

        sprite.scale.set(scale, scale, 1);

        // If daySkySprite is provided, update it with the same position and scale
        if (daySkySprite) {
            daySkySprite.position.set(equatorial.x, equatorial.y, equatorial.z);
            daySkySprite.scale.set(scale, scale, 1);
        }


        this.updateArrow(planet, ra, dec, date, observer, sphereRadius)


        if (planet === "Sun") {

            // const ecef2 = equatorial.clone()
            // ecef2.applyMatrix4(this.celestialSphere.matrix)

            const gst = calculateGST(date);
            const ecef = celestialToECEF(ra,dec,wgs84.RADIUS, gst)
            // ecef for the sun will give us a vector from the cernter to the earth towards the Sun (which, for our purposes
            // is considered to be infinitely far away
            // We can use this to find the region where Starlink flares are expected

            const eus = ECEF2EUS(ecef, radians(Sit.lat), radians(Sit.lon), wgs84.RADIUS)
            const eusDir = ECEF2EUS(ecef, radians(Sit.lat), radians(Sit.lon), 0, true).normalize();
            // DebugArrow("Sunarrow", eusDir, eus, 2000000,"#FFFFFF")

             // if (Globals.sunLight) {
             //     Globals.sunLight.position.copy(eusDir)
             //
             //
             //     let toSun2 = getCelestialDirection("Sun", date);
             //     assert(eusDir.distanceTo(toSun2) < 0.000001, "Sunlight direction mismatch")
             //
             // }

             // sunDir is the direction vector FROM the sun. i.e. the direction sunlight is in.
            this.toSun.copy(eusDir.clone().normalize())
            this.fromSun.copy(this.toSun.clone().negate())

            if (this.showFlareRegion) {

                const camera = NodeMan.get("lookCamera").camera;

                const cameraPos = camera.position;
                const cameraEcef = EUSToECEF(cameraPos)
                const LLA = ECEFToLLAVD_Sphere(cameraEcef)

                const {az: az1, el: el1} = raDecToAzElRADIANS(ra, dec, radians(LLA.x), radians(LLA.y), getLST(date, radians(LLA.y)))
                const {az, el} = raDecToAltAz(ra, dec, radians(LLA.x), radians(LLA.y), getJulianDate(date))
                //console.log(`RA version ${planet}, ${degrees(az1)}, ${degrees(el1)}`)
                //console.log(`raDecToAltAz  ${planet}, ${degrees(az)}, ${degrees(el)}`)

                ///////////////////////////////////////////////////////////////////////
                // attempt to find the glint position for radius r
                // i.e. the position on the earth centered sphere, of radius r where
                // a line from the camera to that point will reflect in the direction of
                // the sun
                // This is a non-trivial problem, related to Alhazen's problem, and does not
                // easily submit to analytical approaches
                // So here I use an iterative geometric approach
                // first we simplify the search to two dimensions, as we know the point must lay in
                // the plane specified by the origin O, the camera position P, and the sun vector v
                // we could do it all in 2D, or just rotate about the axis perpendicular to this.
                // 2D seems like it would be fastest, but just rotating maybe simpler
                // So first calculate the axis perpendicular to OP and v
                const P = this.camera.position;
                const O = this.globe.center;
                const OP = P.clone().sub(O)             // from origin to camera
                const OPn = OP.clone().normalize();       // normalized for cross product
                const v = this.toSun                    // toSun is already normalized
                const axis = V3().crossVectors(v, OPn).normalize()   // axis to rotate the point on
                const r = wgs84.RADIUS + 550000         // 550 km is approximate starlink altitude

                // We are looking for a point X, at radisu R. Let's just start directly above P
                // as that's nice and simple
                const X0 = OPn.clone().multiplyScalar(r).add(O)

                var bestX = X0
                var bestGlintAngle = 100000; // large value so the first one primes it
                var bestAngle = 0;

                var start = 0
                var end = 360
                var step = 1
                var attempts = 0
                const maxAttempts = 6

                do {
                    //  console.log(`Trying Start = ${start}, end=${end}, step=${step},  bestAngle=${bestAngle}, bestGlintAngle=${bestGlintAngle}`)
                    // try a simple iteration for now
                    for (var angle = start; angle <= end; angle += step) {
                        // the point needs rotating about the globe origin
                        // (which is not 0,0,0, as we are in EUS)
                        // so sub O, rotate about the axis, then add O back
                        const X = X0.clone().sub(O).applyAxisAngle(axis, radians(angle)).add(O)

                        // we now have a potential new position, so calculate the glint angle

                        // only want to do vectors that point tawards the sun
                        const camToSat = X.clone().sub(P)

                        if (camToSat.dot(v) > 0) {

                            const globeToSat = X.clone().sub(O).normalize()
                            const reflected = camToSat.clone().reflect(globeToSat).normalize()
                            const dot = reflected.dot(v)
                            const glintAngle = (degrees(Math.acos(dot)))
                            if ((glintAngle >= 0) && (glintAngle < bestGlintAngle)) {
                                // check if it's obscured by the globe
                                // this check is more expensive, so only do it
                                // for potential "best" angles.
                                const ray = new Ray(X, this.toSun)
                                if (!intersectSphere2(ray, this.globe)) {
                                    bestAngle = angle;
                                    bestGlintAngle = glintAngle;
                                    bestX = X.clone();
                                }
                            }
                        }
                    }


                    start = bestAngle - step;
                    end = bestAngle + step;
                    step /= 10
                    attempts++;

                } while (bestGlintAngle > 0.0001 && attempts < maxAttempts)

                DebugArrowAB("ToGlint", this.camera.position, bestX, "#FF0000", true, this.flareRegionGroup, 20, LAYER.MASK_HELPERS)
                DebugArrow("ToSunFromGlint", this.toSun, bestX, 5000000, "#FF0000", true, this.flareRegionGroup, 20, LAYER.MASK_HELPERS)
                DebugWireframeSphere("ToGlint", bestX, 500000, "#FF0000", 4, this.flareRegionGroup)

            }

        }
        // add or update planetSprites - only create if it doesn't exist, otherwise just update
        if (!this.planetSprites[planet]) {
            this.planetSprites[planet] = {
                ra: ra,
                dec: dec,
                mag: mag,
                equatorial: equatorial,
                sprite: sprite,
                color: color,
                daySkySprite: daySkySprite,
            };
        } else {
            // Update existing entry
            this.planetSprites[planet].ra = ra;
            this.planetSprites[planet].dec = dec;
            this.planetSprites[planet].mag = mag;
            this.planetSprites[planet].equatorial = equatorial;
            this.planetSprites[planet].color = color;
            // Update daySkySprite if provided
            if (daySkySprite) {
                this.planetSprites[planet].daySkySprite = daySkySprite;
            }
        }

    }


    updateArrow(planet, ra, dec, date, observer, sphereRadius) {

        // problem with initialization order, so we need to check if the planet sprite is defined
        if (this.planetSprites[planet] === undefined) {
            return;
        }

        const name = planet;
        const flagName = "show" + name + "Arrow";
        const groupName = name + "ArrowGroup";
        const arrowName = name + "arrow";
        const obName = name + "ArrowOb";

        if (this[flagName] === undefined) {
            return;
        }

        if (this[flagName]) {
             const gst = calculateGST(date);
            const ecef = celestialToECEF(ra, dec, wgs84.RADIUS, gst)
            const eusDir = ECEF2EUS(ecef, radians(Sit.lat), radians(Sit.lon), 0, true);
            eusDir.normalize();
            this[obName].updateDirection(eusDir)

        }
    }

    dispose() {
        // Clean up star field resources
        if (this.starField) {
            this.starField.dispose();
        }
        
        // Clean up planet sprites before disposing
        this.removePlanets(this.celestialSphere, this.celestialDaySphere);
        super.dispose();
    }


}





export function addNightSky(def) {
//    console.log("Adding CNodeDisplayNightSky")
    var nightSky = new CNodeDisplayNightSky({id: "NightSkyNode", ...def});

    // iterate over any 3D views
    // and add an overlay to each for the star names (and any other night sky UI)

//    console.log("Adding night Sky Overlays")
    ViewMan.iterate((key, view) => {
        if (view.canDisplayNightSky) {
            new CNodeDisplaySkyOverlay({
                id: view.id+"_NightSkyOverlay",
                overlayView: view,
                camera: view.camera,
                nightSky: nightSky,
                gui: nightSky.celestialGUI,
            });
        }
    })

    return nightSky;
}



