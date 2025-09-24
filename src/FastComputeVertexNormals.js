/**
 * Fast vertex normals computation - optimized version that avoids function call overhead
 * 
 * This is a high-performance replacement for geometry.computeVertexNormals() that:
 * - Works directly with typed arrays (no BufferAttribute getter/setter calls)
 * - Skips normalization checks (assumes non-normalized attributes)
 * - Uses minimal object allocations
 * - Optimized for both indexed and non-indexed geometries
 * 
 * Usage:
 *   import { fastComputeVertexNormals } from './FastComputeVertexNormals.js';
 *   fastComputeVertexNormals(geometry);
 */

import {BufferAttribute} from 'three';

/**
 * Fast computation of vertex normals for BufferGeometry
 * @param {BufferGeometry} geometry - The geometry to compute normals for
 */
export function fastComputeVertexNormals(geometry) {
    const index = geometry.index;
    const positionAttribute = geometry.getAttribute('position');
    
    if (!positionAttribute) {
        console.error('fastComputeVertexNormals: Missing position attribute.');
        return;
    }

    const positions = positionAttribute.array;
    const vertexCount = positionAttribute.count;
    
    // Create or get the normal attribute
    let normalAttribute = geometry.getAttribute('normal');
    if (!normalAttribute) {
        const normals = new Float32Array(vertexCount * 3);
        geometry.setAttribute('normal', new BufferAttribute(normals, 3));
        normalAttribute = geometry.getAttribute('normal');
    }
    
    const normals = normalAttribute.array;
    
    // Reset all normals to zero (faster than fill(0))
    for (let i = 0, len = normals.length; i < len; i++) {
        normals[i] = 0;
    }
    
    if (index) {
        // Indexed geometry - average face normals at shared vertices
        computeIndexedNormalsFast(positions, normals, index.array);
    } else {
        // Non-indexed geometry - each face has its own vertices
        computeNonIndexedNormalsFast(positions, normals);
    }
    
    // Normalize all vertex normals in place
    normalizeVertexNormalsFast(normals);
    
    normalAttribute.needsUpdate = true;
}

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

/**
 * Replace the computeVertexNormals method on a specific geometry instance
 * @param {BufferGeometry} geometry - The geometry to patch
 */
export function patchGeometryComputeVertexNormals(geometry) {
    geometry.computeVertexNormals = function() {
        fastComputeVertexNormals(this);
    };
}

/**
 * Globally replace BufferGeometry.prototype.computeVertexNormals with the fast version
 * Call this once at the start of your application to speed up all geometries
 */
export function patchAllGeometriesComputeVertexNormals() {
    // Import BufferGeometry dynamically to avoid circular dependencies
    import('three').then(({ BufferGeometry }) => {
        BufferGeometry.prototype.computeVertexNormals = function() {
            fastComputeVertexNormals(this);
        };
    });
}