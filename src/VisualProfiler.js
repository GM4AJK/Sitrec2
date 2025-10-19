/**
 * Visual Profiler - displays a real-time performance visualization on screen
 * Shows timing of code segments with a flame-graph-like visualization
 */
export class VisualProfiler {
    constructor() {
        this.enabled = true; // Enabled by default
        this.canvas = null;
        this.ctx = null;
        
        // Profiling state
        this.level = 0;
        this.baseTime = null;
        this.totalTime = 1 / 60; // 1/30th of a second in seconds (33.33ms)
        
        // Stack of timing segments
        this.stack = [];
        
        // Store current segments for drawing
        this.segments = [];
        
        // Visual settings
        this.lineHeight = 16; // pixels
        this.distanceFromBottom = 100; // pixels
        
        // Canvas dimensions
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        
        // Background and text settings
        this.backgroundColor = '#1a1a1a';
        this.textColor = '#000';
        this.timelineColor = '#444';
    }
    
    /**
     * Initialize the profiler - creates canvas and sets up event listeners
     */
    init() {
        if (this.canvas) {
            return; // Already initialized
        }
        
        // Create canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'fixed';
        this.canvas.style.bottom = this.distanceFromBottom + 'px';
        this.canvas.style.left = '0px';
        this.canvas.style.zIndex = '10000';
        this.canvas.style.background = this.backgroundColor;
        this.canvas.style.cursor = 'pointer';
        
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        
        // Handle window resize
        this.handleResize();
        window.addEventListener('resize', () => this.handleResize());
        
        // Click to toggle
        this.canvas.addEventListener('click', () => this.toggle());
        
        console.log('Visual Profiler initialized');
    }
    
    /**
     * Handle window resize - update canvas size
     */
    handleResize() {
        this.canvasWidth = window.innerWidth;
        this.canvasHeight = this.lineHeight * 10; // Show up to 10 levels
        
        if (this.canvas) {
            this.canvas.width = this.canvasWidth;
            this.canvas.height = this.canvasHeight;
        }
    }
    
    /**
     * Enable or disable the profiler
     */
    toggle() {
        this.enabled = !this.enabled;
        console.log(`Visual Profiler ${this.enabled ? 'enabled' : 'disabled'}`);
        if (!this.enabled && this.canvas) {
            this.clearCanvas();
        }
    }
    
    /**
     * Set enabled state
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    
    /**
     * Push a profiling segment onto the stack
     * @param {string} color - Color for this segment (e.g., '#ff0000', 'rgb(255,0,0)')
     * @param {string} name - Name/label for this segment
     */
    push(color, name) {
        if (!this.enabled) {
            return;
        }
        
        // If this is the top level, record base time (don't clear yet)
        if (this.level === 0) {
            this.baseTime = performance.now();
            this.segments = [];
            // console.log('Profiler frame started, canvas:', this.canvasWidth, 'x', this.canvasHeight);
        }
        
        // Record the start time for this segment
        const startTime = performance.now();
        
        this.stack.push({
            level: this.level,
            color: color,
            name: name,
            startTime: startTime
        });
        
        this.level++;
    }
    
    /**
     * Pop a profiling segment and draw it
     */
    pop() {
        if (!this.enabled || this.stack.length === 0) {
            return;
        }
        
        const endTime = performance.now();
        this.level--;
        
        const segment = this.stack.pop();
        segment.endTime = endTime;
        
        // Store segment for drawing
        this.segments.push(segment);
        
        // If we're back at level 0, we're done with this frame - redraw everything
        if (this.level === 0) {
            this.redrawFrame();
        }
    }
    
    /**
     * Redraw the entire frame with all segments
     */
    redrawFrame() {
        if (!this.ctx || this.canvasWidth === 0) {
            return;
        }
        
        // Clear the canvas
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
        
        // Draw all segments accumulated so far
        for (const segment of this.segments) {
            this.drawSegment(segment);
        }
        
        // Draw timeline at bottom
        this.drawTimeline();
    }
    
    /**
     * Draw a single segment rectangle
     */
    drawSegment(segment) {
        if (!this.ctx || !this.baseTime || this.canvasWidth === 0) {
            return;
        }
        
        const duration = segment.endTime - segment.startTime;
        const startRelative = segment.startTime - this.baseTime;
        
        // Calculate pixel positions
        // baseTime is at x=0, baseTime+totalTime is at x=canvasWidth
        // totalTime is in seconds, convert to ms for the calculation
        const totalTimeMs = this.totalTime * 1000;
        const pxPerMs = this.canvasWidth / totalTimeMs;
        
        // startRelative and duration are in milliseconds
        const x = startRelative * pxPerMs;
        const width = duration * pxPerMs;
        const y = segment.level * this.lineHeight;
        
        // Draw rectangle (ensure minimum width for visibility)
        const minWidth = 2;
        const finalWidth = Math.max(width, minWidth);
        
        this.ctx.fillStyle = segment.color;
        this.ctx.fillRect(x, y, finalWidth, this.lineHeight - 1);
        
        // Draw border
        this.ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        this.ctx.lineWidth = 0.5;
        this.ctx.strokeRect(x, y, finalWidth, this.lineHeight - 1);
        
        // Draw text if there's enough space
        if (finalWidth > 30) {
            this.ctx.fillStyle = this.textColor;
            this.ctx.font = '10px monospace';
            this.ctx.fillText(segment.name, x + 2, y + this.lineHeight - 2);
        }
    }
    
    /**
     * Draw timeline markers and labels at the bottom
     */
    drawTimeline() {
        if (!this.ctx) {
            return;
        }
        
        // Draw timeline
        this.ctx.strokeStyle = this.timelineColor;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.canvasHeight - 15);
        this.ctx.lineTo(this.canvasWidth, this.canvasHeight - 15);
        this.ctx.stroke();
        
        // Draw time labels
        this.ctx.fillStyle = this.textColor;
        this.ctx.font = '9px monospace';
        
        // Draw markers every 5ms
        const interval = 5; // ms
        const totalTimeMs = this.totalTime * 1000;
        const pxPerMs = this.canvasWidth / totalTimeMs;
        
        for (let ms = 0; ms <= totalTimeMs; ms += interval) {
            const x = ms * pxPerMs;
            this.ctx.beginPath();
            this.ctx.moveTo(x, this.canvasHeight - 15);
            this.ctx.lineTo(x, this.canvasHeight - 12);
            this.ctx.stroke();
            
            if (ms % 10 === 0) {
                this.ctx.fillText(ms.toFixed(0) + 'ms', x - 10, this.canvasHeight - 2);
            }
        }
    }
    
    /**
     * Clear the canvas
     */
    clearCanvas() {
        if (!this.ctx) {
            return;
        }
        
        // Fill background
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
        
        // Draw border to make canvas visible
        this.ctx.strokeStyle = '#666';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0, 0, this.canvasWidth, this.canvasHeight);
        
        // Draw status text
        this.ctx.fillStyle = this.textColor;
        this.ctx.font = 'bold 11px monospace';
        this.ctx.fillText('PROFILER (click to toggle)', 5, 12);
    }
    
    /**
     * Remove the profiler from the DOM
     */
    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
    }
}

// Create global instance
export let globalProfiler = null;

/**
 * Initialize the global profiler instance
 */
export function initGlobalProfiler() {
    globalProfiler = new VisualProfiler();
    globalProfiler.init();
    return globalProfiler;
}