const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ele', {
    openBrowser: () => ipcRenderer.invoke('open-browser'),

    material: {
        create: (data) => ipcRenderer.invoke('material:create', data),
        delete: (id) => ipcRenderer.invoke('material:delete', id),
        clear: () => ipcRenderer.invoke('material:clear'),
        update: (id, data) => ipcRenderer.invoke('material:update', id, data),
        reset: (id) => ipcRenderer.invoke('material:reset', id),
        get: (id) => ipcRenderer.invoke('material:get', id),
        list: () => ipcRenderer.invoke('material:list'),
        page: (page, pageSize) => ipcRenderer.invoke('material:page', page, pageSize),
        count: () => ipcRenderer.invoke('material:count'),
        onReload: (callback) => ipcRenderer.on('material:reload', () => callback())
    },
    
    device: {
        create: (data) => ipcRenderer.invoke('device:create', data),
        delete: (id) => ipcRenderer.invoke('device:delete', id),
        update: (id, data) => ipcRenderer.invoke('device:update', id, data),
        get: (id) => ipcRenderer.invoke('device:get', id),
        list: () => ipcRenderer.invoke('device:list'),
        count: () => ipcRenderer.invoke('device:count'),
        onReload: (callback) => ipcRenderer.on('device:reload', () => callback())
    },

    history: {
        create: (data) => ipcRenderer.invoke('history:create', data),
        delete: (id) => ipcRenderer.invoke('history:delete', id),
        clear: () => ipcRenderer.invoke('history:clear'),
        get: (id) => ipcRenderer.invoke('history:get', id),
        list: (params) => ipcRenderer.invoke('history:list', params),
        page: (params) => ipcRenderer.invoke('history:page', params),
        count: () => ipcRenderer.invoke('history:count')
    },

    config: {
        set: (key, value) => ipcRenderer.invoke('config:set', key, value),
        get: (key) => ipcRenderer.invoke('config:get', key),
        config: () => ipcRenderer.invoke('config:config'),
        setMultiple: (configs) => ipcRenderer.invoke('config:setMultiple', configs),
        delete: (key) => ipcRenderer.invoke('config:delete', key)
    },

    work: {
        start: (deviceId) => ipcRenderer.invoke('work:start', deviceId),
        stop: (deviceId) => ipcRenderer.invoke('work:stop', deviceId),
        startAll: () => ipcRenderer.invoke('work:startAll'),
        stopAll: () => ipcRenderer.invoke('work:stopAll'),
        onTestEvent: (callback) => ipcRenderer.on('test-event', (_, data) => callback(data))
    }
})