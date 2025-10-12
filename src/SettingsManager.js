// SettingsManager.js
// Handles loading and saving user settings from both cookies and server (S3)

import {Globals} from "./Globals";

// Cookie helper functions for settings
function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
    return document.cookie.split('; ').reduce((r, v) => {
        const parts = v.split('=');
        return parts[0] === name ? decodeURIComponent(parts[1]) : r
    }, null);
}

// Sanitize settings to prevent exploits
export function sanitizeSettings(settings) {
    const sanitized = {};
    
    // Only allow specific known settings with type checking
    if (settings.maxDetails !== undefined) {
        const maxDetails = Number(settings.maxDetails);
        // Clamp to valid range
        sanitized.maxDetails = Math.max(5, Math.min(30, maxDetails));
    }
    
    return sanitized;
}

// Load settings from cookie
export function loadSettingsFromCookie() {
    const cookieValue = getCookie("sitrecSettings");
    if (cookieValue) {
        try {
            const parsed = JSON.parse(cookieValue);
            const sanitized = sanitizeSettings(parsed);
            console.log("Loaded settings from cookie:", sanitized);
            return sanitized;
        } catch (e) {
            console.warn("Failed to parse settings cookie", e);
        }
    }
    return null;
}

// Save settings to cookie
export function saveSettingsToCookie(settings) {
    try {
        const sanitized = sanitizeSettings(settings);
        setCookie("sitrecSettings", JSON.stringify(sanitized), 365); // Save for 1 year
        console.log("Saved settings to cookie:", sanitized);
    } catch (e) {
        console.warn("Failed to save settings cookie", e);
    }
}

// Load settings from server (S3)
export async function loadSettingsFromServer() {
    try {
        const response = await fetch('./sitrecServer/settings.php', {
            method: 'GET',
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            console.warn("Server settings unavailable, status:", response.status);
            return null;
        }
        
        const data = await response.json();
        
        if (data.error) {
            console.warn("Server settings error:", data.error);
            return null;
        }
        
        if (data.settings) {
            const sanitized = sanitizeSettings(data.settings);
            console.log("Loaded settings from server:", sanitized);
            return sanitized;
        }
        
        return null;
    } catch (e) {
        console.warn("Failed to load settings from server:", e);
        return null;
    }
}

// Save settings to server (S3)
export async function saveSettingsToServer(settings) {
    try {
        const sanitized = sanitizeSettings(settings);
        
        const response = await fetch('./sitrecServer/settings.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ settings: sanitized })
        });
        
        if (!response.ok) {
            console.warn("Failed to save settings to server, status:", response.status);
            return false;
        }
        
        const data = await response.json();
        
        if (data.error) {
            console.warn("Server settings save error:", data.error);
            return false;
        }
        
        if (data.success) {
            console.log("Saved settings to server:", data.settings);
            return true;
        }
        
        return false;
    } catch (e) {
        console.warn("Failed to save settings to server:", e);
        return false;
    }
}

/**
 * Initialize settings by loading from server (if logged in) or cookies
 * @returns {Promise<Object>} The loaded settings object
 */
export async function initializeSettings() {
    // Initialize Globals.settings with defaults
    if (!Globals.settings) {
        Globals.settings = {
            maxDetails: 15 // Default value
        };
    }
    
    // Try to load from server first (if logged in)
    if (Globals.userID > 0) {
        const serverSettings = await loadSettingsFromServer();
        if (serverSettings && Object.keys(serverSettings).length > 0) {
            Object.assign(Globals.settings, serverSettings);
            console.log("Using server settings");
            return Globals.settings;
        }
    }
    
    // Fall back to cookie if server unavailable or user not logged in
    const savedSettings = loadSettingsFromCookie();
    if (savedSettings) {
        Object.assign(Globals.settings, savedSettings);
        console.log("Using cookie settings");
    }
    
    return Globals.settings;
}

/**
 * Save settings to server (if logged in) and/or cookies
 * @param {Object} settings - The settings object to save
 * @returns {Promise<boolean>} True if saved successfully
 */
export async function saveSettings(settings) {
    // Try to save to server first (if logged in)
    if (Globals.userID > 0) {
        const success = await saveSettingsToServer(settings);
        if (success) {
            console.log("Settings saved to server");
            // Also save to cookie as backup
            saveSettingsToCookie(settings);
            return true;
        }
    }
    
    // Fall back to cookie if server unavailable or user not logged in
    saveSettingsToCookie(settings);
    console.log("Settings saved to cookie only");
    return true;
}

/**
 * SettingsSaver - Encapsulates intelligent debouncing logic for settings saves
 * 
 * This class manages the timing and debouncing of settings saves to prevent
 * server overload during rapid UI changes (like slider dragging) while ensuring
 * responsive saves when appropriate.
 * 
 * Features:
 * - Saves immediately if no recent save occurred (> delay period)
 * - Automatically debounces when saves occur within the delay period
 * - Supports force immediate saves via optional parameter
 * - Calculates optimal remaining delay for scheduled saves
 * 
 * Usage:
 *   const saver = new SettingsSaver();
 *   await saver.save();           // Intelligent save (immediate or debounced)
 *   await saver.save(true);        // Force immediate save
 */
export class SettingsSaver {
    /**
     * Create a new SettingsSaver
     * @param {number} delay - Minimum milliseconds between saves (default: 5000)
     */
    constructor(delay = 5000) {
        this.lastSaveTime = 0;
        this.saveTimer = null;
        this.saveDelay = delay;
    }
    
    /**
     * Save settings with intelligent debouncing
     * - Saves immediately if no recent save (> delay period ago)
     * - Schedules a delayed save if saved recently (< delay period ago)
     * - Ensures final value is always saved
     * 
     * @param {boolean} immediate - Force immediate save, bypassing debounce
     * @returns {Promise<boolean>} True if saved successfully
     */
    async save(immediate = false) {
        const now = Date.now();
        const timeSinceLastSave = now - this.lastSaveTime;
        
        // If immediate flag is set, cancel any pending save and save now
        if (immediate) {
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
                this.saveTimer = null;
            }
            this.lastSaveTime = now;
            return await saveSettings(Globals.settings);
        }
        
        // If enough time has passed since last save, save immediately
        if (timeSinceLastSave >= this.saveDelay) {
            this.lastSaveTime = now;
            return await saveSettings(Globals.settings);
        }
        
        // Otherwise, schedule a delayed save (debounce)
        // Clear any existing timer
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // Schedule save for when the delay period expires
        const remainingDelay = this.saveDelay - timeSinceLastSave;
        this.saveTimer = setTimeout(async () => {
            this.lastSaveTime = Date.now();
            await saveSettings(Globals.settings);
            this.saveTimer = null;
        }, remainingDelay);
        
        return true; // Scheduled successfully
    }
    
    /**
     * Cancel any pending save
     */
    cancel() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }
    
    /**
     * Check if a save is currently scheduled
     * @returns {boolean} True if a save is pending
     */
    isPending() {
        return this.saveTimer !== null;
    }
}