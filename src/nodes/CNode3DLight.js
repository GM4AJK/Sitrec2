import {CNode3D} from "./CNode3D";
import {assert} from "../assert";
import {AdditiveBlending, Mesh, PlaneGeometry, ShaderMaterial, Vector3} from 'three';
import {sharedUniforms} from "../js/map33/material/SharedUniforms";
import {NodeMan} from "../Globals";

export class CNode3DLight extends CNode3D {
    constructor(v) {
        super(v);
        this.type = 'CNode3DLight';

        this.light = v.light; // the light objectm required for this node
        assert(this.light, "CNode3DLight requires a light object");

        console.log("CNode3DLight created for light: " + this.light.name);

        const size = v.size || 4; // default size if not specified

// Create plane geometry
        const geometry = new PlaneGeometry(size, size); // adjust size as needed

// Shader material with HDR-style disk + falloff
        const material = new ShaderMaterial({
            uniforms: {
                ...sharedUniforms, // shared uniforms for near/far planes
                uColor: { value: [this.light.color.r, this.light.color.g, this.light.color.b] },
                uIntensity: { value: this.light.intensity }, // HDR "strength"
                uRadius: { value: 0.3 },     // core radius (hard center)

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

// Create mesh
        const billboard = new Mesh(geometry, material);
        billboard.name = "LightBillboard";
        billboard.position.copy(this.light.position);

// Add to scene
        v.scene.add(billboard);

// Save reference
        this._object = billboard;

        this.scene = v.scene; // save the scene for later use




    }

    dispose() {
        if (this._object) {
            this.scene.remove(this._object);
            this._object.geometry.dispose();
            this._object.material.dispose();
            this._object = null;
        }
        super.dispose();
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


    update() {
    }
}