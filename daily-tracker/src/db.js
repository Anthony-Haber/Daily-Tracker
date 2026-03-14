'use strict';

const path = require('path');
const { app, dialog } = require('electron');
const Database = require('better-sqlite3');
const Store    = require('electron-store');

// Persists user config (db folder path) across sessions.
const store = new Store({ name: 'daily-tracker-config' });

let db = null;

// ── Error handling ────────────────────────────────────────────────────────────

/**
 * Wraps a synchronous DB call in try/catch.
 * On failure: shows a user-friendly error dialog and returns the fallback value.
 *
 * @template T
 * @param {() => T}  fn        DB operation to execute
 * @param {T}        fallback  Value returned when the operation fails
 * @returns {T}
 */
function safeDB(fn, fallback = null) {
  try {
    return fn();
  } catch (err) {
    console.error('[db] error:', err.message);
    dialog.showErrorBox(
      'Database Error',
      `A database error occurred:\n\n${err.message}\n\nIf this persists, try changing the database folder in Settings.`,
    );
    return fallback;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

/** Returns true when no data folder has been chosen yet (i.e. first launch). */
function needsSetup() {
  return !store.get('dbFolder');
}

/**
 * Persist the chosen data folder path without opening a dialog.
 * Called by the setup wizard IPC handler in main.js.
 * @param {string} folderPath
 */
function setDbFolder(folderPath) {
  store.set('dbFolder', folderPath);
}

/**
 * Open (or create) the SQLite database.
 *
 * The data folder must already be stored in electron-store before calling
 * init() — either via the setup wizard (first launch) or from a previous
 * session.  Falls back to userData if somehow nothing is set.
 *
 * Uses path.join() throughout — works on Windows, macOS and Linux.
 */
async function init() {
  let dbFolder = store.get('dbFolder');

  if (!dbFolder) {
    // Safety fallback — should not happen after the setup wizard runs.
    // app.getPath('userData') is cross-platform:
    //   Windows → C:\Users\<user>\AppData\Roaming\<app>
    //   macOS   → ~/Library/Application Support/<app>
    //   Linux   → ~/.config/<app>
    dbFolder = app.getPath('userData');
    store.set('dbFolder', dbFolder);
  }

  try {
    const dbPath = path.join(dbFolder, 'daily-tracker.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    createTables();
    createFocusSessionsTable();
    try { db.exec('ALTER TABLE tasks ADD COLUMN category TEXT'); } catch (_) {}
    try { db.exec('ALTER TABLE tasks ADD COLUMN pomodoro_estimate INTEGER DEFAULT 1'); } catch (_) {}
    try { db.exec('ALTER TABLE reflections ADD COLUMN journal_entry TEXT'); } catch (_) {}
    try { db.exec('ALTER TABLE hourly_logs ADD COLUMN task_id INTEGER REFERENCES tasks(id)'); } catch (_) {}
  } catch (err) {
    dialog.showErrorBox(
      'Failed to open database',
      `Could not open the database at:\n${dbFolder}\n\nError: ${err.message}\n\nTry changing the database folder in Settings.`,
    );
    throw err; // re-throw so app.whenReady can catch it if needed
  }
}

/** Returns the full path to the open database file. */
function getDbPath() {
  return db ? db.name : null;
}

/** Lets the user pick a new folder at any time and re-saves the preference. */
async function changeDbFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Change database folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (canceled || filePaths.length === 0) return null;

  store.set('dbFolder', filePaths[0]);
  return filePaths[0];
}

// ── Schema ────────────────────────────────────────────────────────────────────

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hourly_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT NOT NULL,
      activity   TEXT NOT NULL,
      category   TEXT,           -- "work" | "personal" | "break" | "exercise" | "other"
      mood       INTEGER         -- 1-5 (😴 😐 🙂 😊 🔥)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      title      TEXT NOT NULL,
      notes      TEXT,
      status     TEXT DEFAULT 'pending',  -- pending | in_progress | done
      due_date   TEXT,
      category   TEXT                     -- work | personal | health | learning | other
    );

    CREATE TABLE IF NOT EXISTS meals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL,
      meal_type   TEXT,          -- breakfast | lunch | dinner | snack
      description TEXT NOT NULL,
      calories    INTEGER
    );

    CREATE TABLE IF NOT EXISTS reflections (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      date           TEXT NOT NULL UNIQUE,
      mood           REAL,       -- 1.0-10.0 (continuous)
      highlights     TEXT,
      challenges     TEXT,
      gratitude      TEXT,
      tomorrow_goals TEXT
    );

    CREATE TABLE IF NOT EXISTS finances (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      type        TEXT NOT NULL,
      amount      REAL NOT NULL,
      category    TEXT,
      description TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hourly_logs_timestamp ON hourly_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_tasks_status          ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date        ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_meals_timestamp       ON meals(timestamp);
    CREATE INDEX IF NOT EXISTS idx_reflections_date      ON reflections(date);
    CREATE INDEX IF NOT EXISTS idx_finances_date         ON finances(date);
    CREATE INDEX IF NOT EXISTS idx_finances_type         ON finances(type);
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** ISO-8601 timestamp for right now. */
function now() {
  return new Date().toISOString();
}

// ── hourly_logs CRUD ──────────────────────────────────────────────────────────

function insertLog({ activity, category = null, mood = null, task_id = null, timestamp = now() }) {
  return safeDB(() => {
    const info = db.prepare(`
      INSERT INTO hourly_logs (timestamp, activity, category, mood, task_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(timestamp, activity, category, mood, task_id ?? null);
    return { id: Number(info.lastInsertRowid) };
  }, null);
}

function getLogsByDate(date) {
  return safeDB(() =>
    db.prepare(`
      SELECT * FROM hourly_logs
      WHERE date(timestamp) = ?
      ORDER BY timestamp ASC
    `).all(date),
  []);
}

function getAllLogs() {
  return safeDB(() =>
    db.prepare('SELECT * FROM hourly_logs ORDER BY timestamp DESC').all(),
  []);
}

function updateLog(id, { activity, category, mood }) {
  return safeDB(() =>
    db.prepare(`
      UPDATE hourly_logs
      SET activity = COALESCE(?, activity),
          category = COALESCE(?, category),
          mood     = COALESCE(?, mood)
      WHERE id = ?
    `).run(activity ?? null, category ?? null, mood ?? null, id),
  );
}

function deleteLog(id) {
  return safeDB(() =>
    db.prepare('DELETE FROM hourly_logs WHERE id = ?').run(id),
  );
}

// ── tasks CRUD ────────────────────────────────────────────────────────────────

function insertTask({ title, notes = null, status = 'pending', due_date = null, category = null, pomodoro_estimate = 1 }) {
  return safeDB(() => {
    const info = db.prepare(`
      INSERT INTO tasks (created_at, title, notes, status, due_date, category, pomodoro_estimate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(now(), title, notes, status, due_date, category, pomodoro_estimate ?? 1);
    return { id: Number(info.lastInsertRowid) };
  }, null);
}

function getTasks({ status } = {}) {
  return safeDB(() => {
    if (status) {
      return db.prepare(`
        SELECT * FROM tasks WHERE status = ? ORDER BY due_date ASC, created_at ASC
      `).all(status);
    }
    return db.prepare(`
      SELECT * FROM tasks ORDER BY due_date ASC, created_at ASC
    `).all();
  }, []);
}

function getTaskById(id) {
  return safeDB(() =>
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) ?? null,
  null);
}

function updateTask(id, { title, notes, status, due_date, category, pomodoro_estimate }) {
  return safeDB(() =>
    db.prepare(`
      UPDATE tasks
      SET title             = COALESCE(?, title),
          notes             = COALESCE(?, notes),
          status            = COALESCE(?, status),
          due_date          = COALESCE(?, due_date),
          category          = COALESCE(?, category),
          pomodoro_estimate = COALESCE(?, pomodoro_estimate)
      WHERE id = ?
    `).run(title ?? null, notes ?? null, status ?? null, due_date ?? null, category ?? null, pomodoro_estimate ?? null, id),
  );
}

function deleteTask(id) {
  return safeDB(() => {
    const run = db.transaction(() => {
      db.prepare('UPDATE hourly_logs SET task_id = NULL WHERE task_id = ?').run(id);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    });
    return run();
  });
}

// ── meals CRUD ────────────────────────────────────────────────────────────────

function insertMeal({ description, meal_type = null, calories = null, timestamp = now() }) {
  return safeDB(() => {
    const info = db.prepare(`
      INSERT INTO meals (timestamp, meal_type, description, calories)
      VALUES (?, ?, ?, ?)
    `).run(timestamp, meal_type, description, calories);
    return { id: Number(info.lastInsertRowid) };
  }, null);
}

function getMealsByDate(date) {
  return safeDB(() =>
    db.prepare(`
      SELECT * FROM meals
      WHERE date(timestamp) = ?
      ORDER BY timestamp ASC
    `).all(date),
  []);
}

function getAllMeals() {
  return safeDB(() =>
    db.prepare('SELECT * FROM meals ORDER BY timestamp DESC').all(),
  []);
}

function updateMeal(id, { meal_type, description, calories }) {
  return safeDB(() =>
    db.prepare(`
      UPDATE meals
      SET meal_type   = COALESCE(?, meal_type),
          description = COALESCE(?, description),
          calories    = COALESCE(?, calories)
      WHERE id = ?
    `).run(meal_type ?? null, description ?? null, calories ?? null, id),
  );
}

function deleteMeal(id) {
  return safeDB(() =>
    db.prepare('DELETE FROM meals WHERE id = ?').run(id),
  );
}

// ── reflections CRUD ──────────────────────────────────────────────────────────

function upsertReflection({ date, mood = null, highlights = null, challenges = null, gratitude = null, tomorrow_goals = null, journal_entry = null }) {
  return safeDB(() => {
    db.prepare(`
      INSERT INTO reflections (date, mood, highlights, challenges, gratitude, tomorrow_goals, journal_entry)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        mood           = excluded.mood,
        highlights     = excluded.highlights,
        challenges     = excluded.challenges,
        gratitude      = excluded.gratitude,
        tomorrow_goals = excluded.tomorrow_goals,
        journal_entry  = excluded.journal_entry
    `).run(date, mood, highlights, challenges, gratitude, tomorrow_goals, journal_entry);
    return { ok: true };
  }, { ok: false });
}

function getReflectionByDate(date) {
  return safeDB(() =>
    db.prepare('SELECT * FROM reflections WHERE date = ?').get(date) ?? null,
  null);
}

function getAllReflections() {
  return safeDB(() =>
    db.prepare('SELECT * FROM reflections ORDER BY date DESC').all(),
  []);
}

function deleteReflection(id) {
  return safeDB(() =>
    db.prepare('DELETE FROM reflections WHERE id = ?').run(id),
  );
}

// ── finances CRUD ─────────────────────────────────────────────────────────────

function insertFinance({ date, type, amount, category = null, description = null }) {
  return safeDB(() => {
    const info = db.prepare(`
      INSERT INTO finances (date, type, amount, category, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(date, type, amount, category, description, now());
    return { id: Number(info.lastInsertRowid) };
  }, null);
}

function getFinances({ limit = 100 } = {}) {
  return safeDB(() =>
    db.prepare(`
      SELECT * FROM finances ORDER BY date DESC, created_at DESC LIMIT ?
    `).all(limit),
  []);
}

function getFinancesLast30Days() {
  return safeDB(() =>
    db.prepare(`
      SELECT date, type, SUM(amount) AS total
      FROM finances
      WHERE date >= date('now', '-29 days')
      GROUP BY date, type
      ORDER BY date ASC
    `).all(),
  []);
}

function getMonthlyFinanceSummary(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return safeDB(() =>
    db.prepare(`
      SELECT type, SUM(amount) AS total
      FROM finances
      WHERE date LIKE ?
      GROUP BY type
    `).all(prefix + '%'),
  []);
}

function deleteFinance(id) {
  return safeDB(() =>
    db.prepare('DELETE FROM finances WHERE id = ?').run(id),
  );
}

/**
 * Returns every finance row grouped by date+type, ordered oldest-first.
 * Used to build the all-time cumulative net-balance graph.
 */
function getAllFinancesForGraph() {
  return safeDB(() =>
    db.prepare(`
      SELECT date, type, SUM(amount) AS total
      FROM finances
      GROUP BY date, type
      ORDER BY date ASC
    `).all(),
  []);
}

// ── focus_sessions ────────────────────────────────────────────────────────────

function createFocusSessionsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      date             TEXT NOT NULL,
      task_label       TEXT,
      mode             TEXT NOT NULL,  -- pomodoro | short_break | long_break
      duration_minutes INTEGER NOT NULL,
      completed        INTEGER NOT NULL DEFAULT 0,  -- 0 | 1
      created_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_focus_sessions_date ON focus_sessions(date);
  `);
}

function saveFocusSession({ date, task_label = null, mode, duration_minutes, completed = 0 }) {
  return safeDB(() => {
    const info = db.prepare(`
      INSERT INTO focus_sessions (date, task_label, mode, duration_minutes, completed, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(date, task_label, mode, duration_minutes, completed ? 1 : 0, now());
    return { id: Number(info.lastInsertRowid) };
  }, null);
}

function getFocusSessionsByDate(date) {
  return safeDB(() =>
    db.prepare(`
      SELECT * FROM focus_sessions
      WHERE date = ?
      ORDER BY created_at ASC
    `).all(date),
  []);
}

function getFocusSummaryToday() {
  return safeDB(() =>
    db.prepare(`
      SELECT COUNT(*) AS completed_pomodoros
      FROM focus_sessions
      WHERE date = date('now') AND mode = 'pomodoro' AND completed = 1
    `).get(),
  { completed_pomodoros: 0 });
}

// ── Cross-table queries ───────────────────────────────────────────────────────

function getActiveDates() {
  return safeDB(() =>
    db.prepare(`
      SELECT date(timestamp) AS d FROM hourly_logs
      UNION
      SELECT date(timestamp) AS d FROM meals
      UNION
      SELECT date AS d FROM reflections
      ORDER BY d DESC
    `).all().map(r => r.d),
  []);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // lifecycle
  init,
  needsSetup,
  setDbFolder,
  getDbPath,
  changeDbFolder,

  // hourly_logs
  insertLog,
  getLogsByDate,
  getAllLogs,
  updateLog,
  deleteLog,

  // tasks
  insertTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,

  // meals
  insertMeal,
  getMealsByDate,
  getAllMeals,
  updateMeal,
  deleteMeal,

  // reflections
  upsertReflection,
  getReflectionByDate,
  getAllReflections,
  deleteReflection,

  // finances
  insertFinance,
  getFinances,
  getFinancesLast30Days,
  getMonthlyFinanceSummary,
  deleteFinance,
  getAllFinancesForGraph,

  // focus_sessions
  saveFocusSession,
  getFocusSessionsByDate,
  getFocusSummaryToday,

  // cross-table
  getActiveDates,
};
