'use strict';

const context_type = process.type;
const version = '2.0.0 - 2025_09_23';

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


const electron = require('electron');
const {app, net, protocol, ipcMain, ipcRenderer, BrowserWindow, screen, dialog, shell} = electron;
const _fs = require('fs');
const fs = _fs.promises;

const path = require('path');
const https = require('https');
const http = require('http');
const child_process = require('child_process');

const { pathToFileURL } = require('url')
const tools = {};

let fnc_window = {};
let fnc_global = {};
let fnc_screen = {};
let fnc_app = {};
let fnc_dialog = {};
let fnc_shell = {};

tools.path = path;
tools.fs = fs;
async function init(){
	if(context_type == 'browser'){
		protocol.registerSchemesAsPrivileged([{ scheme: 'raum', privileges: { secure: false, standard:true, stream:true, bypassCSP: true, supportFetchAPI:true } }]);
		await app.whenReady();
		mainInit();
	}
	else {
		fb('Helper Remote Init' + version);
		window.electron_helper = {};
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
		initApis();
		//ipcRenderer.on('log', (e, msg) => { console.log(e.senderId, msg) });
	}
}

async function mainInit(){
	fb('Helper Main Init ' + version)
	initApis();
	ipcMain.handle('tools', toolsCommand);


	if(protocol.registerFileProtocol){
		fb('Register File Protocol: raum')
		protocol.registerFileProtocol('raum', (request, callback) => {
			let furl = request.url.slice('raum:////'.length);
			callback(decodeURI(path.normalize(furl)))
		})
	}
	else {
		fb('Handle File Protocol: raum')
		protocol.handle('raum', (request) => {
			let furl = request.url.slice('raum://'.length);
			furl = decodeURI(path.normalize(furl));
			furl = pathToFileURL(furl).toString();
			return net.fetch(furl);
		})
	}
	
	tools.user_data = app.getPath('userData');
	tools.temp_path = path.join(tools.user_data, 'temp');
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
    return await ipcRenderer.invoke(name, payload);
};

function ipcHandleRenderer(channel, fnc){
    console.log('Init Channel on Renderer: ' + channel);
    ipcRenderer.on(channel, fnc)		
}



/* Unified API Initialization
################################################################################### */
function initApis() {
    if (context_type == 'browser') {
        // Main Process: Define APIs with handle functions
        const apis = {
            window: {
                close: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).close(); return {status:true}; }
                },
                show: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).show(); return {status:true}; }
                },
                focus: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).focus(); return {status:true}; }
                },
                hide: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).hide(); return {status:true}; }
                },
                toggleDevTools: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).toggleDevTools(); return {status:true}; }
                },
                setPosition: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).setPosition(req.data.x, req.data.y); return {status:true}; }
                },
                setBounds: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).setBounds(req.data); return {status:true}; }
                },
                setFullScreen: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).setFullScreen(req.data); return {status:true}; }
                },
                isFullScreen: {
                    handle: (e, req) => BrowserWindow.fromWebContents(e.sender).isFullScreen()
                },
                isVisible: {
                    handle: (e, req) => BrowserWindow.fromWebContents(e.sender).isVisible()
                },
                getBounds: {
                    handle: (e, req) => BrowserWindow.fromWebContents(e.sender).getBounds()
                },
                getPosition: {
                    handle: (e, req) => BrowserWindow.fromWebContents(e.sender).getPosition()
                },
                getId: {
                    handle: (e, req) => BrowserWindow.fromWebContents(e.sender).id
                },
                setSize: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).setSize(req.data.width, req.data.height); return {status:true}; }
                },
                center: {
                    handle: (e, req) => { BrowserWindow.fromWebContents(e.sender).center(); return {status:true}; }
                },
                hook_event: {
                    handle: (e, req) => {
                        fb('Hooked Event: ' + req.data);
                        let browserWindow = BrowserWindow.fromWebContents(e.sender);
                        browserWindow.on(req.data, (_event, _data) => { browserWindow.send('window_event' + req.event_id, {type:req.data, data:_data}); });
                        return {status:true};
                    }
                }
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
                        var ar = process.execPath.split(path.sep);
                        ar.length -= 2;
                        return ar.join(path.sep) + path.sep;
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
    } else {
        // Renderer Process: Define APIs with invoke functions
        const apis = {
            window: {
                close: {
                    invoke: () => ipcRenderer.invoke('window', {command:'close'})
                },
                show: {
                    invoke: () => ipcRenderer.invoke('window', {command:'show'})
                },
                focus: {
                    invoke: () => ipcRenderer.invoke('window', {command:'focus'})
                },
                hide: {
                    invoke: () => ipcRenderer.invoke('window', {command:'hide'})
                },
                toggleDevTools: {
                    invoke: () => ipcRenderer.invoke('window', {command:'toggleDevTools'})
                },
                setPosition: {
                    invoke: (x, y) => ipcRenderer.invoke('window', {command:'setPosition', data:{x:x, y:y}})
                },
                setBounds: {
                    invoke: (arg) => ipcRenderer.invoke('window', {command:'setBounds', data:arg})
                },
                setFullScreen: {
                    invoke: (arg) => ipcRenderer.invoke('window', {command:'setFullScreen', data:arg})
                },
                isFullScreen: {
                    invoke: () => ipcRenderer.invoke('window', {command:'isFullScreen'})
                },
                isVisible: {
                    invoke: () => ipcRenderer.invoke('window', {command:'isVisible'})
                },
                getBounds: {
                    invoke: () => ipcRenderer.invoke('window', {command:'getBounds'})
                },
                getPosition: {
                    invoke: () => ipcRenderer.invoke('window', {command:'getPosition'})
                },
                getId: {
                    invoke: () => ipcRenderer.invoke('window', {command:'getId'})
                },
                setSize: {
                    invoke: (width, height) => ipcRenderer.invoke('window', {command:'setSize', data:{width:width, height:height}})
                },
                center: {
                    invoke: () => ipcRenderer.invoke('window', {command:'center'})
                },
                hook_event: {
                    invoke: async (event_name, cb) => {
                        let event_id = tools.id();
                        let temp = await ipcRenderer.invoke('window', {command:'hook_event', data:event_name, event_id:event_id});
                        return ipcRenderer.on('window_event' + event_id, cb);
                    }
                }
            },
			global: {
				get: {
					invoke: async (name, clone=true) => { 
						let req = await ipcRenderer.invoke('global', {command:'get', name:name, clone:clone});
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
					}
				},
				set: {
					invoke: async (name, data) => {
						let payload = data;
						if (typeof data === 'undefined') {
							payload = {__is_marker: true, __undefined: true};
						}
						return await ipcRenderer.invoke('global', {command:'set', name:name, data:payload});
					},
				}
			},
            screen: {
                getPrimaryDisplay: {
                    invoke: async () => {
                        let req = await ipcRenderer.invoke('screen', {command:'getPrimaryDisplay'});
                        return JSON.parse(req.data);
                    }
                },
                getAllDisplays: {
                    invoke: async () => {
                        let req = await ipcRenderer.invoke('screen', {command:'getAllDisplays'});
                        return JSON.parse(req.data);
                    }
                }
            },
            app: {
                exit: {
                    invoke: () => ipcRenderer.invoke('app', {command:'exit'})
                },
                isPackaged: {
                    invoke: () => ipcRenderer.invoke('app', {command:'isPackaged'})
                },
                getAppPath: {
                    invoke: () => ipcRenderer.invoke('app', {command:'getAppPath'})
                },
                getPath: {
                    invoke: (name) => ipcRenderer.invoke('app', {command:'getPath', name:name})
                },
                getName: {
                    invoke: () => ipcRenderer.invoke('app', {command:'getName'})
                },
                getExecPath: {
                    invoke: () => ipcRenderer.invoke('app', {command:'getExecPath'})
                },
                getVersions: {
                    invoke: () => ipcRenderer.invoke('app', {command:'getVersions'})
                }
            },
            dialog: {
                showOpenDialog: {
                    invoke: async (options) => ipcRenderer.invoke('dialog', {command:'showOpenDialog', data:options})
                }
            },
            shell: {
                showItemInFolder: {
                    invoke: async (fp) => ipcRenderer.invoke('shell', {command:'showItemInFolder', data:fp})
                }
            }
        };
        // Expose API functions
        for (let api in apis) {
            window.electron_helper[api] = {};
            for (let method in apis[api]) {
                window.electron_helper[api][method] = apis[api][method].invoke;
            }
        }
        fnc_window = window.electron_helper.window;
        fnc_global = window.electron_helper.global;
        fnc_screen = window.electron_helper.screen;
        fnc_app = window.electron_helper.app;
        fnc_dialog = window.electron_helper.dialog;
        fnc_shell = window.electron_helper.shell;
    }
}

let masterConfigs = {};

function _isConfigLogEnabled(options){
	if(options && options.log) return true;
	try {
		const v = process && process.env ? process.env.ELECTRON_HELPER_CONFIG_LOG : undefined;
		if(v === '1' || v === 'true' || v === 'yes') return true;
	} catch(e) {}
	return false;
}

function _cfgLog(prefix, name, extra){
	try {
		const msg = extra ? (prefix + ' ' + name + ' ' + extra) : (prefix + ' ' + name);
		console.log(msg);
	} catch(e) {}
}

// This is the core file-handling logic, adapted from the old `config` function.
async function _loadAndWatchConfigFile(filePath, defaultConfig, force, migrate) {
    return new Promise(async (resolve, reject) => {
        let cnf = {};
        cnf.data = defaultConfig;
        cnf.backup = JSON.stringify(defaultConfig);
        cnf.path = filePath;
        const backupPath = filePath + '.bak';

        if (force) {
            await fs.unlink(filePath).catch(() => {});
            await fs.unlink(backupPath).catch(() => {});
        }

        cnf.writeFile = async () => {
            const currentStr = JSON.stringify(cnf.data, null, 4);
            if (currentStr !== cnf.backup) {
                fb(`Writing Config: ${path.basename(filePath)}`);
                try {
                    if (await tools.fileExists(filePath)) {
                        const existing = await tools.readJSON(filePath);
                        if (JSON.stringify(existing) !== currentStr) {
                            await tools.writeJSON(backupPath, existing);
                        }
                    }
                } catch (e) {
                    fb(`Failed to create config backup: ${e.message}`);
                }
                cnf.backup = currentStr;
                return tools.writeJSON(cnf.path, cnf.data);
            }
        };

        cnf.write = () => {
            clearTimeout(cnf.timeout);
            cnf.timeout = setTimeout(cnf.writeFile, 500);
        };
        cnf.interval = setInterval(cnf.write, 3000);

		if (!(await tools.fileExists(filePath))) {
			if(migrate && typeof migrate === 'function'){
				try { cnf.data = migrate(cnf.data, defaultConfig) || cnf.data; } catch(e) {}
			}
			await tools.writeJSON(filePath, cnf.data);
			resolve(cnf);
		} else {
            let loadedData = null;
            try {
                loadedData = await tools.readJSON(filePath);
                if (!loadedData || (typeof loadedData === 'object' && Object.keys(loadedData).length === 0)) {
                    throw new Error('Config file is empty');
                }
                JSON.stringify(loadedData); // Validate it's not circular
            } catch (e) {
                fb(`Config file corrupted, attempting restore from backup: ${e.message}`);
                try {
                    loadedData = await tools.readJSON(backupPath);
                    await tools.writeJSON(filePath, loadedData);
                    fb('Config restored from backup');
                } catch (backupErr) {
                    fb(`Backup restore failed: ${backupErr.message}, using default config`);
                    loadedData = defaultConfig;
                }
            }
			// Migration/repair hook (preferred) OR shallow merge fallback.
			// NOTE: shallow merge will drop nested defaults, so migrations should repair nested objects.
			if(migrate && typeof migrate === 'function'){
				try {
					cnf.data = migrate(loadedData, defaultConfig) || { ...defaultConfig, ...loadedData };
				} catch(e) {
					cnf.data = { ...defaultConfig, ...loadedData };
				}
			}
			else {
				cnf.data = { ...defaultConfig, ...loadedData };
			}

			// Force a write soon if the migrated/merged data differs from file content.
			// Keep cnf.backup as the original file snapshot so cnf.writeFile() detects changes.
			try {
				cnf.backup = JSON.stringify(loadedData, null, 4);
			} catch(e) {
				cnf.backup = JSON.stringify(defaultConfig, null, 4);
			}
            resolve(cnf);
        }
    });
}


const config = {
	initMain: async (name, defaultConfig = {}, options = null) => {
        if (context_type !== 'browser') {
            throw new Error('helper.config.initMain can only be called from the main process.');
        }

        const userPath = app.getPath('userData');
        const filePath = path.join(userPath, `${name}.json`);
        
		const migrate = (options && typeof options.migrate === 'function') ? options.migrate : null;
		const force = options && options.force ? true : false;
		const logEnabled = _isConfigLogEnabled(options);
		const configObj = await _loadAndWatchConfigFile(filePath, defaultConfig, force, migrate);
		configObj.__log = logEnabled;
        masterConfigs[name] = configObj;

        // Ensure IPC handlers are only set up once.
        if (!ipcMain.eventNames().includes('config-get')) {
            fb('Setting up centralized config IPC handlers.');
            
            ipcMain.handle('config-get', (e, configName) => {
                if (!masterConfigs[configName]) {
                    console.error(`Config '${configName}' not initialized in main process.`);
                    return null;
                }
				if(masterConfigs[configName].__log){
					_cfgLog('[config-get]', configName, 'sender=' + e.senderId);
				}
                return masterConfigs[configName].data;
            });

            ipcMain.handle('config-set', (e, { name, data }) => {
                if (masterConfigs[name]) {
					if(masterConfigs[name].__log){
						let k = 0;
						try { k = data && typeof data === 'object' ? Object.keys(data).length : 0; } catch(err) {}
						_cfgLog('[config-set]', name, 'sender=' + e.senderId + ' keys=' + k);
					}
                    masterConfigs[name].data = data;
                    masterConfigs[name].write(); // This is the debounced save-to-file method.
                    
                    // Broadcast the update to all renderer processes.
                    tools.broadcast(`config-updated-${name}`, data);
                    
                    return { success: true };
                }
                return { success: false, error: `Config '${name}' not found.` };
            });
        }
        
        // Return a subset of the config object for direct use in main process if needed.
        return {
			get: () => {
				if(masterConfigs[name].__log){
					_cfgLog('[config.get]', name, 'process=main');
				}
				return masterConfigs[name].data;
			},
			set: (newData) => {
				if(masterConfigs[name].__log){
					let k = 0;
					try { k = newData && typeof newData === 'object' ? Object.keys(newData).length : 0; } catch(err) {}
					_cfgLog('[config.set]', name, 'process=main keys=' + k);
				}
                masterConfigs[name].data = newData;
                masterConfigs[name].write();
                tools.broadcast(`config-updated-${name}`, newData);
            },
            path: masterConfigs[name].path
        };
    },

	initRenderer: async (name, updateCallback, options = null) => {
        if (context_type === 'browser') {
            throw new Error('helper.config.initRenderer can only be called from a renderer process.');
        }
		// Backward-compatible overload: initRenderer(name, optionsObject)
		if(updateCallback && typeof updateCallback === 'object' && !options){
			options = updateCallback;
			updateCallback = null;
		}
		const logEnabled = _isConfigLogEnabled(options);

        let localConfig = (options && options.initialConfig) ? options.initialConfig : await ipcRenderer.invoke('config-get', name);
		if(logEnabled){
			_cfgLog('[config.initRenderer]', name, 'pid=' + process.pid + (options && options.initialConfig ? ' (using initialConfig)' : ''));
		}

        ipcRenderer.on(`config-updated-${name}`, (e, newData) => {
            localConfig = newData;
            if (updateCallback && typeof updateCallback === 'function') {
                updateCallback(newData);
            }
        });

        return {
			get: () => {
				if(logEnabled){
					_cfgLog('[config.get]', name, 'pid=' + process.pid);
				}
				return localConfig;
			},
			set: (newData) => {
				if(logEnabled){
					let k = 0;
					try { k = newData && typeof newData === 'object' ? Object.keys(newData).length : 0; } catch(err) {}
					_cfgLog('[config.set]', name, 'pid=' + process.pid + ' keys=' + k);
				}
                localConfig = newData; // Optimistic update of local copy
                ipcRenderer.invoke('config-set', { name: name, data: newData });
            }
        };
    }
};


async function toolsCommand(e, req){
	let command = req.command;
	let reply = {status:false};
	
	if(command == 'newWindow'){
		let nw = await tools.browserWindow(req.data.template, req.data.options);
		reply = nw.id;
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


/* Tools
###################################################################################
################################################################################### */

tools.browserWindow = (template='default', options) => {
	return new Promise(async (resolve, reject) => {
		if(context_type == 'browser'){
			let win;
			let win_options = { 
				webPreferences: {
					contextIsolation: false, 
					nodeIntegration:true, 
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
			
			const sendInitData = () => {
				if(options && options.init_data){ 
					options.init_data.windowId = win.id;
					win.webContents.send('init_data', options.init_data); 
				}
				win.webContents.executeJavaScript(/*javascript*/`
					try{ if(typeof electron_helper !== 'undefined' && electron_helper) { electron_helper.id = ${win.id}; } }catch(e){ console.error('set electron_helper.id failed', e); }
				`).catch((e) => { console.error('executeJavaScript failed for set id', e); });
				resolve(win);
			};

			win.webContents.once('dom-ready', sendInitData);
		}
		else {
			let w_id = await ipcRenderer.invoke('tools', {command:'newWindow', data:{template:template, options:options}})
			resolve(w_id);
		}
	})
	
}

tools.sendToMain = (channel, data) => {
	if(context_type == 'browser'){
		console.log({channel:channel, data:data})
	}
	else {
		return ipcRenderer.invoke(channel, data);
	}
}

tools.sendToId = async (id, channel, data) => {
	if(context_type == 'browser'){
		let win = BrowserWindow.fromId(id);
		if(win && !win.isDestroyed()) {
			win.webContents.send(channel, data);
		}
	}
	else {
		await ipcRenderer.invoke('tools', {command:'sendToId', data:{id:id, channel:channel, data:data}});
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
		await ipcRenderer.invoke('tools', {command:'broadcast', data:{channel:channel, data:data}});
	}
}

tools.download = async (_url, file, progress) => {
	if(context_type == 'browser'){
		return new Promise(async (resolve, reject) => {
			https.get(_url, async (res) => {
				if(res.statusCode == 200){
					let temp_file = path.join(path.dirname(file), tools.id())
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
		// Renderer World
		let ticket = tools.id();
		ipcRenderer.on(ticket, progress)
		let res = await ipcRenderer.invoke('tools', {command:'download', data:{ticket:ticket, url:_url, file:file}});
		ipcRenderer.removeListener(ticket, progress);
		return res;
	}
}


tools.cleanUpTemp = (verbose=false) =>{
	if(verbose) { fb('cleanup') }
	return new Promise(async (resolve, reject) => {
		try {
			let user_data = app.getPath('userData');
			let temp_path = path.join(user_data, 'temp');
			if(verbose) { fb(user_data) }

			let files = await fs.readdir(temp_path);
			if(files.length > 0){
				await Promise.all( 
					files.map(item => {
						if(verbose) { fb(item) }
						fs.unlink(path.join(temp_path,item))
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

tools.fileExists = (fp) => {
	return new Promise( async (resolve, reject) => {
		try {
			await fs.access(fp);
			resolve(true)
		}
		catch {
			resolve(false)
		}
	})
}

tools.ensureDir = (fp) => {
	return new Promise(async (resolve, reject) => {
		try {
			await fs.access(fp);
			resolve('there allready');
		}
		catch {
			await fs.mkdir(fp);
			resolve('folder created');
		}
	})
}

tools.readJSON = (fp) => {
	return new Promise(async (resolve, reject) => {
		let data = await fs.readFile(fp, 'utf8');
		try {
			let out = JSON.parse(data);
			resolve(out);
		}
		catch(err){
			reject(err);
		}
	})
}

tools.checkFileType = function (fp, filter) {
	let info = path.parse(fp);
	let out = false;
	if(filter.includes(info.ext.toLowerCase())){
		out = true;
	}
	return out;
}

tools.getFiles = function(fp, filter){
	return new Promise(async (resolve, reject) => {
		try {
			let files = await fs.readdir(fp, {withFileTypes:true});
			let out = [];
			for(var i=0; i<files.length; i++){
				let file = files[i];
				if(file.isFile()){
					let p = path.join(fp, file.name);
					let info = path.parse(p);
					if(filter){
						if(filter.includes(info.ext.toLowerCase())){
							out.push(p);
						}
					}
					else {
						out.push(p);
					}
				}
			};
			resolve(out);
		}
		catch (err) {
			reject(err.toString())
		}
	})
}


tools.getFilesRecursive = function(fp, filter){
	return new Promise(async (resolve,reject) => {
		let all = await tools.getFilesR(fp);
		let out = [];
		all.forEach(file => {
			let info = path.parse(file);
			if(filter.includes(info.ext.toLowerCase())){
				out.push(file);
			}
		})
		resolve(out)
	})
}

tools.getFilesR = async function(dir, filter) {
	const dirents = await fs.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(dirents.map((dirent) => {
		const res = path.resolve(dir, dirent.name);
		return dirent.isDirectory() ? tools.getFilesR(res) : res;
	}));
	return Array.prototype.concat(...files);
}

tools.writeJSON = (fp, data) => {
	return new Promise( async (resolve, reject) => {
		try {
			await fs.writeFile(fp, JSON.stringify(data, null, 4));
			resolve();
		}
		catch {
			reject('error')
		}
	})
}

tools.getFileURL = (fp) => {
	let furl = pathToFileURL(fp).href;
	furl.replace('file://', 'raum://');
	return furl
}

tools.loadImage = (fp) => {
	return new Promise((resolve, reject) => {
		let image = new Image();
		image.src = tools.getFileURL(fp);
		image.addEventListener('error', (img) => {
			resolve(tools.drawImageDummy(fp));
		}, {once:true})
		image.addEventListener('load', (img) => {
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
	// opts:
	//   returnElement: true -> return the rendered HTMLElement without appending or applying display logic
	//   returnString: true -> return the HTML string (unparsed)
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

	// Inline the CSS into the HTML fragment so callers don't need to inject separately
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



/* This is not done */
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
				'Accept':        	'application/json',
				'User-Agent':    	'Node LibreMon-Client'
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
	console.log(document.styleSheets);
	if(!html){ html = /*html*/`<!DOCTYPE html><html><head><title>Sub Window</title></head><body></body></html>`}
    let win = window.open();
    win.document.write(html);
	win.parent_window = window;
	if(options?.cloneCSS){
		document.head.querySelectorAll('link, style').forEach(refs => {
			console.log(refs);
			win.document.head.appendChild(refs.cloneNode(true));
	   });
	}
	return win;
}

tools.isAdmin = function(){
	return new Promise((resolve, reject) => {
		child_process.exec('NET SESSION', { windowsHide: true }, function(err,so,se) {
			resolve(se.length === 0 ? true : false);
    	});
	})
}

init();

/* Log
###################################################################################
################################################################################### */
function log(options){
	let log_data = [];
	let _verbose = options.verbose || false;
	let _default_context = options.default_context || 'log';
	let _default_level = options.default_level || 0;

	if(context_type == 'browser'){
		return { 
			push:(obj, context=_default_context, level=_default_level, verbose=_verbose) =>  { 
				options.win.send('log_push', {data:obj, context:context, level:level, verbose:verbose}); 
			}
		};
	}
	ipcRenderer.on('log_push', (e, data) => { log_push(log_data, data.data, data.context, data.level, data.verbose)})
	return { 
		data:log_data, 
		push:(obj, context=_default_context, level=_default_level, verbose=_verbose) => { log_push(log_data, obj, context, level, verbose)}
	}
}

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

let exp = {
	window		: fnc_window,
	global		: fnc_global,
	screen 		: fnc_screen,
	app			: fnc_app,
	dialog		: fnc_dialog,
	shell		: fnc_shell,
	tools		: tools,
	ipcInvoke	: ipcInvoke,
	ipcHandle	: ipcHandle,
	config		: config,
	log			:log,
	ipcHandleRenderer: ipcHandleRenderer,
	setGlobal	: (name, data) => { if (typeof global !== 'undefined') global[name] = data; }
}

if(context_type != 'browser'){
	window.electron_helper = exp;
}

// Export for require() in main process to match helper.js behavior
try {
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = exp;
	}
} catch (e) {}