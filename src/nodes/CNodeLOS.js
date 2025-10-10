// Base class for the vasrious sources of LOS information.
// LOS = Lines of Sight, which is a track with heading vectors
// getValueFrame(f) will return
// {position: position, // EUS location in meters,
// heading: fwd,        // unit vector pointing along the LOS
// up: up,              // (optional) up unit vector for LOS, e.g. camera orientation
// right:               // (option) right unit vector
// }


import {CNodeTrack} from "./CNodeTrack";
import {GlobalDateTimeNode, NodeMan, Sit} from "../Globals";
import {saveAs} from "../js/FileSaver";
import {Matrix3, Vector3} from "three";
import {ECEF2ENU, ECEFToEUS, ENU2ECEF, EUSToECEF, EUSToLLA, wgs84} from "../LLA-ECEF-ENU";

export class CNodeLOS extends CNodeTrack {
    constructor(v) {
        super(v);

        NodeMan.addExportButton(this, "exportLOSCSV", "CSV ")

    }

    exportLOSCSV() {
        // Get the first point to establish the ENU origin
        const firstData = this.getValueFrame(0);
        if (!firstData || !firstData.position) {
            console.error("No position data available for export");
            return;
        }

        // Get the LLA of the first position to establish the new ENU origin
        const firstPosEUS = firstData.position;
        const firstLLA = EUSToLLA(firstPosEUS);
        
        // The new ENU origin is on the ground (altitude = 0) below the first point
        const originLat = firstLLA.x * Math.PI / 180;  // Convert to radians
        const originLon = firstLLA.y * Math.PI / 180;  // Convert to radians

        // Pre-compute transformation matrices for direction vectors
        // We need to transform from EUS (at Sit.lat, Sit.lon) to ENU (at origin)
        
        // Step 1: EUS to ENU at Sit location (just axis swap)
        // EUS: x=east, y=up, z=south
        // ENU: x=east, y=north, z=up
        // So: ENU = (EUS.x, -EUS.z, EUS.y)
        
        // Step 2: Rotate from Sit ENU frame to origin ENU frame
        const sitLat = Sit.lat * Math.PI / 180;
        const sitLon = Sit.lon * Math.PI / 180;
        
        // Matrix to transform from ECEF to ENU at Sit location
        const mECEF2ENU_Sit = new Matrix3().set(
            -Math.sin(sitLon), Math.cos(sitLon), 0,
            -Math.sin(sitLat) * Math.cos(sitLon), -Math.sin(sitLat) * Math.sin(sitLon), Math.cos(sitLat),
            Math.cos(sitLat) * Math.cos(sitLon), Math.cos(sitLat) * Math.sin(sitLon), Math.sin(sitLat)
        );
        
        // Matrix to transform from ENU at Sit to ECEF
        const mENU2ECEF_Sit = new Matrix3().copy(mECEF2ENU_Sit).invert();
        
        // Matrix to transform from ECEF to ENU at origin location
        const mECEF2ENU_Origin = new Matrix3().set(
            -Math.sin(originLon), Math.cos(originLon), 0,
            -Math.sin(originLat) * Math.cos(originLon), -Math.sin(originLat) * Math.sin(originLon), Math.cos(originLat),
            Math.cos(originLat) * Math.cos(originLon), Math.cos(originLat) * Math.sin(originLon), Math.sin(originLat)
        );
        
        // Combined transformation for direction vectors: EUS@Sit -> ENU@Sit -> ECEF -> ENU@Origin
        const mEUS2ENU = new Matrix3();
        mEUS2ENU.multiplyMatrices(mECEF2ENU_Origin, mENU2ECEF_Sit);

        // Build CSV
        let csv = "Time, SensorPositionX, SensorPositionY, SensorPositionZ, LOSUnitVectorX, LOSUnitVectorY, LOSUnitVectorZ, maxRange, LOSUncertaintyVertical, LOSUncertaintyHorizontal\n";
        
        for (let f = 0; f < this.frames; f++) {
            const data = this.getValueFrame(f);
            if (!data || !data.position || !data.heading) {
                continue;
            }

            // Convert position from EUS to ECEF, then to ENU with new origin
            const posEUS = data.position;
            const posECEF = EUSToECEF(posEUS);
            const posENU = ECEF2ENU(posECEF, originLat, originLon, wgs84.RADIUS, false);

            // Convert heading vector from EUS to ENU
            // First convert EUS to ENU at Sit location (axis swap)
            const headingEUS = data.heading;
            const headingENU_Sit = new Vector3(headingEUS.x, -headingEUS.z, headingEUS.y);
            
            // Then rotate to ENU at origin location
            const headingENU = headingENU_Sit.clone().applyMatrix3(mEUS2ENU);
            
            // Normalize to ensure it's a unit vector
            headingENU.normalize();

            // Calculate time for this frame in milliseconds since epoch
            const startMS = GlobalDateTimeNode.dateStart.valueOf();
            const timestamp = Math.round(startMS + f * 1000 * (Sit.simSpeed ?? 1) / Sit.fps);
            
            // Calculate maxRange based on ground plane collision
            // Ground plane is at z=0 in ENU coordinates
            // Ray equation: P = posENU + t * headingENU
            // For ground intersection: posENU.z + t * headingENU.z = 0
            // Solve for t: t = -posENU.z / headingENU.z
            let maxRange;
            if (headingENU.z < 0 && posENU.z > 0) {
                // Ray is pointing downward and position is above ground
                const t = -posENU.z / headingENU.z;
                maxRange = t; // Distance to ground intersection
            } else {
                // Ray doesn't intersect ground (pointing up or parallel, or already below ground)
                maxRange = -1; // Indicates infinity
            }
            
            const uncertaintyVertical = 0.1; // placeholder
            const uncertaintyHorizontal = 0.1; // placeholder
            
            csv += `${timestamp},${posENU.x},${posENU.y},${posENU.z},${headingENU.x},${headingENU.y},${headingENU.z},${maxRange},${uncertaintyVertical},${uncertaintyHorizontal}\n`;
        }

        // Save the file
        saveAs(new Blob([csv]), `LOS-${this.id}.csv`);
        
        // Test the reverse transformation
        this.testReverseExport(csv, originLat, originLon);
    }

    testReverseExport(csv, originLat, originLon) {
        console.log("=== Testing Reverse Export Transformation ===");
        
        // Parse CSV
        const lines = csv.split('\n');
        const dataLines = lines.slice(1).filter(line => line.trim().length > 0);
        
        // Pre-compute transformation matrices for direction vectors (reverse direction)
        const sitLat = Sit.lat * Math.PI / 180;
        const sitLon = Sit.lon * Math.PI / 180;
        
        // Matrix to transform from ENU at origin to ECEF
        const mENU2ECEF_Origin = new Matrix3().set(
            -Math.sin(originLon), Math.cos(originLon), 0,
            -Math.sin(originLat) * Math.cos(originLon), -Math.sin(originLat) * Math.sin(originLon), Math.cos(originLat),
            Math.cos(originLat) * Math.cos(originLon), Math.cos(originLat) * Math.sin(originLon), Math.sin(originLat)
        ).invert();
        
        // Matrix to transform from ECEF to ENU at Sit location
        const mECEF2ENU_Sit = new Matrix3().set(
            -Math.sin(sitLon), Math.cos(sitLon), 0,
            -Math.sin(sitLat) * Math.cos(sitLon), -Math.sin(sitLat) * Math.sin(sitLon), Math.cos(sitLat),
            Math.cos(sitLat) * Math.cos(sitLon), Math.cos(sitLat) * Math.sin(sitLon), Math.sin(sitLat)
        );
        
        // Combined transformation for direction vectors: ENU@Origin -> ECEF -> ENU@Sit
        const mENU2ENU_Sit = new Matrix3();
        mENU2ENU_Sit.multiplyMatrices(mECEF2ENU_Sit, mENU2ECEF_Origin);
        
        let maxPosError = 0;
        let maxHeadingError = 0;
        let totalPosError = 0;
        let totalHeadingError = 0;
        let count = 0;
        
        for (let i = 0; i < dataLines.length; i++) {
            const parts = dataLines[i].split(',').map(parseFloat);
            if (parts.length !== 10) continue;
            
            const [timestamp, x, y, z, dx, dy, dz, maxRange, uncertaintyV, uncertaintyH] = parts;
            
            // Get original data
            const originalData = this.getValueFrame(i);
            if (!originalData || !originalData.position || !originalData.heading) {
                continue;
            }
            
            // Convert position from ENU back to EUS
            const posENU = new Vector3(x, y, z);
            const posECEF = ENU2ECEF(posENU, originLat, originLon, wgs84.RADIUS, false);
            const posEUS = ECEFToEUS(posECEF);
            
            // Convert heading vector from ENU back to EUS
            // First rotate from ENU@Origin to ENU@Sit
            const headingENU = new Vector3(dx, dy, dz);
            const headingENU_Sit = headingENU.clone().applyMatrix3(mENU2ENU_Sit);
            
            // Then convert from ENU@Sit to EUS (reverse axis swap)
            // ENU@Sit = (EUS.x, -EUS.z, EUS.y)
            // So: EUS.x = ENU.x, EUS.y = ENU.z, EUS.z = -ENU.y
            const headingEUS = new Vector3(headingENU_Sit.x, headingENU_Sit.z, -headingENU_Sit.y);
            headingEUS.normalize();
            
            // Compare with original
            const posError = posEUS.distanceTo(originalData.position);
            const headingError = Math.acos(Math.min(1, Math.max(-1, headingEUS.dot(originalData.heading)))) * 180 / Math.PI;
            
            maxPosError = Math.max(maxPosError, posError);
            maxHeadingError = Math.max(maxHeadingError, headingError);
            totalPosError += posError;
            totalHeadingError += headingError;
            count++;
            
            // Log first few and any large errors
            if (i < 3 || posError > 0.01 || headingError > 0.1) {
                console.log(`Frame ${i}:`);
                console.log(`  Position error: ${posError.toFixed(6)} meters`);
                console.log(`  Heading error: ${headingError.toFixed(6)} degrees`);
                console.log(`  Original pos: (${originalData.position.x.toFixed(3)}, ${originalData.position.y.toFixed(3)}, ${originalData.position.z.toFixed(3)})`);
                console.log(`  Recovered pos: (${posEUS.x.toFixed(3)}, ${posEUS.y.toFixed(3)}, ${posEUS.z.toFixed(3)})`);
                console.log(`  Original heading: (${originalData.heading.x.toFixed(6)}, ${originalData.heading.y.toFixed(6)}, ${originalData.heading.z.toFixed(6)})`);
                console.log(`  Recovered heading: (${headingEUS.x.toFixed(6)}, ${headingEUS.y.toFixed(6)}, ${headingEUS.z.toFixed(6)})`);
            }
        }
        
        console.log(`\n=== Summary (${count} frames tested) ===`);
        console.log(`Position errors:`);
        console.log(`  Max: ${maxPosError.toFixed(6)} meters`);
        console.log(`  Average: ${(totalPosError / count).toFixed(6)} meters`);
        console.log(`Heading errors:`);
        console.log(`  Max: ${maxHeadingError.toFixed(6)} degrees`);
        console.log(`  Average: ${(totalHeadingError / count).toFixed(6)} degrees`);
        
        if (maxPosError < 0.001 && maxHeadingError < 0.01) {
            console.log("✓ Transformation test PASSED - errors within acceptable tolerance");
        } else {
            console.warn("⚠ Transformation test shows significant errors");
        }
    }

}