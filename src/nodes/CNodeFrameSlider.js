import {par} from "../par";
import {NodeMan, setRenderOne, Sit} from "../Globals";
import {CNode} from "./CNode";
import {parseBoolean} from "../utils";

export class CNodeFrameSlider extends CNode {
    constructor(v) {
        super(v);
        this.sliderDiv = null;
        this.sliderInput = null;
        this.playPauseButton = null;
        this.startButton = null;
        this.endButton = null;
        this.frameAdvanceButton = null;
        this.frameBackButton = null;
        this.fastForwardButton = null;
        this.fastRewindButton = null;
        this.pinButton = null;

        this.pinned = false;
        this.advanceHeld = false;
        this.backHeld = false;
        this.advanceHoldFrames = 0;
        this.backHoldFrames = 0;
        this.holdThreshold = 10; // Number of frames the button needs to be held before starting repeated actions
        this.fadeOutTimer = null;

        // Dragging state for A and B limits
        this.draggingALimit = false;
        this.draggingBLimit = false;
        this.hoveringALimit = false;
        this.hoveringBLimit = false;
        this.dragThreshold = 10; // Pixels within which we can grab a limit line

        this.setupFrameSlider();
    }

    setupFrameSlider() {
        const sliderContainer = document.createElement('div');

        // Set up the slider container
        sliderContainer.style.position = 'absolute';
        sliderContainer.style.height = '40px';
        sliderContainer.style.bottom = '0px';
        if (parseBoolean(process.env.BANNER_ACTIVE)) {
            sliderContainer.style.bottom = process.env.BANNER_HEIGHT + 'px';
        }
        sliderContainer.style.width = '100%';
        sliderContainer.style.zIndex = '1001'; // Needed to get mouse events when over other windows
        sliderContainer.style.display = 'flex';
        sliderContainer.style.alignItems = 'center';

        // Prevent double click behavior on the slider container
        sliderContainer.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        // Create control buttons container
        this.controlContainer = document.createElement('div');
        this.controlContainer.style.display = 'flex';
        this.controlContainer.style.marginRight = '10px';
        this.controlContainer.style.width = '400px'; // Adjusted width to accommodate the new buttons

        // Create Buttons
        this.pinButton = this.createButton(
            this.controlContainer,
            spriteLocations.pin.row,
            spriteLocations.pin.col,
            this.togglePin.bind(this),
            'Pin/Unpin'
        );

        this.togglePin();

        this.playPauseButton = this.createButton(
            this.controlContainer,
            spriteLocations.play.row,
            spriteLocations.play.col,
            this.togglePlayPause.bind(this),
            'Play/Pause'
        );
        this.updatePlayPauseButton();

        this.frameBackButton = this.createButton(
            this.controlContainer,
            spriteLocations.frameBack.row,
            spriteLocations.frameBack.col,
            this.backOneFrame.bind(this),
            'Step Back',
            () => {
                this.backHeld = true;
                this.backHoldFrames = 0; // Reset the hold count on mouse down
            },
            () => {
                this.backHeld = false;
                this.backHoldFrames = 0; // Clear the hold count on mouse up
            }
        );

        this.frameAdvanceButton = this.createButton(
            this.controlContainer,
            spriteLocations.frameAdvance.row,
            spriteLocations.frameAdvance.col,
            this.advanceOneFrame.bind(this),
            'Step Forward',
            () => {
                this.advanceHeld = true;
                this.advanceHoldFrames = 0; // Reset the hold count on mouse down
            },
            () => {
                this.advanceHeld = false;
                this.advanceHoldFrames = 0; // Clear the hold count on mouse up
            }
        );

        this.fastRewindButton = this.createButton(
            this.controlContainer,
            spriteLocations.fastRewind.row,
            spriteLocations.fastRewind.col,
            () => {},
            'Fast Rewind',
            () => {
                this.fastRewindButton.held = true;
                par.paused = true;
                this.updatePlayPauseButton();
            },
            () => {
                this.fastRewindButton.held = false;
            }
        );

        this.fastForwardButton = this.createButton(
            this.controlContainer,
            spriteLocations.fastForward.row,
            spriteLocations.fastForward.col,
            () => {},
            'Fast Forward',
            () => {
                this.fastForwardButton.held = true;
                par.paused = true;
                this.updatePlayPauseButton();
            },
            () => {
                this.fastForwardButton.held = false;
            }
        );

        this.startButton = this.createButton(
            this.controlContainer,
            spriteLocations.start.row,
            spriteLocations.start.col,
            () => this.setFrame(0),
            'Jump to Start'
        );

        this.endButton = this.createButton(
            this.controlContainer,
            spriteLocations.end.row,
            spriteLocations.end.col,
            () => this.setFrame(parseInt(this.sliderInput.max, 10)),
            'Jump to End'
        );

        this.controlContainer.style.opacity = "0"; // Initially hidden
        sliderContainer.appendChild(this.controlContainer);

        // Create the slider input element
        this.sliderInput = document.createElement('input');
        this.sliderInput.type = "range";
        this.sliderInput.className = "flat-slider";
        this.sliderInput.style.position = 'absolute';
        this.sliderInput.style.top = '0';
        this.sliderInput.style.left = '0';
        this.sliderInput.style.width = '100%';
        this.sliderInput.style.height = '100%';
        this.sliderInput.style.outline = 'none'; // Remove focus outline
        this.sliderInput.tabIndex = -1; // Prevent keyboard focus
        this.sliderInput.min = "0";
        this.sliderInput.max = "100"; // Initial max, can be updated later
        this.sliderInput.value = "0";

        let sliderDragging = false;
        let sliderFade = false;

        const newFrame = (frame) => {
            par.frame = frame;
            setRenderOne(true);
        };

        const getFrameFromSlider = () => {
            const frame = parseInt(this.sliderInput.value, 10);
            newFrame(frame);
        };

        // create a div to hold the slider
        this.sliderDiv = document.createElement('div');
        this.sliderDiv.style.width = '100%';
        this.sliderDiv.style.height = '40px';
        this.sliderDiv.style.display = 'flex';
        this.sliderDiv.style.alignItems = 'center';
        this.sliderDiv.style.justifyContent = 'center';
        this.sliderDiv.style.position = 'relative';
        this.sliderDiv.style.zIndex = '1002';
        this.sliderDiv.style.opacity = "0"; // Initially hidden
        this.sliderDiv.style.transition = "opacity 0.2s";
        this.sliderDiv.style.marginRight = '10px'; // Match the spacing between buttons and slider


        this.sliderDiv.appendChild(this.sliderInput);
        sliderContainer.appendChild(this.sliderDiv);
        document.body.appendChild(sliderContainer);

        // add a canvas to the slider div
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '1003'; // Ensure it overlays the input
        this.canvas.style.pointerEvents = 'none'; // Initially allow events to pass through
        this.sliderDiv.appendChild(this.canvas);

        // Add mouse event handlers for dragging A and B limits
        this.setupLimitDragging();

        // Add mouse move listener to the slider container to manage pointer events
        sliderContainer.addEventListener('mousemove', (event) => {
            if (!this.draggingALimit && !this.draggingBLimit) {
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                const mouseY = event.clientY - rect.top;
                
                // Helper functions (duplicated here for scope)
                const frameToPixel = (frame) => {
                    return (frame / Sit.frames) * this.canvas.offsetWidth;
                };
                
                const getNearLimit = (mouseX, mouseY) => {
                    const aPixel = frameToPixel(Sit.aFrame);
                    const bPixel = frameToPixel(Sit.bFrame);
                    const currentFramePixel = frameToPixel(par.frame);
                    
                    // Define slider thumb area (prioritize this over A/B limits)
                    const thumbWidth = 20; // Approximate width of slider thumb
                    const thumbArea = {
                        left: currentFramePixel - thumbWidth / 2,
                        right: currentFramePixel + thumbWidth / 2,
                        top: 10, // Allow A/B dragging above the slider track
                        bottom: 40 // Full height of slider container
                    };
                    
                    // If mouse is in the slider thumb area, don't allow A/B limit dragging
                    if (mouseX >= thumbArea.left && mouseX <= thumbArea.right && 
                        mouseY >= thumbArea.top && mouseY <= thumbArea.bottom) {
                        return null;
                    }
                    
                    // Check if near A limit line or handle
                    if (Math.abs(mouseX - aPixel) <= this.dragThreshold) {
                        return 'A';
                    }
                    // Check if near A handle circle (top of line) - prioritize this area
                    if (Math.abs(mouseX - aPixel) <= 8 && mouseY >= 0 && mouseY <= 16) {
                        return 'A';
                    }
                    
                    // Check if near B limit line or handle
                    if (Math.abs(mouseX - bPixel) <= this.dragThreshold) {
                        return 'B';
                    }
                    // Check if near B handle circle (top of line) - prioritize this area
                    if (Math.abs(mouseX - bPixel) <= 8 && mouseY >= 0 && mouseY <= 16) {
                        return 'B';
                    }
                    
                    return null;
                };
                
                const nearLimit = getNearLimit(mouseX, mouseY);
                
                // Enable pointer events on canvas only when near a limit
                if (nearLimit) {
                    this.canvas.style.pointerEvents = 'auto';
                } else {
                    this.canvas.style.pointerEvents = 'none';
                }
            }
        });


        // Event listeners for slider interactions
        this.sliderInput.addEventListener('input', () => {
            newFrame(parseInt(this.sliderInput.value, 10));
            sliderDragging = true;
            par.paused = true;
        });

        this.sliderInput.addEventListener('change', () => {
            if (sliderFade) {
                this.sliderInput.style.opacity = "1";
                setTimeout(() => { this.sliderInput.style.opacity = "0"; }, 200); // fade out
                sliderFade = false;
            }
            sliderDragging = false;
        });

        this.sliderInput.style.opacity = "0"; // Initially hidden

        sliderContainer.addEventListener('mouseenter', () => {
            console.log("Hover Start");
            if (!sliderDragging) {
                setTimeout(() => { this.sliderDiv.style.opacity = "1"; }, 200); // fade in
                setTimeout(() => { this.sliderInput.style.opacity = "1"; }, 200); // fade in
                setTimeout(() => { this.controlContainer.style.opacity = "1"; }, 200); // fade in
                this.sliderFadeOutCounter = undefined; // Reset fade counter on mouse enter
            }
            sliderFade = false;
            // Clear any existing fade out timer
            if (this.fadeOutTimer) {
                clearTimeout(this.fadeOutTimer);
                this.fadeOutTimer = null;
            }
        });

        sliderContainer.addEventListener('mouseleave', () => {
            if (sliderDragging) {
                sliderFade = true;
            } else {
                // Start fade out timer (2 seconds delay, then 0.5 second fade)
                this.fadeOutTimer = setTimeout(() => {
                    this.startFadeOut();
                }, 2000);
            }
        });
    }

    setupLimitDragging() {
        let isDragging = false;
        let dragStartX = 0;

        // Helper function to get mouse position relative to canvas
        const getMousePos = (event) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
        };

        // Helper function to convert pixel position to frame number
        const pixelToFrame = (x) => {
            return Math.round((x / this.canvas.offsetWidth) * Sit.frames);
        };

        // Helper function to get pixel position of a frame
        const frameToPixel = (frame) => {
            return (frame / Sit.frames) * this.canvas.offsetWidth;
        };

        // Helper function to check if mouse is near a limit line or handle
        const getNearLimit = (mouseX, mouseY) => {
            const aPixel = frameToPixel(Sit.aFrame);
            const bPixel = frameToPixel(Sit.bFrame);
            const currentFramePixel = frameToPixel(par.frame);
            
            // Define slider thumb area (prioritize this over A/B limits)
            const thumbWidth = 20; // Approximate width of slider thumb
            const thumbArea = {
                left: currentFramePixel - thumbWidth / 2,
                right: currentFramePixel + thumbWidth / 2,
                top: 10, // Allow A/B dragging above the slider track
                bottom: 40 // Full height of slider container
            };
            
            // If mouse is in the slider thumb area, don't allow A/B limit dragging
            if (mouseX >= thumbArea.left && mouseX <= thumbArea.right && 
                mouseY >= thumbArea.top && mouseY <= thumbArea.bottom) {
                return null;
            }
            
            // Check if near A limit line or handle
            if (Math.abs(mouseX - aPixel) <= this.dragThreshold) {
                return 'A';
            }
            // Check if near A handle circle (top of line) - prioritize this area
            if (Math.abs(mouseX - aPixel) <= 8 && mouseY >= 0 && mouseY <= 16) {
                return 'A';
            }
            
            // Check if near B limit line or handle
            if (Math.abs(mouseX - bPixel) <= this.dragThreshold) {
                return 'B';
            }
            // Check if near B handle circle (top of line) - prioritize this area
            if (Math.abs(mouseX - bPixel) <= 8 && mouseY >= 0 && mouseY <= 16) {
                return 'B';
            }
            
            return null;
        };

        // Mouse down event
        this.canvas.addEventListener('mousedown', (event) => {
            const mousePos = getMousePos(event);
            const nearLimit = getNearLimit(mousePos.x, mousePos.y);
            
            if (nearLimit === 'A') {
                this.draggingALimit = true;
                isDragging = true;
                dragStartX = mousePos.x;
                this.canvas.style.cursor = 'ew-resize';
                
                // Add global event listeners for dragging
                document.addEventListener('mousemove', globalMouseMove);
                document.addEventListener('mouseup', globalMouseUp);
                
                event.preventDefault();
                event.stopPropagation();
            } else if (nearLimit === 'B') {
                this.draggingBLimit = true;
                isDragging = true;
                dragStartX = mousePos.x;
                this.canvas.style.cursor = 'ew-resize';
                
                // Add global event listeners for dragging
                document.addEventListener('mousemove', globalMouseMove);
                document.addEventListener('mouseup', globalMouseUp);
                
                event.preventDefault();
                event.stopPropagation();
            }
        });

        // Mouse move event on canvas (for hover detection when not dragging)
        this.canvas.addEventListener('mousemove', (event) => {
            if (!isDragging) {
                const mousePos = getMousePos(event);
                // Update cursor and hover state based on proximity to limits
                const nearLimit = getNearLimit(mousePos.x, mousePos.y);
                this.hoveringALimit = (nearLimit === 'A');
                this.hoveringBLimit = (nearLimit === 'B');
                
                if (nearLimit) {
                    this.canvas.style.cursor = 'ew-resize';
                } else {
                    this.canvas.style.cursor = 'default';
                }
            }
        });

        // Global mouse move event for dragging (allows vertical movement outside canvas)
        const globalMouseMove = (event) => {
            if (isDragging) {
                const mousePos = getMousePos(event);
                const newFrame = Math.max(0, Math.min(Sit.frames, pixelToFrame(mousePos.x)));
                
                if (this.draggingALimit) {
                    Sit.aFrame = newFrame;
                    setRenderOne(true);
                } else if (this.draggingBLimit) {
                    Sit.bFrame = newFrame;
                    setRenderOne(true);
                }
            }
        };

        // Global mouse up event for dragging
        const globalMouseUp = (event) => {
            if (isDragging) {
                this.draggingALimit = false;
                this.draggingBLimit = false;
                isDragging = false;
                this.canvas.style.cursor = 'default';
                // Reset pointer events to allow normal slider interaction
                this.canvas.style.pointerEvents = 'none';
                
                // Remove global event listeners
                document.removeEventListener('mousemove', globalMouseMove);
                document.removeEventListener('mouseup', globalMouseUp);
            }
        };

        // Mouse leave event (only reset hover states, don't stop dragging)
        this.canvas.addEventListener('mouseleave', (event) => {
            this.hoveringALimit = false;
            this.hoveringBLimit = false;
            // Don't stop dragging on mouse leave - let global mouse up handle it
        });
    }

    dispose() {
        super.dispose()
        // safely remove the slider
        this.sliderDiv.remove();
        // Clear any pending fade out timer
        if (this.fadeOutTimer) {
            clearTimeout(this.fadeOutTimer);
            this.fadeOutTimer = null;
        }
    }

    startFadeOut() {
        if (this.pinned) return; // Don't fade out if pinned
        
        // Use CSS transition for smooth fade out
        this.sliderDiv.style.transition = "opacity 0.5s";
        this.sliderInput.style.transition = "opacity 0.5s";
        this.controlContainer.style.transition = "opacity 0.5s";
        
        this.sliderDiv.style.opacity = "0";
        this.sliderInput.style.opacity = "0";
        this.controlContainer.style.opacity = "0";
        
        this.fadeOutTimer = null;
    }

    createButton(container, row, column, clickHandler, title, mouseDownHandler = null, mouseUpHandler = null) {
        const buttonContainer = this.createButtonContainer();
        const button = this.createSpriteDiv(row, column, clickHandler);
        button.title = title;
        buttonContainer.appendChild(button);
        container.appendChild(buttonContainer);

        if (mouseDownHandler) {
            button.addEventListener('mousedown', mouseDownHandler);
        }
        if (mouseUpHandler) {
            button.addEventListener('mouseup', mouseUpHandler);
        }

        return button;
    }

    update(frame) {
        // If pinned, ensure the bar stays visible
        if (this.pinned) {
            this.sliderDiv.style.opacity = "1";
            this.sliderInput.style.opacity = "1";
            this.controlContainer.style.opacity = "1";
            // Clear any pending fade out timer when pinned
            if (this.fadeOutTimer) {
                clearTimeout(this.fadeOutTimer);
                this.fadeOutTimer = null;
            }
        }

        if (this.advanceHeld) {
            this.advanceHoldFrames++;
            if (this.advanceHoldFrames > this.holdThreshold) {
                this.advanceOneFrame();
            }
        }

        if (this.backHeld) {
            this.backHoldFrames++;
            if (this.backHoldFrames > this.holdThreshold) {
                this.backOneFrame();
            }
        }

        if (this.fastForwardButton && this.fastForwardButton.held) {
            par.frame = Math.min(parseInt(par.frame, 10) + 10, parseInt(this.sliderInput.max, 10));
        }

        if (this.fastRewindButton && this.fastRewindButton.held) {
            par.frame = Math.max(parseInt(par.frame, 10) - 10, 0);
        }

        // resize the canvas to the actualy pixels of the div
        const ctx = this.canvas.getContext('2d');
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;


        // Draw A limit line (green)
        const aPixel = this.canvas.width * Sit.aFrame / Sit.frames;
        let aColor = '#008000'; // Default green
        let aLineWidth = 2;
        let aHandleRadius = 4;
        
        if (this.draggingALimit) {
            aColor = '#00ff00'; // Bright green when dragging
            aLineWidth = 3;
            aHandleRadius = 5;
        } else if (this.hoveringALimit) {
            aColor = '#00cc00'; // Medium green when hovering
            aLineWidth = 2.5;
            aHandleRadius = 4.5;
        }
        
        ctx.strokeStyle = aColor;
        ctx.lineWidth = aLineWidth;
        ctx.beginPath();
        ctx.moveTo(aPixel, 0);
        ctx.lineTo(aPixel, this.canvas.height);
        ctx.stroke();

        // Draw A limit handle (small circle at top)
        ctx.fillStyle = aColor;
        ctx.beginPath();
        ctx.arc(aPixel, 8, aHandleRadius, 0, 2 * Math.PI);
        ctx.fill();

        // Draw B limit line (red)
        const bPixel = this.canvas.width * Sit.bFrame / Sit.frames;
        let bColor = '#800000'; // Default red
        let bLineWidth = 2;
        let bHandleRadius = 4;
        
        if (this.draggingBLimit) {
            bColor = '#ff0000'; // Bright red when dragging
            bLineWidth = 3;
            bHandleRadius = 5;
        } else if (this.hoveringBLimit) {
            bColor = '#cc0000'; // Medium red when hovering
            bLineWidth = 2.5;
            bHandleRadius = 4.5;
        }
        
        ctx.strokeStyle = bColor;
        ctx.lineWidth = bLineWidth;
        ctx.beginPath();
        ctx.moveTo(bPixel, 0);
        ctx.lineTo(bPixel, this.canvas.height);
        ctx.stroke();

        // Draw B limit handle (small circle at top)
        ctx.fillStyle = bColor;
        ctx.beginPath();
        ctx.arc(bPixel, 8, bHandleRadius, 0, 2 * Math.PI);
        ctx.fill();


    }

    updateFrameSlider() {
        if (this.sliderInput.style.opacity === "1") {
            const currentValue = parseInt(this.sliderInput.value, 10);
            if (currentValue !== par.frame) {
                this.sliderInput.value = par.frame;
            }

            const max = parseInt(this.sliderInput.max, 10);
            if (max !== Sit.frames) {
                this.sliderInput.max = Sit.frames;
            }
        }
    }

    // Utility function to create a div using a sprite from a sprite sheet
    createSpriteDiv(row, column, onClickHandler) {
        const div = document.createElement('div');
        div.style.width = '40px';
        div.style.height = '40px';
        div.style.backgroundImage = 'url(./data/images/video-sprites-40px-5x3.png?v=1)';
        div.style.backgroundSize = '200px 120px'; // Updated to match the actual sprite sheet size
        div.style.backgroundPosition = `-${column * 40}px -${row * 40}px`; // Corrected to reflect sprite size in 200x120 image
        div.style.backgroundRepeat = 'no-repeat'; // Ensure only one sprite is displayed
        div.style.cursor = 'pointer';
        div.addEventListener('click', onClickHandler);
        return div;
    }

    // Utility function to create a button container
    createButtonContainer() {
        const container = document.createElement('div');
        container.style.width = '40px';
        container.style.height = '40px';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        return container;
    }

    // Function to update the play/pause button based on the state of par.paused
    updatePlayPauseButton() {
        if (par.paused) {
            this.playPauseButton.style.backgroundPosition = `-${spriteLocations.play.col * 40}px -${spriteLocations.play.row * 40}px`;
        } else {
            this.playPauseButton.style.backgroundPosition = `-${spriteLocations.pause.col * 40}px -${spriteLocations.pause.row * 40}px`;
        }
    }

    // Play/Pause toggle function
    togglePlayPause() {
        par.paused = !par.paused;
        this.updatePlayPauseButton();
    }

    // Pin/Unpin toggle function
    togglePin() {
        this.pinned = !this.pinned;
        this.pinButton.style.backgroundPosition = this.pinned ? `-${spriteLocations.unpin.col * 40}px -${spriteLocations.unpin.row * 40}px` : `-${spriteLocations.pin.col * 40}px -${spriteLocations.pin.row * 40}px`;
    }

    // Advance a single frame function
    advanceOneFrame() {
        par.paused = true;
        this.updatePlayPauseButton()
        let currentFrame = parseInt(this.sliderInput.value, 10);
        if (currentFrame < parseInt(this.sliderInput.max, 10)) {
            this.setFrame(currentFrame + 1);
        }
    }

    // Back a single frame function
    backOneFrame() {
        par.paused = true;
        this.updatePlayPauseButton()
        let currentFrame = parseInt(this.sliderInput.value, 10);
        if (currentFrame > 0) {
            this.setFrame(currentFrame - 1);
        }
    }

    // Set frame helper function
    setFrame(frame) {
        this.sliderInput.value = frame;
        par.frame = frame;
    }
}

// Define the sprite locations by button name
const spriteLocations = {
    play: { row: 0, col: 0 }, // Play button
    pause: { row: 0, col: 1 }, // Pause button
    frameBack: { row: 1, col: 3 }, // Step one frame back
    frameAdvance: { row: 1, col: 2 }, // Step one frame forward
    start: { row: 1, col: 1 }, // Jump to start
    end: { row: 1, col: 0 }, // Jump to end
    fastRewind: { row: 2, col: 1 }, // Fast rewind
    fastForward: { row: 2, col: 0 }, // Fast forward
    pin: { row: 2, col: 2 }, // Pin button
    unpin: { row: 2, col: 3 } // Unpin button
};

// Exported function to create an instance of CNodeFrameSlider
export function SetupFrameSlider() {
    return new CNodeFrameSlider({ id: "FrameSlider" });
}

export function updateFrameSlider() {
    const slider = NodeMan.get("FrameSlider");
    slider.updateFrameSlider();
    slider.updatePlayPauseButton();
}
