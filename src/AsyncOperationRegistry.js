/**
 * AsyncOperationRegistry
 * 
 * Singleton that tracks all in-flight async operations (fetches, workers, tile loads, etc.)
 * Provides centralized cancellation to prevent race conditions during situation transitions.
 * 
 * Key features:
 * - Tracks AbortControllers and promises
 * - Auto-cleanup when operations complete
 * - Centralized cancelAll() for situation transitions
 * - Minimal overhead with lazy initialization
 */

class AsyncOperationRegistry {
    constructor() {
        this.operations = new Map(); // id -> {type, controller, created, description}
        this.operationCounter = 0;
        this.enabled = true;
    }

    /**
     * Register an AbortController-based operation
     * @param {AbortController} controller - The controller to track
     * @param {string} type - Category (e.g., 'fetch', 'tile-texture', 'tile-elevation', 'worker')
     * @param {string} description - Human-readable description for debugging
     * @returns {number} Operation ID (for manual unregister if needed)
     */
    registerAbortable(controller, type, description = '') {
        if (!this.enabled || !controller) return null;

        const id = ++this.operationCounter;
        this.operations.set(id, {
            type,
            controller,
            created: Date.now(),
            description,
            cancelled: false
        });

        // console.log(`[AsyncOps] Registered: ${type} - ${description} (id: ${id}, total: ${this.operations.size})`);
        return id;
    }

    /**
     * Register a promise-based operation
     * Auto-unregisters when promise resolves/rejects
     * @param {Promise} promise - The promise to track
     * @param {string} type - Category
     * @param {string} description - Human-readable description
     * @returns {number} Operation ID
     */
    registerPromise(promise, type, description = '') {
        if (!this.enabled || !promise) return null;

        const id = ++this.operationCounter;
        this.operations.set(id, {
            type,
            controller: null,
            promise,
            created: Date.now(),
            description,
            cancelled: false
        });

        // console.log(`[AsyncOps] Registered Promise: ${type} - ${description} (id: ${id}, total: ${this.operations.size})`);

        // Auto-cleanup on completion
        Promise.resolve(promise)
            .then(() => this.unregister(id))
            .catch(() => this.unregister(id)); // Ignore errors, just cleanup

        return id;
    }

    /**
     * Manually unregister an operation
     * @param {number} id - Operation ID from register()
     */
    unregister(id) {
        if (this.operations.has(id)) {
            const op = this.operations.get(id);
            this.operations.delete(id);
            // console.log(`[AsyncOps] Unregistered: ${op.type} - ${op.description} (remaining: ${this.operations.size})`);
        }
    }

    /**
     * Cancel all registered operations
     * Used during situation transitions to abort in-flight work
     * @returns {Object} Summary of cancelled operations
     */
    cancelAll() {
        if (!this.enabled) return { count: 0 };

        const summary = {};
        let count = 0;

        this.operations.forEach((op, id) => {
            if (op.controller && !op.cancelled) {
                try {
                    op.controller.abort();
                    op.cancelled = true;
                    count++;
                    summary[op.type] = (summary[op.type] || 0) + 1;
                    console.log(`[AsyncOps] Cancelled: ${op.type} - ${op.description} (id: ${id})`);
                } catch (err) {
                    console.warn(`[AsyncOps] Error cancelling operation ${id}:`, err);
                }
            }
        });

        // Clear all operations after cancelling
        this.operations.clear();
        
        if (count > 0) {
            console.log(`[AsyncOps] Cancelled ${count} operations:`, summary);
        } else {
            console.log(`[AsyncOps] No operations to cancel`);
        }

        return { count, summary };
    }

    /**
     * Get current operation count
     */
    getCount() {
        return this.operations.size;
    }

    /**
     * Get summary of all tracked operations
     */
    getSummary() {
        const summary = {
            total: this.operations.size,
            byType: {}
        };

        this.operations.forEach(op => {
            summary.byType[op.type] = (summary.byType[op.type] || 0) + 1;
        });

        return summary;
    }

    /**
     * Get a formatted multi-line string of all pending operations
     * Useful for debugging what's stuck
     * @returns {string} Multi-line string of pending operations, or empty if none
     */
    getPendingOperationsString() {
        if (this.operations.size === 0) return '';
        
        const lines = [];
        const now = Date.now();
        
        this.operations.forEach((op, id) => {
            const ageMs = now - op.created;
            const ageSec = (ageMs / 1000).toFixed(1);
            lines.push(`  [${id}] ${op.type.padEnd(20)} - ${op.description} (${ageSec}s)`);
        });
        
        return `${this.operations.size} pending async ops:\n${lines.join('\n')}`;
    }

    /**
     * Clear all tracking without cancelling
     * (used when operations are already disposed externally)
     */
    clear() {
        const count = this.operations.size;
        this.operations.clear();
        if (count > 0) {
            console.log(`[AsyncOps] Cleared ${count} operations from tracking`);
        }
    }

    /**
     * Enable/disable the registry (for testing or debugging)
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Get detailed list of all tracked operations (for debugging)
     */
    getOperations() {
        const ops = [];
        this.operations.forEach((op, id) => {
            ops.push({
                id,
                type: op.type,
                description: op.description,
                age: Date.now() - op.created,
                cancelled: op.cancelled
            });
        });
        return ops;
    }
}

// Singleton instance
export const asyncOperationRegistry = new AsyncOperationRegistry();