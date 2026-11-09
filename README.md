# Deskmate

A clean, minimal dashboard for [Obsidian](https://obsidian.md). Put a few small blocks in any note and get:

- **A header** with a live clock, the date, a time-of-day greeting and quick stats (notes, open tasks, done today). An optional, subtle 3D background sits behind it.
- **Today:** one goal for the day, plus every task due today or overdue from across your vault. Tick tasks off right there or add new ones.
- **Subject cards:** a grid of your subject or project notes, each with a cover, an emoji and a short description.
- **Day log:** a quick "What's happening?" box. Each line is saved with the time in a Day Log note, newest day first.
- **Tabs:** split a long dashboard into tabs. Each tab is its own note, so any block inside it (Dataview, other plugins) still works.
- **Daily card:** an encouraging sentence and an everyday thing described in one simple sentence, written by a small AI that runs on your own computer.
- **Recently edited:** your latest notes with their properties as small tags and how long ago you changed them.

Deskmate follows your theme, works in light and dark mode, and fits phones.

**Works offline.** Deskmate makes no network requests, with one opt-in exception: if you turn on the local AI, its model is downloaded once (see below). The 3D library (three.js) is bundled inside the plugin.

<!-- Screenshots go here -->

## Install

**Community plugins:** coming soon.

**Now, with BRAT:**
1. Install the **BRAT** plugin from Community plugins.
2. Run **BRAT: Add a beta plugin for testing** and enter `Nelvin198/deskmate`.
3. Enable **Deskmate** in Settings → Community plugins.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Nelvin198/deskmate/releases) into `<your vault>/.obsidian/plugins/deskmate/`, then enable it.

## Quick start

Run **Deskmate: Create dashboard note** from the command palette (Ctrl/Cmd+P). Or paste this into any note:

````markdown
---
cssclasses: deskmate
---

```deskmate-header
subtitle: Notes, thoughts and things that matter.
```

```deskmate-today
```

```deskmate-subjects
folder: Subjects
```
````

`cssclasses: deskmate` gives the note a wider page so the cards have room, and hides the Properties box at the top. To edit that note's properties later, run **Show file properties** from the command palette.

## Blocks

### `deskmate-header`

| Option | Example | |
|---|---|---|
| `title` | `My vault` | Small label above the greeting. Defaults to the vault name. |
| `subtitle` | `Stay in the flow.` | Line under the greeting. |
| `name` | `Sam` | "Good morning, Sam." Overrides the name in settings. |
| `3d` | `off` | Turns the 3D background on or off for this block. |

### `deskmate-today`

No options. Shows:
- **Today's goal:** click to write it. It is saved per day, so each morning starts fresh.
- **To do today:** open tasks with a due date of today or earlier, from every note (except ignored folders). Tasks finished today stay visible, crossed out.
- **Edit or delete:** click a task's text to change it; use the bin icon to delete it (with Undo).
- **Add a task:** type and press Enter. The task goes into the note set in settings (default `To-do.md`) with today's date.

Tasks use the [Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) format, so the two work together, but Tasks is not required:

```markdown
- [ ] Email the tutor 📅 2026-11-03
- [ ] Practise German 🔁 every day when done 📅 2026-11-03
```

Repeating tasks (`🔁 every day`, `every 2 weeks`, `every month`, `every weekday`, `… when done`) get their next copy when you tick them in Deskmate.

### `deskmate-subjects`

| Option | Example | |
|---|---|---|
| `folder` | `Subjects` | Show the notes in this folder (default from settings). |
| `tag` | `#subject` | Or show notes with this tag instead. |
| `title` | `Courses` | Label above the grid. Leave empty (`title:`) to hide it. |

Each note can set these properties:

```yaml
icon: 🦉
description: Big questions and how people have answered them.
cover: "[[philosophy-cover.png]]"
```

Covers must be images inside your vault (so Deskmate stays offline). Without a cover, the card gets a soft colour made from its name.

### `deskmate-recent`

| Option | Example | |
|---|---|---|
| `folder` | `Notes` | Only notes in this folder. Default: the whole vault. |
| `limit` | `8` | How many notes (1 to 30). Default 6. |
| `show` | `subject, status` | Properties to show as tags. `status` values `draft`, `learning` and `mastered` get their own colours. |
| `title` | `Latest` | Label above the list. Leave empty to hide it. |

### `deskmate-daylog`

| Option | Example | |
|---|---|---|
| `note` | `Journal/Day Log` | The note entries are saved to (found by name). Default from settings: `Day Log`. |
| `title` | `Today so far` | Label on the card. |

**Your day** (with local AI): at the bottom of the card, press **Summarise my day** to turn today's entries into a vivid, diary-style paragraph that covers your morning, afternoon and evening (each written separately, then joined; up to 300 words), then **Add to journal** to save them under a `## Day summary` heading in that day's daily note (created from your Daily notes template if needed; saving again replaces it).

Type a line and press Enter to save it as `- 14:32 your text` under today's `## 2026-11-04 (Wednesday)` heading. Click an entry to edit it; use the bin icon to delete it (with Undo).

### `deskmate-tabs`

````markdown
```deskmate-tabs
Today: [[Dashboard/Today]]
Trackers: [[Dashboard/Trackers]]
Notes: [[Dashboard/Notes]]
```
````

One line per tab: `Label: [[note]]`. The chosen tab's note is shown in place. Use the arrow keys to switch, and the pencil button to edit the current tab's note. Deskmate remembers the last tab on each device. Requires Obsidian 1.8.7 or newer.

### `deskmate-daily`

No options. Shows:
- **Encouragement:** one short, uplifting sentence, new each day.
- **Describe:** an everyday thing (366 built in, one per day) described simply and vividly.

Without AI (or on phones) it shows built-in lines instead. Each day's lines are saved in the plugin's data, so a phone synced with your laptop shows the same ones.

## Local AI

Deskmate can run a small language model **on your computer** with [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU. Nothing you write is sent anywhere.

1. Settings → Deskmate → **AI on this device** → turn on **Use AI**.
2. Pick a model (default: Llama 3.2 1B, about 0.9 GB) and press **Download**. This is the only time Deskmate goes online: it fetches the model from huggingface.co and github.com and keeps it in Obsidian's cache on that device (not in your vault, so it never syncs).
3. After that it works offline. **Delete model** removes it again.

Needs a computer with WebGPU (most from the last few years). Phones show the laptop's daily lines or the built-in ones.

## Settings

- Your name for the greeting, 12/24-hour clock, seconds.
- 3D background on desktop and, separately, on mobile (off by default to save battery). It pauses when scrolled away, when Obsidian is in the background, or when your system asks for reduced motion.
- Which note new tasks go to, and folders to ignore.
- The default subjects folder.

## Development

```sh
npm install
npm run dev     # watch mode; set DESKMATE_PLUGIN_DIR to copy builds into a vault
npm run build
npm run lint
npm test        # indexing, tab lifecycle and AI worker regression tests
npm run test:browser  # packaged worker smoke check in isolated Chrome (build first)
```

Task indexing updates only the changed note, using the text already supplied by Obsidian's metadata cache. Full reconciliation is reserved for startup, folder renames and changes to ignored folders. Unchanged task lists and subject cards retain their DOM, and pending widget refreshes are cancelled on unload.

Local AI initialization, cache checks and inference run in an embedded Web Worker. Requests are serialized, the worker is terminated after two idle minutes or when the plugin unloads, and failed automatic daily generations wait for a manual retry. Installation still uses `main.js`, `manifest.json` and `styles.css`.

Pushing a version tag (for example `1.0.1`) builds the plugin and creates a GitHub release.

## Credits

- [three.js](https://threejs.org) (MIT licence) powers the 3D background.
- [WebLLM](https://github.com/mlc-ai/web-llm) (Apache 2.0 licence) runs the local AI.

## Licence

MIT © silverbullet
