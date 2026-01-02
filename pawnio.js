/**
 * PawnIO Installation Helper
 * 
 * PawnIO is a scriptable kernel driver required by LibreHardwareMonitor
 * for accessing many hardware sensors (CPU temps, voltages, fan speeds, etc.).
 * 
 * The installer (PawnIO_setup.exe) is bundled in the bin folder and run
 * automatically during Squirrel install/update events.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const _fs = require('fs');

const MIN_VERSION = '2.0.0.0';
const INSTALLER_NAME = 'PawnIO_setup.exe';

/**
 * Check Windows registry for PawnIO installation
 * @returns {Object} { installed: boolean, version: string|null }
 */
function checkRegistry() {
    try {
        // Check both 32-bit and 64-bit registry locations
        const regPaths = [
            'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO',
            'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO'
        ];
        
        for (const regPath of regPaths) {
            try {
                const result = execSync(`reg query "${regPath}" /v DisplayVersion`, {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                // Parse version from registry output
                // Format: "    DisplayVersion    REG_SZ    2.1.0"
                const match = result.match(/DisplayVersion\s+REG_SZ\s+(\d+\.\d+\.\d+(?:\.\d+)?)/i);
                if (match) {
                    return { installed: true, version: match[1] };
                }
            } catch (e) {
                // Registry key doesn't exist at this path, try next
            }
        }
        
        return { installed: false, version: null };
    } catch (err) {
        return { installed: false, version: null };
    }
}

/**
 * Compare semantic versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const maxLen = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLen; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
    }
    return 0;
}

/**
 * Check if PawnIO is installed and meets minimum version
 * @returns {Object} { ok: boolean, installed: boolean, version: string|null, needsUpdate: boolean }
 */
function getStatus() {
    const reg = checkRegistry();
    
    if (!reg.installed) {
        return { ok: false, installed: false, version: null, needsUpdate: false };
    }
    
    const needsUpdate = compareVersions(reg.version, MIN_VERSION) < 0;
    return { 
        ok: !needsUpdate, 
        installed: true, 
        version: reg.version, 
        needsUpdate 
    };
}

/**
 * Find the PawnIO installer path
 * @param {string} basePath - Base path to search from (app path or resources path)
 * @returns {string|null} Path to installer or null if not found
 */
function findInstaller(basePath) {
    // Possible locations depending on packaged vs dev mode
    const searchPaths = [
        path.join(basePath, 'bin', INSTALLER_NAME),
        path.join(basePath, 'resources', 'bin', INSTALLER_NAME),
        path.join(basePath, '..', 'bin', INSTALLER_NAME),
        path.join(basePath, '..', 'resources', 'bin', INSTALLER_NAME),
        // During Squirrel install, paths can be weird
        path.join(path.dirname(basePath), 'resources', 'bin', INSTALLER_NAME),
    ];
    
    for (const p of searchPaths) {
        try {
            if (_fs.existsSync(p)) {
                return p;
            }
        } catch (e) {
            // Continue searching
        }
    }
    
    return null;
}

/**
 * Run PawnIO installation (synchronous for use during Squirrel events)
 * @param {string} basePath - Base path to find the installer
 * @param {function} log - Logging function (async)
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function install(basePath, log = async (msg) => console.log(msg)) {
    const status = getStatus();
    
    // Already installed and up to date
    if (status.ok) {
        await log(`PawnIO v${status.version} already installed`);
        return { success: true, message: `Already installed: v${status.version}` };
    }
    
    // Find installer
    const installerPath = findInstaller(basePath);
    if (!installerPath) {
        await log('PawnIO installer not found in bin folder');
        await log('Searched paths from: ' + basePath);
        return { success: false, message: 'Installer not found' };
    }
    
    await log(`Running PawnIO installer: ${installerPath}`);
    
    return new Promise(async (resolve) => {
        try {
            // Run installer with -install flag for silent installation
            const proc = spawn(installerPath, ['-install'], {
                stdio: 'ignore',
                windowsHide: true
            });
            
            proc.on('close', async (code) => {
                if (code === 0) {
                    // Verify installation
                    const newStatus = getStatus();
                    if (newStatus.ok) {
                        await log(`PawnIO v${newStatus.version} installed successfully`);
                        resolve({ success: true, message: `Installed: v${newStatus.version}` });
                    } else if (newStatus.installed) {
                        await log(`PawnIO installed but version ${newStatus.version} < ${MIN_VERSION}`);
                        resolve({ success: false, message: `Version too old: ${newStatus.version}` });
                    } else {
                        await log('PawnIO installation completed but not detected');
                        resolve({ success: false, message: 'Installation not detected' });
                    }
                } else {
                    await log(`PawnIO installer exited with code ${code}`);
                    resolve({ success: false, message: `Installer exit code: ${code}` });
                }
            });
            
            proc.on('error', async (err) => {
                await log(`PawnIO installer error: ${err.message}`);
                resolve({ success: false, message: err.message });
            });
            
        } catch (err) {
            await log(`Failed to run PawnIO installer: ${err.message}`);
            resolve({ success: false, message: err.message });
        }
    });
}

/**
 * Run PawnIO uninstallation
 * @param {string} basePath - Base path to find the installer
 * @param {function} log - Logging function (async)
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function uninstall(basePath, log = async (msg) => console.log(msg)) {
    const status = getStatus();
    
    if (!status.installed) {
        await log('PawnIO not installed, nothing to uninstall');
        return { success: true, message: 'Not installed' };
    }
    
    const installerPath = findInstaller(basePath);
    if (!installerPath) {
        await log('PawnIO installer not found for uninstall');
        return { success: false, message: 'Installer not found' };
    }
    
    await log(`Running PawnIO uninstaller: ${installerPath}`);
    
    return new Promise(async (resolve) => {
        try {
            const proc = spawn(installerPath, ['-uninstall'], {
                stdio: 'ignore',
                windowsHide: true
            });
            
            proc.on('close', async (code) => {
                await log(`PawnIO uninstaller exited with code ${code}`);
                resolve({ success: code === 0, message: `Exit code: ${code}` });
            });
            
            proc.on('error', async (err) => {
                await log(`PawnIO uninstaller error: ${err.message}`);
                resolve({ success: false, message: err.message });
            });
            
        } catch (err) {
            await log(`Failed to run PawnIO uninstaller: ${err.message}`);
            resolve({ success: false, message: err.message });
        }
    });
}

module.exports = {
    getStatus,
    install,
    uninstall,
    findInstaller,
    MIN_VERSION,
    INSTALLER_NAME
};
