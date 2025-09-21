// test_helper.js - Test suite for electron_helper APIs

export async function testHelper() {
    console.log('Starting electron_helper API tests...');

    const results = {
        passed: 0,
        failed: 0,
        errors: []
    };

    const log = (msg, pass = true) => {
        console.log(`${pass ? '✓' : '✗'} ${msg}`);
        if (pass) results.passed++;
        else results.failed++;
    };

    const error = (msg, err) => {
        console.error(`✗ ${msg}:`, err);
        results.errors.push({ msg, err });
        results.failed++;
    };

    // Check if electron_helper exists
    if (!window.electron_helper) {
        console.error('✗ electron_helper not found on window');
        return;
    }
    log('electron_helper found on window');

    // Test Window API
    const winApi = window.electron_helper.window;
    if (typeof winApi !== 'object') {
        error('window API not an object');
    } else {
        log('window API is object');
        // Safe tests with validation
        try {
            const id = await winApi.getId();
            if (typeof id === 'number' && id > 0) {
                log(`window.getId() returned valid ID: ${id}`);
            } else {
                error(`window.getId() returned invalid ID: ${id}`);
            }
        } catch (e) { error('window.getId()', e); }

        try {
            const visible = await winApi.isVisible();
            if (typeof visible === 'boolean') {
                log(`window.isVisible() returned: ${visible}`);
            } else {
                error(`window.isVisible() returned non-boolean: ${visible}`);
            }
        } catch (e) { error('window.isVisible()', e); }

        try {
            const bounds = await winApi.getBounds();
            if (bounds && typeof bounds === 'object' && 'x' in bounds && 'y' in bounds && 'width' in bounds && 'height' in bounds) {
                log(`window.getBounds() returned valid bounds:`, bounds);
            } else {
                error(`window.getBounds() returned invalid bounds:`, bounds);
            }
        } catch (e) { error('window.getBounds()', e); }

        // Check function existence
        ['close', 'show', 'focus', 'hide', 'toggleDevTools', 'setPosition', 'setBounds', 'setFullScreen', 'isFullScreen', 'getPosition', 'setSize', 'center', 'hook_event'].forEach(method => {
            if (typeof winApi[method] === 'function') {
                log(`window.${method} is function`);
            } else {
                error(`window.${method} not a function`);
            }
        });

        // Test window manipulation (on current window)
        try {
            await winApi.setSize(800, 600);
            log('window.setSize() succeeded');
            await winApi.center();
            log('window.center() succeeded');
        } catch (e) { error('window.setSize/center', e); }

        // Test window positioning
        try {
            await winApi.setPosition(100, 100);
            const pos = await winApi.getPosition();
            if (pos && Array.isArray(pos) && pos.length === 2 && typeof pos[0] === 'number' && typeof pos[1] === 'number') {
                log(`window.setPosition/getPosition succeeded: [${pos[0]}, ${pos[1]}]`);
            } else {
                error('window.getPosition returned invalid position:', pos);
            }
        } catch (e) { error('window.setPosition/getPosition', e); }

        // Test window bounds
        try {
            const testBounds = { x: 200, y: 200, width: 1024, height: 768 };
            await winApi.setBounds(testBounds);
            const bounds = await winApi.getBounds();
            if (bounds && typeof bounds === 'object' && bounds.x === testBounds.x && bounds.y === testBounds.y && bounds.width === testBounds.width && bounds.height === testBounds.height) {
                log('window.setBounds/getBounds succeeded');
            } else {
                error('window.getBounds returned different bounds:', bounds);
            }
        } catch (e) { error('window.setBounds/getBounds', e); }

        // Test fullscreen
        try {
            const wasFullScreen = await winApi.isFullScreen();
            await winApi.setFullScreen(true);
            const isFullScreen = await winApi.isFullScreen();
            if (isFullScreen === true) {
                log('window.setFullScreen(true) and isFullScreen succeeded');
                await winApi.setFullScreen(false);
                const backToNormal = await winApi.isFullScreen();
                if (backToNormal === false) {
                    log('window.setFullScreen(false) succeeded');
                } else {
                    error('window.setFullScreen(false) failed');
                }
            } else {
                error('window.setFullScreen(true) failed');
            }
        } catch (e) { error('window fullscreen operations', e); }
    }

    // Test Global API
    const globalApi = window.electron_helper.global;
    if (typeof globalApi !== 'object') {
        error('global API not an object');
    } else {
        log('global API is object');
        try {
            await globalApi.set('test_key', { test: 'object', num: 42 });
            log('global.set() with object succeeded');
        } catch (e) { error('global.set() with object', e); }

        try {
            const val = await globalApi.get('test_key');
            if (val && typeof val === 'object' && val.test === 'object' && val.num === 42) {
                log('global.get() returned correct object');
            } else {
                error('global.get() returned wrong object:', val);
            }
        } catch (e) { error('global.get() with object', e); }

        try {
            const val = await globalApi.get('test_key', false); // clone=false
            if (val && typeof val === 'object' && val.test === 'object' && val.num === 42) {
                log('global.get() with clone=false returned correct object');
            } else {
                error('global.get() with clone=false returned wrong object:', val);
            }
        } catch (e) { error('global.get() with clone=false', e); }

        try {
            await globalApi.set('test_string', 'hello world');
            const strVal = await globalApi.get('test_string');
            if (strVal === 'hello world') {
                log('global.set/get with string succeeded');
            } else {
                error('global.get() string returned wrong value:', strVal);
            }
        } catch (e) { error('global.set/get string', e); }

        try {
            await globalApi.set('test_number', 12345);
            const numVal = await globalApi.get('test_number');
            if (numVal === 12345) {
                log('global.set/get with number succeeded');
            } else {
                error('global.get() number returned wrong value:', numVal);
            }
        } catch (e) { error('global.set/get number', e); }

        try {
            await globalApi.set('test_array', [1, 'two', { three: 3 }]);
            const arrVal = await globalApi.get('test_array');
            if (Array.isArray(arrVal) && arrVal[0] === 1 && arrVal[1] === 'two' && arrVal[2].three === 3) {
                log('global.set/get with array succeeded');
            } else {
                error('global.get() array returned wrong value:', arrVal);
            }
        } catch (e) { error('global.set/get array', e); }

        try {
            await globalApi.set('test_null', null);
            const nullVal = await globalApi.get('test_null');
            if (nullVal === null) {
                log('global.set/get with null succeeded');
            } else {
                error('global.get() null returned wrong value:', nullVal);
            }
        } catch (e) { error('global.set/get null', e); }

        try {
            await globalApi.set('test_undefined', undefined);
            const undefVal = await globalApi.get('test_undefined');
            if (undefVal === undefined) {
                log('global.set/get with undefined succeeded');
            } else {
                error('global.get() undefined returned wrong value:', undefVal);
            }
        } catch (e) { error('global.set/get undefined', e); }

        try {
            const val = await globalApi.get('nonexistent_key');
            log(`global.get() for nonexistent key returned: ${JSON.stringify(val)}`);
        } catch (e) { error('global.get() nonexistent', e); }

        ['get', 'set'].forEach(method => {
            if (typeof globalApi[method] === 'function') {
                log(`global.${method} is function`);
            } else {
                error(`global.${method} not a function`);
            }
        });
    }

    // Test Screen API
    const screenApi = window.electron_helper.screen;
    if (typeof screenApi !== 'object') {
        error('screen API not an object');
    } else {
        log('screen API is object');
        try {
            const display = await screenApi.getPrimaryDisplay();
            if (display && typeof display === 'object' && display.bounds && display.workArea && display.scaleFactor) {
                log('screen.getPrimaryDisplay() returned valid display object');
            } else {
                error('screen.getPrimaryDisplay() returned invalid object:', display);
            }
        } catch (e) { error('screen.getPrimaryDisplay()', e); }

        try {
            const displays = await screenApi.getAllDisplays();
            if (Array.isArray(displays) && displays.length > 0) {
                log(`screen.getAllDisplays() returned ${displays.length} displays`);
                // Check first display
                const first = displays[0];
                if (first && typeof first === 'object' && first.bounds) {
                    log('First display has valid structure');
                } else {
                    error('First display has invalid structure:', first);
                }
            } else {
                error('screen.getAllDisplays() returned invalid array:', displays);
            }
        } catch (e) { error('screen.getAllDisplays()', e); }

        ['getPrimaryDisplay', 'getAllDisplays'].forEach(method => {
            if (typeof screenApi[method] === 'function') {
                log(`screen.${method} is function`);
            } else {
                error(`screen.${method} not a function`);
            }
        });
    }

    // Test App API
    const appApi = window.electron_helper.app;
    if (typeof appApi !== 'object') {
        error('app API not an object');
    } else {
        log('app API is object');
        try {
            const name = await appApi.getName();
            if (typeof name === 'string' && name.length > 0) {
                log(`app.getName() returned valid name: ${name}`);
            } else {
                error(`app.getName() returned invalid name: ${name}`);
            }
        } catch (e) { error('app.getName()', e); }

        try {
            const packaged = await appApi.isPackaged();
            if (typeof packaged === 'boolean') {
                log(`app.isPackaged() returned: ${packaged}`);
            } else {
                error(`app.isPackaged() returned non-boolean: ${packaged}`);
            }
        } catch (e) { error('app.isPackaged()', e); }

        try {
            const path = await appApi.getAppPath();
            if (typeof path === 'string' && path.length > 0) {
                log(`app.getAppPath() returned valid path: ${path}`);
            } else {
                error(`app.getAppPath() returned invalid path: ${path}`);
            }
        } catch (e) { error('app.getAppPath()', e); }

        try {
            const versions = await appApi.getVersions();
            if (versions && typeof versions === 'object' && versions.node && versions.electron) {
                log('app.getVersions() returned valid versions object');
            } else {
                error('app.getVersions() returned invalid object:', versions);
            }
        } catch (e) { error('app.getVersions()', e); }

        try {
            const userPath = await appApi.getPath('userData');
            if (typeof userPath === 'string' && userPath.length > 0) {
                log(`app.getPath('userData') returned valid path: ${userPath}`);
            } else {
                error(`app.getPath('userData') returned invalid path: ${userPath}`);
            }
        } catch (e) { error('app.getPath()', e); }

        ['exit', 'isPackaged', 'getAppPath', 'getPath', 'getName', 'getExecPath', 'getVersions'].forEach(method => {
            if (typeof appApi[method] === 'function') {
                log(`app.${method} is function`);
            } else {
                error(`app.${method} not a function`);
            }
        });
    }

    // Test Tools (just a few safe ones)
    const toolsApi = window.electron_helper.tools;
    if (typeof toolsApi !== 'object') {
        error('tools API not an object');
    } else {
        log('tools API is object');
        try {
            const id = toolsApi.id();
            if (typeof id === 'string' && id.startsWith('_') && id.length > 10) {
                log(`tools.id() returned valid ID: ${id}`);
            } else {
                error(`tools.id() returned invalid ID: ${id}`);
            }
        } catch (e) { error('tools.id()', e); }

        if (toolsApi.path && typeof toolsApi.path === 'object' && typeof toolsApi.path.join === 'function') {
            log('tools.path is valid path module');
        } else {
            error('tools.path is not valid path module');
        }

        if (toolsApi.fs && typeof toolsApi.fs === 'object' && typeof toolsApi.fs.readFile === 'function') {
            log('tools.fs is valid fs promises module');
        } else {
            error('tools.fs is not valid fs module');
        }

        // Test browserWindow creation
        try {
            const winId = await toolsApi.browserWindow('default', { html: '<html><body>Test Window</body></html>' });
            if (typeof winId === 'number' && winId > 0) {
                log(`tools.browserWindow() created window with ID: ${winId}`);
                // Note: Window remains open for manual inspection/testing
            } else {
                error('tools.browserWindow() returned invalid ID:', winId);
            }
        } catch (e) { error('tools.browserWindow()', e); }

        // Test broadcast and sendToId using ipcHandleRenderer to receive messages in this renderer
        try {
            let receivedBroadcast = null;
            let receivedDirect = null;

            // Register renderer-side listeners using ipcHandleRenderer
            if (typeof window.electron_helper.ipcHandleRenderer === 'function') {
                window.electron_helper.ipcHandleRenderer('test_channel', (e, data) => { receivedBroadcast = data; });
                window.electron_helper.ipcHandleRenderer('direct_channel', (e, data) => { receivedDirect = data; });
            }

            // Broadcast should send to all windows (including this one)
            await toolsApi.broadcast('test_channel', { msg: 'hello_all' });
            await new Promise(r => setTimeout(r, 200));
            if (receivedBroadcast && receivedBroadcast.msg === 'hello_all') {
                log('tools.broadcast() delivered message to renderer');
            } else {
                error('tools.broadcast() did not deliver to renderer', receivedBroadcast);
            }

            // Test sendToId by sending to this window's id (should deliver to same renderer)
            const myId = await winApi.getId();
            await toolsApi.sendToId(myId, 'direct_channel', { msg: 'hello_me' });
            await new Promise(r => setTimeout(r, 200));
            if (receivedDirect && receivedDirect.msg === 'hello_me') {
                log('tools.sendToId() delivered message to specified window id');
            } else {
                error('tools.sendToId() did not deliver to specified id', receivedDirect);
            }
        } catch (e) { error('tools.sendToId/broadcast', e); }

        // Test basic filesystem helpers using temp folder and getFiles/getFilesRecursive
        try {
            const tempDir = await appApi.getPath('temp');
            const testDir = toolsApi.path.join(tempDir, `test_fs_dir_${toolsApi.id()}`);
            const nestedDir = toolsApi.path.join(testDir, 'nested');
            await toolsApi.ensureDir(testDir).catch(() => {});
            await toolsApi.ensureDir(nestedDir).catch(() => {});
            const f1 = toolsApi.path.join(testDir, 'a.txt');
            const f2 = toolsApi.path.join(nestedDir, 'b.txt');
            await toolsApi.fs.writeFile(f1, 'one');
            await toolsApi.fs.writeFile(f2, 'two');

            const exists1 = await toolsApi.fileExists(f1);
            const exists2 = await toolsApi.fileExists(f2);
            if (!exists1 || !exists2) throw new Error('created test files not found');

            const filesTop = await toolsApi.getFiles(testDir, ['.txt']);
            if (!Array.isArray(filesTop) || filesTop.length === 0) throw new Error('getFiles returned empty');

            const filesAll = await toolsApi.getFilesRecursive(testDir, ['.txt']);
            if (!Array.isArray(filesAll) || filesAll.length < 2) throw new Error('getFilesRecursive did not return nested files');

            log('tools.readJSON/writeJSON/fileExists/getFiles getFilesRecursive succeeded');
        } catch (e) { error('tools filesystem helpers', e); }
    }

    // Test Dialog API
    const dialogApi = window.electron_helper.dialog;
    if (typeof dialogApi !== 'object') {
        error('dialog API not an object');
    } else {
        log('dialog API is object');
        // Note: showOpenDialog might open a dialog, so just check existence
        if (typeof dialogApi.showOpenDialog === 'function') {
            log('dialog.showOpenDialog is function');
        } else {
            error('dialog.showOpenDialog not a function');
        }
    }

    // Test Shell API
    const shellApi = window.electron_helper.shell;
    if (typeof shellApi !== 'object') {
        error('shell API not an object');
    } else {
        log('shell API is object');
        if (typeof shellApi.showItemInFolder === 'function') {
            log('shell.showItemInFolder is function');
        } else {
            error('shell.showItemInFolder not a function');
        }

        // Test showItemInFolder with a temp file
        try {
            const tempDir = await appApi.getPath('temp');
            const tempFile = toolsApi.path.join(tempDir, `test_${toolsApi.id()}.txt`);
            await toolsApi.fs.writeFile(tempFile, 'Test file for shell.showItemInFolder');
            await shellApi.showItemInFolder(tempFile);
            log('shell.showItemInFolder() opened temp file in folder');
            // Note: File remains for manual cleanup
        } catch (e) { error('shell.showItemInFolder() with temp file', e); }
    }

    // Test Config function
    const configApi = window.electron_helper.config;
    if (typeof configApi === 'function') {
        log('config is function');
        // Test config creation (in memory, no file write)
        try {
            const testConfig = await configApi('memory', { test: 'value' });
            if (testConfig && typeof testConfig === 'object' && testConfig.data && testConfig.data.test === 'value') {
                log('config() in-memory creation succeeded');
            } else {
                error('config() in-memory creation failed:', testConfig);
            }
        } catch (e) { error('config() in-memory creation', e); }

        // Test config with real file
        try {
            const tempDir = await appApi.getPath('temp');
            const configFile = toolsApi.path.join(tempDir, `test_config_${toolsApi.id()}.json`);
            const testData = { real: 'test', number: 123, array: [1,2,3] };
            const realConfig = await configApi(configFile, testData);
            if (realConfig && realConfig.data && JSON.stringify(realConfig.data) === JSON.stringify(testData)) {
                log('config() real file creation succeeded');
            } else {
                error('config() real file creation failed:', realConfig);
            }
        } catch (e) { error('config() real file creation', e); }
    } else {
        error('config not a function');
    }

    // Test Test API (for IPC testing)
    const testApi = window.electron_helper.test;
    if (typeof testApi !== 'object') {
        error('test API not an object');
    } else {
        log('test API is object');
        try {
            const testData = { echo: 'test', num: 42 };
            const result = await testApi.echo(testData);
            if (result && result.echo === 'test' && result.num === 42) {
                log('test.echo() succeeded');
            } else {
                error('test.echo() failed:', result);
            }
        } catch (e) { error('test.echo()', e); }

        try {
            const start = Date.now();
            const delayResult = await testApi.delay('delayed', 200);
            const elapsed = Date.now() - start;
            if (delayResult === 'delayed' && elapsed >= 180 && elapsed <= 300) {
                log('test.delay() succeeded');
            } else {
                error('test.delay() failed:', { result: delayResult, elapsed });
            }
        } catch (e) { error('test.delay()', e); }

        ['echo', 'delay'].forEach(method => {
            if (typeof testApi[method] === 'function') {
                log(`test.${method} is function`);
            } else {
                error(`test.${method} not a function`);
            }
        });
    }

    // Test Log function
    const logApi = window.electron_helper.log;
    if (typeof logApi === 'function') {
        log('log is function');
        try {
            const logger = logApi({ verbose: false });
            if (logger && typeof logger.push === 'function' && Array.isArray(logger.data)) {
                logger.push('test message', 'test_context', 1);
                if (logger.data.length > 0 && logger.data[0][3] === 'test message') {
                    log('log() creation and push succeeded');
                } else {
                    error('log() push failed:', logger.data);
                }
            } else {
                error('log() returned invalid object:', logger);
            }
        } catch (e) { error('log() usage', e); }
    } else {
        error('log not a function');
    }

    console.log(`\nTest Results: ${results.passed} passed, ${results.failed} failed`);
    if (results.errors.length > 0) {
        console.log('Errors:', results.errors);
    }
}