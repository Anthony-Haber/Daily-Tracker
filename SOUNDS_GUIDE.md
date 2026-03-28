# Sounds & Music Guide

All audio assets for the Daily Tracker are organized inside `daily-tracker/src/themes/`.
Each theme has its own `music/` and `sounds/` folders. Drop files in and they ship with the next build.

---

## Folder structure

```
src/themes/{theme}/
  music/
    focus/        — plays during pomodoro sessions
    break/        — plays during short and long breaks
    pre-break/    — plays in the final seconds before a break starts
  sounds/
    ship-log/     — plays when the Ship Log overlay fires
    close/        — plays when a window is closed
    error/        — plays on validation errors or failed actions
    startup/      — plays when the app launches
    meal-log/     — plays when a meal entry is saved
    finance-log/  — plays when a finance entry is saved
    checkin/      — plays when a daily check-in is submitted
    reflection/   — plays when a reflection is saved
```

---

## Supported formats

`.wav` · `.mp3` · `.ogg`

---

## Multiple files = random pick

If a folder contains more than one file, the app picks one at random each time that event fires.
Use this to add variety — e.g. three different "meal saved" chimes.

---

## Special rules

| Folder | Rule |
|--------|------|
| `music/pre-break/` | Keep **one file only**. This is a short sting that fades in right before a break; multiple files are not shuffled here. |
| `sounds/ship-log/` | Only active when the **Outer Wilds** theme is selected. Other themes ignore this folder. |

---

## Themes

| Theme | Who edits it |
|-------|-------------|
| `default` | Developer — committed to the repo, ships in the build |
| `outer-wilds` | Developer — committed to the repo, ships in the build |
| `hollow-knight` | Developer — committed to the repo, ships in the build |
| `minecraft` | Developer — committed to the repo, ships in the build |
| `user-custom` | End user — files are written to `userData/themes/user-custom/` at runtime and are **not** in the repo |

Developer themes: edit the files directly in `src/themes/{theme}/`, then run `npm run build:win` (or the relevant build command). The `src/**/*` glob in `package.json` includes everything automatically.

User-custom theme: the user drops files into the app's data folder via the in-app upload buttons. These are never touched by a build.
