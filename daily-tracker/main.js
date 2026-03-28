'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path      = require('path');
const os        = require('os');
const fs        = require('fs');
const db        = require('./src/db');
const scheduler = require('./src/scheduler');
const settings  = require('./src/settings');
const Store     = require('electron-store');
const { autoUpdater } = require('electron-updater');

const musicStore = new Store({ name: 'daily-tracker-config' });

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
let focusWindow      = null;
let financeWindow    = null;
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

/** Returns the background color for the title bar based on the active theme. */
function getThemeTitleBarColor() {
  const activeTheme = musicStore.get('activeTheme', 'default');
  const themeColors = {
    'default':       '#1a1a2e',
    'outer-wilds':   '#0b1e26',
    'hollow-knight': '#1a1a1a',
    'minecraft':     '#3c3c3c',
    'user-custom':   musicStore.get('themes.user-custom.bgPrimary', '#1a1a2e'),
  };
  return themeColors[activeTheme] || '#1a1a2e';
}

/** Returns titleBarOverlay options so the native controls match the theme. */
function getTitleBarOverlay() {
  return {
    color:       getThemeTitleBarColor(),
    symbolColor: '#ff7d25',
    height:      32,
  };
}

/** Returns the tray icon path for the active theme, falling back to default theme, then to assets/. */
function getThemeTrayIcon() {
  const activeTheme = musicStore.get('activeTheme', 'default');
  const iconName = process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png';

  const themeIconPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'themes', activeTheme, 'icons', iconName)
    : path.join(__dirname, 'src', 'themes', activeTheme, 'icons', iconName);

  const defaultThemeIconPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'themes', 'default', 'icons', iconName)
    : path.join(__dirname, 'src', 'themes', 'default', 'icons', iconName);

  // Final fallback: original assets/tray-icon.png (always present in the repo)
  const assetsFallback = path.join(__dirname, 'assets', 'tray-icon.png');

  if (fs.existsSync(themeIconPath))        return themeIconPath;
  if (fs.existsSync(defaultThemeIconPath)) return defaultThemeIconPath;
  return assetsFallback;
}

/** Shared BrowserWindow options for popup-style windows. */
function popupPrefs(extra = {}) {
  return {
    resizable:        false,
    alwaysOnTop:      true,
    show:             false,
    backgroundColor:  getThemeTitleBarColor(),
    titleBarStyle:    'hidden',
    titleBarOverlay:  getTitleBarOverlay(),
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
    show:            false,
    backgroundColor: getThemeTitleBarColor(),
    titleBarStyle:   'hidden',
    titleBarOverlay: getTitleBarOverlay(),
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

/**
 * Attach a close-sound interceptor to a popup BrowserWindow.
 * When the native OS X button (or any unhandled close) fires, the renderer
 * is asked to play the close sound first; it then calls window:close-confirmed
 * to let the actual close proceed. Buttons that already play the sound set
 * win._soundPlayed = true before calling .close() so there's no double play.
 */
function attachCloseSoundInterceptor(win) {
  win.on('close', (e) => {
    if (win._soundPlayed) return; // sound already handled by a button
    e.preventDefault();
    win.webContents.send('window:close-with-sound');
  });
}

function createPromptWindow() {
  if (promptWindow && !promptWindow.isDestroyed()) {
    promptWindow.show();
    promptWindow.focus();
    return;
  }

  promptWindow = new BrowserWindow(popupPrefs({ width: 460, height: 560, minWidth: 420, minHeight: 520, resizable: true }));
  promptWindow.setMenuBarVisibility(false);
  promptWindow.loadFile(path.join(__dirname, 'src', 'windows', 'prompt-window', 'index.html'));
  promptWindow.once('ready-to-show', () => { promptWindow.show(); promptWindow.focus(); });
  promptWindow.on('closed', () => { promptWindow = null; });
  attachCloseSoundInterceptor(promptWindow);
}

function createMealWindow() {
  if (mealWindow && !mealWindow.isDestroyed()) {
    mealWindow.show();
    mealWindow.focus();
    return;
  }

  mealWindow = new BrowserWindow(popupPrefs({ width: 460, height: 550, minWidth: 400, minHeight: 500, resizable: true }));
  mealWindow.setMenuBarVisibility(false);
  mealWindow.loadFile(path.join(__dirname, 'src', 'windows', 'meal-window', 'index.html'));
  mealWindow.once('ready-to-show', () => { mealWindow.show(); mealWindow.focus(); });
  mealWindow.on('closed', () => { mealWindow = null; });
  attachCloseSoundInterceptor(mealWindow);
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
  attachCloseSoundInterceptor(reflectionWindow);
}

function createSetupWizardWindow() {
  setupWizardWindow = new BrowserWindow({
    width: 560, height: 640,
    resizable:       false,
    center:          true,
    show:            false,
    frame:           true,
    backgroundColor: getThemeTitleBarColor(),
    titleBarStyle:   'hidden',
    titleBarOverlay: getTitleBarOverlay(),
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

function createFocusWindow() {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.show();
    focusWindow.focus();
    return;
  }

  focusWindow = new BrowserWindow({
    width: 480, height: 700, minHeight: 650, resizable: true,
    show:            false,
    alwaysOnTop:     false,
    skipTaskbar:     false,
    backgroundColor: getThemeTitleBarColor(),
    titleBarStyle:   'hidden',
    titleBarOverlay: getTitleBarOverlay(),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  focusWindow.setMenuBarVisibility(false);
  focusWindow.loadFile(path.join(__dirname, 'src', 'windows', 'focus-window', 'index.html'));
  focusWindow.once('ready-to-show', () => { focusWindow.show(); focusWindow.focus(); });
  focusWindow.on('closed', () => { focusWindow = null; });
  attachCloseSoundInterceptor(focusWindow);
}

function createFinanceWindow() {
  if (financeWindow && !financeWindow.isDestroyed()) {
    financeWindow.show();
    financeWindow.focus();
    return;
  }

  financeWindow = new BrowserWindow({
    width: 460, height: 560,
    resizable:       true,
    show:            false,
    alwaysOnTop:     false,
    skipTaskbar:     false,
    backgroundColor: getThemeTitleBarColor(),
    titleBarStyle:   'hidden',
    titleBarOverlay: getTitleBarOverlay(),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  financeWindow.setMenuBarVisibility(false);
  financeWindow.loadFile(path.join(__dirname, 'src', 'windows', 'finance-window', 'index.html'));
  financeWindow.once('ready-to-show', () => { financeWindow.show(); financeWindow.focus(); });
  financeWindow.on('closed', () => { financeWindow = null; });
  attachCloseSoundInterceptor(financeWindow);
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
  attachCloseSoundInterceptor(settingsWindow);
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
      label: '💰 Log Finances',
      click: () => createFinanceWindow(),
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
    {
      label: 'About Daily Tracker',
      click: () => {
        dialog.showMessageBox({
          type:    'info',
          title:   'About Daily Tracker',
          message: `Daily Tracker  v${app.getVersion()}`,
          detail:  'Track your day, one hour at a time.\n\nLog activities, tasks, meals, and evening reflections — all stored locally on your machine.',
          buttons: ['OK'],
        });
      },
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
  const iconPath = getThemeTrayIcon();
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
ipcMain.handle('db:updateTask',    safeHandle((_e, id, f) => {
  const result = db.updateTask(id, f);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tasks:changed');
  return result;
}));
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
ipcMain.handle('db:getAllFinancesForGraph',   safeHandle(()            => db.getAllFinancesForGraph()));

// db meta
ipcMain.handle('db:getDbPath',      safeHandle(() => db.getDbPath()));
ipcMain.handle('db:changeDbFolder', safeHandle(() => db.changeDbFolder()));
ipcMain.handle('db:getActiveDates', safeHandle(() => db.getActiveDates()));

// finance window
ipcMain.handle('finance:save-entry',  safeHandle((_e, data) => db.insertFinance(data)));
ipcMain.handle('finance:open-window', safeHandle(()          => createFinanceWindow()));

// focus sessions
ipcMain.handle('focus:save-session',  safeHandle((_e, data) => db.saveFocusSession(data)));
ipcMain.handle('focus:get-sessions',  safeHandle((_e, date) => db.getFocusSessionsByDate(date)));
ipcMain.handle('focus:get-summary',   safeHandle(()          => db.getFocusSummaryToday()));
ipcMain.handle('focus:open-window',   safeHandle(()          => createFocusWindow()));

// ── Theme initialisation ──────────────────────────────────────────────────────

/**
 * In production: copy bundled src/themes/ from resourcesPath to userData on
 * first launch or after an app update (version stamp mismatch).
 * In development: themes are read directly from src/themes/ — no copy needed.
 */
function initializeThemes() {
  if (!app.isPackaged) {
    console.log('[themes] DEV MODE: reading themes from src/themes/');
    return;
  }

  const src         = path.join(process.resourcesPath, 'src', 'themes');
  const dest        = path.join(app.getPath('userData'), 'themes');
  const versionFile = path.join(dest, '.version');
  const currentVer  = app.getVersion();

  try {
    const storedVer = fs.existsSync(versionFile)
      ? fs.readFileSync(versionFile, 'utf8').trim()
      : null;
    if (storedVer === currentVer) {
      console.log('[themes] Already initialized for version', currentVer, '— skipping copy');
      return;
    }
    console.log('[themes] Initializing themes to userData (version:', currentVer, ')...');
    fs.cpSync(src, dest, { recursive: true });
    fs.writeFileSync(versionFile, currentVer, 'utf8');
    console.log('[themes] Themes initialized to userData');
  } catch (err) {
    console.error('[themes] Error initializing themes:', err);
  }
}

/** Base directory for theme assets (sounds + music), dev vs prod aware. */
function themesBaseDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'themes')
    : path.join(__dirname, 'src', 'themes');
}

// music (focus-window)
function getThemeMusicDir(themeName, pool) {
  return path.join(themesBaseDir(), themeName, 'music', pool);
}

const THEME_STUBS = ['default', 'outer-wilds', 'hollow-knight', 'minecraft', 'user-custom'];

/** One-time migration: focusMusic.presets / focusMusic.playlist → themes.*.music structure */
function ensureThemeStoreStructure() {
  // Migrate old preset structure (focusMusic.presets)
  const oldPresets = musicStore.get('focusMusic.presets');
  if (oldPresets && typeof oldPresets === 'object') {
    for (const [presetId, preset] of Object.entries(oldPresets)) {
      const focusTracks = (preset.focus || []);
      const breakTracks = (preset.break || []);
      for (const track of [...focusTracks, ...breakTracks]) {
        const pool    = track.pool === 'break' ? 'break' : 'focus';
        const oldPath = path.join(app.getPath('userData'), 'focus-music', presetId, track.filename);
        const newDir  = getThemeMusicDir(presetId, pool);
        const newPath = path.join(newDir, track.filename);
        if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
          if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
          try { fs.renameSync(oldPath, newPath); } catch (_) {
            try { fs.copyFileSync(oldPath, newPath); } catch (_) {}
          }
        }
      }
      musicStore.set(`themes.${presetId}.music.focus`, focusTracks.map(t => ({ filename: t.filename, displayName: t.displayName })));
      musicStore.set(`themes.${presetId}.music.break`, breakTracks.map(t => ({ filename: t.filename, displayName: t.displayName })));
    }
    musicStore.delete('focusMusic');
  }

  // Migrate even older flat playlist (focusMusic.playlist)
  const oldPlaylist = musicStore.get('focusMusic.playlist');
  if (Array.isArray(oldPlaylist)) {
    const focus = oldPlaylist.filter(t => (t.pool || 'focus') !== 'break');
    const br    = oldPlaylist.filter(t => t.pool === 'break');
    for (const track of oldPlaylist) {
      const pool    = track.pool === 'break' ? 'break' : 'focus';
      const oldPath = path.join(app.getPath('userData'), 'focus-music', track.filename);
      const newDir  = getThemeMusicDir('default', pool);
      const newPath = path.join(newDir, track.filename);
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
        try { fs.renameSync(oldPath, newPath); } catch (_) {
          try { fs.copyFileSync(oldPath, newPath); } catch (_) {}
        }
      }
    }
    musicStore.set('themes.default.music.focus', focus.map(t => ({ filename: t.filename, displayName: t.displayName })));
    musicStore.set('themes.default.music.break', br.map(t => ({ filename: t.filename, displayName: t.displayName })));
    musicStore.delete('focusMusic');
  }

  // Ensure all theme stubs exist
  for (const theme of THEME_STUBS) {
    if (!musicStore.get(`themes.${theme}.music`)) {
      musicStore.set(`themes.${theme}.music`, { focus: [], break: [] });
    }
  }
}

ipcMain.handle('music:save-track', safeHandle((_e, themeName, pool, filePath, displayName) => {
  ensureThemeStoreStructure();
  const theme = themeName || 'default';
  const p     = pool === 'break' ? 'break' : 'focus';
  const name  = displayName || path.basename(filePath);
  const dir   = getThemeMusicDir(theme, p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}_${path.basename(filePath)}`;
  const dest = path.join(dir, filename);
  fs.copyFileSync(filePath, dest);
  const key    = `themes.${theme}.music.${p}`;
  const tracks = musicStore.get(key, []);
  tracks.push({ filename, displayName: name });
  musicStore.set(key, tracks);
  return { filename, displayName: name, pool: p, filePath: dest };
}));

ipcMain.handle('music:get-tracks', safeHandle((_e, themeName, pool) => {
  const theme = themeName || 'default';
  const p     = pool || 'focus';
  const dir   = getThemeMusicDir(theme, p);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.(wav|mp3|ogg|flac|aac|m4a)$/i.test(f)); } catch (_) {}
  return files.map(filename => ({
    filename,
    displayName: filename.replace(/^\d+_/, ''),
    pool: p,
    filePath: path.join(dir, filename),
  }));
}));

ipcMain.handle('music:delete-track', safeHandle((_e, themeName, pool, filename) => {
  const theme = themeName || 'default';
  const p     = pool || 'focus';
  const key   = `themes.${theme}.music.${p}`;
  const tracks = musicStore.get(key, []);
  musicStore.set(key, tracks.filter(t => t.filename !== filename));
  try { fs.unlinkSync(path.join(getThemeMusicDir(theme, p), filename)); } catch (_) {}
  return true;
}));

ipcMain.handle('music:get-active-theme-tracks', safeHandle((_e, pool) => {
  const theme = musicStore.get('activeTheme', 'default');
  const p     = pool || 'focus';
  const dir   = getThemeMusicDir(theme, p);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.(wav|mp3|ogg|flac|aac|m4a)$/i.test(f)); } catch (_) {}
  return files.map(filename => ({
    filename,
    displayName: filename.replace(/^\d+_/, ''),
    pool: p,
    filePath: path.join(dir, filename),
  }));
}));

ipcMain.handle('music:get-pre-break-track', safeHandle((_e, themeName) => {
  const theme = themeName || musicStore.get('activeTheme', 'default');
  const dir   = path.join(themesBaseDir(), theme, 'music', 'pre-break');
  console.log('[pre-break] looking in:', dir);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => AUDIO_EXTS.test(f));
  } catch (e) {
    console.error('[pre-break] error reading dir:', e.message);
    return null;
  }
  console.log('[pre-break] found files:', files);
  if (!files.length) return null;
  return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}));

// tasks (focus-window)
ipcMain.handle('tasks:get-all',       safeHandle(()              => db.getTasks()));
ipcMain.handle('tasks:update-status', safeHandle((_e, id, status) => {
  const result = db.updateTask(id, { status });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tasks:changed');
  return result;
}));

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
  if (key === 'checkinInterval') {
    scheduler.restart();
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

// theme:save-custom — writes user-chosen variables to src/themes/user-custom/theme.css
ipcMain.handle('theme:save-custom', safeHandle((_e, variables) => {
  const themeDir = path.join(__dirname, 'src', 'themes', 'user-custom');
  if (!fs.existsSync(themeDir)) fs.mkdirSync(themeDir, { recursive: true });
  const lines = Object.entries(variables).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const css = `:root {\n${lines}\n}\n`;
  fs.writeFileSync(path.join(themeDir, 'theme.css'), css, 'utf8');
  return true;
}));

// theme
ipcMain.handle('theme:get-active', () => {
  return musicStore.get('activeTheme', 'default');
});

ipcMain.handle('theme:set-active', (_e, themeName) => {
  musicStore.set('activeTheme', themeName);
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('theme:changed', themeName);
  });
});


ipcMain.handle('theme:restart-with-theme', (_e, themeName) => {
  musicStore.set('activeTheme', themeName);

  // Update tray icon immediately for the new theme.
  if (tray && !tray.isDestroyed()) {
    const newIconPath = getThemeTrayIcon();
    try {
      const newIcon = nativeImage.createFromPath(newIconPath);
      tray.setImage(newIcon.isEmpty() ? nativeImage.createEmpty() : newIcon);
    } catch { /* ignore — tray icon is cosmetic */ }
  }

  if (!app.isPackaged) {
    // Dev mode: app.relaunch() won't work when launched via `npm start`.
    // Instead, hot-swap the theme and immediately play its startup sound.
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('theme:changed', themeName);
    });
    const fp = pickSoundFile(themeName, 'startup');
    if (fp) {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('sound:play-file', fp);
      });
    }
    // Return flag so renderer can show the right status message.
    return { devHotSwap: true };
  }

  // Production: full restart so the new theme's startup sound plays from boot.
  app.relaunch();
  app.exit(0);
});

// ── Sounds ────────────────────────────────────────────────────────────────────

const AUDIO_EXTS = /\.(wav|mp3|ogg)$/i;

/**
 * Pick a random audio file for a given theme + soundType.
 * In dev: reads from src/themes/ directly. In prod: reads from userData/themes/
 * (populated by initializeThemes on first launch / after update).
 * Returns an absolute file path string, or null if nothing is found or
 * uiSoundsEnabled is false for this theme.
 */
function pickSoundFile(themeName, soundType) {
  const uiEnabled = musicStore.get(`themes.${themeName}.uiSoundsEnabled`, true);
  if (!uiEnabled) {
    console.log(`[sound] UI sounds disabled for theme "${themeName}" — skipping "${soundType}"`);
    return null;
  }

  const dir = path.join(themesBaseDir(), themeName, 'sounds', soundType);

  console.log(`[sound] pickSoundFile: theme="${themeName}" type="${soundType}"`);
  console.log(`[sound]   dir: ${dir}`);

  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => AUDIO_EXTS.test(f));
    console.log(`[sound]   found:`, files.length ? files : '(none — only .gitkeep or empty)');
  } catch {
    console.log(`[sound]   folder missing or unreadable: ${dir}`);
  }

  if (!files.length) {
    console.log(`[sound]   → returning null (no audio files for "${soundType}")`);
    return null;
  }

  const selected = path.join(dir, files[Math.floor(Math.random() * files.length)]);
  console.log(`[sound]   → selected: ${selected}`);
  return selected;
}

// Returns the absolute path of a randomly-chosen sound file, or null.
// Main process reads active theme from store so the renderer never needs to pass it.
ipcMain.handle('sound:play', (_e, soundType) => {
  const themeName = musicStore.get('activeTheme', 'default');
  const fp = pickSoundFile(themeName, soundType);
  console.log(`[sound] sending path to renderer: ${fp ?? '(null)'}`);
  return fp;
});

// Explicit-theme variant — used by window.playThemeSound() in the renderer.
ipcMain.handle('sound:play-for-theme', (_e, themeName, soundType) => {
  return pickSoundFile(themeName, soundType);
});

// UI sounds toggle — read/write per-theme uiSoundsEnabled flag.
ipcMain.handle('sound:get-ui-enabled', (_e, themeName) => {
  return musicStore.get(`themes.${themeName}.uiSoundsEnabled`, true);
});
ipcMain.handle('sound:set-ui-enabled', (_e, themeName, enabled) => {
  musicStore.set(`themes.${themeName}.uiSoundsEnabled`, enabled);
});

// window control
ipcMain.on('window:closePrompt',      () => { if (promptWindow)     { promptWindow._soundPlayed     = true; promptWindow.close();     } });
ipcMain.on('window:closeMeal',        () => { if (mealWindow)       { mealWindow._soundPlayed       = true; mealWindow.close();       } });
ipcMain.on('window:closeReflection',  () => { if (reflectionWindow) { reflectionWindow._soundPlayed = true; reflectionWindow.close(); } });
ipcMain.on('window:closeSettings',    () => { if (settingsWindow)   { settingsWindow._soundPlayed   = true; settingsWindow.close();   } });
ipcMain.on('window:openMain',         () => createMainWindow());
ipcMain.on('window:openPrompt',       () => createPromptWindow());
ipcMain.on('window:openReflection',   () => createReflectionWindow());
ipcMain.on('window:openSettings',     () => createSettingsWindow());

// Generic sender-aware close — sound already played by renderer before calling this
ipcMain.on('window:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) { win._soundPlayed = true; win.close(); }
});

// Renderer finished playing close sound via native X — now actually close
ipcMain.on('window:close-confirmed', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) { win._soundPlayed = true; win.close(); }
});

ipcMain.on('tasks:changed', () => {
  mainWindow?.webContents.send('tasks:changed');
});

ipcMain.on('window:open', (_e, name) => {
  switch (name) {
    case 'main':       createMainWindow();       break;
    case 'prompt':     createPromptWindow();     break;
    case 'meal':       createMealWindow();       break;
    case 'reflection': createReflectionWindow(); break;
    case 'settings':   createSettingsWindow();   break;
    case 'focus':      createFocusWindow();      break;
    case 'finance':    createFinanceWindow();    break;
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
ipcMain.handle('app:is-dev',     () => !app.isPackaged);

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  initializeThemes();

  // ── Step 5 diagnostic: verify pre-break folder for each theme ────────────────
  ['default', 'outer-wilds', 'hollow-knight', 'minecraft', 'user-custom'].forEach(theme => {
    const dir = path.join(themesBaseDir(), theme, 'music', 'pre-break');
    try {
      const files = fs.readdirSync(dir).filter(f => AUDIO_EXTS.test(f));
      if (files.length) {
        console.log(`[pre-break] theme "${theme}" pre-break folder: ${files.length} file(s):`, files);
      } else {
        console.warn(`[pre-break] WARNING: no files in pre-break folder for theme "${theme}" (${dir})`);
      }
    } catch {
      console.warn(`[pre-break] WARNING: pre-break folder missing for theme "${theme}" (${dir})`);
    }
  });

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

  // Play startup sound once the main window renderer is fully loaded.
  // Resolved here in the main process (via pickSoundFile) and pushed to the
  // renderer as a file path so it can be played via HTML5 Audio.
  mainWindow.webContents.once('did-finish-load', () => {
    // Fallback: show if ready-to-show didn't fire (can happen with titleBarStyle:'hidden' on Windows).
    if (!mainWindow.isVisible()) mainWindow.show();
    const fp = pickSoundFile(musicStore.get('activeTheme', 'default'), 'startup');
    if (fp) mainWindow.webContents.send('sound:play-file', fp);
  });

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