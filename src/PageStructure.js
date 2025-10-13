
// the page structure consists of either a single div that contains everything
// or multiple divs with id's of "BannerTop", "Content", "ControlsBottom", and "BannerBottom"
// this is controlled by these environment variables
// BANNER_ACTIVE=true
// BANNER_TOP_TEXT=NOTIFICATION MESSAGE
// BANNER_BOTTOM_TEXT=NOTIFICATION MESSAGE
// BANNER_COLOR=#FFFFFF
// BANNER_BACKGROUND_COLOR=#004000
// BANNER_HEIGHT=20
// BANNER_TEXT_HEIGHT=16
// BANNER_BORDER_COLOR=#FF0000
// BANNER_FONT="Arial"


import {parseBoolean} from "./utils";

let setupDone = false;

// Height of the controls area at the bottom (frame slider and buttons)
// Reduced from 40px to 28px, then to 20px (30% thinner than 28px) to minimize vertical space
const CONTROLS_HEIGHT = 20;

export function setupPageStructure() {
    if (setupDone) return;
    setupDone = true;

    // Set body background to black to match the application theme
    document.body.style.backgroundColor = '#000000';

    // if banner is not active, then we have content and controls divs
    if (!parseBoolean(process.env.BANNER_ACTIVE)) {
        // create the container div, with ID of "Content"
        const container = document.createElement('div');
        container.id = "Content";
        // full screen minus controls at bottom
        container.style.position = 'absolute';
        container.style.width = '100%';
        container.style.height = `calc(100% - ${CONTROLS_HEIGHT}px)`;
        container.style.overflow = 'hidden';

        // disable touch actions to prevent scrolling
        container.style.touchAction = 'none';

        document.body.append(container)

        // create the controls div at the bottom
        const controlsBottom = document.createElement('div');
        controlsBottom.id = "ControlsBottom";
        controlsBottom.style.position = 'absolute';
        controlsBottom.style.bottom = '10px'; // Moved up 10px from bottom
        controlsBottom.style.width = '100%';
        controlsBottom.style.height = `${CONTROLS_HEIGHT}px`;
        controlsBottom.style.overflow = 'hidden';
        controlsBottom.style.backgroundColor = '#000000'; // Black background
        controlsBottom.style.paddingBottom = '4px'; // Add padding at the bottom
        controlsBottom.style.paddingRight = '10px'; // Add padding at the right end
        document.body.append(controlsBottom);

        return;
    }

    // if we have a banner, then we have multiple divs
    // create the top banner
    const bannerTop = document.createElement('div');
    bannerTop.id = "BannerTop";
    bannerTop.style.position = 'absolute';
    bannerTop.style.width = '100%';
    bannerTop.style.height = process.env.BANNER_HEIGHT + 'px';
    bannerTop.style.backgroundColor = process.env.BANNER_BACKGROUND_COLOR;
    bannerTop.style.color = process.env.BANNER_COLOR;
    bannerTop.style.textAlign = 'center';
    bannerTop.style.fontFamily = process.env.BANNER_FONT;
    bannerTop.style.fontSize = process.env.BANNER_TEXT_HEIGHT + 'px';
    bannerTop.style.lineHeight = process.env.BANNER_HEIGHT + 'px';
  //  bannerTop.style.borderBottom = '1px solid ' + process.env.BANNER_BORDER_COLOR;
    bannerTop.innerHTML = process.env.BANNER_TOP_TEXT;
    document.body.append(bannerTop);

    // create the content div, accounting for top banner, controls, and bottom banner
    const container = document.createElement('div');
    container.id = "Content";
    container.style.position = 'absolute';
    container.style.width = '100%';
    container.style.height = 'calc(100% - ' + (2 * process.env.BANNER_HEIGHT + CONTROLS_HEIGHT) + 'px)';
    container.style.top = process.env.BANNER_HEIGHT + 'px';
    container.style.overflow = 'hidden';
    document.body.append(container)

    const test = document.getElementById("Content");
    console.log(test)

    // create the controls div above the bottom banner
    const controlsBottom = document.createElement('div');
    controlsBottom.id = "ControlsBottom";
    controlsBottom.style.position = 'absolute';
    controlsBottom.style.bottom = (parseInt(process.env.BANNER_HEIGHT) + 10) + 'px'; // Moved up 10px from banner
    controlsBottom.style.width = '100%';
    controlsBottom.style.height = `${CONTROLS_HEIGHT}px`;
    controlsBottom.style.overflow = 'hidden';
    controlsBottom.style.backgroundColor = '#000000'; // Black background
    controlsBottom.style.paddingBottom = '4px'; // Add padding at the bottom
    controlsBottom.style.paddingRight = '10px'; // Add padding at the right end
    document.body.append(controlsBottom);

    // create the bottom banner
    const bannerBottom = document.createElement('div');
    bannerBottom.id = "BannerBottom";
    bannerBottom.style.position = 'absolute';
    // position at the bottom
    bannerBottom.style.bottom = 0;
    bannerBottom.style.width = '100%';
    bannerBottom.style.height = process.env.BANNER_HEIGHT + 'px';
    bannerBottom.style.backgroundColor = process.env.BANNER_BACKGROUND_COLOR;
    bannerBottom.style.color = process.env.BANNER_COLOR;
    bannerBottom.style.textAlign = 'center';
    bannerBottom.style.fontSize = process.env.BANNER_TEXT_HEIGHT + 'px';
    bannerBottom.style.fontFamily = process.env.BANNER_FONT;
    bannerBottom.style.lineHeight = process.env.BANNER_HEIGHT + 'px';
  //  bannerBottom.style.borderTop = '1px solid ' + process.env.BANNER_BORDER_COLOR;
    bannerBottom.innerHTML = process.env.BANNER_BOTTOM_TEXT;
    document.body.append(bannerBottom);


}

// Helper function to get the controls container
export function getControlsContainer() {
    return document.getElementById("ControlsBottom");
}

// Helper function to toggle controls visibility
let controlsHidden = false;

export function toggleControlsVisibility() {
    const controlsBottom = document.getElementById("ControlsBottom");
    const content = document.getElementById("Content");
    
    if (!controlsBottom || !content) return;
    
    controlsHidden = !controlsHidden;
    
    if (controlsHidden) {
        // Hide controls and expand content to full screen
        controlsBottom.style.display = 'none';
        content.style.height = '100%';
    } else {
        // Show controls and restore content height
        controlsBottom.style.display = 'block';
        
        // Restore original height based on whether banner is active
        if (!parseBoolean(process.env.BANNER_ACTIVE)) {
            content.style.height = `calc(100% - ${CONTROLS_HEIGHT}px)`;
        } else {
            content.style.height = 'calc(100% - ' + (2 * process.env.BANNER_HEIGHT + CONTROLS_HEIGHT) + 'px)';
        }
    }
}

export function areControlsHidden() {
    return controlsHidden;
}
