# Daily Tracker

A lightweight desktop app for building self-awareness through consistent daily logging. Hourly activity check-ins, meal tracking, a task board, and an evening reflection — all stored locally on your machine, no accounts or cloud sync required.

Built with Electron and SQLite.

---

## Features

**Hourly check-ins** — A timed prompt appears on the hour (within your configured window) asking what you worked on and how you felt. Takes five seconds to fill in.

**Evening reflection** — At 8 PM, a structured journaling prompt captures daily highlights, challenges, gratitude, and priorities for tomorrow.

**Task board** — A minimal Kanban board (To Do / In Progress / Done) with drag-and-drop, due dates, categories, and overdue indicators.

**Meal tracker** — Log meals with type, description, and calories. Auto-selects meal type based on time of day. Shows a daily calorie total.

**History & calendar** — A heat-map calendar shows which days have logged data. Click any day to see a full snapshot of activities, meals, tasks, and reflection.

**Streak counter** — Counts how many consecutive days you've logged activity.

**System tray** — Lives in your system tray. Access everything from the tray menu without keeping a window open.

**Configurable reminders** — Set the start and end hour for reminders. Pause notifications for the session from the tray. Launch on startup (optional).

---

## Screenshots

> *(coming soon)*

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm

### Install and run

```bash
git clone https://github.com/Anthony-Haber/daily-tracker.git
cd daily-tracker/daily-tracker
npm install
npm start
```

`npm install` triggers a `postinstall` step that recompiles `better-sqlite3` against the bundled Electron version. This requires Python and a C++ build toolchain:

- **Windows:** Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (select "Desktop development with C++")
- **Linux:** `sudo apt install build-essential python3` (or equivalent for your distro)
- **macOS:** `xcode-select --install`

---

## Building Distributables

```bash
# Windows installer (.exe via NSIS)
npm run build:win

# Linux AppImage
npm run build:linux

# Both at once
npm run build
```

Output goes to `daily-tracker/dist/`.

> **Note:** Building the Linux AppImage must be done on a Linux machine (or WSL2 / Docker). Cross-compiling native modules like `better-sqlite3` from Windows to Linux is not supported.

---

## Configuration

Open **Settings** from the tray menu or dashboard.

| Setting | Description |
|---|---|
| Reminder hours | The start and end hour (24h) for hourly prompts |
| Reminders enabled | Master toggle — turn off entirely or pause for the session from the tray |
| Launch on startup | Registers the app with the OS login items |
| Database folder | Move the database file to a custom location (e.g. a synced folder) |

All settings are saved immediately. Changes to the database folder take effect after a restart.

---

## Data & Privacy

Everything is stored locally:

- **Database:** `daily-tracker.db` — SQLite file in your OS user-data directory, or a custom folder you choose in Settings
- **Preferences:** `daily-tracker-config.json` — also in user-data

No telemetry, no analytics, no network requests. The app works fully offline.

If you want to sync your data across machines, point the database folder at a location managed by your sync client (Dropbox, Syncthing, etc.). Avoid having the app open on two machines simultaneously against the same file.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | [Electron](https://www.electronjs.org/) v29 |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Settings | [electron-store](https://github.com/sindresorhus/electron-store) |
| UI | Vanilla HTML / CSS / JavaScript (no framework) |
| Packaging | [electron-builder](https://www.electron.build/) |

---

## Project Structure

```
daily-tracker/
├── main.js              # App entry, tray, IPC handlers, window management
├── preload.js           # Exposes window.api to renderer processes
└── src/
    ├── db.js            # SQLite CRUD operations
    ├── scheduler.js     # Hourly reminder timer and reflection trigger
    ├── settings.js      # Persistent settings + cross-platform auto-launch
    └── windows/
        ├── main-window/     # Dashboard (overview, tasks, meals, history)
        ├── prompt-window/   # Hourly activity check-in popup
        ├── meal-window/     # Quick meal logger popup
        ├── reflection-window/ # Evening reflection popup
        └── settings-window/ # Settings panel
```

---

## Linux Notes

**Notifications:** Uses the Electron Notification API. If notifications don't appear, install `libnotify-bin`:
```bash
sudo apt install libnotify-bin
```

**Auto-launch:** Managed via a `.desktop` file written to `~/.config/autostart/`.

**AppImage:** The distributed AppImage is self-contained and runs without installation. Mark it executable and run it:
```bash
chmod +x Daily-Tracker-*.AppImage
./Daily-Tracker-*.AppImage
```

---

## License

MIT
