// Modules to control application life and create native browser window
const { nativeImage, dialog, shell, app, BrowserWindow, desktopCapturer, screen, globalShortcut, ipcMain, Menu, Tray } = require('electron')
const path = require('path')
const shortCut = 'CommandOrControl+F1'
const isWindows = process.platform === 'win32'

// https://github.com/electron/electron/pull/27572
let roundedCorners = true
const { writeFile } = require('fs')
//console.log(writeFile)
const prompt = require('electron-prompt');
const Store = require('./store.js');
const store = new Store({
  // We'll call our data file 'user-preferences'
  configName: 'user-preferences',
  defaults: {
    showMenu: !isWindows,
    showDock: true,
    textOverlay: 'Screegle',
    background: 'bigsur.jpg'
  }
});

const { windowManager } = require('node-window-manager')
const { posix } = require('path')
const { callbackify } = require('util')
const { runInContext } = require('vm')

/*windowManager.on("window-activated", (window) => {
  console.log('activated',window.getTitle(),window.id,mainWindowId);
});*/

let menu = null;
let mainWindow = null;
let previewWindow = null;
let helpWindow = null;
let BORDER = 32
let WINDOWS_EXTRA = 0
if (isWindows) {
  BORDER = 64
  WINDOWS_EXTRA = 32
}

let showMenu = isWindows?false:store.get('showMenu')
let showDock = store.get('showDock')
let textOverlay = store.get('textOverlay')
let background = store.get('background')

let tray = null
let screenWidth = 1280
let screenHeight = 720

let capturedWindows = {}
let interval = null
let intervalCursor = null
let snapshotTimeout = null

let realRect = {width:1280,height:720}
let previewScale = 6
let previewRect = {width:parseInt(realRect.width/previewScale),height:parseInt(realRect.height/previewScale)}
let scaleX = 1
let scaleY = 1

let mainWindowId = null
let lastCursor = null
let previousOrder = ''

function scaledBounds(bounds) {
  return {
    x: parseInt(bounds.x * scaleX),
    y: parseInt(bounds.y * scaleY),
    width: parseInt(bounds.width * scaleX),
    height: parseInt(bounds.height * scaleY)
  }
}

function scaledPosition(pos) {
  return {
    x: parseInt(pos.x * scaleX),
    y: parseInt(pos.y * scaleY)
  }
}

async function toggleCapture() {
  let mousePos = screen.getCursorScreenPoint();
  let w = await windowUnderPoint(mousePos)
  if (!w)
    return;
  let bounds = scaledBounds(w.getBounds())
  if (capturedWindows[w.id]) {
    let res = capturedWindows[w.id]
    res.highlightWindow.close();
    mainWindow.webContents.send("fromMain", {stop:res.mediaSourceId,bounds});
    delete capturedWindows[w.id]
  } else {
    let res = await highlight(w,w.mediaSourceId);
    if (res) {
      capturedWindows[w.id] = res
      mainWindow.webContents.send("fromMain", {start:res.mediaSourceId,bounds});
    }
  }
}

function sameBounds(b1,b2) {
  return b1.x === b2.x && b1.y === b2.y && b1.width === b2.width && b1.height === b2.height
}

/*function snapshot() {
  mainWindow.webContents.capturePage().then(image => {
    let t = image.resize({width:previewRect.width,height:previewRect.height})
    let dataurl = t.toDataURL([{scaleFactor:0.2}]);
    //console.log(url)
    console.log(dataurl.length,t.getSize())
    previewWindow.webContents.send("fromMain", {dataurl});
    snapshotTimeout = setTimeout(() => snapshot(), 1000);
  });
}*/

function repositionCursor() {
  let mousePos = screen.getCursorScreenPoint();
  if (!lastCursor || lastCursor.x !== mousePos.x || lastCursor.y !== mousePos.y) {
    mainWindow.webContents.send("fromMain", {cursor: scaledPosition(mousePos)});
  }
  lastCursor = mousePos
}

function repositionWindows() {
  /*let mousePos = screen.getCursorScreenPoint();
  if (!lastCursor || lastCursor.x !== mousePos.x || lastCursor.y !== mousePos.y) {
    mainWindow.webContents.send("fromMain", {cursor: scaledPosition(mousePos)});
  }
  lastCursor = mousePos*/
  let capturedWindowIds = Object.keys(capturedWindows).map(i => parseInt(i))
  let windows = windowManager.getWindows()
  let newOrder = [];
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
  for (let w of windows) {
    let wnd = capturedWindows[w.id]
    if (wnd) {
      try {
        let oldBound = wnd.highlightWindow.oldBound;//getBounds()
        let newBound = adjustBounds(w.getBounds())
        newOrder.push(wnd.mediaSourceId)
        if (!sameBounds(oldBound,newBound)) {
          wnd.highlightWindow.oldBound = newBound
          mainWindow.webContents.send("fromMain", {move:wnd.mediaSourceId,bounds:scaledBounds(newBound)})
          wnd.highlightWindow.setBounds(newBound)
        }
        wnd.highlightWindow.moveAbove(wnd.mediaSourceId)
      } catch (e) {
        console.log('moveAbove error',e)
      }
    }
    if (newOrder.length > 0) {
      let stringOrder = newOrder.join(',');
      if (stringOrder !== previousOrder) {
        //console.log('zorder',{stringOrder,previousOrder,newOrder})
        mainWindow.webContents.send("fromMain", {order:newOrder});
      }
      previousOrder = stringOrder
    }
  }
  /*if (!sent && mainWindowId) {
    sent = true
    previewWindow.webContents.send("fromMain", {mediaSourceId:'window:' + mainWindowId + ':0'})
  }*/
  //console.log(mainWindowId)
}

function adjustBounds(bounds) {
  if (isWindows)
    return {x: bounds.x + 4 , y: bounds.y, width: bounds.width - 10, height: bounds.height - 6}
  else
    return {x: bounds.x - 2 , y: bounds.y - 2, width: bounds.width + 4, height: bounds.height + 4}
}

async function highlight(window,mediaSourceId) {
  let windowId = window.id
  let bounds = adjustBounds(window.getBounds())
  // TODO: check win.moveAbove(mediaSourceId
  // see https://www.electronjs.org/docs/latest/api/browser-window
  let highlightWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height, 
    transparent: true,
    frame:false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // is default value after Electron v5
      contextIsolation: true, // protect against prototype pollution
    }
  })
  highlightWindow.oldBound = bounds
  highlightWindow.loadURL(`file://${__dirname}/highlight.html`)
  highlightWindow.setBounds(bounds);
  highlightWindow.setIgnoreMouseEvents(true)

  //highlightWindow.webContents.openDevTools()
  return {highlightWindow,mediaSourceId}
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

function showHelp() {
  if (helpWindow)
    return helpWindow.show()
  helpWindow = new BrowserWindow({
    title: 'Screegle Help',
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
}

function createWindow (w,h,callback) {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    icon: getIcon(),
    title: 'Screegle Share',
    //x: roundedCorners?w - previewRect.width - BORDER:screenWidth-BORDER,
    //y: roundedCorners?BORDER:screenHeight-BORDER,
    //width: roundedCorners?previewRect.width - BORDER:realRect.width,
    //height: roundedCorners?previewRect.height - BORDER:realRect.height,
    x: screenWidth - BORDER,
    y: screenHeight - BORDER - WINDOWS_EXTRA,
    width: realRect.width,
    height: realRect.height,
    frame: false,
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

async function createPreviewWindow (w,h,callback) {
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
}

// see https://github.com/mran3/Text-File-Loader-Build/blob/master/main.js
if(require('electron-squirrel-startup')) {
  // see https://github.com/daltonmenezes/electron-screen-recorder/blob/master/src/main/index.js
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
  //console.log('screen width/height=',width,height)
  scaleX = realRect.width / width
  scaleY = realRect.height / height

  const ret = globalShortcut.register(shortCut, () => {
    //console.log(shortCut + ' is pressed')
    toggleCapture();
  })

  if (!ret) {
    console.log('registration failed')
  }

  // Check whether a shortcut is registered.
  //console.log(globalShortcut.isRegistered(shortCut))
  createWindow(width,height,() => {
    // find our window id
    let windows = windowManager.getWindows()
    for (let w of windows) {
      if (w.processId === myid)
      {
        //console.log('found my window id',w.id)
        mainWindowId = w.id
        break
      }
    }

    if (app.dock) app.dock.hide();



    tray = new Tray(getIcon());
    //tray.setPressedImage(path.join(__dirname, 'icon-light.png'));

    updateMenu()
    if (process.platform === 'win32') {
      tray.on('click', () => tray.popUpContextMenu(menu));
    }
    tray.setToolTip('Screegle');
    //tray.setContextMenu(menu)
  
    mainWindow.webContents.send('fromMain',{showDock})
    mainWindow.webContents.send('fromMain',{showMenu})
    mainWindow.webContents.send('fromMain',{textOverlay})
    mainWindow.webContents.send('fromMain',{background})
    if (isWindows)
      mainWindow.webContents.send('fromMain',{dock: 'windows-taskbar.png'})
    // move out of view as much as possible
    if (roundedCorners)
      mainWindow.setBounds({x:screenWidth-BORDER,y:screenHeight-BORDER,width:realRect.width,height:realRect.height})

    //console.log('mainWindowId=',mainWindowId)
    createPreviewWindow(width,height,() => {
      //previewWindow.setBounds({x:width-previewRect.width-BORDER,y:BORDER+24,width:previewRect.width,height:previewRect.height})
      previewWindow.webContents.send("fromMain", {mediaSourceId:'window:' + mainWindowId + ':0',rect:previewRect})
      setTimeout(() => {
        interval = setInterval(() => repositionWindows(),300)
        intervalCursor = setInterval(() => repositionCursor(),10)
      },100);

    })

  })
  app.on('activate', async function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  clearInterval(interval)
  clearInterval(intervalCursor)
  //clearTimeout(snapshotTimeout)
  //console.log('will-quit')
  // Unregister a shortcut.
  globalShortcut.unregister(shortCut)

  // Unregister all shortcuts.
  globalShortcut.unregisterAll()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.


const getRecodingIcon = () => {
  return path.join(__dirname, '/assets/recording.png');
}

const getIcon = () => {
  //return path.join(__dirname, '/assets/icon.png');
  return path.join(__dirname, '/assets/icon.png');
};

app.on('ready', function() {
  //console.log('ready')
});

async function pickImage() {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [
      { name: 'Images', extensions: ['jpg', 'png', 'jpeg'] },
    ],
    //defaultPath: '~/Downloads'
  });
  if (filePaths && filePaths.length === 1) {
    let filePath = filePaths[0]
    const image = nativeImage.createFromPath(filePath).resize({width:1280})
    const dataURI = image.toDataURL()
    background = dataURI
    store.set('background',dataURI)
    mainWindow.webContents.send('fromMain',{background:dataURI})
    updateMenu()
  }
}

const updateMenu = () => {
  menu = Menu.buildFromTemplate([
    {
      label: 'Share/unshare Windows with Command + F1',
      enabled: false,
    },
    {
      label: 'Show Screegle Preview',
      click() { previewWindow.show(); },
    },
    {
      label: 'Hide All Windows (or click them in preview)',
      click() { unhighlightAll() },
    },
    { type: 'separator' },
    {
      label: recording?'Stop Recording':'Start Recording',
      click() { toggleRecording() },
    },
    { type: 'separator' },
    {
      label: 'Text Overlay...',
      async click() {
        let val = await promptNow('Screegle','Text Overlay',textOverlay);
        if (val !== null) {
          textOverlay = val
          store.set('textOverlay',textOverlay)
          mainWindow.webContents.send('fromMain',{textOverlay})
        }
      },
    },
    isWindows?{label:'',visible:false}:{
      label: 'Menu',
      async click() {
        showMenu = !showMenu
        store.set('showMenu',showMenu)
        mainWindow.webContents.send('fromMain',{showMenu})
        updateMenu()
      },
      type: showMenu?'checkbox':'normal',
      checked: showMenu,
    },
    {
      label: isWindows?'Taskbar':'Dock',
      async click() {
        showDock = !showDock
        store.set('showDock',showDock)
        mainWindow.webContents.send('fromMain',{showDock})
        updateMenu()
      },
      type: showDock?'checkbox':'normal',
      checked: showDock,
    },
    {
      label: 'Background',
      submenu: isWindows?
      Menu.buildFromTemplate([
        {
          label: 'Default',
          async click() {
            background = 'windows11.jpg'
            store.set('background',background)
            mainWindow.webContents.send('fromMain',{background})
            updateMenu()
          },
          type: 'checkbox',
          checked: background === 'windows11.jpg'
        },
        {
          label: 'Water',
          async click() {
            background = 'windows112.jpg'
            store.set('background',background)
            mainWindow.webContents.send('fromMain',{background})
            updateMenu()
          },
          type: 'checkbox',
          checked: background === 'windows112.jpg'
        },
        {
          label: 'Custom Image...',
          async click() {
            pickImage()
          },
          type: 'checkbox',
          checked: background !== 'windows112.jpg' && background !== 'windows11.jpg'
        },
      ]):
      Menu.buildFromTemplate([
        {
          label: 'Big Sur',
          async click() {
            background = 'bigsur.jpg'
            store.set('background',background)
            mainWindow.webContents.send('fromMain',{background})
            updateMenu()
          },
          type: 'checkbox',
          checked: background ==='bigsur.jpg'
        },
        {
          label: 'Monterey',
          async click() {
            background = 'monterey.jpg'
            store.set('background',background)
            mainWindow.webContents.send('fromMain',{background})
            updateMenu()
          },
          type: 'checkbox',
          checked: background === 'monterey.jpg'
        },
        {
          label: 'Custom Image...',
          async click() {
            pickImage()
          },
          type: 'checkbox',
          checked: background !== 'monterey.jpg' && background !== 'bigsur.jpg'
        },
      ]),
      async click() {
        const { filePaths } = await dialog.showOpenDialog({
          message: 'Pick an image to use as background',
          filters: [
            { name: 'Images', extensions: ['jpg', 'png', 'gif'] },
          ],
          defaultPath: '~/Downloads'
        });
        //console.log(filePaths)
        if (filePaths && filePaths.length === 1) {
          let filePath = filePaths[0]
          store.set('background',filePath)
          mainWindow.webContents.send('fromMain',{background:filePath})
          updateMenu()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Help',
      click() { showHelp() },
      //accelerator: 'CommandOrControl+Q'
    },
    { type: 'separator' },
    {
      label: 'Contact Us <laurent@appblit.com>',
      click() { shell.openExternal("mailto:laurent@appblit.com?subject=Screegle") },
      //accelerator: 'CommandOrControl+Q'
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click() {
        clearInterval(interval)
        //console.log('app.quit')
        /*mainWindow.close()
        previewWindow.close()
        if (helpWindow)
          helpWindow.close()*/
        app.quit();
      },
      //accelerator: 'CommandOrControl+Q'
    }
  ]);
  tray.setContextMenu(menu)
};

let recording = false
function toggleRecording() {
  recording = !recording
  updateMenu()
  if (recording)
    tray.setImage(getRecodingIcon())
  else
    tray.setImage(getIcon())
  previewWindow.webContents.send('fromMain',{toggleRecording:true})
}
function unhighlightAll() {
  for (let entry in capturedWindows) {
    let wnd = capturedWindows[entry]
    unhighlight(wnd.mediaSourceId)
  }
}

function unhighlight(mediaSourceId) {
  let id = parseInt(mediaSourceId.split(':')[1])
  if (capturedWindows[id]) {
    let res = capturedWindows[id]
    res.highlightWindow.close();
    mainWindow.webContents.send("fromMain", {stop:mediaSourceId});
    delete capturedWindows[id]
  }
}

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

async function saveVideo(buffer) {
  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: 'Save video',
    defaultPath: 'screegle.webm',
  });
  if (!filePath) {
    if (await dialog.showMessageBoxSync({defaultId: 1, message: 'Are you sure?', buttons:['Do Not Save','Try Again']}) === 0)
      return
    else
      return saveVideo(buffer)
  }
  /*let mp4 = filePath.replace('.webm','.mp4')
  console.log('converting to mp4...')
  writeFile(mp4, Buffer.from(webmToMp4(buffer)), (err) => {
    if (err)
      console.log('error mp4')
    else
      console.log('mp4 file written',mp4)
  });*/

  writeFile(filePath, buffer, async (err) => {
    if (err)
      dialog.showErrorBox("Screegle","Error saving your video")
    else {
      let button = dialog.showMessageBoxSync({
        message: 'Screegle',
        detail: `Video saved as ${filePath}`,
        defaultId: 0,
        buttons: ['View','Cancel']
      });
      if (button === 0)
        shell.showItemInFolder(filePath);
    }
  });
}

ipcMain.on('buffer', async (event, buffer) => {
  tray.setTitle('')
  saveVideo(buffer)
})

ipcMain.on("toMain", (event, args) => {
  if (args.click) {
    let payload = {click:args.click,scale:previewScale}
    //console.log('sending to mainwindow',payload)
    mainWindow.webContents.send("fromMain", payload);
  } else if (args.videoClicked) {
    let mediaSourceId = args.videoClicked
    unhighlight(mediaSourceId)
  } else if (args.recordingCaption) {
    tray.setTitle(args.recordingCaption)
  }
});