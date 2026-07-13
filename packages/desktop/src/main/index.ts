import { app, shell, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createOpenCodeSidecar } from './opencode-sidecar'
import { createOpenKhodamSidecar } from './openkhodam-sidecar'
import { createQuitCleanup, startSidecars } from './sidecar-orchestration'
import { OpenKhodamConfigStore } from './integrations/openkhodam-config'
import { createGoogleWorkspaceIntegration } from './integrations/google-workspace'
import { isThemeMode, type ThemeMode } from '../theme'

const openkhodamSidecar = createOpenKhodamSidecar()
const opencodeSidecar = createOpenCodeSidecar(openkhodamSidecar)
const isE2e = process.env['OPENKHODAM_E2E'] === '1'
const finishQuit = createQuitCleanup(opencodeSidecar, openkhodamSidecar, () => app.exit())

app.setName('OpenKhodam')

function applyTitleBarOverlay(window: BrowserWindow): void {
  if (typeof window.setTitleBarOverlay !== 'function') return

  window.setTitleBarOverlay({
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
    height: 40
  })
}

function setNativeTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
  BrowserWindow.getAllWindows().forEach(applyTitleBarOverlay)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    title: 'OpenKhodam',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
      height: 40
    },
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 12 } } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  applyTitleBarOverlay(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const openKhodamConfig = new OpenKhodamConfigStore(app.getPath('userData'))
  const googleWorkspace = createGoogleWorkspaceIntegration(openKhodamConfig)

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('opencode:get-status', () => opencodeSidecar.getStatus())
  ipcMain.handle('openkhodam:get-connection', () => openkhodamSidecar.getRendererConnection())
  ipcMain.handle('openkhodam:get-status', () => openkhodamSidecar.getStatus())
  ipcMain.handle('openkhodam:restart', () => openkhodamSidecar.restart())
  ipcMain.handle('opencode:get-connection', () => opencodeSidecar.getConnection())
  ipcMain.handle('opencode:restart', () => opencodeSidecar.restart())
  ipcMain.handle('appearance:set-native-theme', (_event, mode: unknown) => {
    if (isThemeMode(mode)) setNativeTheme(mode)
  })
  ipcMain.handle('opencode:get-model-selection', (_event, input) =>
    openKhodamConfig.getOpenCodeModelSelection(input)
  )
  ipcMain.handle('opencode:set-model-selection', (_event, input) =>
    openKhodamConfig.setOpenCodeModelSelection(input)
  )
  ipcMain.handle('google-workspace:get-status', () => googleWorkspace.getStatus())
  ipcMain.handle('google-workspace:connect', () => googleWorkspace.connect())
  ipcMain.handle('google-workspace:cancel-connect', () => googleWorkspace.cancelConnect())
  ipcMain.handle('google-workspace:disconnect', () => googleWorkspace.disconnect())
  ipcMain.handle('projects:list-opened-folders', () => openKhodamConfig.listOpenedProjectFolders())
  ipcMain.handle('project-directory:select', async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })
  ipcMain.handle('projects:record-opened-folder', (_event, input) =>
    openKhodamConfig.recordOpenedProjectFolder(input)
  )
  ipcMain.handle('projects:remove-opened-folder', (_event, input) =>
    openKhodamConfig.removeOpenedProjectFolder(input)
  )

  opencodeSidecar.onStatusChange((status) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('opencode:status', status)
    })
  })
  openkhodamSidecar.onStatusChange((status) => {
    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.send('openkhodam:status', status)
    )
  })

  if (!isE2e) {
    void startSidecars(openkhodamSidecar, opencodeSidecar)
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  event.preventDefault()
  finishQuit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
