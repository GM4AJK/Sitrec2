import {altitudeAboveSphere, getLocalUpVector} from "../SphericalMath";
import {Sit} from "../Globals";
import {CNodeTrack} from "./CNodeTrack";
import {assert} from "../assert.js";
import {V3} from "../threeUtils";
import {CNodeGUIValue} from "./CNodeGUIValue";

/**
 * Calculate air density based on altitude using the barometric formula
 * This is a simplified model that works reasonably well up to ~10km
 * @param {number} altitude - Altitude in meters above sea level
 * @returns {number} Air density in kg/m³
 */
function getAirDensity(altitude) {
    // Sea level standard atmospheric pressure (Pa)
    const P0 = 101325
    // Sea level standard temperature (K)
    const T0 = 288.15
    // Temperature lapse rate (K/m)
    const L = 0.0065
    // Universal gas constant for air (J/(kg·K))
    const R = 287.05
    // Gravitational acceleration (m/s²)
    const g = 9.80665
    
    // Calculate temperature at altitude
    const T = T0 - L * altitude
    
    // Calculate pressure at altitude using barometric formula
    const P = P0 * Math.pow(T / T0, g / (R * L))
    
    // Calculate density using ideal gas law: ρ = P / (R * T)
    const rho = P / (R * T)
    
    return rho
}

export class CNodeHomingMissileTrack extends CNodeTrack {
    constructor(v) {
        if (v.frames === undefined) {
            v.frames = Sit.frames;
            super(v);
            this.useSitFrames = true;
        } else {
            super(v);
        }

        // Create input nodes if they don't exist
        this.addInput("startFrame", new CNodeGUIValue({
            value: 0,
            start: 0,
            end: 900,
            step: 1,
            desc: "Start Frame",
            gui: "missile",
            tooltip: "Frame at which the missile launches"
        }))

        this.addInput("mass", new CNodeGUIValue({
            value: 10,
            start: 1,
            end: 100,
            step: 0.1,
            desc: "Mass (kg)",
            gui: "missile",
            tooltip: "Mass of the missile in kilograms"
        }))

        this.addInput("thrust", new CNodeGUIValue({
            value: 500,
            start: 0,
            end: 10000,
            step: 10,
            desc: "Thrust (N)",
            gui: "missile",
            tooltip: "Thrust force in Newtons"
        }))

        this.addInput("dragCoefficient", new CNodeGUIValue({
            value: 0.3,
            start: 0,
            end: 2,
            step: 0.01,
            desc: "Drag Coefficient (Cd)",
            gui: "missile",
            tooltip: "Aerodynamic drag coefficient (typical: 0.2-0.5 for missiles)"
        }))

        this.addInput("referenceArea", new CNodeGUIValue({
            value: 0.01,
            start: 0.001,
            end: 1,
            step: 0.001,
            desc: "Reference Area (m²)",
            gui: "missile",
            tooltip: "Cross-sectional area of the missile in square meters"
        }))

        this.addInput("burnTime", new CNodeGUIValue({
            value: 5,
            start: 0,
            end: 60,
            step: 0.1,
            desc: "Burn Time (s)",
            gui: "missile",
            tooltip: "Duration of thrust in seconds"
        }))

        this.requireInputs(["source", "target"])
        this.isNumber = false;
        this.recalculate()
    }

    recalculate() {
        this.array = []

        const startFrame = this.in.startFrame.v0;
        const mass = this.in.mass.v0 // kg
        const thrust = this.in.thrust.v0 // Newtons
        const dragCoefficient = this.in.dragCoefficient.v0 // Cd (dimensionless)
        const referenceArea = this.in.referenceArea.v0 // m²
        const burnTime = this.in.burnTime.v0 // seconds
        const burnFrames = Math.floor(burnTime * Sit.fps)
        const endBurnFrame = startFrame + burnFrames

        // Initialize position and velocity from source track
        let missilePos = this.in.source.p(0).clone()
        let missileVel = V3(0, 0, 0)

        // Get initial velocity from source track if it's moving
        if (this.in.source.frames > 1) {
            const sourcePos0 = this.in.source.p(0)
            const sourcePos1 = this.in.source.p(1)
            missileVel = sourcePos1.clone().sub(sourcePos0).multiplyScalar(Sit.fps)
        }

        const dt = 1.0 / Sit.fps // time step in seconds
        const gravity = 9.81 // m/s^2

        for (let f = 0; f < this.frames; f++) {
            // Store current position
            const trackPoint = {
                position: missilePos.clone(),
                velocity: missileVel.clone(),
            }
            this.array.push(trackPoint)

            // Before start frame, mirror the source track
            if (f < startFrame) {
                missilePos = this.in.source.p(f).clone()
                if (f < this.in.source.frames - 1) {
                    const sourcePos0 = this.in.source.p(f)
                    const sourcePos1 = this.in.source.p(f + 1)
                    missileVel = sourcePos1.clone().sub(sourcePos0).multiplyScalar(Sit.fps)
                }
                continue
            }

            // Get target position
            const targetFrame = Math.min(f, this.in.target.frames - 1)
            const targetPos = this.in.target.p(targetFrame)

            // Calculate direction to target for interception
            // Simple proportional navigation: aim towards where target will be
            let targetVel = V3(0, 0, 0)
            if (targetFrame < this.in.target.frames - 1) {
                const targetPos0 = this.in.target.p(targetFrame)
                const targetPos1 = this.in.target.p(targetFrame + 1)
                targetVel = targetPos1.clone().sub(targetPos0).multiplyScalar(Sit.fps)
            }

            // Estimate time to intercept
            const relativePos = targetPos.clone().sub(missilePos)
            const distance = relativePos.length()
            const missileSpeed = missileVel.length()
            const timeToIntercept = missileSpeed > 0 ? distance / missileSpeed : 1.0

            // Predict target position
            const predictedTargetPos = targetPos.clone().add(targetVel.clone().multiplyScalar(timeToIntercept))

            // Calculate desired direction
            const desiredDir = predictedTargetPos.clone().sub(missilePos)
            if (desiredDir.length() > 0) {
                desiredDir.normalize()
            }

            // Calculate forces
            const localUp = getLocalUpVector(missilePos)
            const gravityForce = localUp.clone().multiplyScalar(-gravity * mass)

            let totalForce = gravityForce.clone()

            // Add thrust if still burning
            if (f < endBurnFrame) {
                const thrustForce = desiredDir.clone().multiplyScalar(thrust)
                totalForce.add(thrustForce)
            }

            // Add air resistance using physically accurate drag equation
            // F_drag = 0.5 × ρ × C_d × A × v²
            const speed = missileVel.length()
            if (speed > 0) {
                // Get altitude above sea level
                const altitude = altitudeAboveSphere(missilePos) // meters above sea level
                
                // Get air density at current altitude
                const airDensity = getAirDensity(altitude) // kg/m³
                
                // Calculate drag force magnitude: F = 0.5 × ρ × C_d × A × v²
                const dragMagnitude = 0.5 * airDensity * dragCoefficient * referenceArea * speed * speed
                
                // Clamp drag force to prevent it from reversing velocity in one timestep
                // Maximum drag deceleration should not exceed current velocity / dt
                const maxDragForce = mass * speed / dt
                const clampedDragMagnitude = Math.min(dragMagnitude, maxDragForce)
                const dragForce = missileVel.clone().normalize().multiplyScalar(-clampedDragMagnitude)
                totalForce.add(dragForce)
            }

            // Calculate acceleration (F = ma)
            const acceleration = totalForce.divideScalar(mass)

            // Update velocity and position using Euler integration
            missileVel.add(acceleration.multiplyScalar(dt))
            missilePos.add(missileVel.clone().multiplyScalar(dt))
        }

        assert(this.frames == this.array.length, "frames length mismatch");
    }

    update(f) {
        super.update(f)
        if (f < this.startFrame) {
            this.hide();
        } else {
            this.show();
        }
    }

}