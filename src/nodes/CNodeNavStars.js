import {NodeMan} from "../Globals";
import {ECEFToLLAVD_Sphere, EUSToECEF, getLST, raDecToAzElRADIANS, wgs84} from "../LLA-ECEF-ENU";
//import {camera} from "../core/Globals.js";
import {radians} from "../utils";
import {getJulianDate, raDecToAltAz} from "../CelestialMath";



export class CNodeNavStars {
    constructor(options = {}) {
        this.enabled = options.enabled ?? true;
    }

    /**     
     * Update the navigation stars if enabled.
     * @param {Date} deltaTime 
     */
    update(deltaTime) {
        if (!this.enabled) return;
        this.do_update(deltaTime);
    }   

    /**     
     * do_update the navigation stars.
     * @param {Date} deltaTime 
     */
    do_update(deltaTime) {
        /**
         * {CNodeCamera} camera
         * {number} cameraPos
         */
        const camera = NodeMan.get("lookCamera").camera;
        const cameraPos = camera.position;
        const cameraEcef = EUSToECEF(cameraPos);
        const LLA = ECEFToLLAVD_Sphere(cameraEcef);
        CNodeNavStars.NAVIGATION_STARS.forEach(element => {
            const ra = element.ra;
            const dec = element.dec;
            const {az, el} = raDecToAltAz(ra, dec, radians(LLA.x), radians(LLA.y), getJulianDate(deltaTime));
        });
    }   

    /**
     * A list of all 58 Western navigation stars with their RA and Dec in decimal radians.
     * Source: https://en.wikipedia.org/wiki/List_of_navigational_stars
     */
    static NAVIGATION_STARS = [
        { name: "Sirius", ra: 1.767794618, dec: -0.291751285 },
        { name: "Canopus", ra: 1.628571459, dec: -0.739757125 },
        { name: "Arcturus", ra: 4.673993941, dec: 0.152286516 },
        { name: "Alpha Centauri", ra: 3.846034025, dec: -1.234575164 },
        { name: "Vega", ra: 5.278155707, dec: 0.684647151 },
        { name: "Capella", ra: 1.628571459, dec: 0.817979193 },
        { name: "Rigel", ra: 5.242298206, dec: -0.201388155 },
        { name: "Procyon", ra: 2.769953749, dec: 0.093998179 },
        { name: "Achernar", ra: 1.303396329, dec: -1.312997862 },
        { name: "Betelgeuse", ra: 5.919529243, dec: 0.134591287 },
        { name: "Hadar", ra: 3.042998573, dec: -1.018789785 },
        { name: "Altair", ra: 5.137222004, dec: 0.261799388 },
        { name: "Aldebaran", ra: 4.598793286, dec: 0.436332313 },
        { name: "Antares", ra: 4.704017829, dec: -0.381971725 },
        { name: "Spica", ra: 4.888222047, dec: -0.057595865 },
        { name: "Pollux", ra: 3.626865301, dec: 0.227590934 },
        { name: "Fomalhaut", ra: 5.594823732, dec: -0.823129226 },
        { name: "Deneb", ra: 5.588611521, dec: 1.083733173 },
        { name: "Mimosa", ra: 3.042998573, dec: -1.007343575 },
        { name: "Regulus", ra: 4.459033203, dec: 0.174532925 },
        { name: "Adhara", ra: 2.513274123, dec: -0.785398163 },
        { name: "Castor", ra: 3.619591317, dec: 0.261799388 },
        { name: "Gacrux", ra: 3.042998573, dec: -1.221730476 },
        { name: "Bellatrix", ra: 5.418622612, dec: 0.104719755 },
        { name: "Elnath", ra: 4.632971861, dec: 0.261799388 },
        { name: "Miaplacidus", ra: 2.35619449, dec: -1.134464014 },
        { name: "Alnilam", ra: 5.603987194, dec: -0.104719755 },
        { name: "Alnair", ra: 5.061454828, dec: -0.872664626 },
        { name: "Regor", ra: 3.042998573, dec: -1.134464014 },      
        { name: "Alioth", ra: 4.677872407, dec: 0.436332313 },
        { name: "Dubhe", ra: 4.292349157, dec: 0.959931089 },
        { name: "Alkaid", ra: 4.823007625, dec: 0.610865238 },
        { name: "Menkent", ra: 3.042998573, dec: -0.959931089 },
        { name: "Hamal", ra: 2.094395102, dec: 0.174532925 },
        { name: "Kaus Australis", ra: 4.084070449, dec: -0.593411945 },
        { name: "Wezen", ra: 5.033185307, dec: -0.261799388 },
        { name: "Sargas", ra: 4.084070449, dec: -0.436332313 },
        { name: "Alphard", ra: 3.665191429, dec: -0.436332313 },
        { name: "Peacock", ra: 4.974188368, dec: -0.872664626 },
        { name: "Mirfak", ra: 2.618000244, dec: 0.174532925 },
        { name: "Atria", ra: 3.665191429, dec: -1.134464014 },
        { name: "Alsephina", ra: 4.084070449, dec: -0.785398163 },
        { name: "Kochab", ra: 3.141592653, dec: 1.134464014 },
        { name: "Zubenelgenubi", ra: 4.188790205, dec: -0.174532925 },
        { name: "Zubeneschamali", ra: 4.188790205, dec: 0.174532925 },
        { name: "Algol", ra: 3.054326190, dec: 0.261799388 },
        { name: "Alnitak", ra: 5.603987194, dec: -0.139626340 },
        { name: "Mizar", ra: 4.677872407, dec: 0.436332313 },
        { name: "Alcor", ra: 4.677872407, dec: 0.436332313 },
        { name: "Aldebaran", ra: 4.598793286, dec: 0.436332313 },
        { name: "Antares", ra: 4.704017829, dec: -0.381971725 },
        { name: "Spica", ra: 4.888222047, dec: -0.057595865 },
        { name: "Pollux", ra: 3.626865301, dec: 0.227590934 },
        { name: "Fomalhaut", ra: 5.594823732, dec: -0.823129226 },
        { name: "Deneb", ra: 5.588611521, dec: 1.083733173 },
        { name: "Mimosa", ra: 3.042998573, dec: -1.007343575 },
        { name: "Regulus", ra: 4.459033203, dec: 0.174532925 },
        { name: "Adhara", ra: 2.513274123, dec: -0.785398163 },
        { name: "Castor", ra: 3.619591317, dec: 0.261799388 },
    ];

    /**
     * Get the navigation star data by name.
     * @param {string} name - The name of the navigation star.
     * @returns {object|null} The star data with RA and Dec in radians, or null if not found.
     */
    static getStarByName(name) {
        return CNodeNavStars.NAVIGATION_STARS.find(star => star.name.toLowerCase() === name.toLowerCase()) || null;
    }
}

