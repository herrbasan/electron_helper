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
 * Check if PawnIO Windows service exists
 * The registry Uninstall key can exist even if the service is missing (broken install).
 * @returns {Object} { exists: boolean, running: boolean }
 */
function checkService() {
    try {
        // Use sc.exe to query the PawnIO service
        const result = execSync('sc.exe query PawnIO', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // If we get here, service exists. Check if it's running.
        const running = result.includes('RUNNING');
        return { exists: true, running };
    } catch (err) {
        // sc.exe returns exit code 1060 when service doesn't exist
        // Any error means service is not properly installed
        return { exists: false, running: false };
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
 * Checks BOTH registry (Uninstall key) AND service existence.
 * Registry alone is not sufficient - the service can be missing even if Uninstall key exists.
 * @returns {Object} { ok: boolean, installed: boolean, version: string|null, needsUpdate: boolean, serviceExists: boolean, serviceRunning: boolean, registryOnly: boolean }
 */
function getStatus() {
    const reg = checkRegistry();
    const svc = checkService();
    
    // If registry says not installed, definitely not installed
    if (!reg.installed) {
        return { 
            ok: false, 
            installed: false, 
            version: null, 
            needsUpdate: false,
            serviceExists: svc.exists,
            serviceRunning: svc.running,
            registryOnly: false
        };
    }
    
    // Registry says installed - but is the service actually there?
    // This catches "broken" installs where Uninstall key exists but service is missing
    if (!svc.exists) {
        return { 
            ok: false, 
            installed: false, // Treat as not installed since service is missing
            version: reg.version,
            needsUpdate: false,
            serviceExists: false,
            serviceRunning: false,
            registryOnly: true // Flag that registry exists but service doesn't
        };
    }
    
    // Both registry and service exist - check version
    const needsUpdate = compareVersions(reg.version, MIN_VERSION) < 0;
    return { 
        ok: !needsUpdate, 
        installed: true, 
        version: reg.version, 
        needsUpdate,
        serviceExists: true,
        serviceRunning: svc.running,
        registryOnly: false
    };
}

/**
 * Find the PawnIO installer path
 * @param {string} basePath - Base path to search from (app path or resources path)
 * @returns {string|null} Path to installer or null if not found
 */
function findInstaller(basePath) {
    const searchPaths = getInstallerSearchPaths(basePath);

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

function getInstallerSearchPaths(basePath) {
    // Possible locations depending on packaged vs dev mode
    return [
        path.join(basePath, 'bin', INSTALLER_NAME),
        path.join(basePath, 'resources', 'bin', INSTALLER_NAME),
        path.join(basePath, '..', 'bin', INSTALLER_NAME),
        path.join(basePath, '..', 'resources', 'bin', INSTALLER_NAME),
        // During Squirrel install, paths can be weird
        path.join(path.dirname(basePath), 'resources', 'bin', INSTALLER_NAME),
    ];
}

async function runInstaller(installerPath, args, log) {
    return new Promise((resolve) => {
        try {
            const proc = spawn(installerPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            proc.stdout?.on('data', (d) => log(String(d).trim()).catch?.(() => {}));
            proc.stderr?.on('data', (d) => log(String(d).trim()).catch?.(() => {}));

            proc.on('close', (code) => resolve({ ok: code === 0, code: code ?? -1 }));
            proc.on('error', async (err) => {
                await log(`Installer spawn error: ${err.message}`);
                resolve({ ok: false, code: -1, error: err });
            });
        } catch (err) {
            log(`Installer run failed: ${err.message}`).catch?.(() => {});
            resolve({ ok: false, code: -1, error: err });
        }
    });
}

async function runInstallerElevated(installerPath, args, log) {
    // UAC prompt if not already elevated.
    const argList = args.map((a) => `\"${a}\"`).join(',');
    const ps = `
$p = Start-Process -FilePath '${installerPath.replace(/'/g, "''")}' -ArgumentList ${argList ? argList : "@()"} -Verb RunAs -Wait -PassThru
exit $p.ExitCode
`.trim();

    await log('Trying elevated install (UAC may prompt)...');

    return new Promise((resolve) => {
        try {
            const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            let stderr = '';
            proc.stdout?.on('data', () => {});
            proc.stderr?.on('data', (d) => { stderr += String(d); });

            proc.on('close', async (code) => {
                if (stderr.trim()) {
                    await log('Elevated stderr: ' + stderr.trim());
                }
                resolve({ ok: code === 0, code: code ?? -1 });
            });
            proc.on('error', async (err) => {
                await log(`Elevated spawn error: ${err.message}`);
                resolve({ ok: false, code: -1, error: err });
            });
        } catch (err) {
            log(`Elevated run failed: ${err.message}`).catch?.(() => {});
            resolve({ ok: false, code: -1, error: err });
        }
    });
}

/**
 * Run PawnIO installation (synchronous for use during Squirrel events)
 * @param {string} basePath - Base path to find the installer
 * @param {function} log - Logging function (async)
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function install(basePath, log = async (msg) => console.log(msg)) {
    const status = getStatus();
    
    // Log detailed status for diagnostics
    await log(`PawnIO status: ok=${status.ok} installed=${status.installed} version=${status.version} serviceExists=${status.serviceExists} serviceRunning=${status.serviceRunning} registryOnly=${status.registryOnly}`);
    
    // Already installed and up to date (both registry AND service are good)
    if (status.ok) {
        await log(`PawnIO v${status.version} already installed and service running`);
        return { success: true, message: `Already installed: v${status.version}`, code: 0 };
    }
    
    // Log why we're installing
    if (status.registryOnly) {
        await log(`PawnIO registry exists (v${status.version}) but service is missing - need to uninstall first then reinstall`);
    } else if (!status.installed) {
        await log('PawnIO not installed - installing');
    } else if (status.needsUpdate) {
        await log(`PawnIO v${status.version} needs update to ${MIN_VERSION}+`);
    }
    
    // Find installer
    const searchPaths = getInstallerSearchPaths(basePath);
    const installerPath = findInstaller(basePath);
    if (!installerPath) {
        await log('PawnIO installer not found in bin folder');
        await log('Base path: ' + basePath);
        await log('Searched paths: ' + searchPaths.join(' | '));
        return { success: false, message: 'Installer not found', code: null };
    }
    
    // If registry exists but service doesn't, we need to uninstall first to clean up
    // Otherwise the installer will refuse with "previous installation found" error
    if (status.registryOnly) {
        await log('Running uninstaller to clean up stale registry...');
        const uninstallResult = await runInstallerElevated(installerPath, ['-uninstall'], log);
        await log(`Uninstall completed with code ${uninstallResult.code}`);
        // Brief pause to let registry cleanup complete
        await new Promise(r => setTimeout(r, 1000));
    }
    
    await log(`Running PawnIO installer: ${installerPath}`);

    // Try normal silent install first
    const first = await runInstaller(installerPath, ['-install'], log);
    if (!first.ok) {
        await log(`PawnIO installer exited with code ${first.code}`);
        // Retry elevated (needed when Squirrel runs unelevated / per-user install)
        const elevated = await runInstallerElevated(installerPath, ['-install'], log);
        if (!elevated.ok) {
            await log(`PawnIO elevated installer exited with code ${elevated.code}`);
            return { success: false, message: `Install failed (code ${elevated.code})`, code: elevated.code };
        }
    }

    // Verify installation
    const newStatus = getStatus();
    await log(`PawnIO post-install status: ok=${newStatus.ok} installed=${newStatus.installed} version=${newStatus.version} serviceExists=${newStatus.serviceExists} serviceRunning=${newStatus.serviceRunning} registryOnly=${newStatus.registryOnly}`);
    
    if (newStatus.ok) {
        await log(`PawnIO v${newStatus.version} installed successfully`);
        return { success: true, message: `Installed: v${newStatus.version}`, code: 0 };
    }
    if (newStatus.registryOnly) {
        await log(`PawnIO registry exists but service still missing after install - may need reboot`);
        return { success: false, message: 'Service not installed (reboot may be required)', code: null };
    }
    if (newStatus.installed) {
        await log(`PawnIO installed but version ${newStatus.version} < ${MIN_VERSION}`);
        return { success: false, message: `Version too old: ${newStatus.version}`, code: null };
    }
    await log('PawnIO installation completed but not detected');
    return { success: false, message: 'Installation not detected', code: null };
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
        return { success: true, message: 'Not installed', code: 0 };
    }
    
    const installerPath = findInstaller(basePath);
    if (!installerPath) {
        await log('PawnIO installer not found for uninstall');
        return { success: false, message: 'Installer not found', code: null };
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
    checkService,
    checkRegistry,
    install,
    uninstall,
    findInstaller,
    getInstallerSearchPaths,
    MIN_VERSION,
    INSTALLER_NAME
};
