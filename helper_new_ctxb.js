'use strict';

const context_type = process.type;
const version = '2.0.0 - 2025_09_23';

const optionalRequireMissing = new Set();
const rendererDisallowedModules = new Set(['fs', 'path', 'https', 'http', 'child_process']);

const optionalRequire = (name) => {
	if (context_type !== 'browser' && rendererDisallowedModules.has(name)) {
		return null;
	}
	if (typeof require !== 'function') {
		return null;
	}
	try {
		return require(name);
	}
	catch (err) {
		const shouldWarn = context_type === 'browser' || !rendererDisallowedModules.has(name);
		if (shouldWarn && !optionalRequireMissing.has(name)) {
			optionalRequireMissing.add(name);
			console.warn(`[helper_new_ctxb] optional module "${name}" unavailable`, err && err.message ? err.message : err);
		}
	}
	return null;
};

// Install process-level handlers early (preload) to surface uncaught exceptions/rejections
try {
	if (typeof process !== 'undefined' && process) {
		process.on && process.on('uncaughtException', (err) => {
			try { console.error('Renderer process uncaughtException:', err && (err.stack || err)); } catch(e){}
		});
		process.on && process.on('unhandledRejection', (reason) => {
			try { console.error('Renderer process unhandledRejection:', reason && (reason.stack || reason)); } catch(e){}
		});
	}
} catch (e) {}

const electron = optionalRequire('electron') || {};

let {
	app,
	net,
	protocol,
	ipcMain,
	ipcRenderer,
	BrowserWindow,
	screen,
	dialog,
	shell,
	contextBridge
} = electron;

if ((!ipcRenderer || typeof ipcRenderer !== 'object') && typeof require === 'function') {
	try {
		const electronFallback = require('electron');
		if (electronFallback && electronFallback.ipcRenderer) {
			ipcRenderer = electronFallback.ipcRenderer;
		}
		if (!contextBridge && electronFallback && electronFallback.contextBridge) {
			contextBridge = electronFallback.contextBridge;
		}
	}
	catch (err) {
		// ignore
	}
}
const _fs = optionalRequire('fs');
const fs = _fs ? _fs.promises : null;

const path = optionalRequire('path');
const https = optionalRequire('https');
const http = optionalRequire('http');
const child_process = optionalRequire('child_process');

const urlModule = optionalRequire('url') || {};
const { pathToFileURL } = urlModule;
const tools = {};

const FS_BRIDGE_CHANNEL = 'helper_ctxb:fs';
const PATH_BRIDGE_CHANNEL = 'helper_ctxb:path:sync';
const hasPath = !!path;
const hasFs = !!fs;

let cachedIpcRenderer = ipcRenderer || null;
const getIpcRenderer = () => {
	if (cachedIpcRenderer) {
		return cachedIpcRenderer;
	}
	if (typeof ipcRenderer !== 'undefined' && ipcRenderer) {
		cachedIpcRenderer = ipcRenderer;
		return cachedIpcRenderer;
	}
	if (typeof electron !== 'undefined' && electron && electron.ipcRenderer) {
		cachedIpcRenderer = electron.ipcRenderer;
		if (cachedIpcRenderer) return cachedIpcRenderer;
	}
	if (typeof require === 'function') {
		try {
			const mod = require('electron');
			if (mod && mod.ipcRenderer) {
				cachedIpcRenderer = mod.ipcRenderer;
				return cachedIpcRenderer;
			}
		}
		catch (err) {
			// ignore
		}
	}
	if (typeof globalThis !== 'undefined' && globalThis.ipcRenderer) {
		cachedIpcRenderer = globalThis.ipcRenderer;
	}
	return cachedIpcRenderer;
};

const requireIpcRenderer = () => {
	const ipc = getIpcRenderer();
	if (!ipc) {
		throw new Error('ipcRenderer unavailable in this context');
	}
	return ipc;
};
const hasIpcMain = !!ipcMain;

const invokeFsBridge = async (command, args={}) => {
	const ipc = requireIpcRenderer();
	const res = await ipc.invoke(FS_BRIDGE_CHANNEL, {command, args});
	if (!res || res.status === false) {
		const err = res && res.error ? res.error : `fs bridge command failed: ${command}`;
		throw new Error(err);
	}
	return res.data;
};

const createFsBridgeProxy = () => ({
	access: (fp, mode) => invokeFsBridge('access', {fp, mode}),
	mkdir: (fp, options) => invokeFsBridge('mkdir', {fp, options}),
	readFile: (fp, options) => invokeFsBridge('readFileRaw', {fp, options}),
	writeFile: (fp, data, options) => invokeFsBridge('writeFileRaw', {fp, data, options}),
	readdir: (fp, options) => invokeFsBridge('readdirSimple', {fp, options}),
	unlink: (fp) => invokeFsBridge('unlink', {fp}),
	rename: (oldPath, newPath) => invokeFsBridge('rename', {oldPath, newPath})
});

const invokePathBridgeSync = (command, args={}) => {
	const ipc = requireIpcRenderer();
	const res = ipc.sendSync(PATH_BRIDGE_CHANNEL, {command, args});
	if (!res || res.status === false) {
		const err = res && res.error ? res.error : `path bridge command failed: ${command}`;
		throw new Error(err);
	}
	return res.data;
};

const createPathBridgeProxy = () => {
	let constantsCache = null;
	const getConstant = (name) => {
		if (!constantsCache) {
			constantsCache = invokePathBridgeSync('constants');
		}
		return constantsCache ? constantsCache[name] : undefined;
	};
	return {
		join: (...segments) => invokePathBridgeSync('join', {segments}),
		dirname: (fp) => invokePathBridgeSync('dirname', {fp}),
		resolve: (...segments) => invokePathBridgeSync('resolve', {segments}),
		normalize: (fp) => invokePathBridgeSync('normalize', {fp}),
		basename: (fp, ext) => invokePathBridgeSync('basename', {fp, ext}),
		extname: (fp) => invokePathBridgeSync('extname', {fp}),
		isAbsolute: (fp) => invokePathBridgeSync('isAbsolute', {fp}),
		relative: (from, to) => invokePathBridgeSync('relative', {from, to}),
		parse: (fp) => invokePathBridgeSync('parse', {fp}),
		get sep() { return getConstant('sep'); },
		get delimiter() { return getConstant('delimiter'); }
	};
};

let fnc_window = {};
let fnc_global = {};
let fnc_screen = {};
let fnc_app = {};
let fnc_dialog = {};
let fnc_shell = {};
let rendererExportsRef = null;

if (hasPath && path) {
	tools.path = path;
} else {
	tools.path = createPathBridgeProxy();
}

if (hasFs && fs) {
	tools.fs = fs;
} else {
	tools.fs = createFsBridgeProxy();
}

const requireFsApi = () => {
	const fsApi = tools.fs || null;
	if (!fsApi) {
		throw new Error('electron_helper: filesystem access is unavailable in this context');
	}
	return fsApi;
};

const normalizeDirent = (entry) => {
	if (!entry) {
		return {
			name: '',
			isFile: () => false,
			isDirectory: () => false,
			isSymbolicLink: () => false
		};
	}
	if (typeof entry.isFile === 'function' && typeof entry.isDirectory === 'function') {
		return entry;
	}
	const hasBoolean = (key) => (entry && Object.prototype.hasOwnProperty.call(entry, key)) ? !!entry[key] : false;
	return {
		name: entry.name,
		isFile: () => hasBoolean('isFile'),
		isDirectory: () => hasBoolean('isDirectory'),
		isSymbolicLink: () => hasBoolean('isSymbolicLink')
	};
};
/**
 * Resolve the BrowserWindow target for a window API call.
 * If req.id is provided (allow id===0) use BrowserWindow.fromId(id), otherwise
 * use the sender's webContents. Throws on failure so callers can rely on it.
 */
function getTargetWindow(e, req){
	if(req && (req.id || req.id === 0)){
		const byId = BrowserWindow.fromId(req.id);
		if(!byId) throw new Error('window not found (id=' + req.id + ')');
		return byId;
	}
	const sender = e && e.sender;
	const bw = BrowserWindow.fromWebContents(sender);
	if(!bw) throw new Error('window not found for sender');
	return bw;
}

function exposeRendererApi(api){
	if(!api) { return; }
	if(contextBridge && typeof contextBridge.exposeInMainWorld === 'function'){
		contextBridge.exposeInMainWorld('electron_helper', api);
	}
	else if(typeof window !== 'undefined') {
		window.electron_helper = api;
	}
}

async function init(){
	if(context_type == 'browser'){
		protocol.registerSchemesAsPrivileged([{ scheme: 'raum', privileges: { secure: false, standard:true, stream:true, bypassCSP: true, supportFetchAPI:true } }]);
		await app.whenReady();
		mainInit();
	}
	else {
		fb('Helper Remote Init' + version);
		// Install renderer window error handlers to forward useful stacks to main terminal
		try {
			if (typeof window !== 'undefined' && window) {
				window.addEventListener('error', (ev) => {
					console.error('Renderer window error:', ev && ev.message, ev && ev.error && ev.error.stack ? ev.error.stack : ev.error);
				});
				window.addEventListener('unhandledrejection', (ev) => {
					console.error('Renderer unhandledRejection:', ev && ev.reason && (ev.reason.stack || ev.reason));
				});
			}
		} catch (err) {
			console.error('Failed to install renderer error handlers', err);
		}
		rendererExportsRef = initApis();
		exposeRendererApi(rendererExportsRef);
		//ipcRenderer.on('log', (e, msg) => { console.log(e.senderId, msg) });
	}
}

async function mainInit(){
	fb('Helper Main Init ' + version)
	initApis();
	log(); // set up log_push handler
	ipcMain.handle('tools', toolsCommand);
	if (ipcMain && hasFs) {
		try {
			ipcMain.handle(FS_BRIDGE_CHANNEL, fsBridgeHandler);
		}
		catch (err) {
			fb('Failed to register fs bridge handler: ' + err, 'helper');
		}
	}
	if (ipcMain && hasPath) {
		try {
			if (ipcMain.listenerCount(PATH_BRIDGE_CHANNEL) === 0) {
				ipcMain.on(PATH_BRIDGE_CHANNEL, pathBridgeHandlerSync);
			}
		}
		catch (err) {
			fb('Failed to register path bridge handler: ' + err, 'helper');
		}
	}


	if(protocol.registerFileProtocol){
		fb('Register File Protocol: raum')
		protocol.registerFileProtocol('raum', (request, callback) => {
			let furl = request.url.slice('raum:////'.length);
			callback(decodeURI(tools.path.normalize(furl)))
		})
	}
	else {
		fb('Handle File Protocol: raum')
		protocol.handle('raum', (request) => {
			let furl = request.url.slice('raum://'.length);
			furl = decodeURI(tools.path.normalize(furl));
			furl = pathToFileURL(furl).toString();
			return net.fetch(furl);
		})
	}
	
	tools.user_data = app.getPath('userData');
	tools.temp_path = tools.path.join(tools.user_data, 'temp');
	let req = await tools.ensureDir(tools.temp_path);
	
	fb('Helper Temp Dir ' + req);
	app.on('will-quit', exitApp);
}

async function exitApp(e){
	e.preventDefault();
	app.off('will-quit', exitApp)
	await tools.cleanUpTemp(true);
	app.exit();
}


/* IPC - Inter-Process Communication Utilities
###################################################################################
###################################################################################
 * Low-level utilities for Electron IPC. ipcHandle sets up endpoints in main process first,
 * then ipcInvoke calls them from renderer. ipcHandleRenderer listens for events.
 */
function ipcHandle(name, fnc){
    fb('Init Channel on Main: ' + name);
    ipcMain.handle(name, (e, req) => {
        return fnc(e, name, req);
    })
}

let ipcInvoke = async (name, payload) => { 
	const ipc = requireIpcRenderer();
	return await ipc.invoke(name, payload);
};

function ipcHandleRenderer(channel, fnc){
	console.log('Init Channel on Renderer: ' + channel);
	const ipc = requireIpcRenderer();
	ipc.on(channel, fnc);
}



/* Unified API Initialization
################################################################################### */
function initApis() {
    if (context_type == 'browser') {
        // Main Process: Define APIs with handle functions
        const apis = {
			window: {
					close: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.close(); return {status:true}; } },
					show: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.show(); return {status:true}; } },
					focus: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.focus(); return {status:true}; } },
					hide: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.hide(); return {status:true}; } },
					toggleDevTools: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.toggleDevTools(); return {status:true}; } },
					setPosition: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.setPosition(req.data.x, req.data.y); return {status:true}; } },
					setBounds: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.setBounds(req.data); return {status:true}; } },
					setFullScreen: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.setFullScreen(req.data); return {status:true}; } },
					isFullScreen: { handle: (e, req) => { const bw = getTargetWindow(e, req); return bw.isFullScreen(); } },
					isVisible: { handle: (e, req) => { const bw = getTargetWindow(e, req); return bw.isVisible(); } },
					getBounds: { handle: (e, req) => { const bw = getTargetWindow(e, req); return bw.getBounds(); } },
					getPosition: { handle: (e, req) => { const bw = getTargetWindow(e, req); return bw.getPosition(); } },
					getId: { handle: (e, req) => { const bw = getTargetWindow(e, req); return bw.id; } },
					setSize: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.setSize(req.data.width, req.data.height); return {status:true}; } },
					center: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.center(); return {status:true}; } },
					minimize: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.minimize(); return {status:true}; } },
					isMinimized: { handle: (e, req) => { const bw = getTargetWindow(e, req); return bw.isMinimized(); } },
					restore: { handle: (e, req) => { const bw = getTargetWindow(e, req); bw.restore(); return {status:true}; } },
					hook_event: { handle: (e, req) => { fb('Hooked Event: ' + req.data); const bw = getTargetWindow(e, req); bw.on(req.data, (_event, _data) => { bw.webContents.send('window_event' + req.event_id, {type:req.data, data:_data}); }); return {status:true}; } }
				},
            global: {
                get: {
                    handle: (e, req) => {
						// Mirror behavior of helper.js: use Node `global` storage.
						let reply = {status:true};
						const val = (typeof global !== 'undefined' && Object.prototype.hasOwnProperty.call(global, req.name)) ? global[req.name] : undefined;
						if (req.clone) {
							try {
								// If the key doesn't exist on the main `global`, return a special
								// marker so renderer can distinguish missing -> undefined vs null.
								if (!Object.prototype.hasOwnProperty.call(global, req.name)) {
									reply.data = JSON.stringify({__missing: true});
								} else {
									const stored = global[req.name];
									if (typeof stored === 'undefined') {
										reply.data = JSON.stringify({__undefined: true});
									} else {
										reply.data = JSON.stringify(stored);
									}
								}
							} catch (err) {
								reply.data = JSON.stringify({error: String(err)});
							}
						} else {
							reply.data = val;
						}
						return reply;
                    }
                },
                set: {
                    handle: (e, req) => {
				// Store on Node `global` object to match helper.js semantics
				let value = req.data;
				// If renderer sent a special marker for undefined/null, restore it
				if (value && typeof value === 'object' && value.__is_marker) {
					if (value.__undefined) value = undefined;
					else if (value.__null) value = null;
				}
				global[req.name] = value;
				return {status:true};
                    }
                }
            },
            screen: {
                getPrimaryDisplay: {
                    handle: (e, req) => {
                        return {status:true, data: JSON.stringify(screen.getPrimaryDisplay())};
                    }
                },
                getAllDisplays: {
                    handle: (e, req) => {
                        return {status:true, data: JSON.stringify(screen.getAllDisplays())};
                    }
                }
            },
            app: {
                exit: {
                    handle: (e, req) => {
                        tools.cleanUpTemp(true).then(app.exit);
                        return {status:true};
                    }
                },
                isPackaged: {
                    handle: (e, req) => app.isPackaged
                },
                getAppPath: {
                    handle: (e, req) => app.getAppPath()
                },
                getPath: {
                    handle: (e, req) => app.getPath(req.name)
                },
                getName: {
                    handle: (e, req) => app.getName()
                },
				getExecPath: {
					handle: (e, req) => {
						var ar = process.execPath.split(tools.path.sep);
						ar.length -= 2;
						return ar.join(tools.path.sep) + tools.path.sep;
					}
				},
                getVersions: {
                    handle: (e, req) => JSON.parse(JSON.stringify(process.versions))
                }
            },
            dialog: {
                showOpenDialog: {
                    handle: async (e, req) => await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), req.data)
                }
            },
            shell: {
                showItemInFolder: {
                    handle: (e, req) => shell.showItemInFolder(req.data)
                }
            },
        };
        // Set up IPC handlers
        for (let api in apis) {
            ipcMain.handle(api, (e, req) => {
                let command = req.command;
                if (apis[api][command]) {
                    return apis[api][command].handle(e, req);
                }
                return {status: false};
            });
        }
		return null;
    } else {
        // Renderer Process: Define APIs with invoke functions
        const renderer = {
            window: {
				close: () => ipcInvoke('window', {command:'close'}),
				show: () => ipcInvoke('window', {command:'show'}),
			focus: (id) => ipcInvoke('window', {command:'focus', id: typeof id !== 'undefined' ? id : undefined}),
				hide: () => ipcInvoke('window', {command:'hide'}),
				toggleDevTools: () => ipcInvoke('window', {command:'toggleDevTools'}),
				setPosition: (x, y) => ipcInvoke('window', {command:'setPosition', data:{x:x, y:y}}),
				setBounds: (arg) => ipcInvoke('window', {command:'setBounds', data:arg}),
				setFullScreen: (arg) => ipcInvoke('window', {command:'setFullScreen', data:arg}),
				isFullScreen: () => ipcInvoke('window', {command:'isFullScreen'}),
				isVisible: () => ipcInvoke('window', {command:'isVisible'}),
				getBounds: () => ipcInvoke('window', {command:'getBounds'}),
				getPosition: () => ipcInvoke('window', {command:'getPosition'}),
				getId: () => ipcInvoke('window', {command:'getId'}),
				setSize: (width, height) => ipcInvoke('window', {command:'setSize', data:{width:width, height:height}}),
				center: () => ipcInvoke('window', {command:'center'}),
				minimize: () => ipcInvoke('window', {command:'minimize'}),
				isMinimized: () => ipcInvoke('window', {command:'isMinimized'}),
				restore: () => ipcInvoke('window', {command:'restore'}),
                hook_event: async (event_name, cb) => {
                    let event_id = tools.id();
					let temp = await ipcInvoke('window', {command:'hook_event', data:event_name, event_id:event_id});
                    if(temp && temp.status === false){ return temp; }
					const ipc = requireIpcRenderer();
					ipc.on('window_event' + event_id, cb);
                    return {status:true, event_id};
                }
            },
			global: {
				get: async (name, clone=true) => { 
					let req = await ipcInvoke('global', {command:'get', name:name, clone:clone});
					let out = {};
					if(clone){
						try {
							out = JSON.parse(req.data);
							// Interpret main-side markers for missing/undefined
							if (out && typeof out === 'object'){
								if (out.__missing === true || out.__undefined === true) out = undefined;
							}
						}
						catch(error){
							out = {error:error};
						}
					}
					else {
						out = req.data;
					}
					return out;
				},
				set: async (name, data) => {
					let payload = data;
					if (typeof data === 'undefined') {
						payload = {__is_marker: true, __undefined: true};
					}
					return await ipcInvoke('global', {command:'set', name:name, data:payload});
				}
			},
            screen: {
                getPrimaryDisplay: async () => {
			let req = await ipcInvoke('screen', {command:'getPrimaryDisplay'});
                    return JSON.parse(req.data);
                },
                getAllDisplays: async () => {
			let req = await ipcInvoke('screen', {command:'getAllDisplays'});
                    return JSON.parse(req.data);
                }
            },
            app: {
				exit: () => ipcInvoke('app', {command:'exit'}),
				isPackaged: () => ipcInvoke('app', {command:'isPackaged'}),
				getAppPath: () => ipcInvoke('app', {command:'getAppPath'}),
				getPath: (name) => ipcInvoke('app', {command:'getPath', name:name}),
				getName: () => ipcInvoke('app', {command:'getName'}),
				getExecPath: () => ipcInvoke('app', {command:'getExecPath'}),
				getVersions: () => ipcInvoke('app', {command:'getVersions'})
            },
            dialog: {
				showOpenDialog: async (options) => ipcInvoke('dialog', {command:'showOpenDialog', data:options})
            },
            shell: {
				showItemInFolder: async (fp) => ipcInvoke('shell', {command:'showItemInFolder', data:fp})
            }
        };

		fnc_window = renderer.window;
		fnc_global = renderer.global;
		fnc_screen = renderer.screen;
		fnc_app = renderer.app;
		fnc_dialog = renderer.dialog;
		fnc_shell = renderer.shell;

		const rendererExp = {
			window		: fnc_window,
			global		: fnc_global,
			screen 		: fnc_screen,
			app		: fnc_app,
			dialog		: fnc_dialog,
			shell		: fnc_shell,
			tools		: tools,
			ipcInvoke	: ipcInvoke,
			ipcHandle	: ipcHandle,
			config		: config,
			log		: log,
			ipcHandleRenderer: ipcHandleRenderer,
			setGlobal	: (name, data) => { if (typeof global !== 'undefined') global[name] = data; }
		};

		return rendererExp;
    }
}

function config(fp, obj, force){
	return new Promise(async (resolve, reject) => {
		if(fp === 'memory'){
			let cnf = {};
			cnf.data = obj;
			cnf.backup = JSON.stringify(obj);
			cnf.writeFile = () => {}; // no-op for in-memory
			cnf.write = () => {}; // no-op
			// no interval set for in-memory
			resolve(cnf);
			return;
		}
		const fsApi = requireFsApi();
		let up;
		if(context_type == 'browser'){ up = app.getPath('userData') }
		else { up = await fnc_app.getPath('userData'); }

		let cnf = {};
		cnf.data = obj;
		cnf.backup = JSON.stringify(obj);

		if(fp === 'user'){ fp = tools.path.join(up, 'config.json'); }
		cnf.path = fp;
		const backupPath = fp + '.bak';

		if(force){ await fsApi.unlink(fp).catch(() => {}); await fsApi.unlink(backupPath).catch(() => {}); }

		cnf.writeFile = async () => { 
			const currentStr = JSON.stringify(cnf.data);
			if(currentStr != cnf.backup){
				fb('Writing Config')
				try {
					if(await tools.fileExists(fp)){
						const existing = await tools.readJSON(fp);
						if(JSON.stringify(existing) !== currentStr){
							await tools.writeJSON(backupPath, existing);
							fb('Config backup created');
						}
					}
				} catch (e) { fb('Failed to create config backup: ' + e.message); }
				cnf.backup = currentStr;
				return tools.writeJSON(cnf.path, cnf.data);
			}
		};

		cnf.write = () => {
			clearTimeout(cnf.timeout);
			cnf.timeout = setTimeout(cnf.writeFile, 500)
		}
		cnf.interval = setInterval(cnf.write, 3000);

		if(!(await tools.fileExists(fp))){
			await tools.writeJSON(fp, cnf.data);
			resolve( cnf );
		}
		else {
			let loadedData = null;
			try {
				loadedData = await tools.readJSON(fp);
				if(!loadedData || (typeof loadedData === 'object' && Object.keys(loadedData).length === 0)){
					throw new Error('Config file is empty');
				}
				JSON.stringify(loadedData);
			} catch (e) {
				fb('Config file corrupted or empty, attempting restore from backup: ' + e.message);
				try {
					loadedData = await tools.readJSON(backupPath);
					await tools.writeJSON(fp, loadedData);
					fb('Config restored from backup');
				} catch (backupErr) {
					fb('Backup restore failed: ' + backupErr.message + ', using default config');
					loadedData = obj; // fallback to provided obj
				}
			}
			cnf.data = loadedData;
			resolve( cnf );
		}
	})
}


async function toolsCommand(e, req){
	let command = req.command;
	let reply = {status:false};
	
	if(command == 'newWindow'){
		let nw = await tools.browserWindow(req.data.template, req.data.options);
		reply = nw.id || nw;
	}
	if(command == 'sendToId'){
		tools.sendToId(req.data.id, req.data.channel, req.data.data);
		reply.status = true;
	}
	if(command == 'broadcast'){
		reply = tools.broadcast(req.data.channel, req.data.data);
		reply.status = true;
	}
	if(command == 'download'){
		reply = tools.download(req.data.url, req.data.file, (prog) => { e.sender.send(req.data.ticket, prog)});
	}
	return reply;
}

async function fsBridgeHandler(event, payload={}){
	if (!hasFs || !fs) {
		return {status:false, error:'fs module unavailable in main process'};
	}
	const { command, args={} } = payload;
	try {
		switch(command){
			case 'access':
				await fs.access(args.fp, args.mode);
				return {status:true, data:true};
			case 'mkdir':
				await fs.mkdir(args.fp, args.options);
				return {status:true, data:true};
			case 'readFileRaw':
				return {status:true, data: await fs.readFile(args.fp, args.options)};
			case 'writeFileRaw':
				await fs.writeFile(args.fp, args.data, args.options);
				return {status:true, data:true};
			case 'readdirSimple': {
				const options = args.options || {};
				const entries = await fs.readdir(args.fp, options);
				if (options.withFileTypes) {
					const serialized = entries.map((dirent) => ({
						name: dirent.name,
						isFile: dirent.isFile(),
						isDirectory: dirent.isDirectory(),
						isSymbolicLink: dirent.isSymbolicLink ? dirent.isSymbolicLink() : false,
						isBlockDevice: dirent.isBlockDevice ? dirent.isBlockDevice() : false,
						isCharacterDevice: dirent.isCharacterDevice ? dirent.isCharacterDevice() : false,
						isFIFO: dirent.isFIFO ? dirent.isFIFO() : false,
						isSocket: dirent.isSocket ? dirent.isSocket() : false
					}));
					return {status:true, data: serialized};
				}
				return {status:true, data: entries};
			}
			case 'unlink':
				await fs.unlink(args.fp);
				return {status:true, data:true};
			case 'rename':
				await fs.rename(args.oldPath, args.newPath);
				return {status:true, data:true};
			case 'fileExists': {
				let exists = true;
				try { await fs.access(args.fp); }
				catch { exists = false; }
				return {status:true, data:exists};
			}
			case 'ensureDir': {
				try {
					await fs.access(args.fp);
					return {status:true, data:'there already'};
				}
				catch {
					await fs.mkdir(args.fp);
					return {status:true, data:'folder created'};
				}
			}
			case 'readJSON': {
				const data = await fs.readFile(args.fp, 'utf8');
				return {status:true, data: JSON.parse(data)};
			}
			case 'writeJSON':
				await fs.writeFile(args.fp, JSON.stringify(args.data, null, 4));
				return {status:true, data:true};
			case 'getFiles':
				return {status:true, data: await tools.getFiles(args.fp, args.filter)};
			case 'getFilesRecursive':
				return {status:true, data: await tools.getFilesRecursive(args.fp, args.filter)};
			default:
				return {status:false, error:'Unknown fs bridge command: ' + command};
		}
	}
	catch (err) {
		return {status:false, error: err && err.message ? err.message : String(err)};
	}
}

function pathBridgeHandlerSync(event, payload={}){
	if (!hasPath || !path) {
		event.returnValue = {status:false, error:'path module unavailable in main process'};
		return;
	}
	const { command, args={} } = payload;
	try {
		let data;
		switch(command){
			case 'join':
				data = tools.path.join(...(Array.isArray(args.segments) ? args.segments : []));
				break;
			case 'dirname':
				data = tools.path.dirname(args.fp);
				break;
			case 'resolve':
				data = tools.path.resolve(...(Array.isArray(args.segments) ? args.segments : []));
				break;
			case 'normalize':
				data = tools.path.normalize(args.fp);
				break;
			case 'basename':
				data = tools.path.basename(args.fp, args.ext);
				break;
			case 'extname':
				data = tools.path.extname(args.fp);
				break;
			case 'isAbsolute':
				data = tools.path.isAbsolute(args.fp);
				break;
			case 'relative':
				data = tools.path.relative(args.from || '', args.to || '');
				break;
			case 'parse':
				data = tools.path.parse(args.fp);
				break;
			case 'constants':
				data = { sep: tools.path.sep, delimiter: tools.path.delimiter };
				break;
			default:
				event.returnValue = {status:false, error:'Unknown path bridge command: ' + command};
				return;
		}
		event.returnValue = {status:true, data};
	}
	catch (err) {
		event.returnValue = {status:false, error: err && err.message ? err.message : String(err)};
	}
}


/* Tools
###################################################################################
################################################################################### */

tools.browserWindow = (template='default', options) => {
	return new Promise(async (resolve, reject) => {
		if(context_type == 'browser'){
			let win;
			let win_options = { 
				webPreferences: {
					contextIsolation: true,
					nodeIntegration:false,
					webSecurity: false,
					backgroundThrottling: false, 
					allowRunningInsecureContent:true,
				},
				width: 640, 
				height: 480, 
				useContentSize: true,
				frame:true
			};
			

			if(template == 'frameless' || template == 'nui'){
				win_options.frame = false;
			};
			

			if(options){
				for(let key in options){
					if(key == 'webPreferences'){
						for(let skey in options.webPreferences){
							win_options.webPreferences[skey] = options.webPreferences[skey];
						}
					}
					else {
						win_options[key] = options[key];
					}
				}
			}
			
			if(options && win_options.parentID){
				win_options.parent = BrowserWindow.fromId(win_options.parentID);
			}
			win = new BrowserWindow(win_options);
			let ap = app.getAppPath();
			if(options && options.file){ win.loadFile(options.file); }
			else if(options && options.url){ win.loadURL(options.url); }
			else if(options && options.html) {
				win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(options.html), { baseURLForDataURL: `file://${ap}/` })
			}
			else{
				let html = /*html*/` <!DOCTYPE html><html><head><title>Electron</title></head><body></body></html>`
				win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html), { baseURLForDataURL: `file://${ap}/` })
			}
			if(options && options.devTools){ win.toggleDevTools(); }
			win.webContents.once('did-finish-load', () => {
				if(options && options.init_data){ win.webContents.send('init_data', options.init_data); }
				win.webContents.executeJavaScript(/*javascript*/`
					try{ if(typeof electron_helper !== 'undefined' && electron_helper) { electron_helper.id = ${win.id}; } }catch(e){ console.error('set electron_helper.id failed', e); }
				`).catch((e) => { console.error('executeJavaScript failed for set id', e); });
				resolve(win);
			})
		}
		else {
			const ipc = requireIpcRenderer();
			let w_id = await ipc.invoke('tools', {command:'newWindow', data:{template:template, options:options}});
			resolve(w_id);
		}
	})
	
}

tools.sendToMain = (channel, data) => {
	if(context_type == 'browser'){
		console.log({channel:channel, data:data})
	}
	else {
		const ipc = requireIpcRenderer();
		return ipc.invoke(channel, data);
	}
}

tools.sendToId = async (id, channel, data) => {
	if(context_type == 'browser'){
		let win = BrowserWindow.fromId(id);
		if(!win){ throw new Error('Window not found: ' + id); }
		win.webContents.send(channel, data);
	}
	else {
		const ipc = requireIpcRenderer();
		await ipc.invoke('tools', {command:'sendToId', data:{id:id, channel:channel, data:data}});
	}
}

tools.broadcast = async (channel, data) => {
	if(context_type == 'browser'){
		let wins = BrowserWindow.getAllWindows();
		for(let i=0; i<wins.length; i++){
			wins[i].webContents.send(channel, data);
		}
	}
	else {
		const ipc = requireIpcRenderer();
		await ipc.invoke('tools', {command:'broadcast', data:{channel:channel, data:data}});
	}
}

tools.download = async (_url, file, progress) => {
	if(context_type == 'browser'){
		return new Promise(async (resolve, reject) => {
			https.get(_url, async (res) => {
				if(res.statusCode == 200){
					let temp_file = tools.path.join(tools.path.dirname(file), tools.id())
					await fs.writeFile(temp_file, '');
					let bytes = 0;
					let stream = _fs.createWriteStream(temp_file);
					let totalbytes = res.headers['content-length'];
					let startTime = 0;
					let lastBytes = 0;
					let bps = 0;
					res.on('data', data => {
						stream.write(data);
						let length = Buffer.byteLength(data);
						bytes += length;
						let time = (Date.now() - startTime);
						let scale = 0.5;
						if(time > (1000 * scale)){
							startTime += time;
							bps = (bytes - lastBytes);
							lastBytes = bytes;
						}
						progress({bytes:bytes, totalbytes:totalbytes, bps:bps/scale})
					})
					
					res.on('end', async () => {
						stream.close();
						await fs.rename(temp_file, file);
						resolve({status:true, msg:file})
					})

					res.on('error', async (e) => {
						await fs.unlink(temp_file);
						resolve({status:false, msg:e.toString()})
					})
				}
				else {
					resolve({status:false, msg:res.statusCode})
				}
			})

		
		})
	}
	else {
		const ipc = requireIpcRenderer();
		let ticket = tools.id();
		ipc.on(ticket, progress);
		let res = await ipc.invoke('tools', {command:'download', data:{ticket:ticket, url:_url, file:file}});
		ipc.removeListener(ticket, progress);
		return res;
	}
}

tools.cleanUpTemp = (verbose=false) =>{
	if(verbose) { fb('cleanup') }
	return new Promise(async (resolve, reject) => {
		const fsApi = requireFsApi();
		try {
			let user_data = app.getPath('userData');
			let temp_path = tools.path.join(user_data, 'temp');
			if(verbose) { fb(user_data) }

			let files = await fsApi.readdir(temp_path);
			if(files.length > 0){
				await Promise.all( 
					files.map(item => {
						if(verbose) { fb(item) }
						fsApi.unlink(tools.path.join(temp_path,item))
					})
				)
			}
			resolve();
		}
		catch(err) {
			fb(err.toString);
			reject();
		}
	})
}

tools.fileExists = async (fp) => {
	const fsApi = requireFsApi();
	try {
		await fsApi.access(fp);
		return true;
	}
	catch {
		return false;
	}
};

tools.ensureDir = async (fp) => {
	const fsApi = requireFsApi();
	try {
		await fsApi.access(fp);
		return 'there allready';
	}
	catch {
		await fsApi.mkdir(fp);
		return 'folder created';
	}
};

tools.readJSON = async (fp) => {
	const fsApi = requireFsApi();
	const data = await fsApi.readFile(fp, 'utf8');
	return JSON.parse(data);
};

tools.checkFileType = function (fp, filter) {
	let info = tools.path.parse ? tools.path.parse(fp) : { ext: (fp || '').split('.').pop() };
	let out = false;
	if(filter.includes(info.ext.toLowerCase())){
		out = true;
	}
	return out;
}

tools.getFiles = async function(fp, filter){
	const fsApi = requireFsApi();
	try {
		let files = await fsApi.readdir(fp, {withFileTypes:true});
		let out = [];
		for(let i=0; i<files.length; i++){
			let file = normalizeDirent(files[i]);
			if(file.isFile()){
				let p = tools.path.join(fp, file.name);
				let info = tools.path.parse ? tools.path.parse(p) : { ext: p.slice(p.lastIndexOf('.')) };
				if(filter){
					if(filter.includes(info.ext.toLowerCase())){
						out.push(p);
					}
				}
				else {
					out.push(p);
				}
			}
		}
		return out;
	}
	catch (err) {
		throw err instanceof Error ? err : new Error(String(err));
	}
};


tools.getFilesRecursive = async function(fp, filter){
	let all = await tools.getFilesR(fp);
	let out = [];
	all.forEach(file => {
		let info = tools.path.parse ? tools.path.parse(file) : { ext: file.slice(file.lastIndexOf('.')) };
		if(filter.includes(info.ext.toLowerCase())){
			out.push(file);
		}
	})
	return out;
};

tools.getFilesR = async function(dir, filter) {
	const fsApi = requireFsApi();
	const dirents = await fsApi.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(dirents.map((direntEntry) => {
		const dirent = normalizeDirent(direntEntry);
		const res = tools.path.resolve(dir, dirent.name);
		return dirent.isDirectory() ? tools.getFilesR(res) : res;
	}));
	return Array.prototype.concat(...files);
}

tools.writeJSON = async (fp, data) => {
	const fsApi = requireFsApi();
	await fsApi.writeFile(fp, JSON.stringify(data, null, 4));
};

tools.getFileURL = (fp) => {
	let furl = pathToFileURL(fp).href;
	furl.replace('file://', 'raum://');
	return furl
}

tools.loadImage = (fp) => {
	return new Promise((resolve, reject) => {
		let image = new Image();
		image.src = tools.getFileURL(fp);
		image.addEventListener('error', () => {
			resolve(tools.drawImageDummy(fp));
		}, {once:true})
		image.addEventListener('load', () => {
			resolve(image);
		}, {once:true})
	})
}

tools.drawImageDummy = (text="Missing Asset", width=1920, height=1080) => {
	let canvas = document.createElement('canvas');
	var dpr = window.devicePixelRatio || 1;
	canvas.width = width;
	canvas.height = height;
	
	let ctx = canvas.getContext('2d');

	ctx.beginPath();
	ctx.rect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = 'rgba(30,30,30,0.9)';
	ctx.fill();

	ctx.fillStyle = 'rgba(237, 63, 24,1)'
	ctx.textAlign = "center";
	ctx.font = 40 * dpr + "px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
	ctx.fillText('ASSET MISSING',canvas.width/2,canvas.height/2 - 20);
	ctx.fillStyle = 'rgba(255,255,255,0.8)'
	ctx.font = 14 * dpr + "px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
	ctx.fillText(text,canvas.width/2,canvas.height/2 + 20);
	let img = new Image();
	img.src = canvas.toDataURL();
	return img;
}

tools.versionInfo = (_target, opts) => {
	const returnElement = opts && opts.returnElement;
	const returnString = opts && opts.returnString;
	let target = _target ? _target : document.body;
	let info = process.versions;
	const cssText = /*css*/ `
		.helper-versions {
			position: absolute; 
			bottom: 20px; 
			right:20px; 
			min-width: 300px;
			padding: 20px;
			border-radius: 0.3em;
			font-size: 14px;
			background-color: rgba(40,40,40,0.9);
			z-index: 1000;
		}

		.helper-versions .item {
			display: flex; 
			flex-direction: row;
			width: 100%;
			padding-left: 10px;
			padding-right: 10px;
			padding-top: 4px;
			padding-bottom: 4px;
			margin-bottom: 3px;
		}

		.helper-versions .item div:nth-child(1){
			width: 90px;
			text-align: right;
			padding-right: 10px;
			opacity: 0.5;
		}
	`;

	let html = /*html*/ `
		<div class="helper-versions">
			<style>
			${cssText}
			</style>
			<div class="item">
				<div>Node:</div>
				<div>${info.node}</div>
			</div>
			<div class="item">
				<div>Electron:</div>
				<div>${info.electron}</div>
			</div>
			<div class="item">
				<div>Chrome:</div>
				<div>${info.chrome}</div>
			</div>
		</div>
	`;
	if(returnString){
		return html;
	}

	let fragment = document.createRange().createContextualFragment(html).firstElementChild;

	if(returnElement){
		return fragment;
	}

	target.appendChild(fragment);
	setTimeout(() => {
		let __el = document.querySelector('.helper-versions');
		if(__el && __el.parentNode){ __el.parentNode.removeChild(__el); }
		if(ss && ss.parentNode){ ss.parentNode.removeChild(ss); }
	},5000)
}

tools.headCSS = (css) => {
	var ss = document.createElement("style");
	ss.setAttribute('type', 'text/css');
	ss.setAttribute('rel', 'stylesheet');
	ss.appendChild(document.createTextNode(css));
	document.getElementsByTagName("head")[0].appendChild(ss);
	return ss;
}

tools.id = () => {
	return '_' + (
		Number(String(Math.random()).slice(2)) +
		Date.now() +
		Math.round(performance.now())
	).toString(36);
}

tools.medianAverage = function(ring){
	let sum = 0;
	if(ring.length > 3) {
		let ar = [...ring];
		ar.sort(function(a,b) { return a - b;});
		ar = ar.slice(1,ar.length-1);
		sum = ar.reduce(function(a, b) { return a + b}) / ar.length;
	}
	return sum;
}

tools.jRequest = function(_url, method, data){
	if(data){ data = JSON.stringify(data); }
	return new Promise((resolve, reject) => {
		_url = new URL(_url);
		const options = {
			hostname: _url.hostname,
			port: _url.port,
			path: _url.pathname + (_url.search || ''),
			method: method.toUpperCase(),
			headers: {
				'Accept':         'application/json',
				'User-Agent':     'Node LibreMon-Client'
			}
		};

		if(options.method == 'POST'){
			options.headers['Content-Type'] = 'application/json';
			options.headers['Content-Length'] = Buffer.byteLength(data);
		}

		const reqModule = _url.protocol === 'https:' ? https : http;
		const req = reqModule.request(options, res => {
			let responseData = '';
			res.setEncoding('utf8');
			res.on('data', d => {
				responseData += d;
			});
			res.on('end', () => {
				let result;
				try {
					result = JSON.parse(responseData);
				} catch {
					result = { text: responseData };
				}
				resolve(result);
			});
		});

		req.on('error', error => {
			reject(error.toString());
		});
		if(options.method == 'POST'){
			req.write(data);
		}
		req.end();
	});
}

tools.subWindow = function(html, options){
	if(context_type == 'browser'){ console.log('Can only be run from Renderer'); return; }
	if(!html){ html = /*html*/`<!DOCTYPE html><html><head><title>Sub Window</title></head><body></body></html>`}
	let win = window.open();
	win.document.write(html);
	win.parent_window = window;
	if(options?.cloneCSS){
		document.head.querySelectorAll('link, style').forEach(refs => {
			win.document.head.appendChild(refs.cloneNode(true));
		});
	}
	return win;
}

tools.isAdmin = function(){
	return new Promise((resolve, reject) => {
		child_process.exec('NET SESSION', function(err,so,se) {
			resolve(se.length === 0 ? true : false);
	    });
	})
}

init();

function log(options={}){
	// Create a new log_data array for each instance, just like in the original helper.js
	let log_data = [];
	let _verbose = options.verbose || false;
	let _default_context = options.default_context || 'log';
	let _default_level = options.default_level || 0;

	if(context_type == 'browser'){
		// In main process
		return { 
			data: log_data,
			push: (obj, context=_default_context, level=_default_level, verbose=_verbose) => { 
				if (options && options.win && typeof options.win.send === 'function') {
					options.win.send('log_push', {data:obj, context:context, level:level, verbose:verbose}); 
				}
				log_push(log_data, obj, context, level, verbose);
			}
		};
	} else {
		// In renderer process
		const ipc = getIpcRenderer();
		if (ipc) {
			ipc.on('log_push', (e, data) => { 
				log_push(log_data, data.data, data.context, data.level, data.verbose);
			});
		}
		
		return { 
			data: log_data, 
			push: (obj, context=_default_context, level=_default_level, verbose=_verbose) => { 
				log_push(log_data, obj, context, level, verbose);
				// Then send to main if needed
				try {
					const ipc = requireIpcRenderer();
					ipc.send('log_push_renderer', {data:obj, context:context, level:level, verbose:verbose});
				} catch (e) {
					// Silent fail
				}
			}
		};
	}
}

// No longer needed - removed in favor of direct object construction

function log_push(target, obj, context, level, verbose){
	let now = Date.now();
	let time = new Date(now);
	let msg = obj;
	if(typeof obj == 'object'){
		try {
			msg = JSON.stringify(obj);
		}
		catch(err){
			msg = obj.toString();
		}
	}
	if(verbose){
		console.log(target.length + '\t' + time.toLocaleTimeString() + '\t' + context, obj);
	}
	target.push([now, context, level, msg]);
}

function fb(o, context='helper'){
	if(context_type == 'browser'){
		context = 'main_helper'
	}
	console.log(context + '\t' + o.toString())
}

const exportedApi = rendererExportsRef || {
	window		: fnc_window,
	global		: fnc_global,
	screen 		: fnc_screen,
	app		: fnc_app,
	dialog		: fnc_dialog,
	shell		: fnc_shell,
	tools		: tools,
	ipcInvoke	: ipcInvoke,
	ipcHandle	: ipcHandle,
	config		: config,
	log		: log,
	ipcHandleRenderer: ipcHandleRenderer,
	setGlobal	: (name, data) => { if (typeof global !== 'undefined') global[name] = data; }
};

try {
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = exportedApi;
	}
} catch (e) {}

