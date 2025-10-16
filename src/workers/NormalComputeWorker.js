/**
 * Web Worker for computing vertex normals without blocking the main thread
 * Receives geometry data, computes normals, and sends back the result
 */

// Message format:
// {
//   id: unique identifier for this task
//   positions: Float32Array of vertex positions
//   indices: Uint16Array or Uint32Array or null for non-indexed
//   indexed: boolean indicating if geometry is indexed
// }

self.onmessage = function(event) {
    const { id, positions, indices, indexed } = event.data;
    
    try {
        const vertexCount = positions.length / 3;
        const normals = new Float32Array(vertexCount * 3);
        
        // Reset all normals to zero
        for (let i = 0; i < normals.length; i++) {
            normals[i] = 0;
        }
        
        if (indexed && indices) {
            // Indexed geometry - average face normals at shared vertices
            computeIndexedNormalsFast(positions, normals, indices);
        } else {
            // Non-indexed geometry - each face has its own vertices
            computeNonIndexedNormalsFast(positions, normals);
        }
        
        // Normalize all vertex normals in place
        normalizeVertexNormalsFast(normals);
        
        // Send back the computed normals
        self.postMessage({
            id: id,
            normals: normals,
            success: true
        }, [normals.buffer]); // Transfer ownership of the buffer
        
    } catch (error) {
        // Send error back to main thread
        self.postMessage({
            id: id,
            error: error.message,
            success: false
        });
    }
};

/**
 * Fast computation for indexed geometry
 * @param {Float32Array} positions - Position array
 * @param {Float32Array} normals - Normal array to fill
 * @param {Uint16Array|Uint32Array} indices - Index array
 */
function computeIndexedNormalsFast(positions, normals, indices) {
    const faceCount = indices.length / 3;
    
    // Process faces in batches to improve cache locality
    for (let f = 0; f < faceCount; f++) {
        const f3 = f * 3;
        
        // Get vertex indices
        const a = indices[f3];
        const b = indices[f3 + 1];
        const c = indices[f3 + 2];
        
        // Calculate array offsets once
        const a3 = a * 3;
        const b3 = b * 3;
        const c3 = c * 3;
        
        // Get vertex positions (direct array access)
        const ax = positions[a3];
        const ay = positions[a3 + 1];
        const az = positions[a3 + 2];
        
        const bx = positions[b3];
        const by = positions[b3 + 1];
        const bz = positions[b3 + 2];
        
        const cx = positions[c3];
        const cy = positions[c3 + 1];
        const cz = positions[c3 + 2];
        
        // Calculate edge vectors
        // AB = B - A
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        
        // AC = C - A  
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        
        // Face normal = AB × AC (cross product)
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        
        // Add face normal to each vertex normal (direct array access)
        normals[a3] += nx;
        normals[a3 + 1] += ny;
        normals[a3 + 2] += nz;
        
        normals[b3] += nx;
        normals[b3 + 1] += ny;
        normals[b3 + 2] += nz;
        
        normals[c3] += nx;
        normals[c3 + 1] += ny;
        normals[c3 + 2] += nz;
    }
}

/**
 * Fast computation for non-indexed geometry
 * @param {Float32Array} positions - Position array
 * @param {Float32Array} normals - Normal array to fill
 */
function computeNonIndexedNormalsFast(positions, normals) {
    const vertexCount = positions.length / 3;
    const faceCount = vertexCount / 3;
    
    for (let f = 0; f < faceCount; f++) {
        const f9 = f * 9; // 3 vertices * 3 components
        
        // Get vertex positions (direct array access)
        const ax = positions[f9];
        const ay = positions[f9 + 1];
        const az = positions[f9 + 2];
        
        const bx = positions[f9 + 3];
        const by = positions[f9 + 4];
        const bz = positions[f9 + 5];
        
        const cx = positions[f9 + 6];
        const cy = positions[f9 + 7];
        const cz = positions[f9 + 8];
        
        // Calculate edge vectors
        // AB = B - A
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        
        // AC = C - A
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        
        // Face normal = AB × AC (cross product)
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        
        // Set the same normal for all three vertices of this face
        normals[f9] = nx;
        normals[f9 + 1] = ny;
        normals[f9 + 2] = nz;
        
        normals[f9 + 3] = nx;
        normals[f9 + 4] = ny;
        normals[f9 + 5] = nz;
        
        normals[f9 + 6] = nx;
        normals[f9 + 7] = ny;
        normals[f9 + 8] = nz;
    }
}

/**
 * Fast normalization of vertex normals in place
 * @param {Float32Array} normals - Normal array to normalize
 */
function normalizeVertexNormalsFast(normals) {
    const vertexCount = normals.length / 3;
    
    for (let i = 0; i < vertexCount; i++) {
        const i3 = i * 3;
        
        const x = normals[i3];
        const y = normals[i3 + 1];
        const z = normals[i3 + 2];
        
        const lengthSq = x * x + y * y + z * z;
        
        if (lengthSq > 0) {
            const invLength = 1 / Math.sqrt(lengthSq);
            normals[i3] = x * invLength;
            normals[i3 + 1] = y * invLength;
            normals[i3 + 2] = z * invLength;
        }
    }
}