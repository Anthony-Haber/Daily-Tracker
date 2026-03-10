# Daily Tracker

Keep track of your day — effortlessly.

Daily Tracker is a small Windows app that lives in your system tray and helps you stay aware of how you're spending your time. It gently checks in with you each hour, helps you log meals, and gives you space to reflect at the end of the day. Everything stays private on your own computer.

---

## What it does

- **Hourly check-ins** — A quick pop-up asks what you've been working on each hour. Takes about 5 seconds.
- **Meal logging** — Keep a simple record of what you eat throughout the day.
- **Evening reflection** — Wind down with a short review of your day: highlights, challenges, and goals for tomorrow.
- **Dashboard** — See everything you've logged, organized by day, all in one place.

Your data is saved in a file on your computer — nothing is sent to the internet.

---

## Download & Install

1. Go to the **[Releases](../../releases)** page on GitHub
2. Download the latest **`Daily-Tracker-Setup.exe`** file
3. Double-click it and follow the on-screen steps (takes about 30 seconds)
4. Daily Tracker will appear in your **system tray** — the small icons in the bottom-right corner of your taskbar

**On first launch**, a short setup wizard will welcome you and ask where to save your data. The default (your Documents folder) works great for most people — just click "Start Using Daily Tracker."

### To uninstall

Open **Windows Settings → Apps**, search for **Daily Tracker**, and click Uninstall.

---

## How to use it

- **Left-click** the tray icon to open the dashboard
- **Right-click** the tray icon for quick access to log an activity, log a meal, or open the evening reflection
- To set Daily Tracker to open automatically when you turn on your PC, go to **tray → Settings** and turn on "Start Daily Tracker when Windows starts"

---

## Screenshots

> *(coming soon)*

---

---

## For Developers

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later (comes with npm)
- A C++ build toolchain for compiling the SQLite native module:
  - **Windows:** Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++"

### Run from source

```bash
git clone https://github.com/Anthony-Haber/daily-tracker.git
cd daily-tracker/daily-tracker
npm install
npm start
```

### Build a Windows installer

```bash
cd daily-tracker
npm run build:win
```

The installer (`Daily-Tracker-Setup.exe`) will appear in the `dist/` folder.

### Project structure

```
daily-tracker/
├── main.js                  # App entry, tray, IPC handlers, window management
├── preload.js               # Exposes window.api / window.tracker to renderers
└── src/
    ├── db.js                # SQLite CRUD (better-sqlite3)
    ├── scheduler.js         # Hourly reminder timer
    ├── settings.js          # Persistent settings + auto-launch
    └── windows/
        ├── main-window/     # Dashboard
        ├── prompt-window/   # Hourly check-in popup
        ├── meal-window/     # Meal logger popup
        ├── reflection-window/  # Evening reflection popup
        ├── settings-window/ # Settings panel
        └── setup-wizard/    # First-launch setup flow
```

### Tech stack

| Layer | Technology |
|---|---|
| Shell | [Electron](https://www.electronjs.org/) v29 |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Settings | [electron-store](https://github.com/sindresorhus/electron-store) |
| UI | Vanilla HTML / CSS / JavaScript |
| Packaging | [electron-builder](https://www.electron.build/) |

### Data & privacy

All data lives locally:

- **Database:** `daily-tracker.db` — SQLite file in the folder chosen during setup (default: `Documents\DailyTracker`)
- **Preferences:** `daily-tracker-config.json` — in the OS user-data directory

No telemetry, no analytics, no network requests.

---

MIT License
