'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── window.api — canonical API surface ────────────────────────────────────────

contextBridge.exposeInMainWorld('api', {
  // Database operations
  logActivity:    (data)     => ipcRenderer.invoke('db:insertLog',          data),
  getLogs:        (date)     => ipcRenderer.invoke('db:getLogsByDate',       date),
  addTask:        (data)     => ipcRenderer.invoke('db:insertTask',          data),
  updateTask:     (id, data) => ipcRenderer.invoke('db:updateTask',          id, data),
  deleteTask:     (id)       => ipcRenderer.invoke('db:deleteTask',          id),
  getTasks:       (filters)  => ipcRenderer.invoke('db:getTasks',            filters),
  logMeal:        (data)     => ipcRenderer.invoke('db:insertMeal',          data),
  getMeals:       (date)     => ipcRenderer.invoke('db:getMealsByDate',      date),
  saveReflection: (data)     => ipcRenderer.invoke('db:upsertReflection',    data),
  getReflection:  (date)     => ipcRenderer.invoke('db:getReflectionByDate', date),

  // Finances
  insertFinance:            (data)       => ipcRenderer.invoke('db:insertFinance',            data),
  getFinances:              (opts)       => ipcRenderer.invoke('db:getFinances',              opts),
  getFinancesLast30Days:    ()           => ipcRenderer.invoke('db:getFinancesLast30Days'),
  getMonthlyFinanceSummary: (year, month)=> ipcRenderer.invoke('db:getMonthlyFinanceSummary', year, month),
  deleteFinance:            (id)         => ipcRenderer.invoke('db:deleteFinance',            id),
  getAllFinancesForGraph:    ()           => ipcRenderer.invoke('db:getAllFinancesForGraph'),

  // DB meta
  getDbPath:      ()         => ipcRenderer.invoke('db:getDbPath'),
  changeDbFolder: ()         => ipcRenderer.invoke('db:changeDbFolder'),
  getActiveDates: ()         => ipcRenderer.invoke('db:getActiveDates'),

  // Settings
  getSettings:    ()              => ipcRenderer.invoke('settings:get'),
  setSetting:     (key, value)    => ipcRenderer.invoke('settings:set',           key, value),
  setAutoLaunch:  (enabled)       => ipcRenderer.invoke('settings:setAutoLaunch', enabled),

  // Setup wizard
  setupGetDefaultFolder: ()       => ipcRenderer.invoke('setup:getDefaultFolder'),
  setupChooseFolder:     ()       => ipcRenderer.invoke('setup:chooseFolder'),
  setupComplete:         (folder) => ipcRenderer.invoke('setup:complete', folder),

  // App controls
  closeWindow:      ()    => ipcRenderer.send('window:close'),
  closeConfirmed:   ()    => ipcRenderer.send('window:close-confirmed'),
  onCloseWithSound: (cb)  => ipcRenderer.on('window:close-with-sound', cb),
  openWindow:       (name) => ipcRenderer.send('window:open', name),

  // App info
  appGetVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Auto-updater
  updaterCheckNow:         ()   => ipcRenderer.invoke('updater:checkNow'),
  updaterInstall:          ()   => ipcRenderer.invoke('updater:install'),
  onUpdateAvailable:       (cb) => ipcRenderer.on('updater:update-available',  (_e, info)     => cb(info)),
  onUpdateDownloadProgress:(cb) => ipcRenderer.on('updater:download-progress', (_e, progress) => cb(progress)),
  onUpdateDownloaded:      (cb) => ipcRenderer.on('updater:update-downloaded', (_e, info)     => cb(info)),

  // Cross-window task refresh
  notifyTasksChanged: ()   => ipcRenderer.send('tasks:changed'),
  onTasksChanged:     (cb) => ipcRenderer.on('tasks:changed', () => cb()),
});

// ── window.tracker — legacy API (kept for backwards compatibility) ─────────────

contextBridge.exposeInMainWorld('tracker', {
  // ── hourly_logs ─────────────────────────────────────────────────────────────
  insertLog:     (params)  => ipcRenderer.invoke('db:insertLog', params),
  getLogsByDate: (date)    => ipcRenderer.invoke('db:getLogsByDate', date),
  getAllLogs:     ()        => ipcRenderer.invoke('db:getAllLogs'),
  updateLog:     (id, f)   => ipcRenderer.invoke('db:updateLog', id, f),
  deleteLog:     (id)      => ipcRenderer.invoke('db:deleteLog', id),

  // ── tasks ───────────────────────────────────────────────────────────────────
  insertTask:    (params)  => ipcRenderer.invoke('db:insertTask', params),
  getTasks:      (opts)    => ipcRenderer.invoke('db:getTasks', opts),
  getTaskById:   (id)      => ipcRenderer.invoke('db:getTaskById', id),
  updateTask:    (id, f)   => ipcRenderer.invoke('db:updateTask', id, f),
  deleteTask:    (id)      => ipcRenderer.invoke('db:deleteTask', id),

  // ── meals ───────────────────────────────────────────────────────────────────
  insertMeal:    (params)  => ipcRenderer.invoke('db:insertMeal', params),
  getMealsByDate:(date)    => ipcRenderer.invoke('db:getMealsByDate', date),
  getAllMeals:    ()        => ipcRenderer.invoke('db:getAllMeals'),
  updateMeal:    (id, f)   => ipcRenderer.invoke('db:updateMeal', id, f),
  deleteMeal:    (id)      => ipcRenderer.invoke('db:deleteMeal', id),

  // ── reflections ─────────────────────────────────────────────────────────────
  upsertReflection:   (params) => ipcRenderer.invoke('db:upsertReflection', params),
  getReflectionByDate:(date)   => ipcRenderer.invoke('db:getReflectionByDate', date),
  getAllReflections:   ()       => ipcRenderer.invoke('db:getAllReflections'),
  deleteReflection:   (id)     => ipcRenderer.invoke('db:deleteReflection', id),

  // ── finances ─────────────────────────────────────────────────────────────────
  insertFinance:            (data)        => ipcRenderer.invoke('db:insertFinance',            data),
  getFinances:              (opts)        => ipcRenderer.invoke('db:getFinances',              opts),
  getFinancesLast30Days:    ()            => ipcRenderer.invoke('db:getFinancesLast30Days'),
  getMonthlyFinanceSummary: (year, month) => ipcRenderer.invoke('db:getMonthlyFinanceSummary', year, month),
  deleteFinance:            (id)          => ipcRenderer.invoke('db:deleteFinance',            id),
  getAllFinancesForGraph:    ()            => ipcRenderer.invoke('db:getAllFinancesForGraph'),

  // ── db meta ─────────────────────────────────────────────────────────────────
  getDbPath:      () => ipcRenderer.invoke('db:getDbPath'),
  changeDbFolder: () => ipcRenderer.invoke('db:changeDbFolder'),
  getActiveDates: () => ipcRenderer.invoke('db:getActiveDates'),

  // ── settings ─────────────────────────────────────────────────────────────────
  getSettings:    ()           => ipcRenderer.invoke('settings:get'),
  setSetting:     (key, value) => ipcRenderer.invoke('settings:set',           key, value),
  setAutoLaunch:  (enabled)    => ipcRenderer.invoke('settings:setAutoLaunch', enabled),

  // ── app info ─────────────────────────────────────────────────────────────────
  appGetVersion:     () => ipcRenderer.invoke('app:getVersion'),
  updaterCheckNow:   () => ipcRenderer.invoke('updater:checkNow'),

  // ── cross-window task refresh ────────────────────────────────────────────────
  notifyTasksChanged: ()   => ipcRenderer.send('tasks:changed'),
  onTasksChanged:     (cb) => ipcRenderer.on('tasks:changed', () => cb()),

  // ── scheduler controls ───────────────────────────────────────────────────────
  schedulerPause:    () => ipcRenderer.invoke('scheduler:pause'),
  schedulerResume:   () => ipcRenderer.invoke('scheduler:resume'),
  schedulerIsPaused: () => ipcRenderer.invoke('scheduler:isPaused'),

  // ── setup wizard ────────────────────────────────────────────────────────────
  setupGetDefaultFolder: ()       => ipcRenderer.invoke('setup:getDefaultFolder'),
  setupChooseFolder:     ()       => ipcRenderer.invoke('setup:chooseFolder'),
  setupComplete:         (folder) => ipcRenderer.invoke('setup:complete', folder),

  // ── window control ──────────────────────────────────────────────────────────
  closeWindow:          () => ipcRenderer.send('window:close'),
  closeConfirmed:       () => ipcRenderer.send('window:close-confirmed'),
  onCloseWithSound:     (cb) => ipcRenderer.on('window:close-with-sound', cb),
  openWindow:           (name) => ipcRenderer.send('window:open', name),
  closePrompt:          () => ipcRenderer.send('window:closePrompt'),
  closeMeal:            () => ipcRenderer.send('window:closeMeal'),
  closeReflection:      () => ipcRenderer.send('window:closeReflection'),
  closeSettings:        () => ipcRenderer.send('window:closeSettings'),
  openMain:             () => ipcRenderer.send('window:openMain'),
  openPromptWindow:     () => ipcRenderer.send('window:openPrompt'),
  openReflectionWindow: () => ipcRenderer.send('window:openReflection'),
  openSettingsWindow:   () => ipcRenderer.send('window:openSettings'),

  // ── focus sessions ──────────────────────────────────────────────────────────
  focus: {
    saveSession:  (data) => ipcRenderer.invoke('focus:save-session', data),
    getSessions:  (date) => ipcRenderer.invoke('focus:get-sessions', date),
    getSummary:   ()     => ipcRenderer.invoke('focus:get-summary'),
  },

  // ── tasks (namespaced) ───────────────────────────────────────────────────────
  // Status values: 'pending' | 'in_progress' | 'done'
  tasks: {
    getAll:       ()             => ipcRenderer.invoke('db:getTasks'),
    updateStatus: (taskId, status) => ipcRenderer.invoke('db:updateTask', taskId, { status }),
  },

  // ── finance window ───────────────────────────────────────────────────────────
  finance: {
    saveEntry:  (data) => ipcRenderer.invoke('finance:save-entry',  data),
    openWindow: ()     => ipcRenderer.invoke('finance:open-window'),
  },

  // ── theme ────────────────────────────────────────────────────────────────────
  theme: {
    getActive:          ()              => ipcRenderer.invoke('theme:get-active'),
    setActive:          (themeName)     => ipcRenderer.invoke('theme:set-active', themeName),
    onChange:           (callback)      => ipcRenderer.on('theme:changed', (_e, name) => callback(name)),
    saveCustom:         (variables)     => ipcRenderer.invoke('theme:save-custom', variables),
    restartWithTheme:   (themeName)     => ipcRenderer.invoke('theme:restart-with-theme', themeName),
  },

  // ── sounds ───────────────────────────────────────────────────────────────────
  // tracker.sound.play(soundType) returns Promise<string|null> (absolute file path).
  // sound-player.js wraps this to also trigger HTML5 Audio playback automatically.
  sound: {
    play:          (soundType)             => ipcRenderer.invoke('sound:play', soundType),
    playForTheme:  (themeName, soundType)  => ipcRenderer.invoke('sound:play-for-theme', themeName, soundType),
    // Used by sound-player.js to receive file-path pushes from the main process
    // (e.g. startup sound fired after app.whenReady).
    onPlayFile:    (cb) => ipcRenderer.on('sound:play-file', (_e, fp) => cb(fp)),
    // Per-theme UI sounds toggle — mirrors the uiSoundsEnabled key in electron-store.
    getUiEnabled:  (themeName) => ipcRenderer.invoke('sound:get-ui-enabled', themeName),
    setUiEnabled:  (themeName, enabled) => ipcRenderer.invoke('sound:set-ui-enabled', themeName, enabled),
  },

  // ── music (focus-window) ─────────────────────────────────────────────────────
  music: {
    saveTrack:            (themeName, pool, filePath, name) => ipcRenderer.invoke('music:save-track', themeName, pool, filePath, name),
    getTracks:            (themeName, pool)                 => ipcRenderer.invoke('music:get-tracks', themeName, pool),
    deleteTrack:          (themeName, pool, filename)       => ipcRenderer.invoke('music:delete-track', themeName, pool, filename),
    getActiveThemeTracks: (pool)                            => ipcRenderer.invoke('music:get-active-theme-tracks', pool),
    getPreBreakTrack:     (themeName)                       => ipcRenderer.invoke('music:get-pre-break-track', themeName),
  },

  // ── app meta ─────────────────────────────────────────────────────────────────
  app: {
    isDev: () => ipcRenderer.invoke('app:is-dev'),
  },
});
