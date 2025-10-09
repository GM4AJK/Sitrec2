// find the track an object is moving along, if any
// this is a recursive function that examines the type of node, and then recurses on the appropriate input nodes
// Returns the root data source node (typically CNodeMISBDataTrack) or the root track node itself for synthetic tracks

/**
 * Check if a node is an instance of a class or its subclasses by walking the prototype chain
 * This replicates instanceof behavior without requiring imports
 * @param {object} node - The node to check
 * @param {string} className - The class name to check for
 * @returns {boolean} - True if node is an instance of className or inherits from it
 */
function isInstanceOf(node, className) {
    if (!node) return false;
    
    let proto = Object.getPrototypeOf(node);
    while (proto) {
        if (proto.constructor.name === className) {
            return true;
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}

export function findRootTrack(node) {
    if (!node) {
        return null;
    }

    // Handle 3D objects - search through controller inputs
    if (isInstanceOf(node, 'CNode3D')) {
        // iterate over the inputs, and if one is a controller and returns a result, return it
        for (const inputID in node.inputs) {
            const inputNode = node.inputs[inputID];
            if (isInstanceOf(inputNode, 'CNodeController')) {
                const rootTrack = findRootTrack(inputNode);
                if (rootTrack !== null) {
                    return rootTrack;
                }
            }
        }
        // nothing found in the inputs, so just an object with no path
        return null;
    }

    // Handle controller that positions objects along a track
    if (isInstanceOf(node, 'CNodeControllerTrackPosition')) {
        const sourceTrack = node.inputs.sourceTrack;
        return findRootTrack(sourceTrack);
    }

    // Handle smoothed position tracks - follow the source
    if (isInstanceOf(node, 'CNodeSmoothedPositionTrack')) {
        const source = node.inputs.source;
        return findRootTrack(source);
    }

    // Handle track with wind effects - follow the source
    if (isInstanceOf(node, 'CNodeTrackAir')) {
        const source = node.inputs.source;
        return findRootTrack(source);
    }

    // Handle interpolated tracks - follow the source
    if (isInstanceOf(node, 'CNodeInterpolateTwoFramesTrack')) {
        const source = node.inputs.source;
        return findRootTrack(source);
    }

    // Handle switch nodes - follow the currently selected choice
    if (isInstanceOf(node, 'CNodeSwitch')) {
        const choice = node.choice;
        const choiceNode = node.inputs[choice];
        return findRootTrack(choiceNode);
    }

    // Handle specific frame wrapper - follow the wrapped node
    if (isInstanceOf(node, 'CNodeSpecificFrame')) {
        const wrappedNode = node.inputs.node;
        return findRootTrack(wrappedNode);
    }

    // Handle MISB-based tracks - return the MISB data node (the root data source)
    if (isInstanceOf(node, 'CNodeTrackFromMISB')) {
        const misb = node.inputs.misb;
        // this is the root data track
        // all data driven tracks are converted to misb data internally.
        return misb;
    }

    // Handle synthetic/generated tracks that don't have a data source
    // These are root tracks themselves
    if (isInstanceOf(node, 'CNodeSatelliteTrack')) {
        // Satellite tracks are generated from TLE data, no MISB source
        return node;
    }

    if (isInstanceOf(node, 'CNodeTrackFromLLA')) {
        // Track from lat/lon/alt inputs, no MISB source
        return node;
    }

    if (isInstanceOf(node, 'CNodeTrackFromLLAArray')) {
        // Track from LLA array, no MISB source
        return node;
    }

    if (isInstanceOf(node, 'CNodeJetTrack')) {
        // Synthetic jet track, no MISB source
        return node;
    }

    // For any other CNodeTrack subclass, consider it a root track
    // This handles various LOS traverse tracks, homing missile tracks, etc.
    if (isInstanceOf(node, 'CNodeTrack')) {
        return node;
    }

    // Unknown node type or not a track-related node
    return null;
}