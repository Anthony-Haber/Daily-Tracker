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
  closeWindow: ()     => ipcRenderer.send('window:close'),
  openWindow:  (name) => ipcRenderer.send('window:open', name),
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

  // ── db meta ─────────────────────────────────────────────────────────────────
  getDbPath:      () => ipcRenderer.invoke('db:getDbPath'),
  changeDbFolder: () => ipcRenderer.invoke('db:changeDbFolder'),
  getActiveDates: () => ipcRenderer.invoke('db:getActiveDates'),

  // ── settings ─────────────────────────────────────────────────────────────────
  getSettings:    ()           => ipcRenderer.invoke('settings:get'),
  setSetting:     (key, value) => ipcRenderer.invoke('settings:set',           key, value),
  setAutoLaunch:  (enabled)    => ipcRenderer.invoke('settings:setAutoLaunch', enabled),

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
  openWindow:           (name) => ipcRenderer.send('window:open', name),
  closePrompt:          () => ipcRenderer.send('window:closePrompt'),
  closeMeal:            () => ipcRenderer.send('window:closeMeal'),
  closeReflection:      () => ipcRenderer.send('window:closeReflection'),
  closeSettings:        () => ipcRenderer.send('window:closeSettings'),
  openMain:             () => ipcRenderer.send('window:openMain'),
  openPromptWindow:     () => ipcRenderer.send('window:openPrompt'),
  openReflectionWindow: () => ipcRenderer.send('window:openReflection'),
  openSettingsWindow:   () => ipcRenderer.send('window:openSettings'),
});
