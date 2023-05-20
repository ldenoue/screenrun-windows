/*// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})
*/

// from https://stackoverflow.com/questions/44391448/electron-require-is-not-defined
const {
  contextBridge,
  ipcRenderer,
} = require('electron')
//const { writeFile } = require('fs')
//const path = require('path')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  "api", {
      send: (channel, data) => {
          // whitelist channels
          let validChannels = ["toMain"];
          if (validChannels.includes(channel)) {
              ipcRenderer.send(channel, data);
          }
      },
      receive: (channel, func) => {
          let validChannels = ["fromMain"];
          if (validChannels.includes(channel)) {
              // Deliberately strip event as it includes `sender` 
              ipcRenderer.on(channel, (event, ...args) => func(...args));
          }
      },
      platform: () => process.platform,
      write: async (blob) => {
        const buffer = Buffer.from(await blob.arrayBuffer());
        ipcRenderer.send('buffer', buffer);
      }
  }
);