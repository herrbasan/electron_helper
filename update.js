const { app, ipcMain, BrowserWindow, autoUpdater, screen} = require( "electron" );

const path = require('path');
const _fs = require('fs');
const fs = _fs.promises;
const https = require('https');


let tools = {};
let current = {}
let control;
let temp_dir = path.join(app.getPath('temp'), app.getName() + '_update');
let progress;
let initResolver = null; // Store resolver to call when user makes a decision
let preventQuitHandler = null; // Handler to prevent app quit when update window closes

function init(prop){
	return new Promise(async (resolve, reject) => {
		current = {};
		progress = prop.progress;
		initResolver = null;

		// Delay window creation until we know if there's an update
		let windowCreated = false;
		
		emit('version', {name:app.getName(), version:app.getVersion()})
		await awaitMs(prop.start_delay || 1000);
	
		try {
			let check;
			if(prop.check) {
				check = prop.check;
			}
			else {
				// Support different update sources
				check = await checkVersion(prop.url, prop.source || 'http');
			}

			if(!check.status){
				let sourceType = prop.source === 'git' ? 'GitHub repository' : 'URL';
				emit('log', `Failed to fetch ${sourceType}: ${prop.url}`);
				updateAborted(-2);
				resolve(false);
			}
			else if(check.isNew){
				// Prevent app from quitting when update window is closed
				preventQuitHandler = (e) => { e.preventDefault(); };
				app.on('window-all-closed', preventQuitHandler);
				
				// Only create window when update is found
				if(prop.mode == 'splash'){
					control = await tools.browserWindow('default', {frame:false, devTools:false, show:true, html:renderWindow(prop.mode)})
					windowCreated = true;
				}
				if(prop.mode == 'widget'){
					control = await tools.browserWindow('default', {focusable:false, closeable:false, backgroundColor:null, transparent:true, frame:false, width:450, height:140, devTools:false, show:true, html:renderWindow(prop.mode)})
					let display = screen.getPrimaryDisplay();
					control.setPosition((display.bounds.width/2) - 225, 200);
					control.setAlwaysOnTop(true, 'screen');
					windowCreated = true;
				}
				
				if(control) { control.show();}
				current.package_checksum = check.version[0];
				current.package_name = check.version[1];
				current.package_size = check.version[2];
				
				// Construct download URL based on source
				if(prop.source === 'git') {
					// For GitHub, use the nupkg URL from the API response
					current.package_url = check.nupkg_url;
				}
				else {
					// Default HTTP mode
					current.package_url = prop.url + check.version[1];
				}
				
				emit('log','New Version Found');
				emit('log', current);
				emit('version', {name:app.getName(), version:app.getVersion(), remote_version:check.remote_version})
				emit('state', 1);

				emit('log','Init Updater Events');
				autoUpdater.on('error', (e) => { emit('autoupdater', e.toString()); updateAborted(-4);})
				autoUpdater.on('checking-for-update', () => { emit('autoupdater', 'checking-for-update')} )
				autoUpdater.on('update-available', () => { emit('autoupdater', 'update-available')} )
				autoUpdater.on('update-not-available', () => { emit('autoupdater', 'update-not-available')} )
				autoUpdater.on('update-downloaded', () => { emit('autoupdater', 'update-not-available'); updateFinished()})
				ipcMain.on('command', command);
				
				// For silent/widget modes, start update immediately and resolve true
				if(prop.mode == 'silent' || prop.mode == 'widget') { 
					runUpdate(); 
					resolve(true);
				}
				else {
					// For splash mode, wait for user decision before resolving
					// Store resolver to be called by command handler
					initResolver = resolve;
				}
			}
			else {
				updateAborted(-1);
				resolve(false);
			}
		}
		catch(err) {
			resolve(false);
			emit('log', err.toString())
			updateAborted(-3);
		}
	})
}


function command(e, data){
	if(data == 'app_exit'){
		// User clicked Ignore or closed window - resolve with false to continue app startup
		if(initResolver) {
			initResolver(false);
			initResolver = null;
		}
		updateAborted(-10);
	}
	if(data == 'run_update'){
		// User clicked Update - resolve with true to indicate update in progress
		if(initResolver) {
			initResolver(true);
			initResolver = null;
		}
		runUpdate();
	}
}

async function updateFinished(e){
	emit('log', 'Quit to install');
	emit('state', 4);
	autoUpdater.quitAndInstall();
}

async function updateAborted(state){
	emit('log', 'Update Aborted');
	emit('state', state);
	
	// Remove command listener to prevent duplicate handlers on next update check
	ipcMain.removeListener('command', command);
	
	// Destroy window first, then remove the prevent-quit handler
	// This order matters: if we remove handler first, closing the window triggers app quit
	if(control) { control.destroy(); control = null; }
	
	// Now remove the prevent-quit handler so app can continue normally
	if(preventQuitHandler) {
		app.removeListener('window-all-closed', preventQuitHandler);
		preventQuitHandler = null;
	}
}


async function runUpdate(){
	emit('log','Run Update');
	emit('state', 2);
	let local_archive = path.join(temp_dir, current.package_name);
	let download = await tools.download(current.package_url, local_archive, (data) => { emit('download', data) });
	if(download.status){
		autoUpdater.setFeedURL(temp_dir);
		autoUpdater.checkForUpdates();
		emit('state', 3);
	}
	emit('log', 'Download Finished');
}

function emit(type, data){
	if(control){
		control.webContents.send('event', {type:type, data:data});
	}
	if(progress){
		progress({type, data});
	}
}



function checkVersion(url, source = 'http'){
	if(source === 'git') {
		return checkVersionGit(url);
	}
	
	// Default HTTP mode
	emit('log','Check Version (HTTP)');
	return new Promise( async (resolve, reject) => {
		let status = false;
		let isNew = false;
		let version;
		let remote_version;
		try {
			let response = await fetch(url + 'RELEASES')
			let version_file = await response.text();
			remote_version = version_file.split(' ')[1].split('-')[1];
			if(parseInt(remote_version.split('.').join('')) > parseInt(app.getVersion().split('.').join(''))){
				isNew = true;
				await tools.ensureDir(temp_dir);
				await fs.writeFile(path.join(temp_dir, 'RELEASES'), version_file);
			}
			version = version_file.split(' ');
			status = true;
		}
		catch(err) {
			console.log(err.toString())
			remote_version = err.toString();
		}
		resolve({status:status, isNew:isNew, remote_version:remote_version, version:version});
	})
}

function checkVersionGit(repo){
	emit('log','Check Version (GitHub)');
	return new Promise( async (resolve, reject) => {
		let status = false;
		let isNew = false;
		let version;
		let remote_version;
		let nupkg_url;
		try {
			// Fetch latest release info from GitHub API
			// Try latest endpoint first, fallback to releases list if it fails
			let apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
			let response = await fetch(apiUrl);
			
			let release;
			if(response.status === 404) {
				// Fallback: get all releases and take the first one
				emit('log','Latest endpoint failed, trying releases list');
				apiUrl = `https://api.github.com/repos/${repo}/releases`;
				response = await fetch(apiUrl);
				let releases = await response.json();
				if(!releases || releases.length === 0) {
					throw new Error('No releases found');
				}
				release = releases[0]; // First release should be latest
			} else {
				release = await response.json();
			}
			
			if(!release || !release.tag_name) {
				throw new Error('Invalid GitHub release data');
			}
			
			remote_version = release.tag_name.replace('v', '');
			
			// Check if remote version is newer
			if(parseInt(remote_version.split('.').join('')) > parseInt(app.getVersion().split('.').join(''))){
				isNew = true;
				await tools.ensureDir(temp_dir);
				
				// Find RELEASES file in assets
				let releasesAsset = release.assets.find(asset => asset.name === 'RELEASES');
				let nupkgAsset = release.assets.find(asset => asset.name.endsWith('-full.nupkg'));
				
				if(!releasesAsset || !nupkgAsset) {
					throw new Error('Required assets (RELEASES, nupkg) not found in GitHub release');
				}
				
				// Download RELEASES file
				let releasesResponse = await fetch(releasesAsset.browser_download_url);
				let version_file = await releasesResponse.text();
				
				await fs.writeFile(path.join(temp_dir, 'RELEASES'), version_file);
				
				// Parse version data from RELEASES file
				let version_parts = version_file.trim().split(' ');
				version = [
					version_parts[0], // checksum
					nupkgAsset.name, // filename 
					version_parts[2]  // size
				];
				
				nupkg_url = nupkgAsset.browser_download_url;
				status = true;
			}
			else {
				status = true;
			}
		}
		catch(err) {
			console.log('GitHub check error:', err.toString())
			remote_version = err.toString();
		}
		resolve({status:status, isNew:isNew, remote_version:remote_version, version:version, nupkg_url:nupkg_url});
	})
}



function awaitMs(ms){
	return new Promise((resolve, reject) => {
		setTimeout(resolve, ms)
	})
}


tools.download = async (url, file, progress) => {
    return new Promise(async (resolve, reject) => {
        https.get(url, async (res) => {
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
                    progress({bytes:bytes, totalbytes:totalbytes, bps:(bps / scale)})
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


tools.id = () => {
	return '_' + (
		Number(String(Math.random()).slice(2)) +
		Date.now() +
		Math.round(performance.now())
	).toString(36);
}


tools.browserWindow = (template='default', options) => {
	return new Promise(async (resolve, reject) => {
		
		let win;
		let win_options = {};

		
		if(template == 'default'){
			win_options = { 
				webPreferences: {
					contextIsolation: false, 
					nodeIntegration:true, 
					webSecurity: false
				},
				backgroundColor:'rgb(50,50,50)',
				width: 640, 
				height: 520, 
				useContentSize: true,
				frame:false
			};
		}

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
		
		win = new BrowserWindow(win_options);
		if(options.file){ win.loadFile(options.file); }
		else if(options.url){ win.loadURL(options.url); }
		else if(options.html) {
			let ap = app.getAppPath();
			win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(options.html), {
				baseURLForDataURL: `raum://${ap}/`
			})
		}
		if(options.devTools){ win.toggleDevTools(); }
		win.webContents.once('did-finish-load', () => {
			resolve(win);
		})
		
	})
}


tools.listFiles = (dir, recursive=true, progress) => {
	if(!recursive){
		return fs.readdir(dir, { withFileTypes: true });
	}
	return new Promise(async (resolve, reject) => {
		let count = 0;
		const dirents = await fs.readdir(dir, { withFileTypes: true });
		const files = await Promise.all(dirents.map((dirent) => {
			count++
			if(progress) { progress(count); }
			const res = path.resolve(dir, dirent.name);
			return dirent.isDirectory() ? tools.listFiles(res) : res;
		}));
		resolve(Array.prototype.concat(...files));
	})
}

tools.copyFolder = (source, target, progress) => {
	return new Promise(async (resolve, reject) => {
		let files = await tools.listFiles(source);
		for(let i=0; i<2; i++){

		}
	})
}




/* Renderer
########################################################################################
 */

function renderWindow(type){
	let html = /*html*/ `
	<!DOCTYPE html>
	<html>
		<head>
			<title>Setup</title>
			<style>
                body {
                    position: relative;
                    font: caption;
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    font-weight: 400;
                    margin: 0;
                    padding:0;
                    height: 100%;
                    width: 100%;
                    overflow: hidden;
                    line-height: 1.5rem;
                    font-size: 1rem;
                    font-style: normal;
                    -webkit-tap-highlight-color: rgba(0,0,0,0);
                    font-display: optional;
                }

				body {
					--app-window-background:rgb(240,240,240);
					--app-window-titlebar-height: 3rem;
					--app-window-titlebar-color: rgb(255,255,255);
					--app-window-titlebar-background: rgb(120,120,120);
					--app-window-statusbar-height: 2rem;
					
					--space-base: 14;
					--space-frame: 2rem;

					--color-highlight: rgb(76, 132, 229);
					--color-highlight-dim: rgb(67, 112, 191);
					--color-shade0: 255,255,255;
                    --color-shadeX: 0,0,0;
                    --color-text: rgb(var(--color-shadeX));
                    --color-text-dim: rgb(50,50,50);

					--palette-gray: rgba(130,130,130);
					--palette-gray-hi: rgba(150,150,150);
					--palette-mark: rgb(203, 184, 55);
					--palette-mark-hi: rgb(197, 181, 83);
					--palette-activate: rgb(54, 137, 43);
					--palette-activate-hi: rgb(74, 178, 60);
					--palette-alert: rgb(181, 36, 36);
					--palette-alert-hi: rgb(222, 61, 61);

					--button-color-background: var(--color-highlight-dim);
					--button-color-highlight: var(--color-highlight);
					--button-color-text: rgba(var(--color-shade0),0.8);
					--button-color-text-hi: rgba(var(--color-shade0),1);
					--button-border-radius: 0.2rem;
					--button-border: solid thin transparent;
					--button-margin: 0.8rem;
					--button-font-size: 0.85rem;
					--button-min-width: 2.2rem;
					--button-min-height: 2.2rem;

					position: absolute;
					inset: 0;
					background-color: var(--app-window-background);
				}

				body.dark {
					--app-window-background: rgb(30,30,30);
					--app-window-titlebar-height: 3rem;
					--app-window-titlebar-color: rgb(200,200,200);
					--app-window-titlebar-background: rgb(40,40,40);
					--app-window-statusbar-height: 2rem;
					--color-shade0: 255,255,255;
                    --color-shadeX: 255,255,255;
                    --color-text: rgb(var(--color-shadeX));
                    --color-text-dim: rgb(200,200,200);

					--palette-gray: rgba(80,80,80);
					--palette-gray-hi: rgba(100,100,100);
					--palette-mark: rgb(203, 184, 55);
					--palette-mark-hi: rgb(197, 181, 83);
					--palette-activate: rgb(54, 137, 43);
					--palette-activate-hi: rgb(74, 178, 60);
					--palette-alert: rgb(181, 36, 36);
					--palette-alert-hi: rgb(222, 61, 61); 
				}

				a {
					text-decoration: unset;
					color: var(--color-highlight-dim);
					cursor: pointer;
				}

				a:hover {
					color: var(--color-highlight);
					border-bottom: solid thin var(--color-highlight);
				}
              
                .nui-app {
					position: absolute;
					inset: 0;
                    color: var(--color-text-dim);
				}

				.nui-app .card {
					margin-top: 1rem;
					margin-bottom: 1rem;
					padding-left: 4rem;
					padding-right: 4rem;
					
				}

				.nui-app .splash {
					display: flex;
				}

				.nui-app .splash h1{
					font-size: 2.5rem;
					font-weight: 200;
					margin-bottom: 1rem;
					margin-top: 3rem;
					color: var(--color-highlight);
				}

				.nui-app .content {
					display: block;
					padding: 0;
					position: absolute;
					top: var(--app-window-titlebar-height);
					left:0;
					right: 0;
					bottom: var(--app-window-statusbar-height);
					overflow-y: hidden;
					overflow-x: hidden;
					background-color: var(--app-window-background)
				}

				.nui-app .nui-status-bar {
					position: absolute;
					bottom:0;
					left:0;
					right: 0;
					height: var(--app-window-statusbar-height);
					background-color: rgba(var(--color-shadeX),0.05);
					border-top: solid thin rgba(var(--color-shadeX),0.1);
					display: flex;
					align-items: center;
					padding-left: 1rem;
					color: rgba(var(--color-shadeX),0.2)
				}

				.nui-app .nui-title-bar {
					position: absolute;
					top:0;
					left:0;
					right: 0;
					height: var(--app-window-titlebar-height);
					background-color: var(--app-window-titlebar-background);
					border-bottom: solid thin rgba(var(--color-shadeX),0.1);
					display: grid;
					grid-template-columns: auto auto;
					-webkit-user-select: none;
					-webkit-app-region: drag;
					z-index: 1;
				}

				.nui-app .nui-title-bar .title{
					color: var(--app-window-titlebar-color);
					height: 100%;
					display: flex;
					align-items: center;
					font-size: 0.9rem;
					text-transform: uppercase;
				}

				.nui-app .nui-title-bar .controls{
					display: flex;
					justify-content: flex-end;
				}

				.nui-app .nui-title-bar .title .label{
					
				}

				.nui-app .nui-title-bar .nui-icon-container{
					width: 4rem;
					height: 100%;
					cursor: pointer;
					-webkit-app-region: no-drag;
					transition: all 0.1s;
				}
				.nui-app .nui-title-bar .nui-icon-container.close:hover{
					background-color: var(--palette-alert-hi);
					color: white;
					fill: white;
				}

				.nui-app .nui-title-bar .title .nui-icon-container .nui-icon,
				.nui-app .nui-title-bar .controls .nui-icon {
					fill: var(--app-window-titlebar-color);
					color: var(--app-window-titlebar-color);
				}


				/* Nui Installer
				################################################################################################## */
				.nui-app .nui-title-bar {
					opacity: 0;
					transition: opacity 0.2s;
				}

				.nui-app .nui-status-bar {
					opacity: 0;
					transition: opacity 0.2s;
				}

				.nui-app .content {
					display: grid;
					grid-template-rows: auto 10rem;
				}

				.nui-app .content .steps {
					overflow: hidden;
					position: relative;
					overflow: hidden;
					width: 100%;
					height: 100%;
					border-top: solid thin rgba(var(--color-shadeX),0.1);
					background-color: rgba(var(--color-shadeX),0.02);
					transform: scaleY(0);
					transform-origin: bottom center;
					transition: transform 0.3s ease-in-out;
				}

				.nui-app .content .steps .wrap{
					position: absolute;
					width: 300%;
					height: 100%;
					top:0;
					left:0%;
					display: flex;
					flex-basis: 100%;
					transition: left 0.2s ease-out;
				}

				.nui-app .content .steps .step{
					padding-top: 2rem;
					width: 100%;
					height: 100%;
				}

				.nui-app .content .steps .step.start button{
					margin-bottom:0;
				}

				.nui-app .content .steps .step.progress .bar{
					display: block;
					width: 100%;
					height: 0.4rem;
					margin-top: 0.5rem;
					margin-bottom: 0.5rem;
					background-color: rgba(var(--color-shadeX),0.1);
				}

				.nui-app .content .steps .step.progress .status {
					display: grid;
					grid-template-columns: 50% 50%;
				}

				.nui-app .content .steps .step.progress .status .right{
					font-weight: 600;
					text-align: right;
				}

				.nui-app .content .steps .step.progress .info {
					opacity: 0.5;
				}

				.nui-app .content .steps .step.progress .bar .prog{
					width: 0%;
					height: 100%;
					background-color: var(--color-highlight-dim);
					transition: width 0.1s;
				}
				.nui-icon-container {
					height: 100%;
					display: flex;
					justify-content: center;
					align-items: center;
				}
				.nui-icon-container .nui-icon {
					width: 1.5rem;
					fill: var(--color-text-dim);
				}

				.install_widget .body {
					position: absolute;
					inset: 1.5rem;
					background-color: rgb(50,50,50);
					border-radius: 0.3rem;
					filter: drop-shadow(0 0 0.3rem rgba(0,0,0,0.4));
					color: white;
					padding: 1rem;
					-webkit-user-select: none;
					-webkit-app-region: drag;
					display: flex;
					align-items: center;
				}
				.install_widget .progress {
					width: 100%;
				}

				.install_widget .progress .bar{
					display: block;
					width: 100%;
					height: 0.4rem;
					margin-top: 0.5rem;
					margin-bottom: 0.5rem;
					background-color: rgba(var(--color-shadeX),0.1);
				}

				.install_widget .progress .status {
					display: grid;
					grid-template-columns: 50% 50%;
				}

				.install_widget .progress .status .right{
					font-weight: 600;
					text-align: right;
				}

				.install_widget .progress .info {
					opacity: 0.5;
				}

				.install_widget .progress .bar .prog{
					width: 0%;
					height: 100%;
					background-color: var(--color-highlight);
					transition: width 0.1s;
				}

				/* n000b Buttons */
				/* ######################################################################################### */

				.nui-button-container {
					display: flex;
					flex-wrap: wrap;
					align-items: center;
					justify-content: flex-start;
					width: 100%;
				}

				.nui-button-container > *:last-child {
					margin-right: unset;
				}

				.nui-button-container.right{
					justify-content: flex-end;
				}

				.nui-button-container.right > *:last-child {
					margin-right: unset;
				}

				.nui-button-container label{
					display: flex;
					align-items: center;
					height: var(--button-min-height);
					margin-bottom: var(--button-margin);
				}


				.nui-button-container .nui-input {
					vertical-align:top;
					padding: 0;
					margin: 0;
					width: auto;
					margin-bottom: var(--button-margin);
					margin-right: calc(var(--button-margin) - 0.3rem);
					display: inline-flex;
				}

				.nui-button-container .nui-input input,
				.nui-button-container .nui-input textarea{
					display: inline-block;
					min-height: var(--button-min-height);
					min-width: var(--button-min-width);
					padding:0;
					margin: 0;
					outline: 0;
					padding-left: 0.8rem;
					padding-right: 0.8rem;
					
				}

				.nui-button-container .superSelect {
					display: inline-flex;
					position: relative;
					min-height: var(--button-min-height);
					min-width: calc(var(--button-min-width)*4);
					margin-bottom: var(--button-margin);
					margin-right: calc(var(--button-margin) - 0.3rem);
				}


				button,
				input[type="button"],
				input[type="reset"],
				input[type="submit"] {
					position: relative;
					text-transform: uppercase;
					user-select: none;
					white-space: nowrap;
					min-height: var(--button-min-height);
					min-width: var(--button-min-width);
					margin-bottom: var(--button-margin);
					margin-right: calc(var(--button-margin) - 0.3rem);
					font-size: var(--button-font-size);
					line-height: var(--button-font-size);
					padding-left: calc(var(--button-font-size)*2);
					padding-right: calc(var(--button-font-size)*2);
					color: var(--button-color-text);
					background-color: var(--button-color-background);
					border: var(--button-border);
					border-radius: var(--button-border-radius);
					transition: all 0.2s ease-out;
					transition-property: background-color, color;
					display: inline-flex;
					align-items:center;
					justify-content: center;
					cursor: pointer;
					appearance: none;
					font-family: inherit;
					vertical-align:top;
					--icon-base: 18;
					--icon-scale: calc(var(--space-base)/var(--icon-base));
				}


				button:hover,
				input[type="button"]:hover,
				input[type="reset"]:hover,
				input[type="submit"]:hover {
					background: var(--button-color-highlight);
					color: var(--button-color-text-hi);
				}

				button:disabled,
				input[type="button"]:disabled,
				input[type="reset"]:disabled,
				input[type="submit"]:disabled {
					opacity: 0.4;
					pointer-events: none;
				}

				button:focus,
				input[type="button"]:focus,
				input[type="reset"]:focus,
				input[type="submit"]:focus {
					outline: 0;	
				}

				/* Button Flash */
				button:after {
					content: '';
					position: absolute;
					top: 0;
					left: 0;
					width: 100%;
					height: 100%;
					background-color: white;
					opacity: 0;
					pointer-events: none;
				}
				button:active:after { opacity: 0.2;}
				button:not(:active):after { transition: opacity 0.5s; } 



				button.progress {
					background: var(--palette-gray);
					pointer-events: none;
				}

				button.progress{
					color: rgba(0,0,0,0);
				}

				button.progress::before {
					
					position: absolute;
					content: '';
					width: 24px;
					height: 24px;
					z-index: 1;
					transform: scale(var(--icon-scale));
					background-color: var(--button-color-text);
					animation: button_progress_animation 3s linear infinite;
					clip-path: path('M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z');
				}

				@keyframes button_progress_animation {
					0% {
					transform: scale(var(--icon-scale)) rotate(0deg);
					}
					100% {
					transform: scale(var(--icon-scale)) rotate(360deg);
					}
				}
				
				button[type="submit"],
				button[type="send"],
				input[type="submit"] {
					background-color: var(--palette-activate);
				}

				button[type="submit"]:hover,
				button[type="send"]:hover,
				input[type="submit"]:hover {
					background-color: var(--palette-activate-hi);
				}

				button[type="reset"],
				input[type="reset"] {
					background-color: var(--palette-gray);
				}

				button[type="reset"]:hover,
				input[type="reset"]:hover {
					background-color: var(--palette-gray-hi);
				}

				button[type="outline"] {
					background-color: transparent;
					border: solid var(--border-thickness) var(--palette-gray);
					color: rgba(var(--color-shadeX),0.7);
				}

				button[type="outline"]:hover{
					background-color: var(--palette-gray);
					border: solid var(--border-thickness) transparent;
					color: var(--button-color-text-hi);
				}

				button[type="delete"] {
					background-color: var(--palette-alert);
				}

				button[type="delete"]:hover{
					background-color: var(--palette-alert-hi);
				}


				button .nui-icon {
					margin-right: 0.5rem;
					width: 1.3rem;
					height: 1.3rem;
					fill: var(--button-color-text);
				}




			</style>
		</head>
		<body class="dark">
			<div class="install_widget" style="display:none">
				<div class="body">
					<div class="progress">
						<div class="status"><div class="left">Download Update</div><div class="right">0%</div></div>
						<div class="bar"><div class="prog"></div></div>
						<div class="info"></div>
					</div>
				</div>
			</div>
			<div class="install_splash">
				<div class="nui-app">
					<div class="nui-title-bar">
						<div class="title">
							<div class="nui-icon-container" onclick="document.body.classList.toggle('dark')">
								<svg class="nui-icon" xmlns="http://www.w3.org/2000/svg" height="48" viewBox="0 -960 960 960" width="48"><path d="M140-180v-480 480Zm240-540h200v-100H380v100ZM140-120q-24 0-42-18t-18-42v-480q0-24 18-42t42-18h180v-100q0-24 18-42t42-18h200q24 0 42 18t18 42v100h180q24 0 42 18t18 42v231q-14-11-28.5-19T820-463v-197H140v480h345q2.8 15.836 8.4 30.918Q499-134 506-120H140Zm590 4 113-113-21-21-77 77v-171h-30v171l-77-77-21 21 113 113Zm0 76q-78 0-134-55.4-56-55.399-56-133.999Q540-308 596-364t134-56q78 0 134 55.867Q920-308.265 920-229q0 78.435-56 133.718Q808-40 730-40Z"/></svg>
							</div>
							<div class="label">Update</div>
						</div>
						<div class="controls">
							<div class="nui-icon-container close"><svg class="nui-icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#000000"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg></div>
						</div>
					</div>
					<div class="content">
						<div class="card splash">
							<div class="info">
								<h1>...</h1>
								<div class="version">...</div>
								<div class="company" style="margin-top: 3rem; margin-bottom: 1rem;">
									<div>Fa. David A. Renelt</div>
									<div>New Media Development</div>
									<div><a href="mailto:admin@raum.com">admin@raum.com</a></div>
								</div>
							</div>
						</div>
						<div class="steps">
							<div class="wrap">
								<div class="step start">
									<div class="card">
										<div class="nui-button-container right">
											<div class="remote_version" style="margin-right: auto;">
													...
											</div>
											<button type="reset" id="btn_abort" class="">Ignore</button>
											<button id="btn_install" class="">Update</button>
										</div>
									</div>
								</div>
								<div class="step progress">
									<div class="card">
										<div class="status"><div class="left"></div><div class="right">100%</div></div>
										<div class="bar"><div class="prog"></div></div>
										<div class="info"></div>
									</div>
								</div>
								<div class="step finish">
									<div class="card">
										<div class="nui-button-container right">
											<div class="" style="margin-right: auto;">Installation Complete</div>
											<button id="btn_startapp">Start App</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
					<div class="nui-status-bar"></div>
				</div>
			</div>
		</body>
	
		<script type="module">
			const { ipcRenderer } = require( "electron" );
			let g = {};
			g.type = '${type}';
	
			let el = (query) => document.querySelector(query);
			g.prog_status_left = el('.install_splash .progress .status .left');
			g.prog_status_right = el('.install_splash .progress .status .right');
			g.prog_bar = el('.install_splash .progress .prog');
			g.prog_info = el('.install_splash .progress .info');
			if(g.type == 'widget'){
				el('.install_splash').style.display = 'none';
				el('.install_widget').style.display = null;
				g.prog_status_left = el('.install_widget .progress .status .left');
				g.prog_status_right = el('.install_widget .progress .status .right');
				g.prog_bar = el('.install_widget .progress .prog');
				g.prog_info = el('.install_widget .progress .info');
				document.body.style.backgroundColor = 'transparent';
			}
	

			ipcRenderer.on('event', (e, data) => {
				if(data.type == 'version'){
					renderSplash(data.data);
				}
				if(data.type == 'state'){
					changeState(data.data);
				}
				if(data.type == 'download'){
					progress(data.data);
				}
				if(data.type == 'log' || data.type == 'autoupdate' || data.type == 'state'){
					console.log(data.data);
				}
			})

			el('.nui-title-bar .close').addEventListener('click', (e) => { command('app_exit') })
			el('#btn_install').addEventListener('click', (e) => { command('run_update') })
			el('#btn_abort').addEventListener('click', (e) => { command('app_exit') })

			function command(msg){
				ipcRenderer.send('command', msg);
			}

			function renderSplash(data){
				el('.splash .info h1').innerHTML = data.name;
				el('.splash .info .version').innerHTML = data.version;
				el('.steps .remote_version').innerHTML = 'Version ' + data.remote_version + ' is available';
				if(data.company) {
					el('.splash .info .company').innerHTML = data.company;
				}
			}

			function changeState(data){

				if(data == 1){
					el('.nui-title-bar').style.opacity = 1;
					el('.nui-status-bar').style.opacity = 1;
					el('.steps').style.transform = 'scaleY(1)';
				}
				if(data == 2){
					g.prog_status_left.innerHTML = 'Downloading update file';
					el('.steps .wrap').style.left = '-100%';
				}
				if(data == 3){
					g.prog_status_left.innerHTML = 'Preparing update';
					el('.steps .wrap').style.left = '-100%';
				}
			}

			function progress(data){
				if(data.bytes){
					let proz = (data.bytes / data.totalbytes) * 100;
					g.prog_status_right.innerText = Math.round(proz) + '%';
					g.prog_bar.style.width = proz + '%';
					g.prog_info.innerText = '(' + ((data.bps/1024/1024)*8).toFixed(2) + 'mbps)';
				}
			}
		</script>
	</html>
	`
	return html;
}


module.exports.init = init;
module.exports.checkVersion = checkVersion;