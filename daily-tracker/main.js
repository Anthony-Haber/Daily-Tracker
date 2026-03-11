'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path      = require('path');
const os        = require('os');
const db        = require('./src/db');
const scheduler = require('./src/scheduler');
const settings  = require('./src/settings');
const { autoUpdater } = require('electron-updater');

// ── Windows: required for Action Center notifications ─────────────────────────
// Must be set before app is ready.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.getName());
}

let mainWindow       = null;
let promptWindow     = null;
let mealWindow       = null;
let reflectionWindow = null;
let settingsWindow   = null;
let setupWizardWindow = null;
let tray             = null;

// Resolved by the setup:complete IPC handler once the wizard finishes.
let _setupResolve = null;

// ── Error-safe IPC helper ─────────────────────────────────────────────────────

/**
 * Wraps an IPC handler so any thrown error shows a user-friendly dialog
 * instead of silently failing in the renderer.
 *
 * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} fn
 */
function safeHandle(fn) {
  return async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      console.error('[ipc] unhandled error:', err.message);
      dialog.showErrorBox(
        'Unexpected Error',
        `An unexpected error occurred:\n\n${err.message}`,
      );
      return null;
    }
  };
}

// ── Window helpers ────────────────────────────────────────────────────────────

/** Shared BrowserWindow options for popup-style windows. */
function popupPrefs(extra = {}) {
  return {
    resizable:   false,
    alwaysOnTop: true,
    show:        false,
    ...extra,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  };
}

// ── Window factories ──────────────────────────────────────────────────────────

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1100, height: 700, minWidth: 800, minHeight: 500,
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'windows', 'main-window', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    // Hide to tray — never quit via window close.
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createPromptWindow() {
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.show();
    promptWindow.focus();
    return;
  }

  promptWindow = new BrowserWindow(popupPrefs({ width: 500, height: 490 }));
  promptWindow.setMenuBarVisibility(false);
  promptWindow.loadFile(path.join(__dirname, 'src', 'windows', 'prompt-window', 'index.html'));
  promptWindow.once('ready-to-show', () => { promptWindow.show(); promptWindow.focus(); });
  promptWindow.on('closed', () => { promptWindow = null; });
}

function createMealWindow() {
  if (mealWindow && !mealWindow.isDestroyed()) {
    mealWindow.show();
    mealWindow.focus();
    return;
  }

  mealWindow = new BrowserWindow(popupPrefs({ width: 460, height: 380 }));
  mealWindow.setMenuBarVisibility(false);
  mealWindow.loadFile(path.join(__dirname, 'src', 'windows', 'meal-window', 'index.html'));
  mealWindow.once('ready-to-show', () => { mealWindow.show(); mealWindow.focus(); });
  mealWindow.on('closed', () => { mealWindow = null; });
}

function createReflectionWindow() {
  if (reflectionWindow && !reflectionWindow.isDestroyed()) {
    reflectionWindow.show();
    reflectionWindow.focus();
    return;
  }

  reflectionWindow = new BrowserWindow(popupPrefs({ width: 600, height: 650 }));
  reflectionWindow.setMenuBarVisibility(false);
  reflectionWindow.loadFile(path.join(__dirname, 'src', 'windows', 'reflection-window', 'index.html'));
  reflectionWindow.once('ready-to-show', () => { reflectionWindow.show(); reflectionWindow.focus(); });
  reflectionWindow.on('closed', () => { reflectionWindow = null; });
}

function createSetupWizardWindow() {
  setupWizardWindow = new BrowserWindow({
    width: 560, height: 640,
    resizable:   false,
    center:      true,
    show:        false,
    frame:       true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  setupWizardWindow.setMenuBarVisibility(false);
  setupWizardWindow.loadFile(
    path.join(__dirname, 'src', 'windows', 'setup-wizard', 'index.html'),
  );
  setupWizardWindow.once('ready-to-show', () => {
    setupWizardWindow.show();
    setupWizardWindow.focus();
  });

  // If the user closes the window without completing setup, fall back to userData.
  setupWizardWindow.on('closed', () => {
    if (_setupResolve) {
      db.setDbFolder(app.getPath('userData'));
      _setupResolve();
      _setupResolve = null;
    }
    setupWizardWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow(popupPrefs({ width: 500, height: 490, resizable: true }));
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'src', 'windows', 'settings-window', 'index.html'));
  settingsWindow.once('ready-to-show', () => { settingsWindow.show(); settingsWindow.focus(); });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

/**
 * Build and apply a fresh tray context menu.
 *
 * Called on startup, every 60 s (to keep time-gated items current), and after
 * any action that changes menu state (pause toggle, etc.).
 */
function rebuildTrayMenu() {
  const hour          = new Date().getHours();
  const isEvening     = hour >= 18;
  const schedulerPaused = scheduler.isPaused();

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => createMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Log Activity',
      click: () => createPromptWindow(),
    },
    {
      label: 'Log Meal',
      click: () => createMealWindow(),
    },
    {
      label:   'Evening Reflection',
      enabled: isEvening,
      click:   () => createReflectionWindow(),
    },
    { type: 'separator' },
    {
      label:   schedulerPaused ? 'Resume Notifications' : 'Pause Notifications',
      type:    'normal',
      click:   () => {
        if (scheduler.isPaused()) scheduler.resume();
        else scheduler.pause();
        rebuildTrayMenu();
      },
    },
    {
      label: 'Settings',
      click: () => createSettingsWindow(),
    },
    {
      label: 'Check for Updates',
      click: () => { autoUpdater.checkForUpdatesAndNotify().catch(() => {}); },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Daily Tracker');

  rebuildTrayMenu();

  // On Windows / Linux right-click fires before the menu opens — rebuild so
  // time-gated items (Evening Reflection) always reflect the current hour.
  tray.on('right-click', () => rebuildTrayMenu());

  // Left-click opens dashboard on all platforms.
  // Windows: left-click   Linux: left-click   macOS: left-click
  tray.on('click',        () => createMainWindow());
  tray.on('double-click', () => createMainWindow());  // Windows extra

  // Keep "Evening Reflection" enabled state current across long sessions.
  setInterval(rebuildTrayMenu, 60 * 1000);
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// hourly_logs
ipcMain.handle('db:insertLog',     safeHandle((_e, p)     => db.insertLog(p)));
ipcMain.handle('db:getLogsByDate', safeHandle((_e, date)  => db.getLogsByDate(date)));
ipcMain.handle('db:getAllLogs',    safeHandle(()           => db.getAllLogs()));
ipcMain.handle('db:updateLog',     safeHandle((_e, id, f) => db.updateLog(id, f)));
ipcMain.handle('db:deleteLog',     safeHandle((_e, id)    => db.deleteLog(id)));

// tasks
ipcMain.handle('db:insertTask',    safeHandle((_e, p)     => db.insertTask(p)));
ipcMain.handle('db:getTasks',      safeHandle((_e, opts)  => db.getTasks(opts)));
ipcMain.handle('db:getTaskById',   safeHandle((_e, id)    => db.getTaskById(id)));
ipcMain.handle('db:updateTask',    safeHandle((_e, id, f) => db.updateTask(id, f)));
ipcMain.handle('db:deleteTask',    safeHandle((_e, id)    => db.deleteTask(id)));

// meals
ipcMain.handle('db:insertMeal',    safeHandle((_e, p)     => db.insertMeal(p)));
ipcMain.handle('db:getMealsByDate',safeHandle((_e, date)  => db.getMealsByDate(date)));
ipcMain.handle('db:getAllMeals',   safeHandle(()           => db.getAllMeals()));
ipcMain.handle('db:updateMeal',    safeHandle((_e, id, f) => db.updateMeal(id, f)));
ipcMain.handle('db:deleteMeal',    safeHandle((_e, id)    => db.deleteMeal(id)));

// reflections
ipcMain.handle('db:upsertReflection',   safeHandle((_e, p)    => db.upsertReflection(p)));
ipcMain.handle('db:getReflectionByDate',safeHandle((_e, date) => db.getReflectionByDate(date)));
ipcMain.handle('db:getAllReflections',  safeHandle(()          => db.getAllReflections()));
ipcMain.handle('db:deleteReflection',  safeHandle((_e, id)   => db.deleteReflection(id)));

// finances
ipcMain.handle('db:insertFinance',            safeHandle((_e, p)      => db.insertFinance(p)));
ipcMain.handle('db:getFinances',              safeHandle((_e, opts)   => db.getFinances(opts)));
ipcMain.handle('db:getFinancesLast30Days',    safeHandle(()            => db.getFinancesLast30Days()));
ipcMain.handle('db:getMonthlyFinanceSummary', safeHandle((_e, yr, mo) => db.getMonthlyFinanceSummary(yr, mo)));
ipcMain.handle('db:deleteFinance',            safeHandle((_e, id)     => db.deleteFinance(id)));

// db meta
ipcMain.handle('db:getDbPath',      safeHandle(() => db.getDbPath()));
ipcMain.handle('db:changeDbFolder', safeHandle(() => db.changeDbFolder()));
ipcMain.handle('db:getActiveDates', safeHandle(() => db.getActiveDates()));

// scheduler controls
ipcMain.handle('scheduler:pause',    () => { scheduler.pause();    rebuildTrayMenu(); });
ipcMain.handle('scheduler:resume',   () => { scheduler.resume();   rebuildTrayMenu(); });
ipcMain.handle('scheduler:isPaused', () => scheduler.isPaused());

// settings
ipcMain.handle('settings:get', () => settings.getSettings());

ipcMain.handle('settings:set', (_e, key, value) => {
  settings.setSetting(key, value);
  // Keep the session-level scheduler state in sync with the persistent preference.
  if (key === 'remindersEnabled') {
    if (value) scheduler.resume();
    else scheduler.pause();
    rebuildTrayMenu();
  }
});

ipcMain.handle('settings:setAutoLaunch', (_e, enabled) => {
  try {
    settings.setAutoLaunch(enabled);
  } catch (err) {
    dialog.showErrorBox('Auto-launch Error', `Could not update startup setting:\n\n${err.message}`);
  }
});

// setup wizard
ipcMain.handle('setup:getDefaultFolder', () => {
  return path.join(os.homedir(), 'Documents', 'DailyTracker');
});

ipcMain.handle('setup:chooseFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(setupWizardWindow, {
    title: 'Choose where to save your Daily Tracker data',
    buttonLabel: 'Save here',
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});

ipcMain.handle('setup:complete', (_e, folderPath) => {
  db.setDbFolder(folderPath);
  if (_setupResolve) {
    _setupResolve();
    _setupResolve = null;
  }
  setupWizardWindow?.close();
});

// window control
ipcMain.on('window:closePrompt',      () => promptWindow?.close());
ipcMain.on('window:closeMeal',        () => mealWindow?.close());
ipcMain.on('window:closeReflection',  () => reflectionWindow?.close());
ipcMain.on('window:closeSettings',    () => settingsWindow?.close());
ipcMain.on('window:openMain',         () => createMainWindow());
ipcMain.on('window:openPrompt',       () => createPromptWindow());
ipcMain.on('window:openReflection',   () => createReflectionWindow());
ipcMain.on('window:openSettings',     () => createSettingsWindow());

// Generic sender-aware close + named open
ipcMain.on('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

ipcMain.on('window:open', (_e, name) => {
  switch (name) {
    case 'main':       createMainWindow();       break;
    case 'prompt':     createPromptWindow();     break;
    case 'meal':       createMealWindow();       break;
    case 'reflection': createReflectionWindow(); break;
    case 'settings':   createSettingsWindow();   break;
  }
});

// ── Auto-updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  // Silence all errors — never bother the user if update checks fail.
  autoUpdater.on('error', () => {});

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:download-progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('updater:update-downloaded', info);
  });

  // Check silently on startup; errors swallowed by the listener above.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

ipcMain.handle('updater:checkNow', () => {
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Show setup wizard on very first launch (no data folder chosen yet).
  if (db.needsSetup()) {
    await new Promise((resolve) => {
      _setupResolve = resolve;
      createSetupWizardWindow();
    });
  }

  await db.init();
  createTray();
  createMainWindow();
  scheduler.start({ onPrompt: createPromptWindow, onReflection: createReflectionWindow });
  setupAutoUpdater();
});

// Keep the app alive in the tray when all windows are closed.
app.on('window-all-closed', () => { /* intentionally empty */ });

app.on('before-quit', () => {
  app.isQuitting = true;
  scheduler.stop();
});

// macOS: clicking the dock icon re-opens the dashboard.
app.on('activate', () => createMainWindow());
