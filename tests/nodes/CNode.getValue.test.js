import {CNode, CNodeConstant} from '../../src/nodes/CNode.js';
import {setNodeMan} from '../../src/Globals.js';
import {CNodeManager} from "../../src/nodes/CNodeManager";
import {V3} from '../../src/threeUtils';

// Mock node class that extends CNode to test getValue functionality
class TestNode extends CNode {
    constructor(v) {
        super(v);
        this.values = v.values || [];
        
        // Detect the data type for proper isNumber flag
        if (this.values.length > 0) {
            const firstValue = this.values[0];
            if (typeof firstValue === 'number') {
                // All values should be numbers
                this.isNumber = this.values.every(val => typeof val === 'number');
            } else if (firstValue && firstValue.x !== undefined) {
                // This is a Vector3-like object (has x property)
                // Vector3 objects are handled as direct vectors, not as objects with position
                this.isNumber = false;
            } else if (firstValue && firstValue.position !== undefined) {
                // This is an object with a position property
                this.isNumber = false;
            } else {
                // Default to false for other object types
                this.isNumber = false;
            }
        }
        
        // Override isNumber if explicitly set in constructor
        if (v.isNumber !== undefined) {
            this.isNumber = v.isNumber;
        }
    }

    getValueFrame(frame) {
        if (this.values.length === 0) return undefined;
        if (frame >= this.values.length) {
            return this.values[this.values.length - 1];
        }
        if (frame < 0) {
            return this.values[0];
        }
        return this.values[frame];
    }
}

describe('CNode.getValue Method Tests', () => {
    beforeEach(() => {
        // Clear NodeMan and set up a fresh instance
        setNodeMan(new CNodeManager());
    });

    describe('Single frame constant node', () => {
        test('should return constant value for any frame when frames = 0', () => {
            const constantNode = new CNodeConstant({ 
                id: 'constant', 
                value: 42,
                frames: 0 
            });
            
            expect(constantNode.getValue(0)).toBe(42);
            expect(constantNode.getValue(5)).toBe(42);
            expect(constantNode.getValue(-1)).toBe(42);
        });

        test('should return constant value for any frame when frames = 1', () => {
            const constantNode = new CNodeConstant({ 
                id: 'constant', 
                value: 100,
                frames: 1 
            });
            
            expect(constantNode.getValue(0)).toBe(100);
            expect(constantNode.getValue(2)).toBe(100);
        });
    });

    describe('Integer frame lookup', () => {
        test('should return exact frame value for integer frame numbers', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [10, 20, 30, 40],
                frames: 4
            });
            
            expect(testNode.getValue(0)).toBe(10);
            expect(testNode.getValue(1)).toBe(20);
            expect(testNode.getValue(2)).toBe(30);
            expect(testNode.getValue(3)).toBe(40);
        });
    });

    describe('Number interpolation between frames', () => {
        test('should interpolate between numeric values correctly', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [0, 10, 20],
                frames: 3
            });
            
            // Test interpolation between frames 0 and 1
            expect(testNode.getValue(0.5)).toBe(5);
            expect(testNode.getValue(0.25)).toBe(2.5);
            expect(testNode.getValue(0.75)).toBe(7.5);
            
            // Test interpolation between frames 1 and 2
            expect(testNode.getValue(1.5)).toBe(15);
            expect(testNode.getValue(1.25)).toBe(12.5);
        });
    });

    describe('Vector interpolation between frames', () => {
        test('should interpolate between 3D vectors correctly', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0) },
                    { position: V3(10, 20, 30) }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(0.5);
            expect(result.position.x).toBeCloseTo(5);
            expect(result.position.y).toBeCloseTo(10);
            expect(result.position.z).toBeCloseTo(15);
        });

        test('should handle vector interpolation at quarter points', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0) },
                    { position: V3(8, 12, 16) }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(0.25);
            expect(result.position.x).toBeCloseTo(2);
            expect(result.position.y).toBeCloseTo(3);
            expect(result.position.z).toBeCloseTo(4);
        });
    });

    describe('Object with position interpolation', () => {
        test('should interpolate objects with position property', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0), color: 'red' },
                    { position: V3(10, 20, 30), color: 'blue' }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(0.5);
            expect(result.position.x).toBeCloseTo(5);
            expect(result.position.y).toBeCloseTo(10);
            expect(result.position.z).toBeCloseTo(15);
            expect(result.color).toBe('red'); // Should copy other properties from first frame
        });

        test('should interpolate heading when present', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0), heading: 0 },
                    { position: V3(10, 0, 0), heading: Math.PI / 2 }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(0.5);
            expect(result.position.x).toBeCloseTo(5);
            expect(result.heading).toBeCloseTo(Math.PI / 4);
        });
    });

    describe('Negative frame extrapolation', () => {
        test('should extrapolate backwards for numeric values', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [10, 20],
                frames: 2
            });
            
            // Extrapolating backwards: frameFloat * (value1 - value0) + value0
            // -0.5 * (20 - 10) + 10 = -5 + 10 = 5
            expect(testNode.getValue(-0.5)).toBe(5);
            // -1 * (20 - 10) + 10 = -10 + 10 = 0
            expect(testNode.getValue(-1)).toBe(0);
        });

        test('should extrapolate backwards for vector values', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0) },
                    { position: V3(10, 20, 30) }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(-0.5);
            expect(result.position.x).toBeCloseTo(-5);
            expect(result.position.y).toBeCloseTo(-10);
            expect(result.position.z).toBeCloseTo(-15);
        });

        test('should extrapolate backwards for objects with position', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(10, 20, 30) },
                    { position: V3(20, 40, 60) }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(-0.5);
            expect(result.position.x).toBeCloseTo(5);
            expect(result.position.y).toBeCloseTo(10);
            expect(result.position.z).toBeCloseTo(15);
        });
    });

    describe('Forward frame extrapolation', () => {
        test('should extrapolate forwards for numeric values', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [10, 20, 30],
                frames: 3
            });
            
            // Extrapolating forwards: value1 + (frameFloat - (numFrames - 1)) * (value1 - value0)
            // Frame 3.5: 30 + (3.5 - 2) * (30 - 20) = 30 + 1.5 * 10 = 45
            expect(testNode.getValue(3.5)).toBe(45);
            // Frame 4: 30 + (4 - 2) * (30 - 20) = 30 + 2 * 10 = 50
            expect(testNode.getValue(4)).toBe(50);
        });

        test('should extrapolate forwards for vector values', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0) },
                    { position: V3(10, 20, 30) }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(2.5);
            expect(result.position.x).toBeCloseTo(25);
            expect(result.position.y).toBeCloseTo(50);
            expect(result.position.z).toBeCloseTo(75);
        });

        test('should extrapolate forwards for objects with position', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0) },
                    { position: V3(10, 20, 30) }
                ],
                frames: 2
            });
            
            const result = testNode.getValue(2.5);
            expect(result.position.x).toBeCloseTo(25);
            expect(result.position.y).toBeCloseTo(50);
            expect(result.position.z).toBeCloseTo(75);
        });
    });

    describe('Heading interpolation handling', () => {
        test('should handle heading wrap-around from positive to negative angles', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0), heading: Math.PI * 0.9 },
                    { position: V3(10, 0, 0), heading: -Math.PI * 0.9 }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(0.5);
            // Should interpolate through the shorter path (crossing ±π boundary)
            expect(Math.abs(result.heading)).toBeCloseTo(Math.PI, 1);
        });

        test('should handle numeric heading interpolation', () => {
            const testNode = new TestNode({
                id: 'test',
                values: [
                    { position: V3(0, 0, 0), heading: 0 },
                    { position: V3(10, 0, 0), heading: Math.PI }
                ],
                frames: 2,
                isNumber: false
            });
            
            const result = testNode.getValue(0.5);
            expect(result.heading).toBeCloseTo(Math.PI / 2);
        });
    });
});