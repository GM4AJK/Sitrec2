/**
 * Asynchronous vertex normals computation using web workers
 * 
 * This module provides async versions of normal computation that offload
 * the calculation to a web worker, preventing main thread blocking.
 * 
 * Usage:
 *   import { fastComputeVertexNormalsAsync } from './FastComputeVertexNormalsAsync.js';
 *   await fastComputeVertexNormalsAsync(geometry);
 */

import {BufferAttribute} from 'three';

// Global worker pool for normal computation
let normalWorker = null;
let workerTaskId = 0;
const pendingTasks = new Map();

/**
 * Initialize the web worker for normal computation
 * Called automatically on first use
 */
function initializeWorker() {
    if (normalWorker) return;
    
    // Create worker from inline code or file
    const workerCode = `
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
                    computeIndexedNormalsFast(positions, normals, indices);
                } else {
                    computeNonIndexedNormalsFast(positions, normals);
                }
                
                normalizeVertexNormalsFast(normals);
                
                // Transfer only the normals buffer back to avoid detaching issues
                self.postMessage({
                    id: id,
                    normals: normals,
                    success: true
                }, [normals.buffer]);
                
            } catch (error) {
                self.postMessage({
                    id: id,
                    error: error.message,
                    success: false
                });
            }
        };
        
        function computeIndexedNormalsFast(positions, normals, indices) {
            const faceCount = indices.length / 3;
            
            for (let f = 0; f < faceCount; f++) {
                const f3 = f * 3;
                const a = indices[f3];
                const b = indices[f3 + 1];
                const c = indices[f3 + 2];
                
                const a3 = a * 3;
                const b3 = b * 3;
                const c3 = c * 3;
                
                const ax = positions[a3];
                const ay = positions[a3 + 1];
                const az = positions[a3 + 2];
                
                const bx = positions[b3];
                const by = positions[b3 + 1];
                const bz = positions[b3 + 2];
                
                const cx = positions[c3];
                const cy = positions[c3 + 1];
                const cz = positions[c3 + 2];
                
                const abx = bx - ax;
                const aby = by - ay;
                const abz = bz - az;
                
                const acx = cx - ax;
                const acy = cy - ay;
                const acz = cz - az;
                
                const nx = aby * acz - abz * acy;
                const ny = abz * acx - abx * acz;
                const nz = abx * acy - aby * acx;
                
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
        
        function computeNonIndexedNormalsFast(positions, normals) {
            const vertexCount = positions.length / 3;
            const faceCount = vertexCount / 3;
            
            for (let f = 0; f < faceCount; f++) {
                const f9 = f * 9;
                
                const ax = positions[f9];
                const ay = positions[f9 + 1];
                const az = positions[f9 + 2];
                
                const bx = positions[f9 + 3];
                const by = positions[f9 + 4];
                const bz = positions[f9 + 5];
                
                const cx = positions[f9 + 6];
                const cy = positions[f9 + 7];
                const cz = positions[f9 + 8];
                
                const abx = bx - ax;
                const aby = by - ay;
                const abz = bz - az;
                
                const acx = cx - ax;
                const acy = cy - ay;
                const acz = cz - az;
                
                const nx = aby * acz - abz * acy;
                const ny = abz * acx - abx * acz;
                const nz = abx * acy - aby * acx;
                
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
    `;
    
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    normalWorker = new Worker(workerUrl);
    
    normalWorker.onmessage = (event) => {
        const { id, normals, success, error } = event.data;
        const task = pendingTasks.get(id);
        
        if (task) {
            pendingTasks.delete(id);
            
            if (success) {
                task.resolve(normals);
            } else {
                task.reject(new Error(`Worker error: ${error}`));
            }
        }
    };
    
    normalWorker.onerror = (error) => {
        console.error('Normal computation worker error:', error);
    };
}

/**
 * Asynchronously compute vertex normals using a web worker
 * @param {BufferGeometry} geometry - The geometry to compute normals for
 * @returns {Promise<void>} - Resolves when normals are computed and applied
 */
export async function fastComputeVertexNormalsAsync(geometry) {
    initializeWorker();
    
    const index = geometry.index;
    const positionAttribute = geometry.getAttribute('position');
    
    if (!positionAttribute) {
        console.error('fastComputeVertexNormalsAsync: Missing position attribute.');
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
    
    const taskId = workerTaskId++;
    
    return new Promise((resolve, reject) => {
        try {
            pendingTasks.set(taskId, { resolve, reject });
            
            // Always create copies to avoid detaching the original buffers
            // This prevents "already detached" errors when geometry is reused
            const positionsToSend = new Float32Array(positions);
            
            let indicesToSend = null;
            let isIndexed = false;
            
            if (index) {
                isIndexed = true;
                const indexArray = index.array;
                if (indexArray instanceof Uint32Array) {
                    indicesToSend = new Uint32Array(indexArray);
                } else if (indexArray instanceof Uint16Array) {
                    indicesToSend = new Uint16Array(indexArray);
                } else {
                    indicesToSend = new Uint32Array(indexArray);
                }
            }
            
            // Only transfer the positions buffer back from worker, not the input
            // This allows the geometry's original buffers to remain usable
            const transferables = [];
            const message = {
                id: taskId,
                positions: positionsToSend,
                indices: indicesToSend,
                indexed: isIndexed
            };
            
            // Send message without transferring - we're just copying data
            normalWorker.postMessage(message);
        } catch (error) {
            pendingTasks.delete(taskId);
            reject(error);
        }
    }).then(normals => {
        // Apply the computed normals to the geometry
        const normalAttribute = geometry.getAttribute('normal');
        const normalArray = normalAttribute.array;
        
        // Copy the computed normals back
        for (let i = 0; i < normals.length; i++) {
            normalArray[i] = normals[i];
        }
        
        normalAttribute.needsUpdate = true;
    });
}

/**
 * Terminate the worker when done (optional, useful for cleanup)
 */
export function terminateNormalWorker() {
    if (normalWorker) {
        normalWorker.terminate();
        normalWorker = null;
        pendingTasks.clear();
        workerTaskId = 0;
    }
}