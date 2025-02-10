'use strict';

// Version 1.0.3 - Might be wrong because i'm lazy test
const context_type = process.type;
const version = '1.0.5 - 2023_05_29';


const electron = require('electron');
const {app, net, protocol, ipcMain, ipcRenderer, BrowserWindow, screen, dialog, shell} = electron;
const _fs = require('fs');
const fs = _fs.promises;
const url = require('url');
const path = require('path');
const https = require('https');
const http = require('http');
const child_process = require('child_process');

const { pathToFileURL } = require('url')
const tools = {};
tools.path = path;
tools.fs = fs;

init();
async function init(){
	if(context_type == 'browser'){
		protocol.registerSchemesAsPrivileged([{ scheme: 'raum', privileges: { secure: false, standard:true, stream:true, bypassCSP: true, supportFetchAPI:true } }]);
		await app.whenReady();
		mainInit();
	}
	else {
		fb('Helper Remote Init' + version);
		ipcRenderer.on('log', (e, msg) => { console.log(e.senderId, msg) });
	}
}

async function mainInit(){
	fb('Helper Main Init ' + version)
	ipcMain.handle('window', windowCommand);
	ipcMain.handle('global', globalCommand);
	ipcMain.handle('screen', screenCommand);
	ipcMain.handle('app', appCommand);
	ipcMain.handle('dialog', dialogCommand);
	ipcMain.handle('shell', shellCommand);
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


/* IPC
###################################################################################
################################################################################### */
let ipcInvoke = async (name, payload) => { 
	return await ipcRenderer.invoke(name, payload);
};

function ipcHandle(name, fnc){
	fb('Init Channel on Main: ' + name);
	ipcMain.handle(name, (e, req) => {
		return fnc(e, name, req);
	})
}

function ipcHandleRenderer(channel, fnc){
	console.log('Init Channel on Renderer: ' + channel);
	ipcRenderer.on(channel, fnc)		
}

/* Window
###################################################################################
################################################################################### */

let fnc_window = {
	close: async () => { return await ipcRenderer.invoke('window', {command:'close'}) },
	show: async () => { return await ipcRenderer.invoke('window', {command:'show'}) },
	focus: async () => { return await ipcRenderer.invoke('window', {command:'focus'}) },
	hide: async () => { return await ipcRenderer.invoke('window', {command:'hide'}) },
	toggleDevTools: async () => { return await ipcRenderer.invoke('window', {command:'toggleDevTools'}) },
	setPosition: async (x, y) => { return await ipcRenderer.invoke('window', {command:'setPosition', data:{x:x, y:y}}) },
	setBounds: async (arg) => { return await ipcRenderer.invoke('window', {command:'setBounds', data:arg}) },
	setFullScreen: async (arg) => { return await ipcRenderer.invoke('window', {command:'setFullScreen', data:arg}) },
	isFullScreen: async () => { return await ipcRenderer.invoke('window', {command:'isFullScreen'}) },
	isVisible: async () => { return await ipcRenderer.invoke('window', {command:'isVisible'}) },
	getBounds: async () => { return await ipcRenderer.invoke('window', {command:'getBounds'}) },
	getPosition: async () => { return await ipcRenderer.invoke('window', {command:'getPosition'}) },
	getId: async () => { return await ipcRenderer.invoke('window', {command:'getId'}) },
	setSize: async (width, height) => { return await ipcRenderer.invoke('window', {command:'setSize', data:{width:width, height:height} })},
	center: async () => { return await ipcRenderer.invoke('window', {command:'center'}) },
	hook_event: async (event_name, cb) => {
		let event_id = tools.id();
		let temp = await ipcRenderer.invoke('window', {command:'hook_event', data:event_name, event_id:event_id});
		return ipcRenderer.on('window_event' + event_id, cb);
	}
}

function windowCommand(e, req){
	let browserWindow = BrowserWindow.fromWebContents(e.sender);
	let command = req.command;
	let data = req.data;
	let event_id = req.event_id;
	let reply = {status:true};
	if(command == 'close'){
		browserWindow.close();
	}
	if(command == 'show'){
		browserWindow.show();
	}
	if(command == 'focus'){
		browserWindow.focus();
	}
	if(command == 'hide'){
		browserWindow.hide();
	}
	if(command == 'toggleDevTools'){
		browserWindow.toggleDevTools();
	}
	if(command == 'setPosition'){
		browserWindow.setPosition(data.x, data.y);
	}
	if(command == 'setBounds'){
		browserWindow.setBounds(data);
	}
	if(command == 'setFullScreen'){
		browserWindow.setFullScreen(data);
	}
	if(command == 'isFullScreen'){
		reply = browserWindow.isFullScreen();
	}
	if(command == 'isVisible'){
		reply = browserWindow.isVisible();
	}
	if(command == 'getBounds'){
		reply = browserWindow.getBounds();
	}
	if(command == 'getPosition'){
		reply = browserWindow.getBounds();
	}
	if(command == 'getId'){
		reply = browserWindow.id;
	}
	if(command == 'setSize'){
		reply = browserWindow.setSize(data.width, data.height);
	}
	if(command == 'center'){
		reply = browserWindow.center();
	}
	if(command == 'hook_event'){
		fb('Hooked Event: ' + data)
		//browserWindow.on(data, (_event, _data) => { _event.sender.send('window_event' + event_id, {type:data, data:_data}) }) // this makes no sense
		browserWindow.on(data, (_event, _data) => { browserWindow.send('window_event' + event_id, {type:data, data:_data})})
	}
	return reply;
}

/* Global
###################################################################################
################################################################################### */

let fnc_global = {
	get: async (name, clone=true) => { 
		let req = await ipcRenderer.invoke('global', {command:'get', name:name, clone:clone})
		let out = {};
		if(clone){
			try {
				out = JSON.parse(req.data);
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
	set: async (name, data) => { return await ipcRenderer.invoke('global', {command:'get', name:name, data:data}) },
}

function globalCommand(e, req){
	let command = req.command;
	let data = req.data;
	let name = req.name;
	let reply = {status:false};
	if(command == 'get'){
		reply.status = true;
		if(req.clone){
			reply.data = JSON.stringify(global[name]);
		}
		else {
			reply.data = global[name];
		}
	}
	if(command == 'set'){
		reply.status = true;
		global[name] = data;
	}
	return reply;
}


/* Screen
###################################################################################
################################################################################### */

let fnc_screen = {
	getPrimaryDisplay: async () => {
		let req = await ipcRenderer.invoke('screen', {command:'getPrimaryDisplay'})
		return JSON.parse(req.data);
	},
	getAllDisplays: async () => {
		let req = await ipcRenderer.invoke('screen', {command:'getAllDisplays'})
		return JSON.parse(req.data);
	}
}

function screenCommand(e, req){
	let command = req.command;
	let reply = {status:false};
	if(command == 'getPrimaryDisplay'){
		reply.status = true;
		reply.data = JSON.stringify(screen.getPrimaryDisplay());
	}
	if(command == 'getAllDisplays'){
		reply.status = true;
		reply.data = JSON.stringify(screen.getAllDisplays());
	}
	return reply;
}

/* App
###################################################################################
################################################################################### */

let fnc_app = {
	exit: async () => { return await ipcRenderer.invoke('app', {command:'exit'})},
	isPackaged: async () => { return await ipcRenderer.invoke('app', {command:'isPackaged'})},
	getAppPath: async () => { return await ipcRenderer.invoke('app', {command:'getAppPath'})},
	getPath: async (name) => { return await ipcRenderer.invoke('app', {command:'getPath', name:name})},

	getExecPath: async () => { return await ipcRenderer.invoke('app', {command:'getExecPath'})},
	getVersions: async () => { return await ipcRenderer.invoke('app', {command:'getVersions'})},
}

function appCommand(e, req){
	let command = req.command;
	let reply = {status:true};
	if(command == 'exit'){
		tools.cleanUpTemp(true).then(app.exit);
	}
	if(command == 'isPackaged'){
		reply = app.isPackaged;
	}
	if(command == 'getAppPath'){
		reply = app.getAppPath();
	}
	if(command == 'getPath'){
		reply = app.getPath(req.name);
	}

	if(command == 'getExecPath'){
		var ar = process.execPath.split( path.sep );
		ar.length -= 2;
		reply = ar.join(path.sep) + path.sep;
	}
	if(command == 'getVersions'){
		reply = JSON.parse(JSON.stringify(process.versions));
	}
	return reply;
}


/* Dialog
###################################################################################
################################################################################### */

let fnc_dialog = {
	showOpenDialog: async (options) => { return await ipcRenderer.invoke('dialog', {command:'showOpenDialog', data:options})},
}

async function dialogCommand(e, req){
	let browserWindow = BrowserWindow.fromWebContents(e.sender);
	let command = req.command;
	let reply = {status:false};
	if(command == 'showOpenDialog'){
		reply = await dialog.showOpenDialog(browserWindow, req.data);
	}
	return reply;
}

/* Shell
###################################################################################
################################################################################### */

let fnc_shell = {
	showItemInFolder: async (fp) => { return await ipcRenderer.invoke('shell', {command:'showItemInFolder', data:fp})},
}

async function shellCommand(e, req){
	let command = req.command;
	let reply = {status:false};
	if(command == 'showItemInFolder'){
		reply = shell.showItemInFolder(req.data);
	}
	return reply;
}

function config(fp, obj, force){
	return new Promise(async (resolve, reject) => {
		let up;
		if(context_type == 'browser'){ up = app.getPath('userData') }
		else { up = await fnc_app.getPath('userData'); }

		let cnf = {};
		cnf.data = obj;
		cnf.backup = JSON.stringify(obj);

		if(fp === 'user'){ fp = path.join(up, 'config.json'); }
		cnf.path = fp;
		if(force){ await fs.unlink(fp) }
		cnf.writeFile = async () => { 
			if(JSON.stringify(cnf.data) != cnf.backup){
				fb('Writing Config')
				cnf.backup = JSON.stringify(cnf.data);
				return tools.writeJSON(cnf.path, cnf.data)
				
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
			cnf.data = await tools.readJSON(fp);
			resolve( cnf )
		}

		
	})
}


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
			
			if(win_options.parentID){
				win_options.parent = BrowserWindow.fromId(win_options.parentID);
			}
			win = new BrowserWindow(win_options);
			let ap = app.getAppPath();
			if(options.file){ win.loadFile(options.file); }
			else if(options.url){ win.loadURL(options.url); }
			else if(options.html) {
				win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(options.html), { baseURLForDataURL: `file://${ap}/` })
			}
			else{
				let html = /*html*/` <!DOCTYPE html><html><head><title>Electron</title></head><body></body></html>`
				win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html), { baseURLForDataURL: `file://${ap}/` })
			}
			if(options.devTools){ win.toggleDevTools(); }
			win.webContents.once('did-finish-load', () => {
				if(options.init_data){ win.webContents.send('init_data', options.init_data); }
				win.webContents.executeJavaScript(/*javascript*/`
					if(electron_helper) { electron_helper.id = ${win.id};} 
				`);
				resolve(win);
			})
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
		win.webContents.send(channel, data);
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

tools.versionInfo = (_target) => {
	let target = _target ? _target : document.body;
	let info = process.versions;
	let ss = tools.headCSS( /*css*/ `
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
	`);


	let html = /*html*/ `
		<div class="helper-versions">
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
	`
	let fragment = document.createRange().createContextualFragment(html).firstElementChild;
	target.appendChild(fragment);
	setTimeout(() => {
		let __el = document.querySelector('.helper-versions');
		__el.parentNode.removeChild(__el)
		document.getElementsByTagName("head")[0].removeChild(ss);
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
			path: _url.pathname,
			method: method.toUpperCase(),
			headers: {
				'Accept':        	'application/json',
				'User-Agent':    	'Node LibreMon-Client'
			}
		};

		if(options.method == 'POST'){
			options['Content-Length'] = data.length;
		}

		const req = http.request(options, res => {
			let data = '';
			res.setEncoding('utf8');
			res.on('data', d => {
				data += d;
			});
			res.on('end', () => {
				try {
					data = JSON.parse(data);
				}
				catch(err) {
					data = err;
				}
				resolve(data);
			})
		});

		req.on('error', error => {
			reject(error.toString())
		});
		if(options.method == 'POST'){
			req.write(data);
		}
		req.end();
	})
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
		child_process.exec('NET SESSION', function(err,so,se) {
			resolve(se.length === 0 ? true : false);
    	});
	})
}

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
	ipcHandleRenderer: ipcHandleRenderer
}

if(context_type != 'browser'){
	window.electron_helper = exp;
}

module.exports = exp;