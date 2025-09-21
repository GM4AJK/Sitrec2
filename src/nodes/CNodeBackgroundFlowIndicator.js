// Dispaly an arrow from an object to a celestial body

import {DebugArrowAB, removeDebugArrow} from "../threeExt";
import {CNode} from "./CNode";
import {guiShowHide} from "../Globals";
import {convertColorInput} from "../ConvertColorInputs";
import {Vector3} from "three/src/math/Vector3";
import * as LAYER from "../LayerMasks";
import {GlobalScene} from "../LocalFrame";
import {Raycaster} from "three/src/core/Raycaster";
import {assert} from "../assert";

export class CNodeBackgroundFlowIndicator extends CNode {
    constructor(v) {
        v.color ??= "white";
        v.length ??= 1000;
        super(v);
        convertColorInput(v,"color",this.id)
        this.body = v.body;    // "Sun", "Moon", "Mars", etc
        this.input("length");  // length of arrow
        this.input("color");   // color of arrow
        this.arrowName = "backgroundFlow"

        guiShowHide.add(this, 'visible').onChange( (v) => {
            if (v) {
                this.update(0);
            } else {
                this.remove();
            }
        })
            .name("Background Flow Indicator")
            .tooltip("Display an arrow indicating how much the background will move in the next frame/n" +
                "Useful for syncing the sim with video (use View/Vid Overlay)")


    }

    update(f) {
        if (!this.visible) return;

        const cameraLOS = NodeMan.get("JetLOSCameraCenter", false)
        if (!cameraLOS) return;

        const camera = NodeMan.get("lookCamera", false);
        if (!camera) return;
        const cameraPos = camera.camera.position.clone();

        // get camera vectors at f and f+1

        const losA = cameraLOS.getValue(f).heading;
        const losB = cameraLOS.getValue(f + 1).heading;

        assert(losA && losB, "No LOS values found");
        assert(typeof losA.clone === "function","Invalid LOS value")

        const rayA = new Raycaster(cameraPos, losA)
        const rayB = new Raycaster(cameraPos, losB)

        const terrainNode = NodeMan.get("TerrainModel", false);

        // attmpet to get the closest intersecting objects/points on the terrain model

        let obA = terrainNode.getClosestIntersect(rayA, terrainNode);
        let obB = terrainNode.getClosestIntersect(rayB, terrainNode);

        let pointA, pointB;

        if (obA && obB) {
            pointA = obA.point;
            pointB = obB.point;
        } else {
            // fallback to two points 10km away from the camera in the LOS directions
            pointA = cameraPos.clone().add(losA.clone().multiplyScalar(10000))
            pointB = cameraPos.clone().add(losB.clone().multiplyScalar(10000))
        }


        const AtoB = new Vector3().subVectors(pointB, pointA);

//WHY not two?????????????
   //     DebugArrowAB(this.arrowName+"20", pointA, pointA.clone().add(AtoB.multiplyScalar(20)), "#505050", true, GlobalScene, 20, LAYER.MASK_LOOKRENDER);
        DebugArrowAB(this.arrowName, pointA, pointA.clone().add(AtoB.multiplyScalar(1)), this.in.color.v0, true, GlobalScene, 20, LAYER.MASK_LOOKRENDER);
    }


    remove() {
        removeDebugArrow(this.arrowName)
        removeDebugArrow(this.arrowName+"20")

    }

    dispose() {
        this.remove();
        super.dispose();
    }


}