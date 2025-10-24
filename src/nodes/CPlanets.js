/**
 * CPlanets - Extracted planet rendering system from CNodeDisplayNightSky
 * 
 * Handles:
 * - Planet sprite creation and management
 * - Day sky sprite rendering (Sun and Moon visible during day)
 * - Planet position calculation using Astronomy Engine
 * - Magnitude-based brightness scaling
 * - Resource cleanup and disposal
 * 
 * Dependencies:
 * - Three.js: Provides rendering primitives (Sprite, SpriteMaterial, TextureLoader, etc.)
 * - Astronomy Engine: Calculates planet positions and illumination
 * - CelestialMath.raDec2Celestial: Converts RA/DEC to 3D coordinates
 * - Sit: Global settings (planetScale)
 * - configUtils.SITREC_APP: Application root path for resources
 */

import {Sprite, SpriteMaterial, TextureLoader, Vector3} from "three";
import {Sit} from "../Globals";
import {raDec2Celestial} from "../CelestialMath";
import {SITREC_APP} from "../configUtils";
import {assert} from "../assert.js";
import {radians} from "../utils";
import * as Astronomy from "astronomy-engine";

export class CPlanets {
    /**
     * Creates a new CPlanets instance
     * @param {Object} config Configuration object
     * @param {number} [config.sphereRadius=100] Radius of celestial sphere in units
     * @param {Array<string>} [config.planets] List of planet names to render
     * @param {Array<string>} [config.planetColors] Hex colors for each planet
     */
    constructor(config = {}) {
        this.sphereRadius = config.sphereRadius ?? 100;
        
        // Planet list and colors
        this.planets = config.planets ?? [
            "Sun", "Moon", "Mercury", "Venus", "Mars", 
            "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
        ];
        
        this.planetColors = config.planetColors ?? [
            "#FFFF40", "#FFFFFF", "#FFFFFF", "#80ff80", "#ff8080",
            "#FFFF80", "#FF80FF", "#FFFFFF", "#FFFFFF", "#FFFFFF"
        ];
        
        // Stores all planet sprite data
        // Structure: { planetName: { sprite, daySkySprite, ra, dec, mag, equatorial, color } }
        this.planetSprites = {};
        
        // Preloaded textures for efficiency
        this.textures = {
            star: null,
            sun: null,
            moon: null
        };
        
        this._loadTextures();
    }

    /**
     * Preload planet sprite textures
     * @private
     */
    _loadTextures() {
        const textureLoader = new TextureLoader();
        this.textures.star = textureLoader.load(SITREC_APP + 'data/images/nightsky/MickStar.png');
        this.textures.sun = textureLoader.load(SITREC_APP + 'data/images/nightsky/MickSun.png');
        this.textures.moon = textureLoader.load(SITREC_APP + 'data/images/nightsky/MickMoon.png');
    }

    /**
     * Removes all planet sprites from scenes
     * Safely disposes of materials and textures
     * 
     * @param {Scene} scene Main night sky scene
     * @param {Scene} [dayScene] Optional day sky scene for Sun/Moon rendering
     */
    removePlanets(scene, dayScene = null) {
        if (this.planetSprites) {
            for (const [planet, planetData] of Object.entries(this.planetSprites)) {
                if (planetData.sprite) {
                    if (scene) scene.remove(planetData.sprite);
                    if (planetData.sprite.material) {
                        if (planetData.sprite.material.map) {
                            planetData.sprite.material.map.dispose();
                        }
                        planetData.sprite.material.dispose();
                    }
                }
                if (planetData.daySkySprite && dayScene) {
                    dayScene.remove(planetData.daySkySprite);
                    if (planetData.daySkySprite.material) {
                        if (planetData.daySkySprite.material.map) {
                            planetData.daySkySprite.material.map.dispose();
                        }
                        planetData.daySkySprite.material.dispose();
                    }
                }
            }
        }
        this.planetSprites = {};
    }

    /**
     * Adds planet sprites to the scenes
     * Creates sprites for all planets and positions them based on observer location
     * 
     * @param {Scene} scene Main night sky scene
     * @param {Scene} [dayScene] Optional day sky scene for Sun/Moon during daylight
     * @param {Object} params Configuration object
     * @param {Date} params.date Current simulation date/time
     * @param {Vector3} params.cameraPos Camera position in EUS coordinates
     * @param {Function} params.ecefToLla Function to convert ECEF to LLA coordinates
     */
    addPlanets(scene, dayScene = null, params = {}) {
        assert(params.date, "CPlanets.addPlanets: date required");
        assert(params.cameraPos, "CPlanets.addPlanets: cameraPos required");
        assert(params.ecefToLla, "CPlanets.addPlanets: ecefToLla function required");

        // Remove existing planets first to prevent duplicates
        this.removePlanets(scene, dayScene);

        // Safety check
        if (this.planetSprites && Object.keys(this.planetSprites).length > 0) {
            console.warn("CPlanets: planetSprites not empty after removePlanets, forcing cleanup");
            this.planetSprites = {};
        }

        // Create observer position from camera
        const cameraLLA = params.ecefToLla(params.cameraPos);
        const observer = new Astronomy.Observer(cameraLLA.x, cameraLLA.y, cameraLLA.z);

        // Create sprites for each planet
        let n = 0;
        for (const planet of this.planets) {
            const texture = this._getTextureForPlanet(planet);
            const color = this.planetColors[n++];
            const spriteMaterial = new SpriteMaterial({map: texture, color: color});
            const sprite = new Sprite(spriteMaterial);

            // Create day sky sprite for Sun and Moon
            let daySkySprite = null;
            if ((planet === "Sun" || planet === "Moon") && dayScene) {
                const daySkyMaterial = new SpriteMaterial({map: texture, color: color});
                daySkySprite = new Sprite(daySkyMaterial);
                dayScene.add(daySkySprite);
            }

            // Position and update sprite
            this.updatePlanetSprite(planet, sprite, params.date, observer, daySkySprite);
            this.planetSprites[planet].color = color;

            // Add night sprite to scene
            scene.add(sprite);
        }
    }

    /**
     * Updates a planet sprite's position and scale for the current time
     * Calculates RA/DEC from astronomy library and converts to 3D position
     * 
     * @param {string} planet Planet name
     * @param {Sprite} sprite Three.js Sprite object
     * @param {Date} date Current simulation date/time
     * @param {Astronomy.Observer} observer Observer location
     * @param {Sprite} [daySkySprite] Optional day sky sprite to update in parallel
     */
    updatePlanetSprite(planet, sprite, date, observer, daySkySprite = undefined) {
        // Get celestial coordinates and illumination from Astronomy Engine
        const celestialInfo = Astronomy.Equator(planet, date, observer, false, true);
        const illumination = Astronomy.Illumination(planet, date);
        
        const ra = (celestialInfo.ra) / 24 * 2 * Math.PI;  // RA in hours -> radians
        const dec = radians(celestialInfo.dec);             // DEC in degrees -> radians
        const mag = illumination.mag;                       // Magnitude (brightness)
        const equatorial = raDec2Celestial(ra, dec, this.sphereRadius);

        // Retrieve stored color for this planet
        let color = "#FFFFFF";
        if (this.planetSprites[planet] !== undefined) {
            color = this.planetSprites[planet].color;
        }

        // Set sprite position on celestial sphere
        sprite.position.set(equatorial.x, equatorial.y, equatorial.z);

        // Calculate sprite scale based on magnitude
        // Using magnitude scale formula: scale = 10^(-0.4 * (mag - reference))
        var scale = 10 * Math.pow(10, -0.4 * (mag - -5));
        if (scale > 1) scale = 1;
        
        // Special handling for Sun and Moon
        if (planet === "Sun") scale = 1.9;
        if (planet === "Moon") scale = 1.9;
        
        // Apply planet brightness scale (except for Sun and Moon which are fixed size)
        if (planet !== "Sun" && planet !== "Moon") {
            scale *= Math.pow(10, 0.4 * Math.log10(Sit.planetScale));
        }

        sprite.scale.set(scale, scale, 1);

        // Update day sky sprite if provided
        if (daySkySprite) {
            daySkySprite.position.set(equatorial.x, equatorial.y, equatorial.z);
            daySkySprite.scale.set(scale, scale, 1);
        }

        // Store or update planet sprite data
        if (!this.planetSprites[planet]) {
            this.planetSprites[planet] = {
                ra: ra,
                dec: dec,
                mag: mag,
                equatorial: equatorial,
                sprite: sprite,
                color: color,
                daySkySprite: daySkySprite,
            };
        } else {
            // Update existing entry
            this.planetSprites[planet].ra = ra;
            this.planetSprites[planet].dec = dec;
            this.planetSprites[planet].mag = mag;
            this.planetSprites[planet].equatorial = equatorial;
            this.planetSprites[planet].color = color;
            if (daySkySprite) {
                this.planetSprites[planet].daySkySprite = daySkySprite;
            }
        }
    }

    /**
     * Get appropriate texture for a planet sprite
     * @private
     * @param {string} planet Planet name
     * @returns {Texture} Three.js texture object
     */
    _getTextureForPlanet(planet) {
        if (planet === "Sun") return this.textures.sun;
        if (planet === "Moon") return this.textures.moon;
        return this.textures.star;
    }

    /**
     * Get planet data by name
     * @param {string} planet Planet name
     * @returns {Object|null} Planet sprite data or null if not found
     */
    getPlanetData(planet) {
        return this.planetSprites[planet] || null;
    }

    /**
     * Cleanup and dispose of all resources
     * Call this when the night sky is being destroyed
     */
    dispose() {
        this.removePlanets(null, null);
        
        // Dispose textures
        if (this.textures.star) this.textures.star.dispose();
        if (this.textures.sun) this.textures.sun.dispose();
        if (this.textures.moon) this.textures.moon.dispose();
    }
}