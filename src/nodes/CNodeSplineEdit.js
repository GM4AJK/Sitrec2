import {SplineEditor} from "../SplineEditor";
import {guiMenus, NodeMan, Sit} from "../Globals";
import {Vector3} from "three";
import {PointEditor} from "../PointEditor";
import {CNodeEmptyArray} from "./CNodeArray";
import {getCameraNode} from "./CNodeCamera";
import {assert} from "../assert.js";

// a node wrapper for varioius spline editors
export class CNodeSplineEditor extends CNodeEmptyArray {
    constructor(v) {
        super(v);
        this.frames = v.frames ?? Sit.frames
        assert(this.frames >0, "CNodeSplineEditor has frames=0")

        // Default to time-based interpolation (not constant speed)
        this.constantSpeed = false;
        
        assert(v.view !== undefined, "CNodeSplineEditor needs a view");
        const view = NodeMan.get(v.view) // convert id to node, if needed
        const renderer = view.renderer;
        const controls = view.controls;

        const camera = getCameraNode(v.camera).camera;

        switch (v.type.toLowerCase()) {
            case "catmull":
            case "centripetal":
            case "chordal":
                if (v.initialPointsLLA === undefined) {
                    this.splineEditor = new SplineEditor(v.scene, camera, renderer, controls, () => this.recalculateCascade(),
                        v.initialPoints, false, v.type.toLowerCase())
                } else {
                    this.splineEditor = new SplineEditor(v.scene, camera, renderer, controls, () => this.recalculateCascade(),
                        v.initialPointsLLA, true, v.type.toLowerCase())
                }
                break;
            case "linear":
            default:
                if (v.initialPointsLLA === undefined) {
                    this.splineEditor = new PointEditor(v.scene, camera, renderer, controls, () => this.recalculateCascade(),
                        v.initialPoints, false)
                } else {
                    this.splineEditor = new PointEditor(v.scene, camera, renderer, controls, () => this.recalculateCascade(),
                        v.initialPointsLLA, true)
                }
        }

        this.optionalInputs(["snapCamera","snapTarget"])
        if (this.in.snapCamera != undefined) {
            this.splineEditor.snapCamera  = this.in.snapCamera;
            this.splineEditor.snapTarget  = this.in.snapTarget;
        }

        this.enable = false;

        // Only create GUI in physics menu if skipGUI is not set
        // This allows TrackManager to manage synthetic tracks without duplicate GUIs
        if (!v.skipGUI) {
            this.gui = guiMenus.physics.addFolder("Spline " + this.id).close()
            this.gui.add(this,"enable").onChange( v =>{
               this.splineEditor.setEnable(v)
            })
            this.gui.add(this,"exportSpline")
        }


        this.recalculate()
        this.splineEditor.updatePointEditorGraphics()
    }

    modSerialize() {


        assert(this.splineEditor.frameNumbers !== undefined, "CNodeSplineEditor has no frameNumbers")
        // check same length
        assert(this.splineEditor.frameNumbers.length === this.splineEditor.positions.length, "CNodeSplineEditor frameNumbers and positions length mismatch")


        let positions = [];
        for (let i=0;i<this.splineEditor.positions.length;i++) {
            const p = this.splineEditor.positions[i];
            positions.push([this.splineEditor.frameNumbers[i], p.x, p.y, p.z])
        }
        return {
            ...super.modSerialize(),
            positions: positions,
            constantSpeed: this.constantSpeed,
        }
    }

    modDeserialize(v) {
        super.modDeserialize(v);
        if (v.positions !== undefined) {
            this.splineEditor.load(v.positions)
        }
        if (v.constantSpeed !== undefined) {
            this.constantSpeed = v.constantSpeed
        }
    }



    exportSpline() {
        this.splineEditor.exportSpline()
    }

    update(f) {
        if (this.splineEditor.dirty) {
            this.splineEditor.dirty = false;
            this.recalculateCascade(f)
        }
    }

    // a spline is parametric and we step along it as a function of t
    recalculate() {
//        console.log("+++++Start Recalculate Spline")
 //       const spline = this.splineEditor.spline;
        this.array = []
        var pos = new Vector3()


        /*
        this.length = this.splineEditor.getLength(this.frames) // get length, based on the frames

        //console.log ("Spline length = " + len)

        // First get an array of the length at each value of t
        // with this.resolution steps

        var len = 0;
        var lastPos = new THREE.Vector3()
        var pos = new THREE.Vector3()
//        this.splineEditor.getPoint(0,lastPos)
        lastPos = this.splineEditor.getPointFrame(0)

        this.lengths = []
        this.tPositions = []
        // array is essentially indexed by t
        // where t = i/(frames-1)
        // so i = t*(fframes-1)
        this.tPositions.push(lastPos.clone())
        this.lengths.push(0)
        for (var i=1;i<this.frames;i++){

            var t = i/(this.frames-1) // go from 0 to 1, so we need frames-1 for the last one
            this.splineEditor.getPoint(t,pos)


            len += pos.clone().sub(lastPos).length()
            lastPos.copy(pos)
            this.lengths.push(len)
            this.tPositions.push(pos.clone())
        }

        // we now want an array of positions indexed by length (ie points are equidistant)
        // so step t along the length array until the length at that point
        var tIndex = 0;  // index into the above array

        var lengthStep = this.length/this.frames

        // the first one (lenght of 0) is always the same as t=0
        this.array.push({position:this.tPositions[0].clone()})
        for (var l=lengthStep;l<this.length;l+=lengthStep) {
            // advance tIndex until the length at that point is >= the needed length
            while (this.lengths[tIndex] < l) {
                tIndex++
            }

            if (tIndex >= this.lengths.length) {
                break;
            }
            // we now have the first tIndex that is GREATER OR EQUAL TO the length needed
            // we also know that tIndex > 0, so we can use tIndex-1 safely
            assert(tIndex > 0, "tIndex is "+tIndex )
            var aLen = this.lengths[tIndex-1]
            var bLen = this.lengths[tIndex]
            var fraction = (bLen-l)/(bLen-aLen)
            // fraction is how far from a to b we are for position L
            var aPos = this.tPositions[tIndex-1]
            var bPos = this.tPositions[tIndex]
            var a2b = bPos.clone().sub(aPos)
            var fractionPos = aPos.clone().add(a2b.multiplyScalar(fraction))

            this.array.push({position:fractionPos})



        }
    */

        // update snapping, if needed
        this.splineEditor.updateSnapping();

        if (this.constantSpeed) {
            // CONSTANT SPEED MODE: Traverse the path at constant speed, ignoring frame times
            // Calculate total path length by sampling the curve
            const SAMPLES = 1000; // Number of samples for length calculation
            var totalLength = 0;
            var lastPos = new Vector3()
            var currentPos = new Vector3()
            
            // Get the first point
            this.splineEditor.getPoint(0, lastPos)
            
            // Calculate total length by sampling the curve
            for (var i = 1; i <= SAMPLES; i++) {
                var t = i / SAMPLES;
                this.splineEditor.getPoint(t, currentPos)
                totalLength += currentPos.clone().sub(lastPos).length()
                lastPos.copy(currentPos)
            }
            
            // Now create an array mapping distance along path to t value
            const lengthToT = [{length: 0, t: 0}];
            var accumulatedLength = 0;
            this.splineEditor.getPoint(0, lastPos)
            
            for (var i = 1; i <= SAMPLES; i++) {
                var t = i / SAMPLES;
                this.splineEditor.getPoint(t, currentPos)
                accumulatedLength += currentPos.clone().sub(lastPos).length()
                lengthToT.push({length: accumulatedLength, t: t})
                lastPos.copy(currentPos)
            }
            
            // Now for each frame, find the position at constant speed
            for (var frame = 0; frame < this.frames; frame++) {
                // Calculate target distance for this frame
                var targetDistance = (frame / (this.frames - 1)) * totalLength;
                
                // Find the two samples that bracket this distance
                var sampleIndex = 0;
                while (sampleIndex < lengthToT.length - 1 && lengthToT[sampleIndex + 1].length < targetDistance) {
                    sampleIndex++;
                }
                
                var t;
                if (sampleIndex >= lengthToT.length - 1) {
                    t = 1.0;
                } else {
                    // Interpolate between the two samples to find exact t
                    var sample1 = lengthToT[sampleIndex];
                    var sample2 = lengthToT[sampleIndex + 1];
                    var lengthFraction = (targetDistance - sample1.length) / (sample2.length - sample1.length);
                    t = sample1.t + lengthFraction * (sample2.t - sample1.t);
                }
                
                // Get position at this t value
                var framePos = new Vector3();
                this.splineEditor.getPoint(t, framePos);
                this.array.push({position: framePos});
            }
        } else {
            // TIME-BASED MODE: Use frame numbers to determine position (original behavior)
            // Get it based on the frame number, as the spline now has a per-node frame number stored
            // and will work out the t value for you
          for (var i=0;i<this.frames;i++) {
              var pos = this.splineEditor.getPointFrame(i)
              this.array.push({position:pos})
          }
        }
    }

    insertPoint(frame, point) {
        this.splineEditor.insertPoint(frame, point)
        this.recalculateCascade()
    }



//     // heirachical search for the closest point
// NOT TESTED
//     findClosestPointToRay(ray) {
//
//         var A = 0;
//         var B = 1;
//         var steps = 10;
//         var accuracyDistance = 0.001 // to 1 mm
//
//         var point;
//         while (Math.abs(A-B)<0.000000001) {
//
//             // Find the segment that has the closest center point to the ray
//             // and then repeat with that until accurate enough
//             var bestSegment = A;
//             var bestSegmentDistance = 10000000000
//             var stepSize = (A-B)/steps
//             for (var t=A; t<=B; t+=stepSize) {
//                 var mid = t+stepSize / 2
//                 point = this.v(mid)
//                 var distance = ray.distanceToPoint(point)
//                 if (distance < accuracyDistance) {
//                     return point
//                 }
//                 if (distance < bestSegmentDistance) {
//                     bestSegmentDistance = distance;
//                     bestSegment = t
//                 }
//             }
//
//             A = bestSegment;
//             B = bestSegment+stepSize;
//
//         }
//
//         // This will be the B point, but essentially the same as A
//         return point;
//     }

    adjustUp(height, cameraTrack) {
        this.splineEditor.adjustUp(height,cameraTrack)

    }

 }

