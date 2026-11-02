# herdr-quiet

A quiet layout for the [Herdr](https://herdr.dev) desktop app: one sidebar of chats, panes side by side, and nothing loud.

Inspired by Superlogical's Rex, with a Linear-like calm. Not affiliated with either.

**A layout + mods, not a fork:** it installs into your Herdr config and works on any Herdr desktop app (tested on herdr-app 0.1.11, macOS).

<!-- GIF: 20 s demo goes here (recording pending) -->

## The idea
Agents run; you look only when one needs you. The "Needs you" strip is the only interrupt. A row says one line about its chat (state, how long, sub-agents); the details stay in the pane.

## What you get
- **Sidebar of chats.** This Mac / other machines > spaces > one row per tab. Each row: a flat one-colour program mark (Claude, Codex, shell), the chat title, how long the current turn has run, its sub-agents (`› 3`) and a `⌘N` hint. Only state adds colour: OpenCode's braille spinner while an agent works, a small tinted "Needs you" pill when it needs you.
- **Sub-agent tree.** Click a row's `› N` to list the terminals its agents started with `hc run`, indented under it with a thin tree line (mark, name, age, state); click one to peek at it.
- **Elsewhere.** Agents running in no Herdr tab (started by another tool with `hc run`) get their own section, with their sub-agents.
- **Status line.** The footer reads `2 machines · 14 terminals · 13/18 GB` (herdr-core version in its tooltip).
- **Group by state.** `⌘⌥G` switches the list to Needs you / Working / Finished / Idle sections, each with a count.
- **Split tabs expand.** A tab with several panes shows a faint pane count; click it to list the panes and jump to one.
- **Reorder spaces.** Drag a space header onto another one of the same machine (Herdr keeps the order), or right-click it: Move up / Move down / More….
- **Product icons.** Each space header shows its product's mark as a one-colour 14 px glyph in the muted text colour (the normal text colour when active, never brand colour). Taken once from an SVG favicon/logo the repo tracks (`git ls-files`, main web/app/dashboard folder first; a full-size background rect is dropped), or set your own with `.herdr/icon.svg` in the repo, or pin one per space in `~/.config/herdr-app/data/rex-sidebar/icons.json` (`{ "space name": "/abs/path/logo.svg" }`, wins over everything). No SVG: the space's first letter in the same slot.
- **Settled.** Tabs you put away fold into a "Settled (N)" section at the bottom.
- **Side by side.** Split the shown tab (`⌘D`, `⌘⇧D`, or the bar buttons), or dock any other chat beside it: alt-click its row. Shift-click floats it instead.
- **Changes for every repo.** `⌘⇧G`: each git repo in the focused folder (a folder of products shows them all) with its branch, ahead/behind and changed files; click a file for its diff. Read-only.
- **Memory.** A footer with used / total RAM and the agents' share; click it (or `⌘⌥M`) for compressed memory, swap, pressure, each chat's process tree and the apps outside Herdr. Read-only, polled only while you look.
- **Machines.** A `+` on every machine row opens a shell there (This Mac or an ssh machine).
- **Routines.** Read-only list of [herdr-automations](https://github.com/DnzzL/herdr-automations) schedules.
- **Summary panel.** `⌘⇧S`: the focused agent's last prompt and answer, as plain text.
- **Theme.** Dark Vesper-style palette (#101010 canvas, #FFC799 accent). Fonts are yours: it uses Herdr's settings.

## Keys (while the layout shows)
| Key | Does |
|---|---|
| `⌘1` … `⌘9` | open the Nth chat in the sidebar |
| `⌘D` / `⌘⇧D` | split right / down (works with focus in a docked pane too) |
| `⌘⇧G` | Changes panel |
| `⌘⇧S` | Summary panel |
| `⌘⌥G` | group the sidebar by state / by space |
| `⌘B` or `⌘\` | sidebar |
| `⌘⌥1` / `⌘⌥2` / `⌘⌥3` | Agents / Routines / Memory page (`⌘⌥M` also opens Memory) |
| `⌘⌥4` | bring up the Macro app (or macro.com), if you use Macro |
| `⌘N` | new space |
| `⌘K` | command palette |

## Install
```sh
git clone https://github.com/aliosmandev/herdr-quiet && cd herdr-quiet
./install.sh                                   # into ~/.config/herdr-app (or $HERDR_APP_HOME), adds the keys
herdr-app do layout.switch '{"name":"rex"}'    # or ctrl-shift-l
herdr-app do layout.switch '{"name":"main"}'   # back to Herdr's default
```
`install.sh` replaces only the `layout:rex` section of `keys.json` and keeps a copy in `keys.json.bak-rex`. Internal ids (the `rex` layout, `rex-*` mods) keep their first name so existing installs don't break.

## Undo
The layout and mods are plain files in this repo, and `install.sh` copies them into Herdr. So when an agent changes the UI and you don't like it, undo it like any code change:
```sh
git log --oneline -5          # find the change
git checkout <commit> -- mods layouts keys.rex.json themes   # or: git revert <commit>
./install.sh                  # Herdr reloads the files at once
```

## Cost
Built to stay cheap on a busy Mac: hidden panels do no work, the RAM footer samples every 15 s (about 30 ms), Changes runs git only while open. Measured idle: about 2–3 points of CPU over Herdr's own layout.

## Limits (what the API does not allow)
- Mods cannot restyle terminal text, so the summary is a parsed side panel, not a re-rendered chat.
- One terminal shown twice (a docked or floating copy of a chat that is also on screen) wraps badly in both places, so docking a chat from the shown tab only focuses it.
- Remote machines are tested with one ssh machine.

## Security
Changes reads repos you didn't pick (every child folder), so git runs with `core.fsmonitor` and hooks off, the diff is computed in the mod (no repo filters or textconv drivers run), and symlinks show their target instead of being followed.

Line icons are Lucide (ISC). Program marks are from Simple Icons (CC0); Claude and OpenAI marks are their owners' trademarks. MIT licensed.

Built by Ali Osman · [Lefine](https://lefine.ai)
