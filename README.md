# electron_helper

A dual-context Electron helper library providing unified IPC communication, window management, file operations, config persistence, and auto-updating between main and renderer processes.

**Version:** 2.0.0 (2025-09-23)

---

## Architecture

### Dual-Context Module

The helper is a **single module** that runs in TWO different Electron contexts, detecting its environment via `process.type`:

| Context | Detection | Role |
|---------|-----------|------|
| Main Process | `process.type === 'browser'` | Registers IPC handlers, file protocols, manages resources |
| Renderer Process | `process.type === 'renderer'` | Exposes `window.electron_helper` proxy API via preload |

### Startup Flow

```
Main Process (require)          Renderer Process (preload)
─────────────────────           ────────────────────────────
const helper = require(…)  →    preload: helper_new.js
protocol.registerSchemes   →    window.electron_helper = exp
ipcMain.handle(api, …)     ←→  ipcRenderer.invoke(api, …)
app.on('will-quit', …)          error handlers installed
```

### Security Model

- `nodeIntegration: true, contextIsolation: false` — renderer has full Node access
- No `contextBridge` — helper attaches directly to `window.electron_helper`
- `webSecurity: false` — allows cross-origin requests
- `backgroundThrottling: false` — prevents throttling when window is hidden

---

## Quick Start

### Main Process (app.js)

```js
const helper = require('./electron_helper/helper_new.js');

// global.env is available for cross-process data
global.env = { appPath: app.getAppPath() };

// Create window — helper is used as preload
const win = await helper.tools.browserWindow('frameless', {
  webPreferences: {
    preload: path.join(__dirname, 'electron_helper/helper_new.js')
  },
  html: `<!DOCTYPE html><html>…</html>`
});
```

### Renderer Process (stage.js)

```js
// Available after DOMContentLoaded when preload is set
const env = await window.electron_helper.global.get('env');
await window.electron_helper.window.show();
const config = await window.electron_helper.tools.readJSON(configPath);
```

---

## API Reference

### `window` — BrowserWindow Control

All methods are async and communicate via IPC from renderer to main.

| Method | Renderer Signature | Returns |
|--------|-------------------|---------|
| `close()` | `electron_helper.window.close()` | `{status}` |
| `show()` | `electron_helper.window.show()` | `{status}` |
| `hide()` | `electron_helper.window.hide()` | `{status}` |
| `focus()` | `electron_helper.window.focus()` | `{status}` |
| `toggleDevTools()` | `electron_helper.window.toggleDevTools()` | `{status}` |
| `center()` | `electron_helper.window.center()` | `{status}` |
| `setPosition(x, y)` | `electron_helper.window.setPosition(x, y)` | `{status}` |
| `setBounds(rect)` | `electron_helper.window.setBounds({x,y,width,height})` | `{status}` |
| `setSize(w, h)` | `electron_helper.window.setSize(width, height)` | `{status}` |
| `setFullScreen(flag)` | `electron_helper.window.setFullScreen(true)` | `{status}` |
| `isFullScreen()` | `electron_helper.window.isFullScreen()` | `boolean` |
| `isVisible()` | `electron_helper.window.isVisible()` | `boolean` |
| `getBounds()` | `electron_helper.window.getBounds()` | `{x,y,width,height}` |
| `getPosition()` | `electron_helper.window.getPosition()` | `[x, y]` |
| `getId()` | `electron_helper.window.getId()` | `number` |
| `hook_event(name, cb)` | `electron_helper.window.hook_event('closed', cb)` | listener |

```js
// Example: listen for window close
await electron_helper.window.hook_event('closed', (e, data) => {
  console.log('Window closed');
});
```

### `global` — Cross-Process Key/Value Storage

Maps to Node's `global` object. Primary mechanism for bootstrapping data.

| Method | Signature | Notes |
|--------|-----------|-------|
| `get(name, clone)` | `get('env', true)` | `clone=true` (default) serializes via JSON. Returns `undefined` for missing keys |
| `set(name, data)` | `set('env', {path:'…'})` | Handles `undefined`/`null` via special markers |

```js
// Main process
global.env = { appPath: '/path/to/app', config: {} };

// Renderer process
const env = await electron_helper.global.get('env');
await electron_helper.global.set('myData', { key: 'value' });
```

### `screen` — Display Information

| Method | Returns |
|--------|---------|
| `getPrimaryDisplay()` | Display object (bounds, scaleFactor, etc.) |
| `getAllDisplays()` | Array of Display objects |

```js
const primary = await electron_helper.screen.getPrimaryDisplay();
console.log(primary.bounds); // {x, y, width, height}
```

### `app` — App Lifecycle & Info

| Method | Returns |
|--------|---------|
| `exit()` | — (cleans temp, exits) |
| `isPackaged()` | `boolean` |
| `getAppPath()` | `string` |
| `getPath(name)` | `string` — e.g. `'userData'`, `'temp'`, `'desktop'` |
| `getName()` | `string` |
| `getExecPath()` | `string` — parent directory of executable |
| `getVersions()` | `{node, electron, chrome, v8, …}` |

### `dialog` — File Dialogs

| Method | Signature | Returns |
|--------|-----------|---------|
| `showOpenDialog(options)` | `showOpenDialog({properties:['openFile'], filters:[…]})` | `{canceled, filePaths, bookmarks}` |

```js
const result = await electron_helper.dialog.showOpenDialog({
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Images', extensions: ['png', 'jpg'] }]
});
if (!result.canceled) {
  console.log(result.filePaths);
}
```

### `shell` — OS Shell Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `showItemInFolder(path)` | `showItemInFolder('C:\\file.txt')` | Opens file explorer at file location |
| `openPath(path)` | `openPath('C:\\file.txt')` | Opens file with default application |

### `tools` — Utilities

#### File Operations

| Method | Signature | Returns | Context |
|--------|-----------|---------|---------|
| `readJSON(fp)` | `readJSON('config.json')` | `object` | Both |
| `writeJSON(fp, data)` | `writeJSON('config.json', obj)` | — | Both |
| `fileExists(fp)` | `fileExists('path/to/file')` | `boolean` | Both |
| `ensureDir(fp)` | `ensureDir('path/to/dir')` | `'there already'` / `'folder created'` | Both |
| `getFiles(fp, filter)` | `getFiles('./dir', ['.png'])` | `string[]` — flat listing | Both |
| `getFilesRecursive(fp, filter)` | `getFilesRecursive('./dir', ['.js'])` | `string[]` — recursive | Both |
| `getFilesR(dir)` | `getFilesR('./dir')` | `string[]` — recursive, no filter | Both |
| `checkFileType(fp, filter)` | `checkFileType('img.png', ['.png'])` | `boolean` | Both |

#### Window Factory

| Method | Signature | Returns |
|--------|-----------|---------|
| `browserWindow(template, options)` | See below | `BrowserWindow` (main) / `windowId` (renderer) |

**Templates:** `'default'`, `'frameless'`, `'nui'`

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `webPreferences` | `object` | Override webPreferences (preload, devTools, etc.) |
| `html` | `string` | Inline HTML content (data URL) |
| `file` | `string` | Load from file path |
| `url` | `string` | Load from URL |
| `devTools` | `boolean` | Auto-toggle dev tools |
| `parentID` | `number` | Parent window ID for modal |
| `modal` | `boolean` | Modal window |
| `init_data` | `object` | Data sent to renderer via `init_data` event |
| `width`, `height` | `number` | Window dimensions |

```js
// From renderer — creates window via IPC, returns window ID
const winId = await electron_helper.tools.browserWindow('frameless', {
  width: 800,
  height: 600,
  html: `<!DOCTYPE html><html><body>Hello</body></html>`
});

// From main — returns BrowserWindow instance directly
const win = await electron_helper.tools.browserWindow('default', {
  file: path.join(__dirname, 'settings.html')
});
```

#### IPC Messaging

| Method | Signature | Description |
|--------|-----------|-------------|
| `sendToMain(channel, data)` | `sendToMain('my-channel', payload)` | Renderer → Main custom IPC |
| `sendToId(id, channel, data)` | `sendToId(winId, 'event', data)` | Main → Specific window |
| `broadcast(channel, data)` | `broadcast('update', data)` | Main → All windows |

#### Download

| Method | Signature | Returns |
|--------|-----------|---------|
| `download(url, file, progress)` | `download(url, dest, (prog) => {…})` | `{status, msg}` |

```js
const result = await electron_helper.tools.download(
  'https://example.com/file.zip',
  'C:\\downloads\\file.zip',
  (progress) => {
    console.log(`${(progress.bytes / progress.totalbytes * 100).toFixed(0)}%`);
  }
);
```

#### Image Utilities

| Method | Signature | Returns | Context |
|--------|-----------|---------|---------|
| `loadImage(fp)` | `loadImage('path/to/img.png')` | `HTMLImageElement` | Renderer |
| `drawImageDummy(text, w, h)` | `drawImageDummy('Missing', 800, 600)` | `HTMLImageElement` | Renderer |

#### Other Utilities

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `id()` | `id()` | `string` | Unique identifier (base36) |
| `path` | `path.join(…)` | — | Node `path` module reference |
| `fs` | `fs.readFile(…)` | — | Node `fs.promises` reference |
| `medianAverage(ring)` | `medianAverage([1,2,3,4,5])` | `number` | Trimmed mean (drops min/max) |
| `headCSS(css)` | `headCSS('body{…}')` | `HTMLStyleElement` | Inject CSS into `<head>` |
| `versionInfo(target, opts)` | `versionInfo(document.body)` | — | Show Node/Electron/Chrome versions (auto-removes after 5s) |
| `isAdmin()` | `isAdmin()` | `boolean` | Check Windows admin privileges |
| `jRequest(url, method, data)` | `jRequest(url, 'GET')` | `object` | HTTP/HTTPS JSON client |
| `subWindow(html, opts)` | `subWindow(html, {cloneCSS:true})` | `Window` | Open child browser window |

---

## Config System

The config system provides persistent, watched, debounced configuration with backup/restore and migration support.

### Main Process

```js
const config = await electron_helper.config.initMain('settings', {
  theme: 'dark',
  volume: 0.8,
  window: { width: 800, height: 600 }
}, {
  migrate: (loaded, defaults) => {
    // Repair/upgrade old config shapes
    if (!loaded.window) loaded.window = defaults.window;
    return loaded;
  },
  log: false,       // Enable config operation logging
  force: false      // Delete existing config and start fresh
});

// Direct access in main
config.get();       // { theme: 'dark', … }
config.set({ theme: 'light' });
config.path;        // Full path to config file
```

### Renderer Process

```js
const config = await electron_helper.config.initRenderer('settings', (newData) => {
  // Called when another process updates the config
  console.log('Config updated:', newData);
});

// Local access
config.get();       // Current config (always up-to-date via IPC)
config.set({ volume: 0.5 });  // Optimistic local update + IPC sync
```

### Config Features

- **Debounced writes:** Changes are batched (500ms delay, 3s interval flush)
- **Backup/restore:** `.bak` file created before overwrites; auto-restored on corruption
- **Migration hook:** `migrate(loaded, defaults)` lets you transform old config shapes
- **IPC broadcast:** All renderers receive `config-updated-{name}` events automatically

---

## Auto-Updater (`update.js`)

Separate module for application updates. Main process only.

```js
const updater = require('./electron_helper/update.js');

// Before creating main window
const updating = await updater.init({
  url: 'https://example.com/updates/',
  source: 'http',     // 'http' or 'git'
  mode: 'splash',     // 'splash', 'widget', 'silent'
  useSemVer: true,    // Enable semantic version comparison
  start_delay: 1000,
  progress: (event) => { console.log(event.type, event.data); }
});

if (updating) {
  // Update is in progress — app will quit after install
  return;
}
// No update — continue with normal startup
```

### Update Sources

| Source | Config | Description |
|--------|--------|-------------|
| HTTP | `url` + `RELEASES` file | Custom server with Squirrel.Windows RELEASES file |
| GitHub | `source: 'git'`, `url: 'owner/repo'` | GitHub API, finds `RELEASES` and `.nupkg` assets |

### UI Modes

| Mode | Behavior |
|------|----------|
| `splash` | Full update window with ignore/update buttons |
| `widget` | Floating transparent progress bar (top-center) |
| `silent` | No UI, downloads and installs in background |

---

## Custom Protocol: `raum://`

The helper registers a custom `raum://` file protocol for local asset loading:

```
raum://D:/path/to/file.png  →  file:///D:/path/to/file.png
```

Used internally by `tools.loadImage()` and `tools.getFileURL()`.

---

## Exposed Namespaces

The module exports these on `window.electron_helper` (renderer) and `module.exports` (main):

| Namespace | Contents |
|-----------|----------|
| `window` | BrowserWindow control methods |
| `global` | Cross-process key/value storage |
| `screen` | Display information |
| `app` | App lifecycle/info methods |
| `dialog` | File dialog methods |
| `shell` | OS shell operations |
| `tools` | File I/O, window factory, IPC, downloads, images, utilities |
| `config` | Config management (`initMain`, `initRenderer`) |
| `id` | Current window ID (set by main after `dom-ready`) |
| `ipcInvoke` | Raw IPC invoke (advanced) |
| `ipcHandle` | Raw IPC handle registration (main only) |
| `ipcHandleRenderer` | Raw IPC listener (renderer only) |
| `log` | Logging utility with buffer |
| `setGlobal` | Set value on Node `global` object |

---

## Files

| File | Purpose |
|------|---------|
| `helper_new.js` | Core helper — dual-context IPC, window management, tools, config |
| `update.js` | Auto-updater with HTTP/GitHub sources and UI modes |
| `test.js` | API test harness |

---

## Logging

The `fb()` function logs with context prefix:
- Main: `main_helper\t<message>`
- Renderer: `helper\t<message>`

Config logging can be enabled per-config with `{ log: true }` or globally via `ELECTRON_HELPER_CONFIG_LOG=1`.
