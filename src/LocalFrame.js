// LocalFrame is the position of the jet (or camera) in world coordinates
// and the orientation given local UP (corrected)
// a bit of a holdover from when this was all we were looking at. So old code works in the local frame
// moving the jet moves the local frame
//
// GlobalScene is the global Three.js GlobalScene

export var LocalFrame;
export var GlobalScene;
export var GlobalNightSkyScene;
export var GlobalDaySkyScene;

export function setupScene(_scene){
    // The root GlobalScene
    GlobalScene = _scene;
}

export function setupNightSkyScene(_scene){
    GlobalNightSkyScene = _scene;
}

export function setupDaySkyScene(_scene){
    GlobalDaySkyScene = _scene;
}

export function setupLocalFrame(_group) {
    // LocalFrame takes the old local sim and puts in into the world
    LocalFrame = _group
}