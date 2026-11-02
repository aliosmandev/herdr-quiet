// Rex-style sidebar, Linear-quiet: nav (Agents / Routines) on top, then the page below it.
// Pages: layouts/rex.json has a `stack` (sidebar-pages); props pick what this copy draws:
//   { top } titlebar row · { nav } page switcher · { routines } Routines page (read-only) · { pane } a pane header
//   { beside } the docked pane's header · { empty } blank · (none) the Agents list.
// Quiet on purpose: grey marks for state, the accent only for "needs you".

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, machines, layout, run, theme, setAgentOrder, openOverlay, props, panes, exec, hc, shared, setShared, terminals, appHome, closeOverlay, readTextFile, writeTextFile } from "herdr";

const isClaude = (p) => /claude/i.test(`${p?.name ?? ""} ${p?.icon ?? ""}`);
// OpenCode's busy spinner: braille frames every 80 ms in its muted text colour
// (anomalyco/opencode packages/tui/src/component/spinner-frames.ts:1, interval in spinner.tsx:36).
const BUSY = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const busy = (t, size = 13) => div().w(size).flex_none().flex().justify_center().text_size(size).text_color(t.muted).frames(BUSY, 80);
const asset = (n) => `mods/rex-sidebar/${n}.svg`;
// The only coloured thing on a row: a small tinted "Needs you" pill.
const needsPill = (t) => div().flex_none().px(6).h(16).rounded(8).flex().items_center().text_size(10.5)
  .bg(/^#[0-9a-f]{6}$/i.test(t.blocked) ? t.blocked + "26" : t.blocked).text_color(t.blocked).child("Needs you");
// A core terminal's name: its own name, else its program, else its command.
const termName = (x) => x.name || x.program?.name || (x.argv?.[0] ?? "").split("/").pop() || x.address;
// "<1m", "4m", "2h": how long the current turn has been running.
const since = (ms) => { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; };
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// "#rrggbb" + alpha as "#rrggbbaa".
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
const PAGES = [
  { id: "page-agents", label: "Agents", glyph: "message-square" },
  { id: "page-routines", label: "Routines", glyph: "clock" },
  { id: "page-memory", label: "Memory", glyph: "memory" },
];

// THE order of chats: machines, then spaces, then tabs in tab order (settled tabs left out).
// One row = one Herdr tab; a tab with split panes is still one row. The list draws from it,
// agent.next/prev follow it (setAgentOrder). cmd-1..9 (rex-focus) keeps a copy: keep both in sync.
const RANK = { blocked: 3, done: 2, idle: 1, working: 0 };
function rowsOf(sp, mach) {
  const names = [null, ...mach.filter((m) => m.name !== null).map((m) => m.name)];
  const out = [];
  for (const name of names)
    for (const s of sp.filter((x) => (x.machine ?? null) === name))
      for (const t of s.tabs) if (!t.settled) out.push({ space: s, tab: t });
  return out;
}
// What a tab shows as: its most urgent agent (else the tab's first pane) gives the mark and title.
function chatOf(r, all, pl) {
  const ags = all.filter((a) => a.tab === r.tab.id);
  const lead = ags.map((a, i) => [a, i]).sort((x, y) => (RANK[y[0].status] ?? 0) - (RANK[x[0].status] ?? 0) || x[1] - y[1])[0]?.[0] ?? null;
  const pane = pl.find((p) => p.tab === r.tab.id && p.terminal) ?? null;
  // A shell's title is "user@host:path": show its folder instead, like Rex's "zsh ~/Code/x".
  const dir = (pane?.cwd ?? "").split("/").filter(Boolean).pop();
  const title = r.tab.named ? r.tab.name : lead ? labelOf(lead) : dir || clean(pane?.title) || pane?.program?.name || r.tab.name;
  return { lead, program: lead?.program ?? pane?.program ?? null, title, agents: ags };
}
function selectTab(r) {
  run("space.select", { id: r.space.id });
  run("tab.select", { id: r.tab.id });
}

function ago(iso) {
  const m = (Date.now() - Date.parse(iso)) / 60000;
  return m < 1 ? "now" : m < 60 ? `${Math.round(m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}
function until(iso) {
  const m = (Date.parse(iso) - Date.now()) / 60000;
  if (!(m > 0)) return "due";
  if (m < 60) return `in ${Math.max(1, Math.round(m))}m`;
  const d = new Date(iso), hm = d.toTimeString().slice(0, 5);
  return m < 1440 ? `today ${hm}` : `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
}

function labelOf(a) {
  const name = clean(a.title);
  return !name || name.toLowerCase() === a.program?.name?.toLowerCase() ? a.tab_name : name;
}

function icon(p, size, color) {
  if (!p?.icon) return div().size(size).flex_none();
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Program marks: flat, one colour, no tile (T3 Code / Linear style). The mark takes the
// row's text colour, so only state (spinner, needs-you dot) ever adds colour.
const isCodex = (p) => /codex/i.test(`${p?.name ?? ""} ${p?.icon ?? ""}`);
function mark(p, size, color) {
  const name = isClaude(p) ? "claude" : isCodex(p) ? "codex" : "terminal";
  return div().size(size).flex_none().flex().items_center().justify_center()
    .child(svg(asset(name)).size(Math.round(size * 0.8)).text_color(color));
}

// A draggable floating copy of one terminal over the main view (see the rex-float mod).
export function floatTerminal(terminal) {
  openOverlay({
    kind: "window",
    key: `rex-float-${terminal}`,
    width: 780,
    height: 480,
    layout: {
      id: "rexf",
      type: "column",
      children: [
        { id: "rexf-bar", type: "block", size: { px: 34 }, content: { mod: "rex-float", props: { terminal } } },
        { id: "rexf-term", type: "block", content: { terminal } },
      ],
    },
  });
}

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}
const besideNow = () => findNode(layout(), "beside-term")?.content?.terminal ?? null;

// The active tab's id: its terminals already show in the main view.
function activeTab() {
  const s = spaces().find((x) => x.active);
  return s?.tabs.find((t) => t.active)?.id ?? null;
}

// Dock an agent in the "beside" pane next to the main view (layouts/rex.json).
// An agent of the shown tab is already on screen: showing one PTY twice makes both
// wrap badly, so that just focuses it.
export function openBeside(a) {
  if (a.tab === activeTab()) return run("pane.focus", { terminal: a.address });
  const tree = layout();
  const box = findNode(tree, "beside"), term = findNode(tree, "beside-term");
  if (!box || !term) return floatTerminal(a.address); // an older rex.json without the slot
  if (!box.hidden && term.content?.terminal === a.address) return closeBeside();
  term.content = { terminal: a.address };
  box.hidden = false;
  run("layout.set", { layout: tree });
}

export function closeBeside() {
  const tree = layout();
  const box = findNode(tree, "beside"), term = findNode(tree, "beside-term");
  if (!box) return;
  box.hidden = true;
  if (term) term.content = { mod: "rex-sidebar", props: { empty: true } };
  run("layout.set", { layout: tree });
}

// ---- RAM footer ({ ram } props) -------------------------------------------------------------
// Cheap on purpose (the Mac this is for already swaps): every RAM_MS one `hc ls`, one `ps` and one
// `vm_stat`+`sysctl`, ~20 ms in total. A terminal's pid comes from `hc get` once and is cached:
// a live terminal keeps its pid. Per tab: the RSS of each of its terminals' process trees.
// The footer publishes { tabs: { tabId: bytes } } as shared("rex.ram") for the row tooltips.
const RAM_MS = 15000;    // footer
const MEM_PAGE_MS = 10000; // Memory page, only while it is the shown page
const GB = 1024 ** 3;
const gb = (b) => (b / GB >= 10 ? (b / GB).toFixed(0) : (b / GB).toFixed(1));
const mb = (b) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
// Pressure word from kern.memorystatus_level (free %): our thresholds, close to Activity Monitor's colours.
const pressureWord = (p) => (p >= 85 ? "critical" : p >= 70 ? "warn" : "normal");
let coreVersion = null; // `hc --version`, read once by the footer
const pids = {}; // terminal address -> { pid, tab }

async function sampleRam(detail = false) {
  const ls = JSON.parse((await hc(["ls", "--json"])).stdout).terminals ?? [];
  const live = new Map(ls.map((x) => [x.address, x]));
  for (const a of Object.keys(pids)) if (!live.has(a)) delete pids[a];
  for (const x of ls) {
    if (pids[x.address]) continue;
    try {
      const g = JSON.parse((await hc(["get", x.address])).stdout);
      if (g.pid) pids[x.address] = { pid: g.pid, tab: g.labels?.["herdr.tab"] ?? null };
    } catch {}
  }
  // pid -> rss bytes, ppid -> children (and, for the Memory page, pid -> executable path).
  const out = (await exec("ps", ["-axo", detail ? "pid=,ppid=,rss=,comm=" : "pid=,ppid=,rss="])).stdout.trim().split("\n");
  const rss = new Map(), kids = new Map(), comm = new Map();
  for (const line of out) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const pid = +m[1], ppid = +m[2];
    rss.set(pid, +m[3] * 1024);
    if (detail) comm.set(pid, m[4]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const mine = new Set();
  const tree = (root) => { let sum = 0; const stack = [root]; while (stack.length) { const p = stack.pop(); if (mine.has(p)) continue; mine.add(p); sum += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); } return sum; };
  const tabs = {}, terms = [];
  let agentsTotal = 0;
  for (const [address, { pid, tab }] of Object.entries(pids)) {
    const b = tree(pid);
    agentsTotal += b;
    if (tab) tabs[tab] = (tabs[tab] ?? 0) + b;
    terms.push({ address, tab, bytes: b, where: live.get(address)?.where ?? "", agent: live.get(address)?.agent ?? "" });
  }
  // Used like Activity Monitor: app memory (anonymous - purgeable) + wired + compressed.
  const vm = (await exec("vm_stat", [])).stdout;
  const page = Number(/page size of (\d+)/.exec(vm)?.[1] ?? 16384);
  const n = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);
  const compressed = n("Pages occupied by compressor") * page;
  const used = (n("Anonymous pages") - n("Pages purgeable") + n("Pages wired down")) * page + compressed;
  const sys = (await exec("sysctl", ["-n", "hw.memsize", "kern.memorystatus_level", "vm.swapusage"])).stdout.trim().split("\n");
  const total = Number(sys[0]), pressure = 100 - Number(sys[1]);
  const swapUsed = (() => { const m = /used = ([\d.]+)([MG])/.exec(sys[2] ?? ""); return m ? +m[1] * (m[2] === "G" ? GB : 1024 ** 2) : 0; })();
  const r = { used, total, pressure, compressed, swapUsed, agents: agentsTotal, tabs, terms };
  if (detail) {
    // Everything outside Herdr's terminals, grouped by app bundle (all helpers summed), else by name.
    const apps = new Map();
    for (const [pid, b] of rss) {
      if (mine.has(pid) || !b) continue;
      const path = comm.get(pid) ?? "";
      const app = /\/([^/]+)\.app\//.exec(path)?.[1] ?? path.split("/").pop() ?? "?";
      apps.set(app, (apps.get(app) ?? 0) + b);
    }
    r.apps = [...apps].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }
  return r;
}

export default class RexSidebar extends View {
  init(_props, cx) {
    if (props()?.beside) cx.timer.every(5000, (cx) => { if (!findNode(layout(), "beside")?.hidden) cx.notify(); });
    if (props()?.memory) {
      // Polls only while Memory is the shown sidebar page.
      const tick = (cx) => {
        if (findNode(layout(), "sidebar-pages")?.active !== "page-memory") return;
        cx.spawn(async (cx) => { try { this.mem = await sampleRam(true); } catch (e) { this.memError = String(e?.message ?? e); } cx.notify(); });
      };
      tick(cx);
      cx.timer.every(MEM_PAGE_MS, tick);
      cx.timer.every(1000, (cx) => { const on = findNode(layout(), "sidebar-pages")?.active === "page-memory"; if (on && !this.wasOn) tick(cx); this.wasOn = on; });
    }
    if (props()?.ram && !coreVersion) cx.spawn(async (cx) => {
      const v = await hc(["--version"]).catch(() => null);
      coreVersion = /\d+\.\d+\.\d+/.exec(v?.stdout ?? "")?.[0] ?? null;
      cx.notify();
    });
    if (props()?.ram) {
      const tick = (cx) => cx.spawn(async (cx) => {
        try { setShared("rex.ram", await sampleRam()); } catch (e) { this.ramError = String(e?.message ?? e); cx.notify(); }
      });
      tick(cx);
      cx.timer.every(RAM_MS, tick);
    }
    this.folded = new Set();
    this.open = new Set(); // tab ids whose panes are shown under the row
    this.subOpen = new Set(); // tab ids whose sub-agent tree is shown
    this.icons = {};          // space id -> app-home-relative icon path | null (none found) | pending
    this.dragSp = null;       // space id being dragged
    this.overSp = null;
    this.showSettled = false;
    if (props()?.routines) {
      // Read-only: dnzzl.automations (classic herdr plugin) -> `herdr-automations list --json`.
      this.data = null;
      this.error = null;
      const load = (cx) => cx.spawn(async (cx) => {
        try {
          let bin = "herdr-automations";
          try { if ((await exec(bin, ["version"])).code !== 0) throw 0; } catch {
            // Not on PATH (the plugin's install-cli shim isn't installed): ask classic herdr where the plugin lives.
            const r = await exec("herdr", ["plugin", "list", "--plugin", "dnzzl.automations", "--json"]);
            const root = JSON.parse(r.stdout)?.result?.plugins?.[0]?.plugin_root;
            if (!root) throw new Error("plugin dnzzl.automations not found");
            bin = `${root}/bin/herdr-automations`;
          }
          const out = await exec(bin, ["list", "--json"]);
          this.data = JSON.parse(out.stdout);
          this.error = null;
        } catch (e) {
          this.error = String(e?.message ?? e);
        }
        cx.notify();
      });
      load(cx);
      cx.timer.every(30000, (cx) => load(cx));
    }
  }

  // Memory page: read-only. Totals, then each chat's process tree, then apps outside Herdr.
  memoryPage(t) {
    const m = this.mem;
    const note = (x) => div().px(16).py(10).text_size(12).text_color(t.dim).child(x);
    if (!m) return v_flex().size_full().bg(t.chrome).child(note(this.memError ? `Can't read memory: ${this.memError}` : "Reading memory…"));
    const word = pressureWord(m.pressure);
    const head = (x) => div().px(16).pt(14).pb(4).text_size(11).text_color(t.dim).child(x);
    const line = (id, label, sub, bytes, hot) => h_flex().id(id).mx(8).px(8).h(24).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
      .child(div().truncate().flex_1().min_w(0).text_size(12.5).text_color(hot ? t.foreground : t.muted).child(label))
      .when(Boolean(sub), (el) => el.child(div().truncate().flex_none().max_w(90).text_size(11).text_color(t.dim).child(sub)))
      .child(div().flex_none().text_size(11.5).text_color(hot ? t.blocked : t.muted).child(mb(bytes)));
    const stat = (label, value, hot) => h_flex().px(16).h(20).items_center().text_size(12)
      .child(div().flex_1().text_color(t.dim).child(label)).child(div().text_color(hot ? t.blocked : t.muted).child(value));
    const kids = [
      head("Memory"),
      stat("Used", `${gb(m.used)} / ${gb(m.total)} GB`, word === "critical"),
      stat("Compressed", `${gb(m.compressed)} GB`, false),
      stat("Swap", `${gb(m.swapUsed)} GB`, m.swapUsed > 4 * GB),
      stat("Pressure", `${word} · ${m.pressure}%`, word !== "normal"),
    ];
    const terms = [...m.terms].sort((a, b) => b.bytes - a.bytes).filter((x) => x.bytes >= 20 * 1024 ** 2);
    kids.push(head(`Chats · ${mb(m.agents)}`));
    for (const x of terms) kids.push(line(`mt-${x.address}`, x.where || x.address, x.agent, x.bytes, false));
    if (!terms.length) kids.push(note("No chat uses more than 20 MB."));
    kids.push(head("Apps outside Herdr"));
    for (const [app, b] of m.apps ?? []) kids.push(line(`ma-${app}`, app, "", b, false));
    // One quiet hint about the biggest thing, if something stands out.
    const top = [...(m.apps ?? []).map(([a, b]) => ({ name: a, b })), ...terms.map((x) => ({ name: x.where, b: x.bytes }))].sort((a, b) => b.b - a.b)[0];
    if (top && (word !== "normal" || m.swapUsed > 4 * GB))
      kids.push(div().px(16).pt(12).text_size(11.5).text_color(t.dim).child(`Biggest: ${top.name} (${mb(top.b)}). Quitting it frees the most.`));
    return v_flex().size_full().bg(t.chrome).child(v_flex().id("rex-memory").flex_1().min_h(0).overflow_y_scrollbar().pb(12).children(kids));
  }

  // A space's icon: its product's own favicon, found once and copied into the app home (image()
  // reads from there). First an icon file named for Herdr (.herdr/icon.svg|png), then the files the
  // repo itself tracks (git ls-files: no clones, no node_modules, runs nothing) ranked
  // public/favicon.svg > favicon.svg > favicon.png > apple-touch-icon > icon/logo.svg. Repos tried:
  // the folder's own, then its child repos (the one named like the space first). None: no icon.
  findIcon(cx, s, pl) {
    this.icons[s.id] = "pending";
    const tabs = new Set((s.tabs ?? []).map((x) => x.id));
    const dir = pl.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    // Remote spaces aren't read over ssh; only an absolute path reaches find/git (a path starting
    // with "-" would read as an option).
    if (!dir || s.machine || !dir.startsWith("/")) { this.icons[s.id] = null; return; }
    const GIT = ["-c", "core.fsmonitor=false", "--no-optional-locks"];
    // The main app's icon first (a web / app / dashboard / landing / site folder, or one named like
    // the space), then by file type, then the shallowest path.
    const main = (p) => new RegExp(`(^|/)(web|app|dashboard|landing|site|www|${s.name.replace(/[^\w-]/g, "")})/`, "i").test(p);
    const rank = (p) => (main(p) ? -350 : 0) + (/(^|\/)(dist|build|out)\//.test(p) ? 500 : 0) + (/public\/favicon\.svg$/.test(p) ? 0 : /favicon\.svg$/.test(p) ? 1 : /favicon\.png$/.test(p) ? 2 : /apple-touch-icon\.png$/.test(p) ? 3 : 4) * 100 + p.split("/").length;
    cx.spawn(async (cx) => {
      let found = null;
      try {
        // A pinned icon wins: data/rex-sidebar/icons.json in the app home, { "<space name>": "/abs/path.svg" }
        // (kept across installs, unlike the mod folder).
        const pins = JSON.parse((await readTextFile(`${appHome()}/data/rex-sidebar/icons.json`)) ?? "{}");
        const pin = pins?.[s.name];
        if (typeof pin === "string" && pin.startsWith("/") && pin.endsWith(".svg")) found = pin;
        for (const f of found ? [] : [".herdr/icon.svg"]) {
          if ((await exec("test", ["-f", `${dir}/${f}`])).code === 0) { found = `${dir}/${f}`; break; }
        }
        if (!found) {
          const top = await exec("git", [...GIT, "rev-parse", "--show-toplevel"], { cwd: dir }).catch(() => null);
          const root = top?.code === 0 && top.stdout.trim().startsWith("/") ? top.stdout.trim() : dir;
          const kids = (await exec("find", [root, "-mindepth", "2", "-maxdepth", "2", "-name", ".git"])).stdout
            .split("\n").filter(Boolean).map((g) => g.replace(/\/\.git$/, ""))
            .sort((a, b) => (b.endsWith(`/${s.name}`) ? 1 : 0) - (a.endsWith(`/${s.name}`) ? 1 : 0) || a.localeCompare(b));
          for (const repo of [...(top?.code === 0 ? [root] : []), ...kids]) {
            const r = await exec("git", [...GIT, "ls-files", "--", "*favicon.svg", "*/icon.svg", "*/logo.svg"], { cwd: repo }).catch(() => null);
            const list = (r?.stdout ?? "").split("\n").filter(Boolean).sort((a, b) => rank(a) - rank(b));
            if (list.length) { found = `${repo}/${list[0]}`; break; }
          }
        }
        // Only a regular file, never a symlink (a repo could point one anywhere). Drawn as a one-colour
        // glyph (svg() tints by shape), so a full-size background rect would become a solid square:
        // drop it, and keep a cleaned copy in the app home (svg() reads from there).
        if (found && (await exec("test", ["-L", found])).code !== 0 && (await exec("test", ["-f", found])).code === 0) {
          const src = await readTextFile(found);
          if (src && src.length < 64 * 1024 && /<svg[\s>]/i.test(src)) {
            const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(src);
            const W = vb?.[1], H = vb?.[2];
            const isBg = (tag) => {
              const a = (n) => new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
              const full = (v, d) => v === "100%" || (d && v !== undefined && parseFloat(v) >= parseFloat(d));
              return full(a("width"), W) && full(a("height"), H) && !parseFloat(a("x") ?? "0") && !parseFloat(a("y") ?? "0");
            };
            const clean = src.replace(/<rect\b[^>]*\/?>(\s*<\/rect>)?/gi, (tag) => (isBg(tag) ? "" : tag));
            const rel = `data/rex-sidebar/glyphs/${s.id}.svg`;
            await exec("mkdir", ["-p", `${appHome()}/data/rex-sidebar/glyphs`]);
            const prev = await readTextFile(`${appHome()}/${rel}`);
            if (prev !== clean) await writeTextFile(`${appHome()}/${rel}`, clean, prev);
            this.icons[s.id] = rel; cx.notify(); return;
          }
        }
      } catch {}
      this.icons[s.id] = null;
    });
  }

  // Right-click on a space header: Move up / Move down (within its machine), and Herdr's own menu.
  spaceMenu(t) {
    const id = props().spaceMenu, all = spaces(), i = all.findIndex((x) => x.id === id), me = all[i];
    const same = (j) => all[j] && (all[j].machine ?? null) === (me?.machine ?? null);
    const close = () => closeOverlay(props().overlay);
    const item = (key, label, enabled, fn) => h_flex().id(key).h(28).px(10).mx(4).rounded(6).items_center().text_size(12.5)
      .text_color(enabled ? t.foreground : t.dim).when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => { fn(); close(); }))
      .child(label);
    return v_flex().size_full().py(4).bg(t.popover)
      .child(item("sm-up", "Move up", same(i - 1), () => run("space.move", { id, index: i })))
      .child(item("sm-down", "Move down", same(i + 1), () => run("space.move", { id, index: i + 2 })))
      .child(item("sm-more", "More…", true, () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id } } })));
  }

  // Footer: "15.7 / 18 GB · agents 1.3 GB". Grey; the accent only above 85% memory pressure.
  ramFoot(t) {
    const r = shared("rex.ram");
    const hot = r && r.pressure >= 85;
    return h_flex().id("ram-foot").size_full().px(16).gap(8).items_center().text_size(11).border_t(1).border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => run("layout.select", { stack: "sidebar-pages", child: "page-memory" }))
      .tooltip(`${coreVersion ? `herdr-core ${coreVersion} · ` : ""}${r ? `memory pressure ${r.pressure}% · click for details` : "reading memory…"}`)
      // "2 machines · 14 terminals · 13/18 GB": the one status line (herdr-core version in the tooltip).
      .child(div().truncate().min_w(0).text_color(t.dim).child([
        `${machines().length} machine${machines().length === 1 ? "" : "s"}`,
        `${terminals().filter((x) => x.state === "live").length} terminals`,
      ].filter(Boolean).join(" · ")))
      .child(div().flex_none().text_color(t.dim).child("·"))
      .child(div().flex_none().text_color(hot ? t.blocked : t.dim).child(r ? `${gb(r.used)}/${gb(r.total)} GB` : this.ramError ? "memory n/a" : "…"));
  }

  // Titlebar row: room for the traffic lights, then the sidebar toggle; new space on the right.
  top(t) {
    const btn = (id, glyph, fn, tip) => div().id(id).size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(fn)
      .child(svg(asset(glyph)).size(15).text_color(t.muted));
    return h_flex().size_full().pl(84).pr(12).items_center()
      .child(btn("toggle-sidebar", "panel-left", () => run("layout.toggle", { id: "sidebar" }), "Sidebar  ⌘B"))
      .child(div().flex_1())
      .child(btn("new-space", "plus", () => run("space.new"), "New space  ⌘N"));
  }

  // One header for every pane (main pane, docked pane): small program mark + the chat's title.
  // Same height, padding and colors everywhere so two panes line up.
  paneHead(t, program, a, title, extra) {
    const st = a?.status;
    return h_flex().size_full().px(12).gap(8).items_center().bg(t.background).border_b(1).border_color(t.border)
      .child(mark(program, 16, t.muted))
      .child(div().truncate().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
      .when(st === "working", (el) => el.child(h_flex().gap(5).flex_none().items_center().text_size(11.5).text_color(t.dim).child(busy(t, 12)).child("Working")))
      .when(st === "blocked", (el) => el.child(h_flex().gap(5).flex_none().items_center().text_size(11.5).text_color(t.blocked).child(div().size(6).rounded(3).bg(t.blocked)).child("Needs you")))
      .when(st === "done", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("Finished")))
      .when(Boolean(extra), (el) => el.child(extra));
  }

  // Header of a pane in the shown tab (layouts/rex.json: pane.header).
  head(t) {
    const p = panes().find((x) => x.pane === props()?.pane);
    const a = agents().find((x) => x.address === p?.terminal);
    return this.paneHead(t, p?.program, a, a ? labelOf(a) : clean(p?.title) || p?.program?.name || "", null);
  }

  // Header of the docked pane: same look, plus go-to-its-tab and close.
  besideBar(t) {
    const addr = besideNow();
    const a = agents().find((x) => x.address === addr);
    const btn = (id, glyph, fn) => div().id(id).size(22).flex_none().rounded(5).flex().items_center().justify_center()
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(fn).child(svg(asset(glyph)).size(14).text_color(t.muted));
    const extra = h_flex().gap(2).flex_none()
      .when(Boolean(a), (el) => el.child(btn("bs-go", "chevron-right", () => run("agent.focus", { terminal: addr }))))
      .child(btn("bs-x", "x", () => closeBeside()));
    return this.paneHead(t, a?.program, a, a ? labelOf(a) : addr ?? "", extra);
  }

  // Linear-style page switcher: icon + label, active one on a soft chip.
  nav(t) {
    const active = findNode(layout(), "sidebar-pages")?.active ?? PAGES[0].id;
    return v_flex().size_full().px(8).pt(2).gap(1).children(PAGES.map((p) => {
      const on = p.id === active;
      return h_flex().id(`nav-${p.id}`).h(28).px(8).gap(9).items_center().rounded(6).cursor_pointer()
        .bg(on ? t.selected : "#00000000").hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click(() => run("layout.select", { stack: "sidebar-pages", child: p.id }))
        .child(svg(asset(p.glyph)).size(15).flex_none().text_color(on ? t.foreground : t.muted))
        .child(div().text_size(13).text_color(on ? t.foreground : t.muted).child(p.label));
    }));
  }

  // Routines page: what dnzzl.automations has scheduled. Read-only. No "Run now": the plugin's `run`
  // starts an agent in a worktree, which is a write this list shouldn't do on a click.
  routines(t) {
    const note = (text) => div().px(16).py(12).text_size(12).text_color(t.dim).child(text);
    const list = this.data?.automations ?? [];
    const kids = [];
    if (this.error && /not found|ENOENT|No such file/i.test(this.error)) {
      // No routines source on this machine: a calm empty state, not an error.
      kids.push(note("No routines yet."));
      kids.push(div().px(16).text_size(11.5).text_color(t.dim).child("Routines come from the dnzzl.automations herdr plugin."));
      kids.push(div().px(16).pt(2).text_size(11).text_color(t.dim).child("herdr plugin install DnzzL/herdr-automations"));
    } else if (this.error) kids.push(note(`Can't read routines: ${this.error}`));
    else if (!this.data) kids.push(note("Loading…"));
    else if (!list.length) {
      kids.push(note("No routines yet."));
      kids.push(div().px(16).text_size(11.5).text_color(t.dim).child("Add one with herdr-automations add, or edit"));
      kids.push(div().px(16).pt(2).text_size(11).text_color(t.dim).truncate().child(String(this.data.config ?? "").replace(/^\/Users\/[^/]+/, "~")));
    }
    for (const a of list) {
      const bad = a.last?.status === "failed" || a.last?.status === "missed";
      const last = a.last ? `${a.last.status} ${a.last.at ? ago(a.last.at) : ""}` : "never run";
      kids.push(
        v_flex().id(`rt-${a.name}`).mx(8).px(8).py(6).gap(2).rounded(6).hover((s) => s.bg(t.hover))
          .child(h_flex().gap(8).items_center()
            .child(div().size(6).flex_none().rounded(3).bg(bad ? t.blocked : a.disabled ? t.dim : t.muted))
            .child(div().truncate().flex_1().min_w(0).text_size(13).text_color(a.disabled ? t.dim : t.foreground).child(a.name))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(a.disabled || this.data.paused ? "paused" : a.next ? until(a.next) : "")))
          .child(div().pl(14).truncate().text_size(11.5).text_color(t.dim).child(`${a.cron} · ${last}`)),
      );
    }
    return v_flex().size_full().bg(t.chrome).child(v_flex().id("rex-routines").flex_1().min_h(0).overflow_y_scrollbar().pt(4).children(kids));
  }

  // One tab = one row: mark, title, faint pane count, ⌘N hint, state. Marks are grey; state is the only colour:
  // the braille spinner while working, the accent dot when it needs you. Click: show it.
  // Alt-click docks its agent beside the main view, shift-click floats it.
  row(t, r, c, key, n, extra) {
    const st = r.tab.status;
    const on = r.tab.active && r.space.active;
    const ink = on || st === "blocked" ? t.foreground : t.muted;
    const multi = r.tab.panes > 1;
    const open = this.open.has(r.tab.id);
    const ram = shared("rex.ram")?.tabs?.[r.tab.id];
    return h_flex().id(key)
      .when(ram > 0, (el) => el.tooltip(`${c.title} · ${mb(ram)}`)).gap(9).mx(8).px(8).h(28).rounded(6).items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .hover((s) => s.bg(on ? t.selected : t.hover))
      .on_click((e) => {
        if (c.lead && e.modifiers?.shift) return floatTerminal(c.lead.address);
        if (c.lead && e.modifiers?.alt) return openBeside(c.lead);
        selectTab(r);
      })
      .child(mark(c.program, 16, ink))
      .child(div().truncate().flex_1().min_w(0).text_size(13).text_color(ink).child(c.title))
      .when(Boolean(extra), (el) => el.child(div().truncate().flex_none().max_w(70).text_size(11).text_color(t.dim).child(extra)))
      // A split tab: its pane count opens the panes below the row (and closes them again).
      .when(multi, (el) => el.child(
        h_flex().id(`${key}-x`).flex_none().gap(2).px(3).h(18).rounded(4).items_center().hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => { cx.stop_propagation(); open ? this.open.delete(r.tab.id) : this.open.add(r.tab.id); cx.notify(); })
          .child(div().text_size(11).text_color(t.dim).child(String(r.tab.panes)))
          .child(svg(asset(open ? "chevron-down" : "chevron-right")).size(10).text_color(t.dim)),
      ))
      // Sub-agents its agents started with `hc run` (live ones), as "› N".
      .when(c.subs > 0, (el) => el.child(
        div().id(`${key}-subs`).flex_none().px(3).h(18).rounded(4).flex().items_center().hover((s) => s.bg(t.raised))
          .text_size(11).text_color(t.dim).tooltip(`${c.subs} sub-agent${c.subs > 1 ? "s" : ""}: click to ${this.subOpen.has(r.tab.id) ? "hide" : "show"}`)
          .on_click((_e, cx) => { cx.stop_propagation(); this.subOpen.has(r.tab.id) ? this.subOpen.delete(r.tab.id) : this.subOpen.add(r.tab.id); cx.notify(); })
          .child(`› ${c.subs}`)))
      // How long this turn has been running.
      .when(st === "working" && Boolean(r.tab.working_since), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(since(r.tab.working_since))))
      .when(n >= 1 && n <= 9, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`⌘${n}`)))
      .child(
        st === "working" ? busy(t)
          : st === "blocked" ? needsPill(t)
          : div().size(6).mx(3).flex_none(),
      );
  }

  // Sub-agents of a tab (terminals its agents started with `hc run`), indented under the row with a
  // thin tree line: mark, name, age, state. Click one to peek at it.
  subRows(t, parents, depth = 1, seen = new Set()) {
    const all = terminals().filter((x) => x.state === "live");
    const out = [];
    for (const parent of parents) {
      for (const x of all.filter((y) => y.parent === parent && !seen.has(y.address))) {
        seen.add(x.address);
        const st = x.status;
        out.push(h_flex().id(`sub-${x.address}`).ml(16 + depth * 14).mr(8).h(24).items_center().cursor_pointer().rounded(6)
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("terminal.peek", { terminal: x.address }))
          .child(div().w(1).h_full().flex_none().bg(t.border))
          .child(h_flex().flex_1().min_w(0).pl(10).pr(8).gap(8).items_center()
            .child(mark(x.program, 13, t.dim))
            .child(div().truncate().flex_1().min_w(0).text_size(12).text_color(t.muted).child(termName(x)))
            .when(Boolean(x.created_ms), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(since(x.created_ms))))
            .child(st === "working" ? busy(t, 12) : st === "blocked" ? needsPill(t) : div().size(5).mx(3).flex_none().rounded(3).bg(st === "done" ? t.done : "#00000000"))));
        out.push(...this.subRows(t, [x.address], depth + 1, seen));
      }
    }
    return out;
  }

  // The panes of an opened split tab, indented under its row: mark, title, state. Click focuses that pane.
  paneRows(t, r, pl, all) {
    return pl.filter((p) => p.tab === r.tab.id).map((p) => {
      const a = all.find((x) => x.address === p.terminal);
      const title = a ? labelOf(a) : (p.cwd ?? "").split("/").filter(Boolean).pop() || clean(p.title) || p.program?.name || "pane";
      const ink = p.focused && r.tab.active ? t.foreground : t.dim;
      return h_flex().id(`pn-${p.pane}`).gap(8).ml(34).mr(8).px(8).h(24).rounded(6).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => { selectTab(r); run("pane.focus", { pane: p.pane }); })
        .child(mark(p.program, 13, ink))
        .child(div().truncate().flex_1().min_w(0).text_size(12).text_color(ink).child(title))
        .child(a?.status === "working" ? busy(t, 12) : a?.status === "blocked" ? div().size(5).mx(3).flex_none().rounded(3).bg(t.blocked) : div());
    });
  }

  render(cx) {
    const t = theme();
    if (props()?.top) return this.top(t);
    if (props()?.ram) return this.ramFoot(t);
    if (props()?.spaceMenu) return this.spaceMenu(t);
    if (props()?.memory) return this.memoryPage(t);
    if (props()?.nav) return this.nav(t);
    if (props()?.routines) return this.routines(t);
    if (props()?.empty) return div().size_full().bg(t.background);
    if (props()?.beside) return this.besideBar(t);
    if (props()?.pane) return this.head(t);
    const all = agents();
    const sp = spaces();
    const mach = machines();
    const pl = panes();
    const rows = rowsOf(sp, mach);
    const nOf = (r) => rows.findIndex((x) => x.tab.id === r.tab.id) + 1;
    const chats = new Map(rows.map((r) => [r.tab.id, chatOf(r, all, pl)]));
    const terms = terminals();
    for (const c of chats.values()) {
      const mine = new Set(c.agents.map((a) => a.address));
      c.subs = terms.filter((x) => x.parent && mine.has(x.parent) && x.state === "live").length;
    }
    // agent.next / agent.prev walk the same order as the rows.
    setAgentOrder(rows.flatMap((r) => chats.get(r.tab.id).agents.map((a) => a.address)));
    const out = [];

    // Grouped by state (⌘⌥G toggles; default: by machine and space). One section per state with a
    // quiet "Working 2" header; each row says its space. Same rows, same look.
    if (shared("rex.group") === "state") {
      const SECTIONS = [["blocked", "Needs you"], ["working", "Working"], ["done", "Finished"], ["idle", "Idle"]];
      for (const [st, label] of SECTIONS) {
        const mine = rows.filter((r) => (r.tab.status ?? "idle") === st || (st === "idle" && !["blocked", "working", "done"].includes(r.tab.status)));
        if (!mine.length) continue;
        out.push(div().px(16).pt(out.length ? 14 : 8).pb(3).text_size(11).text_color(st === "blocked" ? t.blocked : t.dim).child(`${label} ${mine.length}`));
        for (const r of mine) out.push(this.row(t, r, chats.get(r.tab.id), `sg-${r.tab.id}`, nOf(r), r.space.name));
      }
      return v_flex().size_full().bg(t.chrome).child(v_flex().id("rex-list").flex_1().min_h(0).overflow_y_scrollbar().pb(16).children(out));
    }

    const needs = rows.filter((r) => r.tab.status === "blocked");
    if (needs.length) {
      out.push(div().px(16).pt(10).pb(4).text_size(11).text_color(t.blocked).child(`Needs you · ${needs.length}`));
      for (const r of needs) out.push(this.row(t, r, chats.get(r.tab.id), `nb-${r.tab.id}`, nOf(r), r.space.name));
    }

    const names = [null, ...mach.filter((m) => m.name !== null).map((m) => m.name)];
    for (const name of names) {
      const state = mach.find((m) => m.name === name)?.layout;
      const mine = sp.filter((s) => (s.machine ?? null) === name);
      // New space on this machine: a shell there, opened as a Herdr space so it shows in this list
      // (a terminal started without Herdr's labels, e.g. plain `hc run --on`, stays out of it).
      const newHere = () => run("space.new", name === null ? {} : { machine: name });
      const where = name === null ? "This Mac" : name;
      out.push(
        h_flex().id(`m-${where}`).mx(8).px(8).pt(needs.length || name !== null ? 16 : 6).pb(2).gap(8).items_center()
          .child(svg(asset(name === null ? "monitor" : "server")).size(14).text_color(t.dim))
          .child(div().text_size(12).text_color(t.muted).child(where))
          .when(state && state !== "ready", (el) => el.child(div().text_size(11).text_color(t.dim).child(state === "loading" ? "connecting…" : "offline")))
          .child(div().flex_1())
          .child(div().id(`m-${where}-new`).size(18).flex_none().rounded(4).flex().items_center().justify_center().cursor_pointer()
            .hover((s) => s.bg(t.hover)).tooltip(`New shell on ${where}`).on_click(newHere)
            .child(svg(asset("plus")).size(12).text_color(t.dim))),
      );
      for (const s of mine) {
        const key = `sp-${s.id}`;
        const folded = this.folded.has(s.id);
        const ico = this.icons[s.id];
        if (ico === undefined) this.findIcon(cx, s, pl);
        const idx = sp.findIndex((x) => x.id === s.id);
        const dragging = this.dragSp !== null && this.dragSp !== undefined;
        out.push(
          h_flex().id(key).relative().mx(8).px(8).pt(12).pb(3).gap(5).items_center().cursor_pointer()
            .when(this.dragSp === s.id && this.overSp !== s.id, (el) => el.opacity(0.5))
            // Drag a space header onto another of the same machine to move it there (space.move,
            // Herdr keeps the order); a plain click selects it. Right-click: Move up / down.
            .when(dragging && this.overSp === s.id && this.dragSp !== s.id, (el) => el.child(
              div().absolute().left(0).right(0).h(2).bg(t.accent)
                .when(sp.findIndex((x) => x.id === this.dragSp) < idx, (l) => l.bottom(0))
                .when(sp.findIndex((x) => x.id === this.dragSp) > idx, (l) => l.top(0))))
            .on_mouse_down("left", () => { this.dragSp = s.id; this.overSp = s.id; })
            .on_mouse_move((_e, cx2) => {
              if (!dragging) return;
              const src = sp.find((x) => x.id === this.dragSp);
              const over = src && (src.machine ?? null) === (s.machine ?? null) ? s.id : null;
              if (this.overSp !== over) { this.overSp = over; cx2.notify(); }
            })
            .on_mouse_up("left", (_e, cx2) => {
              const from = this.dragSp, over = this.overSp;
              this.dragSp = null; this.overSp = null;
              if (from && over === s.id && from !== s.id) run("space.move", { id: from, index: idx + 1 });
              else if (from === s.id) run("space.select", { id: s.id });
              cx2.notify();
            })
            .on_mouse_down("right", () => openOverlay({ mod: "rex-sidebar", kind: "popup", width: 180, height: 104, props: { spaceMenu: s.id } }))
            .child(
              div().id(`${key}-fold`).size(14).flex_none().flex().items_center().justify_center()
                .on_click((_e, cx2) => { cx2.stop_propagation(); folded ? this.folded.delete(s.id) : this.folded.add(s.id); cx2.notify(); })
                .child(svg(asset(folded ? "chevron-right" : "chevron-down")).size(11).text_color(t.dim)),
            )
            // The product's mark in one style for every space: a one-colour 14 px glyph in the muted
            // text colour, the normal text colour when active, never brand colour. No SVG found: the
            // space's first letter in the same slot.
            .child(div().size(14).flex_none().flex().items_center().justify_center()
              .child(ico && ico !== "pending"
                ? svg(ico).size(14).text_color(s.active ? t.foreground : t.muted)
                : div().text_size(10.5).font_semibold().text_color(s.active ? t.foreground : t.muted).child([...clean(s.name)][0]?.toUpperCase() ?? "·")))
            .child(div().truncate().text_size(11.5).text_color(s.active ? t.muted : t.dim).child(s.name))
            .when(Boolean(s.branch), (el) => el.child(div().truncate().flex_1().text_size(11).text_color(t.dim).child(s.branch)))
            .when(!s.branch, (el) => el.child(div().flex_1())),
        );
        if (!folded) for (const r of rows.filter((x) => x.space.id === s.id)) {
          out.push(this.row(t, r, chats.get(r.tab.id), `tb-${r.tab.id}`, nOf(r), ""));
          if (r.tab.panes > 1 && this.open.has(r.tab.id)) out.push(...this.paneRows(t, r, pl, all));
          if (this.subOpen.has(r.tab.id)) out.push(...this.subRows(t, chats.get(r.tab.id).agents.map((a) => a.address)));
        }
      }
      if (!mine.length) out.push(state === "unavailable"
        ? div().px(16).py(4).text_size(11.5).text_color(t.dim).child("Not reachable")
        : h_flex().id(`m-${where}-empty`).mx(8).px(8).h(26).gap(8).items_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(newHere)
          .child(svg(asset("plus")).size(12).flex_none().text_color(t.dim))
          .child(div().truncate().text_size(12).text_color(t.dim).child(`New shell on ${where}`)));
    }

    // Elsewhere: live terminals in no Herdr tab (no herdr.tab label) whose starter isn't shown either,
    // e.g. an agent another tool started with `hc run`. Their own sub-agents hang under them.
    {
      const live = terminals().filter((x) => x.state === "live");
      const shown = new Set(all.map((a) => a.address));
      const inTab = (x) => Boolean(x.labels?.["herdr.tab"]);
      const roots = live.filter((x) => !inTab(x) && !(x.parent && (shown.has(x.parent) || live.some((y) => y.address === x.parent))));
      if (roots.length) {
        out.push(div().px(16).pt(16).pb(3).text_size(11).text_color(t.dim).child(`Elsewhere ${roots.length}`));
        for (const x of roots) {
          out.push(h_flex().id(`el-${x.address}`).mx(8).px(8).h(28).gap(9).items_center().rounded(6).cursor_pointer()
            .hover((s) => s.bg(t.hover)).on_click(() => run("terminal.peek", { terminal: x.address }))
            .child(mark(x.program, 16, t.muted))
            .child(div().truncate().flex_1().min_w(0).text_size(13).text_color(t.muted).child(termName(x)))
            .when(Boolean(x.created_ms), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(since(x.created_ms))))
            .child(x.status === "working" ? busy(t) : x.status === "blocked" ? needsPill(t) : div().size(6).mx(3).flex_none()));
          out.push(...this.subRows(t, [x.address]));
        }
      }
    }

    // Settled tabs (put away, still running), folded at the bottom like T3 Code's "Settled (52)".
    const settled = sp.flatMap((s) => s.tabs.filter((x) => x.settled).map((x) => ({ space: s, tab: x })));
    if (settled.length) {
      const show = this.showSettled;
      out.push(
        h_flex().id("settled").mx(8).px(8).pt(16).pb(3).gap(8).items_center().cursor_pointer()
          .on_click((_e, cx2) => { this.showSettled = !show; cx2.notify(); })
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`Settled (${settled.length})`))
          .child(div().flex_1().h(1).bg(t.border))
          .child(svg(asset(show ? "chevron-down" : "chevron-right")).size(11).text_color(t.dim)),
      );
      if (show) for (const r of settled) {
        const c = chatOf(r, all, pl);
        out.push(this.row(t, r, c, `st-${r.tab.id}`, 0, r.space.name));
      }
    }
    return v_flex().size_full().bg(t.chrome).child(
      v_flex().id("rex-list").flex_1().min_h(0).overflow_y_scrollbar().pb(16).children(out),
    );
  }
}
