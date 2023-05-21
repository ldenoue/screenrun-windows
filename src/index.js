const { nativeImage, dialog, shell, app, BrowserWindow, desktopCapturer, screen, /*systemPreferences,*/ globalShortcut, ipcMain, Menu, Tray } = require('electron')
const path = require('path')
const shortCut = 'CommandOrControl+F1'
const isWindows = process.platform === 'win32'

const pathToFfmpeg = require('ffmpeg-static');
console.log(pathToFfmpeg);
const { exec } = require('child_process');

const appName = 'ScreenRun'
// https://github.com/electron/electron/pull/27572
let roundedCorners = true
const { writeFile, writeFileSync, rename, unlinkSync } = require('fs')
//console.log(writeFile)
const prompt = require('electron-prompt');
const Store = require('./store.js');
const store = new Store({
  // We'll call our data file 'user-preferences'
  configName: 'user-preferences',
  defaults: {
    showMenu: !isWindows,
    showDock: true,
    textOverlay: appName,
    background: 'bigsur.jpg'
  }
});

const { windowManager } = require('node-window-manager')

const windowWidth = 320
const windowHeight = 240
let screenWidth = 1280
let screenHeight = 720

/*windowManager.on("window-activated", (window) => {
  console.log('activated',window.getTitle(),window.id,mainWindowId);
});*/

let menu = null;
let mainWindow = null;
let mouseClicks = []
let startTime = null
let tray = null

let capturedWindows = {}
let interval = null

function unhighlight(mediaSourceId) {
  highlightWindowId = null
  startTime = null
  console.log('mouseClicks=',mouseClicks)
  let id = parseInt(mediaSourceId.split(':')[1])
  if (capturedWindows[id]) {
    let res = capturedWindows[id]
    res.highlightWindow.close();
    mainWindow.webContents.send("fromMain", {stop:mediaSourceId});
    delete capturedWindows[id]
  }
}

async function toggleCapture() {
  let mousePos = screen.getCursorScreenPoint();
  let w = await windowUnderPoint(mousePos)
  if (!w)
    return;
  if (capturedWindows[w.id]) {
    unhighlight(capturedWindows[w.id].mediaSourceId)
  } else {
    let res = await highlight(w,w.mediaSourceId);
    if (res) {
      capturedWindows[w.id] = res
      mainWindow.webContents.send("fromMain", {start: res.mediaSourceId});
    }
  }
}

function sameBounds(b1,b2) {
  return b1.x === b2.x && b1.y === b2.y && b1.width === b2.width && b1.height === b2.height
}

function repositionWindows() {
  if (!highlightWindowId)
    return
  let capturedWindowIds = Object.keys(capturedWindows).map(i => parseInt(i))
  let windows = windowManager.getWindows()
  let visibleWindows = windows.map(w => w.id)
  let recompute = false
  for (let capturedId of capturedWindowIds) {
    if (visibleWindows.indexOf(capturedId) === -1) {
      recompute = true
      unhighlight(capturedWindows[capturedId].mediaSourceId)
    }
  }
  if (recompute)
    capturedWindowIds = Object.keys(capturedWindows).map(i => parseInt(i))

    if (capturedWindowIds.length === 0)
    return
  let capturedWindowId = capturedWindowIds[0]
  let capturedWindowSeen = false
  let highlightWindowUnder = false
  let myWnd = null
  for (let w of windows) {
    if (w.id === capturedWindowId)
      capturedWindowSeen = true
    if (w.id === highlightWindowId && !capturedWindowSeen)
      highlightWindowUnder = true
    let wnd = capturedWindows[w.id]
    if (wnd) {
      myWnd = wnd
      try {
        capturedBounds = w.getBounds()
        let oldBound = wnd.highlightWindow.oldBound;//getBounds()
        let newBound = adjustBounds(capturedBounds)
        if (!sameBounds(oldBound,newBound)) {
          wnd.highlightWindow.oldBound = newBound
          wnd.highlightWindow.setBounds(newBound)
        }
      } catch (e) {
      }
    }
  }
  if (!highlightWindowUnder) {
    try {
      myWnd.highlightWindow.moveAbove(myWnd.mediaSourceId)
    } catch (e) {}
    if (startTime) {
      let mousePos = {...screen.getCursorScreenPoint()};
      mousePos.x -= capturedBounds.x
      mousePos.y -= capturedBounds.y
      mousePos.type = 'click'
      mousePos.ts = Date.now() - startTime
      mouseClicks.push(mousePos)
      console.log(mousePos)
    }
  }
}

let highlightWindowId = null
let capturedBounds = null
function adjustBounds(bounds) {
  if (isWindows)
    return {x: bounds.x + 4 , y: bounds.y, width: bounds.width - 10, height: bounds.height - 6}
  else
    return {x: bounds.x - 2 , y: bounds.y - 2, width: bounds.width + 4, height: bounds.height + 4}
}

async function highlight(window,mediaSourceId) {
  console.log('highlight',window.id)
  mouseClicks = []
  let windowId = window.id
  let bounds = adjustBounds(window.getBounds())
  let windowsBefore = windowManager.getWindows().map(w => w.id)
  // TODO: check win.moveAbove(mediaSourceId
  // see https://www.electronjs.org/docs/latest/api/browser-window
  let highlightWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height, 
    transparent: true,
    frame: false,
    //title: 'ScreenRunOverlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // is default value after Electron v5
      contextIsolation: true, // protect against prototype pollution
    }
  })
  //highlightWindow.setTitle('ScreenRunOvelay')
  //highlightWindow.setAlwaysOnTop(true)
  highlightWindow.oldBound = bounds
  highlightWindow.loadURL(`file://${__dirname}/highlight.html`)
  highlightWindow.setBounds(bounds);
  highlightWindow.setIgnoreMouseEvents(true)

  highlightWindow.webContents.on('did-finish-load', function() {
    setTimeout(() => {
      let windowsAfter = windowManager.getWindows().map(w => w.id)
      let difference = windowsAfter.filter(x => !windowsBefore.includes(x));
      console.log('difference=',difference)
      highlightWindowId = difference[0]
    }, 1000)
  });

  //highlightWindow.webContents.openDevTools()
  return {highlightWindow,mediaSourceId,windowId}
}

function containsPoint(box,pos) {
  if (pos.x < box.x)
    return false
  if (pos.y < box.y)
    return false
  if (pos.x > (box.x + box.width))
    return false
  if (pos.y > (box.y + box.height))
    return false
  return true
}

let myid = process.pid//require('electron').remote.getCurrentWebContents().getOSProcessId();
//console.log('myid=',myid)

async function windowUnderPoint(pos) {
  const inputSources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {width: 0, height: 0},
  })
  let ids = {}
  for (let src of inputSources) {
    let id = parseInt(src.id.split(':')[1])
    ids[id] = src.id
  }
  //console.log(ids)
  let windows = windowManager.getWindows().filter(w => {
    //return w.path.indexOf('/System/Library/CoreServices') === -1 && w.processId !== myid
    return w.processId !== myid && ids[w.id]
  });
  //console.log(windows)
  let res = null
  for (let w of windows) {
    //console.log(w.path)
    //console.log(w.isVisible)
    //if (w.isVisible()) {
      //console.log(w.path)
      let bounds = w.getBounds()
      //console.log(pos,bounds)
      if (containsPoint(bounds,pos))
      {
        //console.log('found=',pos,bounds)
        res = w
        res.mediaSourceId = ids[w.id]
        //console.log(res.id,res.mediaSourceId)
        return res;
      }
    //}
  }
  return res
}

/*function showHelp() {
  if (helpWindow)
    return helpWindow.show()
  helpWindow = new BrowserWindow({
    title: 'ScreenRun Help',
    width: 800,
    height: 600,
    x: screenWidth/2-400,
    y: screenHeight/2-300,
    //frame: false,
    show: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false, // is default value after Electron v5
      contextIsolation: true, // protect against prototype pollution
    }
  })

  helpWindow.menuBarVisible = false
  // and load the index.html of the app.
  helpWindow.loadFile(path.join(__dirname,'welcome.html'))

  helpWindow.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    shell.openExternal(url);
  });
  helpWindow.webContents.on('did-finish-load', function() {
    helpWindow.show();
  });

  helpWindow.on('close', () => {
    helpWindow = null
  })
}*/

function createWindow (callback) {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    icon: getIcon(),
    title: 'ScreenRun Share',
    x: (screenWidth-windowWidth)/2,
    y: (screenHeight-windowHeight)/2,
    width: windowWidth,
    height: windowHeight,
    //acceptFirstMouse: true,
    frame: false,
    //transparent: true,
    skipTaskbar: true, // for Windows: we don't want user to close our windows
    roundedCorners: roundedCorners,
    resizable: false,
    opacity: 0.99, // for Windows to always repaint the window even when outside of the screen
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // is default value after Electron v5
      contextIsolation: true, // protect against prototype pollution
    }
  })

  mainWindow.hide()
  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname,'index.html'))

  mainWindow.webContents.on('did-finish-load', function() {
    callback();
  });
  // Open the DevTools.
  //mainWindow.webContents.openDevTools()
}

async function promptNow(title,label,value) {
  let res = await prompt({
    height:200,
    title: title,
    label: label,
    value: value,
    inputAttrs: {
        type: 'text'
    },
    type: 'input'
  })
  return res;
}

/*async function createPreviewWindow (w,h,callback) {
  previewWindow = new BrowserWindow({
    icon: getIcon(),
    acceptFirstMouse: true, // macOS
    title: '',
    width: previewRect.width,
    height: previewRect.height,
    x: w - previewRect.width - BORDER,
    y: BORDER,
    frame: false,
    resizable: false,
    skipTaskbar: true, // for Windows: we don't want user to close our windows
    roundedCorners: roundedCorners,
    webPreferences: {
      // see https://stackoverflow.com/questions/44391448/electron-require-is-not-defined
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // is default value after Electron v5
      contextIsolation: true, // protect against prototype pollution
    }
  })

  // and load the index.html of the app.
  previewWindow.loadFile(path.join(__dirname,'preview-index.html'))

  previewWindow.webContents.on('did-finish-load', function() {
    callback();
  });
  // Open the DevTools.
  //previewWindow.webContents.openDevTools()
}*/

// see https://github.com/mran3/Text-File-Loader-Build/blob/master/main.js
if(require('electron-squirrel-startup')) {
  // see https://github.com/daltonmenezes/electron-screen-recorder/blob/master/src/main/index.js
  console.log('quit')
  app.quit()
  return
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {

  const primaryDisplay = screen.getPrimaryDisplay()
  //console.log(primaryDisplay)
  //const { width, height } = primaryDisplay.workAreaSize
  const { width, height } = primaryDisplay.size
  screenWidth = width
  screenHeight = height

  const ret = globalShortcut.register(shortCut, () => {
    //console.log(shortCut + ' is pressed')
    toggleCapture();
  })

  if (!ret) {
    console.log('registration failed')
  }

  // Check whether a shortcut is registered.
  //console.log(globalShortcut.isRegistered(shortCut))
  createWindow(() => {
    if (app.dock) app.dock.hide();
    tray = new Tray(getIcon());
    updateMenu()
    if (process.platform === 'win32') {
      tray.on('click', () => tray.popUpContextMenu(menu));
    }
    tray.setToolTip(appName);
    setTimeout(() => {
      interval = setInterval(() => repositionWindows(),100)
    },100);
  })

  app.on('activate', async function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  dialog.showMessageBoxSync({
    message: appName,
    detail: 'Record any window by moving your cursor over it and press Command F1',
    defaultId: 0,
    buttons: ['Ok']
  })
})

app.on('will-quit', () => {
  console.log('will-quit')
  clearInterval(interval)
  // Unregister a shortcut.
  globalShortcut.unregister(shortCut)
  // Unregister all shortcuts.
  globalShortcut.unregisterAll()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  console.log('all closed, quitting')
  if (process.platform !== 'darwin') app.quit()
})

const getRecodingIcon = () => {
  return path.join(__dirname, '/assets/icon.png');
}

const getIcon = () => {
  //return path.join(__dirname, '/assets/icon.png');
  return path.join(__dirname, '/assets/icon.png');
};

app.on('ready', function() {
  //console.log('ready')
});


const updateMenu = () => {
  menu = Menu.buildFromTemplate([
    {
      label: 'Command F1 to record the window under cursor',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Contact <laurent@appblit.com>',
      click() { shell.openExternal("mailto:laurent@appblit.com?subject=ScreenRun") },
      //accelerator: 'CommandOrControl+Q'
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click() {
        clearInterval(interval)
        app.quit();
      },
      //accelerator: 'CommandOrControl+Q'
    }
  ]);
  tray.setContextMenu(menu)
};

/*const ffmpeg = require("ffmpeg.js/ffmpeg-mp4")

function webmToMp4(webmData) {
	let stderr = ""

	return ffmpeg({
		MEMFS: [{
			name: "input.webm",
			data: webmData
		}],
		arguments: ["-i", "input.webm", "-c:a", "aac", "-c:v", "h264", "output.mp4"],
		print: () => {},
		printErr: data => {
			stderr += data
		},
		onExit: code => {
			if (code !== 0) {
				throw new Error(`Conversion error: ${stderr}`)
			}
		}
	}).MEMFS[0].data.buffer
}*/

function getClicks() {
  let res = [capturedBounds.width,capturedBounds.height]
  for (let m of mouseClicks) {
    let e = m.x + "," + (capturedBounds.height - m.y) + "," + m.ts
    res.push(e)
  }
  return 'screenrun:' + res.join(',')
}

async function saveVideo(buffer) {
  mainWindow.show()
  writeFileSync('in.webm',buffer)
  let clicks = getClicks()
  console.log(clicks)
  exec(pathToFfmpeg + ` -i in.webm -metadata title="${clicks}" -c:a aac out.mp4`)
  mainWindow.hide()
  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: 'Save video',
    defaultPath: 'screenrun.mp4',
  });
  if (!filePath) {
    if (dialog.showMessageBoxSync({defaultId: 1, message: 'Are you sure?', buttons:['Do Not Save','Try Again']}) === 0)
      return
    else
      return saveVideo(buffer)
  }
  rename('out.mp4',filePath,(err) => {
    unlinkSync('in.webm')
    if (err)
      dialog.showErrorBox(appName,"Error saving your video")
    else {
      let button = dialog.showMessageBoxSync({
        message: appName,
        detail: `Video saved as ${filePath}`,
        defaultId: 0,
        buttons: ['View','Cancel']
      });
      if (button === 0)
        shell.showItemInFolder(filePath);
    }
  })
}

ipcMain.on('buffer', async (event, buffer) => {
  tray.setTitle('')
  saveVideo(buffer)
})

ipcMain.on("toMain", (event, args) => {
  if (args.recordingCaption) {
    tray.setTitle(args.recordingCaption)
  } else if (args.startTime !== undefined)
    startTime = args.startTime
});