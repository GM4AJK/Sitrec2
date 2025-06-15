// given an array of "positions" smooth the x,y,and z tracks by moving average
// or other techniques
// optionally copy any other data (like color, fov, etc) to the new array
import {CNodeEmptyArray} from "./CNodeArray";
import {GlobalDateTimeNode, NodeMan} from "../Globals";
import {f2m, RollingAverage, SlidingAverage} from "../utils";
import {CatmullRomCurve3} from "three";
import {V3} from "../threeUtils";
import {assert} from "../assert";
import {CNodeTrack} from "./CNodeTrack";

export class CNodeSmoothedPositionTrack extends CNodeTrack {
    constructor(v) {
        super(v)
        this.method = v.method || "moving"
        this.input("source") // source array node
        if (this.method === "moving" || this.method === "sliding") {
            this.input("window") // amount to smooth (rolling average window size)
            this.optionalInputs(["iterations"])
        }

        this.frames = this.in.source.frames;
        this.useSitFrames = this.in.source.useSitFrames;


        if (this.method === "catmull") {
            // this.intervals = v.intervals ?? 10
            this.input("tension")
            this.input("intervals")
        }

        this.copyData = v.copyData ?? false;

        this.recalculate()

        this.exportable = v.exportable ?? false;
        if (this.exportable) {
            NodeMan.addExportButton(this, "exportTrackCSV", "Smoothed CSV ")
        }
    }


    exportTrackCSV() {
        // let csv = "Frame,Time,Lat,Lon,Alt\n"
        // for (let f = 0; f < this.frames; f++) {
        //
        //     let pos = this.array[f].lla
        //     if (pos === undefined) {
        //         // don't have an LLA, so convert from EUS
        //         const posEUS = this.array[f].position
        //         const posLLA = EUSToLLA(posEUS);
        //         pos = [posLLA.x, posLLA.y, posLLA.z]
        //     }
        //     const time = GlobalDateTimeNode.frameToMS(f)
        //
        //     csv += f + "," + time + "," + (pos[0]) + "," + (pos[1]) + "," + f2m(pos[2]) + "\n"
        // }
        // saveAs(new Blob([csv]), "trackSmoothed-" + this.id + ".csv")

        this.exportArray();

    }

    recalculate() {

        this.sourceArray = this.in.source.array;

        if (this.sourceArray === undefined) {
            // need to build it from source node, possibly calculating the values
            // this gives us a per-frame array of {position:...} type vectors
            // and the original data if we want to copy that
            this.sourceArray = []
            for (var i = 0; i < this.in.source.frames; i++) {
                if (this.copyData) {
                    const original = this.in.source.v(i);
                    // make a copy of the original object
                    // and add the smoothed position to it
                    const copy = {...original, position: this.in.source.p(i)};
                    this.sourceArray.push(copy)
                } else {
                    this.sourceArray.push({position: this.in.source.p(i)})
                }
            }
        }

        if (this.method === "moving" || this.method === "sliding") {

            // const x = this.sourceArray.map(pos => pos.position.x)
            // const y = this.sourceArray.map(pos => pos.position.y)
            // const z = this.sourceArray.map(pos => pos.position.z)

            // create x,y,z arrays using getValueFrame, so we can smooth abstract data
            // (like catmullrom tracks, which don't create the sourceArray)

            const x = []
            const y = []
            const z = []
            for (let i = 0; i < this.sourceArray.length; i++) {
                const pos = this.in.source.p(i)
                x.push(pos.x)
                y.push(pos.y)
                z.push(pos.z)
            }

            var window = this.in.window.v0
            var iterations = 1
            if (this.in.iterations)
                iterations = this.in.iterations.v0

            var xs, ys, zs;

            if (window > this.sourceArray.length-3) {
                console.warn("Window size is larger tha 3 less than the number of frames, reducing.")
                window = this.sourceArray.length - 3;
            }

            if (window <= 0) {
                // zero sized window, just copy the data
                xs = x
                ys = y
                zs = z
            } else {
                if (this.method === "moving") {
                    xs = RollingAverage(x, window, iterations)
                    ys = RollingAverage(y, window, iterations)
                    zs = RollingAverage(z, window, iterations)
                } else {
                    xs = SlidingAverage(x, window, iterations)
                    ys = SlidingAverage(y, window, iterations)
                    zs = SlidingAverage(z, window, iterations)
                }
            }

            this.array = []
            for (var i = 0; i < x.length; i++) {
                this.array.push({position: V3(xs[i], ys[i], zs[i])})
            }
            this.frames = this.array.length;
        } else {
            // Catmull!
            // here sourceArray is an array of {position:...} type vecrot
            // convert to a simple array of Vector3s at the desired interval
            var interval = Math.floor(this.frames / this.in.intervals.v0)
            var data = []
            for (var i = 0; i < this.frames; i += interval) {
                var splinePoint = this.sourceArray[i].position.clone()
                //        DebugSphere("SplinePoint" + i, splinePoint, 20, 0xff00ff)

                data.push(splinePoint)
            }
            this.spline = new CatmullRomCurve3(data);
            this.spline.tension = this.in.tension.v0;  // only has effect for catmullrom

            // for a track, we will want to use chordal
            // as it keeps the velocity smooth across a segment
            // the different methods only have significant other differences with sharp turns.
            this.spline.curveType = 'chordal';  // Possible values are centripetal, chordal and catmullrom.

            //   this.dump()

            // now make the array of positions
            // this avoids recalculating the spline each frame
            // and allows us to re-smooth a catmull track with existing code
            this.array = []
            for (var i = 0; i < this.frames; i++) {
                var pos = V3()
                var t = i / this.frames
                this.spline.getPoint(t, pos)
                this.array.push({position: pos})
            }

        }

        // // if the source array has misbRows, then we need to copy them to the new array
        // // so that we can use them in the output
        // // this will be done in getValueFrame
        // assert(this.array !== undefined, "CNodeSmoothedPositionTrack: array is undefined, id=" + this.id)
        // for (let i = 0; i < this.sourceArray.length; i++) {
        //     if (this.sourceArray[i].misbRow !== undefined) {
        //         assert(this.array[i] !== undefined, "CNodeSmoothedPositionTrack: array[i] is undefined, i=" + i)
        //         this.array[i].misbRow = this.sourceArray[i].misbRow
        //     }
        // }

    }

    getValueFrame(frame) {
        let pos;
        if (this.method === "moving" || this.method === "sliding") {
            assert(this.array[frame] !== undefined, "CNodeSmoothedPositionTrack: array[frame] is undefined, frame=" + frame + " id=" + this.id)
            pos = this.array[frame].position
        } else {
            pos = V3()
            var t = frame / this.frames
            this.spline.getPoint(t, pos)
            //       console.log(vdump(pos))
        }

        if (this.copyData) {
            return {
                ...this.sourceArray[frame], // might have other data, if copyData was set
                ...{position: pos}
            }
        } else {
            // just a bit quicker to not copy the data if we don't have to
            return {position: pos}
        }

    }


    dump() {

        if (this.spline !== undefined) {
            var out = ""

            out += "frame,t,x,y,z,v\n"
            var lastPos = V3()
            this.spline.getPoint(0, lastPos)
            for (var f = 1; f < this.frames; f++) {
                var pos = V3()
                var t = f / this.frames
                this.spline.getPoint(t, pos)

                var v = pos.clone().sub(lastPos).length()

                out += f + ",";
                out += t + ",";
                out += pos.x + ",";
                out += pos.y + ",";
                out += pos.z + ",";
                out += v + "\n";

                lastPos = pos


                // last line no comma, lf
                //out += data[8][f] + "\n"
            }

            saveAs(new Blob([out]), "gimbalSpline.csv")
        }
    }


}