// Rex focus: a slim top bar (props.bar) and a chat-like summary panel for the focused agent.
// The panel reads the agent's screen with `hc read` and pulls out the last prompt and the last
// answer. Mods can't restyle terminal text, so this is a parsed summary, not a re-render.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

import { agents, panes, focused, spaces, machines, hc, run, theme, openOverlay, props, nextCommand, layout, shared, setShared, exec, settings } from "herdr";

const WORDS = { working: "Working", blocked: "Needs you", done: "Finished", idle: "Idle" };
const asset = (n) => `mods/rex-focus/${n}.svg`;
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
const RULE = /^\s*[─━]{8,}\s*$/;
const USER = /^\s{0,2}[❯›]\s?(.*)$/;
const BOT = /^\s{0,2}[⏺•]\s+(.*)$/;
const TOOL = /^([A-Z][\w-]*\(|Called |Read \d|Searched for|Listed \d|Ran )/;
const SPIN = /^\s*[✻✢✶✳✽·*✦]\s/;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function floatTerminal(terminal) {
  openOverlay({
    kind: "window", key: `rex-float-${terminal}`, width: 780, height: 480,
    layout: { id: "rexf", type: "column", children: [
      { id: "rexf-bar", type: "block", size: { px: 34 }, content: { mod: "rex-float", props: { terminal } } },
      { id: "rexf-term", type: "block", content: { terminal } },
    ] },
  });
}

// Screen text -> { prompt, answer, activity, tail }. Heuristic, built for Claude Code and Codex.
// Split the shown tab's focused pane (explicit pane: an implicit split fails while a docked
// or floating terminal block has focus). Used by cmd-d / cmd-shift-d and the bar buttons.
function splitShown(direction) {
  const f = focused();
  const mine = panes().filter((p) => p.tab === f?.tab);
  const target = mine.find((p) => p.focused) ?? mine[0];
  if (target) run("pane.split", { direction, pane: target.pane });
}

export function summarize(text) {
  let lines = text.replace(/\s+$/, "").split("\n");
  const rules = lines.map((l, i) => (RULE.test(l) ? i : -1)).filter((i) => i >= 0);
  // Drop the input box: rule, prompt, rule, status lines.
  if (rules.length >= 2 && rules[rules.length - 1] - rules[rules.length - 2] <= 4) lines = lines.slice(0, rules[rules.length - 2]);
  else {
    const last = lines.length - 1 - [...lines].reverse().findIndex((l) => USER.test(l));
    if (last >= 0 && last >= lines.length - 4) lines = lines.slice(0, last);
  }
  const tail = lines.filter((l) => l.trim()).slice(-14).join("\n");
  let u = -1;
  lines.forEach((l, i) => { if (USER.test(l)) u = i; });
  const grab = (from) => {
    const out = [lines[from].replace(/^\s{0,2}[⏺•❯›]\s?/, "")];
    for (let i = from + 1; i < lines.length; i++) {
      const l = lines[i];
      if (USER.test(l) || BOT.test(l) || SPIN.test(l) || RULE.test(l)) break;
      out.push(l.replace(/^ {1,2}/, ""));
    }
    return out.join("\n").trim();
  };
  const prompt = u >= 0 ? grab(u).replace(/\n\s*\n[\s\S]*$/, "") : "";
  let answer = "", activity = "";
  for (let i = u + 1; i < lines.length; i++) {
    const m = BOT.exec(lines[i]);
    if (!m) continue;
    if (TOOL.test(m[1])) activity = m[1];
    else answer = grab(i);
  }
  return { prompt, answer, activity, tail };
}

// Copy of rex-sidebar's row order (machines > spaces > tabs, settled left out). Keep both in sync.
// One row = one tab; cmd-1..9 show the Nth.
function shownRows() {
  const sp = spaces(), mach = machines();
  const names = [null, ...mach.filter((m) => m.name !== null).map((m) => m.name)];
  const out = [];
  for (const name of names)
    for (const s of sp.filter((x) => (x.machine ?? null) === name))
      for (const t of s.tabs) if (!t.settled) out.push({ space: s.id, tab: t.id });
  return out;
}

// True when the layout node with this id is hidden (layout.toggle / show / hide edit the tree).
function hidden(id) {
  const find = (n) => (n?.id === id ? n : (n?.children ?? []).map(find).find(Boolean) ?? null);
  return Boolean(find(layout())?.hidden);
}

// Tabular numbers: GPUI has no font features, so numbers use the terminal font (monospace, so
// every digit has the same width and counts, times and RAM don't jitter). Same font as the UI
// when the UI font is already monospace.
const mono = () => { const v = settings()?.font; return typeof v === "string" ? v : ""; };
const tn = (el) => (mono() ? el.font_family(mono()) : el);

export default class RexFocus extends View {
  init(_p, cx) {
    this.target = null;
    this.data = null;
    cx.timer.every(3000, (cx) => this.refresh(cx));
    // `herdr-app do rex-focus.float` (or a key bound to "rex-focus.float") floats the focused terminal.
    if (props()?.bar) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // cmd-d / cmd-shift-d (keys.json, layout:rex). An implicit pane.split fails while a layout block
        // (docked/floating terminal) has focus, so split an explicit pane: the shown tab's focused one.
        if (/^split/.test(c)) {
          splitShown(/down/.test(c) ? "down" : "right");
        } else if (/^nth/.test(c)) {
          // cmd-1..9 (keys.json, layout:rex): show the Nth chat of the sidebar list.
          const r = shownRows()[Number(/\d+/.exec(c)?.[0]) - 1];
          if (r) { run("space.select", { id: r.space }); run("tab.select", { id: r.tab }); }
        } else if (c === "macro") {
          // cmd-alt-4: Herdr mods can't show a web view, so bring up the Macro app (or macro.com).
          cx.spawn(async () => {
            const r = await exec("open", ["-a", "Macro"]).catch(() => ({ code: 1 }));
            if (r.code !== 0) await exec("open", ["https://macro.com/app"]).catch(() => {});
          });
        } else if (c === "group") {
          // cmd-alt-g: the sidebar groups chats by state instead of by machine and space (and back).
          setShared("rex.group", shared("rex.group") === "state" ? "space" : "state");
        } else if (/^page/.test(c)) {
          // "page:agents" / "page:routines": the sidebar's pages (a stack in layouts/rex.json).
          run("layout.select", { stack: "sidebar-pages", child: `page-${c.split(":")[1]}` });
        } else if (c === "float") {
          const f = focused();
          const term = f?.terminal ?? this.current()?.address;
          if (term) floatTerminal(term);
        }
        cx.notify();
      }
    });
  }

  current() {
    const f = focused();
    const all = agents();
    return all.find((a) => a.address === f?.terminal) ?? all.find((a) => a.address === f?.agent)
      ?? all.find((a) => a.tab === f?.tab) ?? null;
  }

  refresh(cx) {
    if (props()?.bar) return;
    // Hidden (the default): no hc read, no re-render. It was reading 160 lines every 3 s for nothing.
    if (hidden("summary")) return;
    const a = this.current();
    if (!a) return;
    cx.spawn(async (cx) => {
      const r = await hc(["read", a.address, "--json", "--lines", "160"]);
      let text = "";
      try { text = JSON.parse(r.stdout).text ?? ""; } catch { text = r.stdout; }
      this.data = { address: a.address, ...summarize(text) };
      cx.notify();
    });
  }

  // Titlebar row of the work area: the space on the left, thin icon buttons on the right.
  // The chat's title lives in each pane's own header, not here.
  bar(t) {
    const sp = spaces().find((s) => s.active);
    const a = this.current();
    const all = agents();
    const working = all.filter((x) => x.status === "working").length;
    const blocked = all.filter((x) => x.status === "blocked").length;
    const btn = (id, ic, fn, tip) =>
      div().id(id).size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(tip)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(fn).child(svg(asset(ic)).size(15).text_color(t.muted));
    // Where you are: space › chat (the shown tab's name, else its agent's title), then a quiet
    // live count. Grey; only "needs you" takes the accent, and clicking it opens that chat.
    const tab = sp?.tabs?.find((x) => x.active);
    // Only an agent of the shown tab names it (current() can fall back to the last focused agent
    // elsewhere); a plain shell tab shows its folder, like the sidebar row.
    const own = a && a.tab === tab?.id ? a : null;
    const pane = panes().find((p) => p.tab === tab?.id && p.focused) ?? panes().find((p) => p.tab === tab?.id);
    const dir = (pane?.cwd ?? "").split("/").filter(Boolean).pop() ?? "";
    const chat = (tab?.named ? tab.name : null) || (own?.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim() || dir || tab?.name || "";
    const needs = all.find((x) => x.status === "blocked");
    return h_flex().size_full().px(14).gap(14).items_center().text_size(12)
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().flex_none().text_color(t.dim).child(sp?.name ?? ""))
        .when(Boolean(chat), (el) => el.child(div().flex_none().text_color(t.dim).child("›")).child(div().truncate().min_w(0).text_color(t.muted).child(chat)))
        .when(Boolean(sp?.branch), (el) => el.child(h_flex().gap(4).items_center().flex_none().text_color(t.dim)
          .child(svg(asset("git-branch")).size(12).text_color(t.dim)).child(sp.branch))))
      .when(working > 0, (el) => el.child(tn(div()).flex_none().text_color(t.dim).child(`${working} working`)))
      .when(blocked > 0, (el) => el.child(
        tn(div().id("needs-you")).flex_none().px(6).py(1).rounded(5).cursor_pointer().text_color(t.blocked)
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => needs && run("agent.focus", { terminal: needs.address }))
          .child(`${blocked} needs you`)))
      .child(div().flex_1())
      // Pane actions, quiet line icons: split right (⌘D), split down (⌘⇧D), changes (⌘⇧G), float, summary.
      .child(h_flex().gap(2).items_center().flex_none()
        .child(btn("split-r", "split-right", () => splitShown("right"), "Split right  ⌘D"))
        .child(btn("split-d", "split-down", () => splitShown("down"), "Split down  ⌘⇧D"))
        .child(div().w(1).h(14).mx(4).bg(t.border))
        .child(btn("changes", "changes", () => run("layout.toggle", { id: "changes" }), "Changes  ⌘⇧G"))
        .when(Boolean(a), (el) => el.child(btn("float", "layers", () => floatTerminal(a.address), "Float this chat")))
        .child(btn("summary", "panel-right", () => run("layout.toggle", { id: "summary" }), "Summary  ⌘⇧S")));
  }

  card(t, label, body, mono) {
    return v_flex().gap(6).p(12).rounded(10).bg(t.surface).border(1).border_color(t.border)
      .child(div().text_size(10.5).font_semibold().text_color(t.dim).child(label.toUpperCase()))
      .child(body);
  }

  render(cx) {
    const t = theme();
    if (props()?.bar) return this.bar(t);
    const a = this.current();
    if (a && this.data?.address !== a.address && this.target !== a.address) { this.target = a.address; this.refresh(cx); }
    const d = this.data?.address === a?.address ? this.data : null;
    const kids = [];
    if (!a) kids.push(div().p(12).text_size(12).text_color(t.dim).child("No agent focused."));
    else if (!d) kids.push(div().p(12).text_size(12).text_color(t.dim).child("Reading…"));
    else {
      if (d.prompt) kids.push(this.card(t, "You", div().text_size(12.5).text_color(t.foreground).child(d.prompt)));
      // The answer is a terminal's output, so untrusted: shown as plain text, never as markdown that could fetch an image
      // or open a disguised link.
      if (d.answer) kids.push(this.card(t, a.program?.name ?? "Agent", v_flex().gap(4).text_size(12.5).text_color(t.foreground).children(d.answer.split("\n").map((l) => div().child(l || " ")))));
      if (a.status === "working" && d.activity) kids.push(div().px(4).text_size(11.5).text_color(t.working).truncate().child(d.activity));
      if (!d.prompt && !d.answer)
        kids.push(this.card(t, "Screen", div().text_size(11).font_family("Geist Mono").text_color(t.muted).child(d.tail || "(empty)")));
    }
    return v_flex().size_full().min_w(0).child(
      v_flex().id("rex-sum").flex_1().min_h(0).gap(10).overflow_y_scrollbar().pb(10).children(kids),
    );
  }
}
