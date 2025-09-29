import {CNode3D} from "./CNode3D";
import {assert} from "../assert";
import {AdditiveBlending, Mesh, PlaneGeometry, ShaderMaterial, Vector3} from 'three';
import {sharedUniforms} from "../js/map33/material/SharedUniforms";
import {NodeMan} from "../Globals";
import {CNodeGUIValue} from "./CNodeGUIValue";
import {par} from "../par";

export class CNode3DLight extends CNode3D {
    constructor(v) {
        super(v);
        this.type = 'CNode3DLight';

        this.light = v.light; // the light objectm required for this node
        assert(this.light, "CNode3DLight requires a light object");

        console.log("CNode3DLight created for light: " + this.light.name);

        // Store the GUI folder if provided
        this.gui = v.gui;

        // Initialize visibility control variables
        this.lightVisible = true;
        this.lightIlluminates = false;

        //const size = v.size || 4; // default size if not specified

        const size = this.light.intensity / 100;

// Create plane geometry
        const geometry = new PlaneGeometry(size, size); // adjust size as needed

// Shader material with HDR-style disk + falloff
        const material = new ShaderMaterial({
            uniforms: {
                ...sharedUniforms, // shared uniforms for near/far planes
                uColor: { value: [this.light.color.r, this.light.color.g, this.light.color.b] },
                uIntensity: { value: this.light.intensity }, // HDR "strength"
                uRadius: { value: 0.3 },     // proportion of core radius (hard center)

            },
            vertexShader: `
        varying vec2 vUv;
        varying float vDepth;
        
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vDepth = gl_Position.w;
        }
    `,
            fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform float uRadius;
        uniform float nearPlane; // these are set in sharedUniforms
        uniform float farPlane;

        varying vec2 vUv;
        varying float vDepth;

        void main() {
            vec2 centered = vUv - 0.5;
            float dist = length(centered) * 2.0; // fix scaling
            
            // Core disk
            float core = smoothstep(uRadius, uRadius - 0.05, dist);
            
            // Soft outer falloff
            float falloff = pow(clamp(1.0 - dist, 0.0, 1.0), 2.0);
            
            // Combine alpha
            float alpha = core + (1.0 - core) * falloff * 0.5;
            alpha = clamp(alpha, 0.0, 1.0);

            // Logarithmic depth calculation
            // requires the near and far planes to be set in the material (shared uniforms)
            // and vDepth to be passed from the vertex shader from gl_Position.w
            float z = (log2(max(nearPlane, 1.0 + vDepth)) / log2(1.0 + farPlane)) * 2.0 - 1.0;
            gl_FragDepthEXT = z * 0.5 + 0.5;

            // uIntensity should not be used here because it's already applied in the shader
            // but we can still used for color
            // if it's large, then somethng like [1,0,0.01] will come out as magenta
            gl_FragColor = vec4(uColor, alpha);
        
        }
    `,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending
        });

        // check for strobes
        if (this.light.userData !== undefined && this.light.userData.strobeEvery) {
            this.strobeEvery = this.light.userData.strobeEvery
            this.strobeLength = this.light.userData.strobeLength || 0.1;
        }


// Create mesh
        const billboard = new Mesh(geometry, material);
        billboard.name = "LightBillboard";
        billboard.position.copy(this.light.position);

// Add to scene
        v.scene.add(billboard);

// Save reference
        this._object = billboard;

        this.scene = v.scene; // save the scene for later use

        // Create GUI controls if GUI folder is provided
        if (this.gui) {
            this.createGUIControls();
        }

    }

    createGUIControls() {
        // Light Visible control (controls both light and billboard visibility)
        this.lightVisibleControl = new CNodeGUIValue({
            id: this.id + "_lightVisible",
            desc: "Light Visible",
            value: this.lightVisible ? 1 : 0,
            start: 0,
            end: 1,
            step: 1,
            onChange: (value) => {
                this.lightVisible = value === 1;
                this.updateVisibility();
            }
        }, this.gui);

        // Light Illuminates control (controls only light illumination)
        this.lightIlluminatesControl = new CNodeGUIValue({
            id: this.id + "_lightIlluminates",
            desc: "Light Illuminates",
            value: this.lightIlluminates ? 1 : 0,
            start: 0,
            end: 1,
            step: 1,
            onChange: (value) => {
                this.lightIlluminates = value === 1;
                this.updateVisibility();
            }
        }, this.gui);

        // Intensity control
        this.intensityControl = new CNodeGUIValue({
            id: this.id + "_intensity",
            desc: "Intensity",
            value: this.light.intensity,
            start: 0,
            end: 10000,
            step: 1,
            onChange: (value) => {
                this.light.intensity = value;
                this._object.material.uniforms.uIntensity.value = value;
                // Update size based on intensity
                const newSize = value / 100;
                this._object.geometry.dispose();
                this._object.geometry = new PlaneGeometry(newSize, newSize);
            }
        }, this.gui);

        // Color control - create a color object for the GUI
        this.colorObject = {
            color: '#' + this.light.color.getHexString()
        };
        this.colorControl = this.gui.addColor(this.colorObject, 'color').name('Color').onChange((value) => {
            this.light.color.setHex(value.replace('#', '0x'));
            this._object.material.uniforms.uColor.value = [this.light.color.r, this.light.color.g, this.light.color.b];
        });

        // Radius control
        this.radiusControl = new CNodeGUIValue({
            id: this.id + "_radius",
            desc: "Radius",
            value: this._object.material.uniforms.uRadius.value,
            start: 0.1,
            end: 1.0,
            step: 0.01,
            onChange: (value) => {
                this._object.material.uniforms.uRadius.value = value;
            }
        }, this.gui);

        // Strobe controls if strobe data exists
        if (this.strobeEvery !== undefined) {
            this.strobeEveryControl = new CNodeGUIValue({
                id: this.id + "_strobeEvery",
                desc: "Strobe Every (s)",
                value: this.strobeEvery,
                start: 0,
                end: 20.0,
                step: 0.01,
                onChange: (value) => {
                    this.strobeEvery = value;
                }
            }, this.gui);

            this.strobeLengthControl = new CNodeGUIValue({
                id: this.id + "_strobeLength",
                desc: "Strobe Length (s)",
                value: this.strobeLength,
                start: 0.01,
                end: 1.0,
                step: 0.01,
                onChange: (value) => {
                    this.strobeLength = value;
                }
            }, this.gui);
        }
    }

    // Method to update visibility based on control variables and strobe state
    updateVisibility() {
        // Billboard visibility is controlled by lightVisible
        if (this._object) {
            this._object.visible = this.lightVisible;
        }
        
        // Light illumination is controlled by both lightVisible and lightIlluminates
        this.light.visible = this.lightVisible && this.lightIlluminates;
    }

    dispose() {
        NodeMan.disposeRemove(this.lightVisibleControl, true);
        NodeMan.disposeRemove(this.lightIlluminatesControl, true);
        NodeMan.disposeRemove(this.intensityControl, true);
        NodeMan.disposeRemove(this.radiusControl, true);
        NodeMan.disposeRemove(this.strobeEveryControl, true);
        NodeMan.disposeRemove(this.strobeLengthControl, true);


        // currently UI is destroyed when changing levels, but this reference is still there
        // an now has no parent.
        // if we want to remove things individually, we might want to improve this
        // but for now it's a possible minor temporary memory leak.
        // if (this.colorControl) {
        //     this.colorControl.destroy();
        //     this.colorControl = null;
        // }


        if (this._object) {
            this.scene.remove(this._object);
            this._object.geometry.dispose();
            this._object.material.dispose();
            this._object = null;
        }
        super.dispose();
    }

    // we do the strobing in update(), not preRender(view)
    // as it's only once per frame, not once per view render call
    update(f) {
        super.update(f);
        const time = par.time;

        let strobeOn = false;

        // only need to check if both are non-zero
        if (this.strobeEvery && this.strobeLength) {
            strobeOn = time % this.strobeEvery < this.strobeLength;



            // if we've gone past the time to strobe then do it regardless of if it's in the flash window
            // this ensures we don't miss any very short flashes
            // (e.g. strobe every 1.01 seconds, but strobe length is 0.01 seconds)
            // since 0.01 is less than a frame, it would not always fall in the window
            if (this.lastStrobeTime !== undefined
                && (time - this.lastStrobeTime) > this.strobeEvery) {
                strobeOn = true;

            }


            if (strobeOn) {
                // reset time to last time we SHOULD have strobed
                // not the time we actually strobed
                // this maintains more consistent timing
                this.lastStrobeTime = time - time % this.strobeEvery
            }


            // Apply strobe to both billboard and light visibility
            if (this._object) {
                this._object.visible = this.lightVisible && strobeOn;
            }
            this.light.visible = this.lightVisible && this.lightIlluminates && strobeOn;

        }
        else {
            // No strobe controls - use normal visibility settings
            this.updateVisibility();
        }
    }

    preRender(view) {
        const camera = view.camera;

        // make the billboard face the camera
        if (this._object) {
            this._object.lookAt(camera.position);
        }



        // const distance = this._object.position.distanceTo(view.camera.position);
        //
        // // Scale the billboard up a bit based on distance
        // const fovScale =  (distance ** 1.5)  / 10000 ; // adjust as needed
        //
        //
        // console.log("Scaling billboard for light: " + this.light.name + " with distance: " + distance + " and scale: " + fovScale);
        //
        // this._object.scale.set(fovScale, fovScale, 1); // scale uniformly in X and Y


        const camPos = camera.position;

        // get the world position of the light, which will be a child of some other object like a jet or a ship
        const objPos = this.light.getWorldPosition(new Vector3());

        const distance = camPos.distanceTo(objPos);
        const fovRadians = camera.fov * (Math.PI / 180);


        // boostScale function to adjust the size so that there's a minimum angular size
        function boostScale(S0, W, D, F, boost = 0.01) {
            const base = (S0 * W) / (2 * D);
            const addedAngle = boost * F / 2;
            const newS = (2 * D / W) * Math.tan(Math.atan(base) + addedAngle);
            return newS;
        }

        let newSize = boostScale(0.5, 5, distance, fovRadians, 0.01);

        // how daylight is it? get the sky color from the scene
        const sunNode = NodeMan.get("theSun", true);
        if (sunNode !== undefined) {
            const skyOpacity = sunNode.calculateSkyOpacity(camera.position);
            newSize *= (1.0 - skyOpacity); // scale down the size based on the sky opacity
        }
        this._object.scale.setScalar(newSize);

        // AND - why is moveing camera with C not working right in:
        // - locked mode
        // - when frame > 0

    }

}