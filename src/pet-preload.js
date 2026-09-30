'use strict';

/** Bridge for the standalone pet window. Nothing about the main app leaks here. */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dsh', {
  getState: () => ipcRenderer.invoke('state:get'),
  refresh: () => ipcRenderer.invoke('state:refresh'),
  frames: () => ipcRenderer.invoke('pet:frames'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  dragBegin: () => ipcRenderer.invoke('pet:drag-begin'),
  dragEnd: () => ipcRenderer.invoke('pet:drag-end'),
  moveTo: (x, y) => ipcRenderer.invoke('pet:move-to', { x, y }),
  clamp: () => ipcRenderer.invoke('pet:clamp'),
  snap: () => ipcRenderer.invoke('pet:snap'),
  menu: () => ipcRenderer.invoke('pet:menu'),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('state:update', listener);
    return () => ipcRenderer.removeListener('state:update', listener);
  },
});
