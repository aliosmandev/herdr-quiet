// Changes across every git repo under the focused folder (rexmod's "what did the agent change"
// idea, for a folder of products like ~/code/acme: web, api, sdk, ...).
// The focused pane's folder: if it is a repo, just that repo; otherwise each repo found up to
// its direct children (not deeper: reference clones and node_modules stay out, and so does their cost). Per repo: branch, ahead/behind, changed files (git status). Collapsible.
// Read-only: it never stages, commits or discards anything.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, focused, spaces, theme, settings, readTextFile, layout } from "herdr";

// Every git call runs in folders we didn't choose (any child repo, e.g. a fresh clone), so turn off
// the config that can start a program on a read: fsmonitor, hooks; and take no index lock.
const SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--no-optional-locks"];
const asset = (n) => `mods/rex-changes/${n}.svg`;
const tilde = (p) => p.replace(/^\/Users\/[^/]+/, "~");
const MAX_FILES = 40;
const DIFF_LINES = 60;
// The terminal font from Herdr settings ("font"), for diff lines; none set: the UI font.
const mono = () => { const v = settings()?.font ?? settings()?.font_family; return typeof v === "string" ? v : ""; };
// "#rrggbb" + alpha as "#rrggbbaa".
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c) ? c + a : c);
// git status XY -> one quiet letter.
const letter = (xy) => (xy.includes("?") ? "U" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : xy.includes("R") ? "R" : "M");

// `git status --porcelain=v2 --branch` -> { branch, ahead, behind, upstream, files: [{ code, path }] }.
function parse(out) {
  const r = { branch: "", ahead: 0, behind: 0, upstream: false, files: [] };
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.head ")) r.branch = line.slice(14);
    else if (line.startsWith("# branch.upstream ")) r.upstream = true;
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { r.ahead = +m[1]; r.behind = +m[2]; }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      // "1 XY sub mH mI mW hH hI path" / "2 XY ... score path\torig"
      const path = parts.slice(line.startsWith("1 ") ? 8 : 9).join(" ").split("\t")[0];
      r.files.push({ code: letter(parts[1]), path });
    } else if (line.startsWith("? ")) r.files.push({ code: "U", path: line.slice(2) });
    else if (line.startsWith("u ")) r.files.push({ code: "C", path: line.split(" ").slice(10).join(" ") });
  }
  return r;
}

// Line diff of two texts as unified-style lines ("@@", " ctx", "-old", "+new"), 2 lines of context.
// Myers' O((N+M)·D) algorithm (git's default), so a small change in a big file stays cheap. Past
// MAX_D edits it falls back to one hunk between the common prefix and suffix (a preview only).
const MAX_D = 3000;
const MAX_LINES = 20000;       // N+M above this: no Myers, preview hunk only
const TRACE_BUDGET = 4_000_000; // Int32 entries kept for the walk back (16 MB)
function myers(A, B) {
  const n = A.length, m = B.length, max = n + m, off = max + 1;
  if (max > MAX_LINES) return null;
  let v = new Int32Array(2 * max + 3);
  const trace = []; // per step d: v[-d..d] only, so memory grows with d², not d·(N+M)
  let kept = 0;
  for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    kept += 2 * d + 1;
    if (kept > TRACE_BUDGET) return null;
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) {
        // Walk the trace back into edit ops.
        const ops = [];
        let cx = n, cy = m;
        for (let e = d; e > 0; e--) {
          // trace[e] holds v[-e..e] as it was before step e: index k at k + e.
          const pv = trace[e], kk = cx - cy, at = (k) => (k < -e || k > e ? 0 : pv[k + e]);
          const pk = kk === -e || (kk !== e && at(kk - 1) < at(kk + 1)) ? kk + 1 : kk - 1;
          const px = at(pk), py = px - pk;
          while (cx > px && cy > py) { ops.push([" ", A[--cx]]); cy--; }
          if (cx === px) ops.push(["+", B[--cy]]); else ops.push(["-", A[--cx]]);
        }
        while (cx > 0 && cy > 0) { ops.push([" ", A[--cx]]); cy--; }
        return ops.reverse();
      }
    }
  }
  return null;
}
function unified(a, b) {
  const A = a ? a.replace(/\n$/, "").split("\n") : [], B = b ? b.replace(/\n$/, "").split("\n") : [];
  let ops = myers(A, B);
  if (!ops) {
    let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    ops = [...A.slice(0, p).map((x) => [" ", x]), ...A.slice(p, A.length - s).map((x) => ["-", x]), ...B.slice(p, B.length - s).map((x) => ["+", x]), ...A.slice(A.length - s).map((x) => [" ", x])];
  }
  // Keep changed lines plus 2 lines of context around them; "@@" marks each gap.
  const keep = ops.map((o, k) => o[0] !== " " || ops.slice(Math.max(0, k - 2), k + 3).some((x) => x[0] !== " "));
  const out = [];
  let gap = true;
  ops.forEach((o, k) => {
    if (!keep[k]) { gap = true; return; }
    if (gap) out.push("@@");
    gap = false;
    out.push(o[0] + o[1]);
  });
  return out;
}

function hidden(id) {
  const find = (n) => (n?.id === id ? n : (n?.children ?? []).map(find).find(Boolean) ?? null);
  return Boolean(find(layout())?.hidden);
}

export default class RexChanges extends View {
  init(_props, cx) {
    this.root = null;   // folder looked at
    this.repos = null;  // [{ dir, name, ...parse() }]
    this.error = null;
    this.open = new Set(); // repo dirs shown expanded (dirty ones open by default once)
    this.seen = new Set();
    this.busy = false;
    this.diffs = {}; // "dir\0path" -> lines (string[]) | null while loading; present = shown
    const tick = (cx) => this.load(cx);
    tick(cx);
    cx.timer.every(15000, tick);
    // Opening the panel shows fresh data at once instead of waiting for the next 15 s tick.
    cx.timer.every(1000, (cx) => { const on = !hidden("changes"); if (on && !this.wasOn) tick(cx); this.wasOn = on; });
  }

  folder() {
    const f = focused();
    if (f?.cwd) return f.cwd;
    return spaces().find((s) => s.active)?.folder ?? null;
  }

  load(cx) {
    if (this.busy) return;
    if (hidden("changes")) return; // closed (the default): no git at all
    const root = this.folder();
    if (!root) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // A repo itself (or inside one): show that repo only.
        const top = await exec("git", [...SAFE, "rev-parse", "--show-toplevel"], { cwd: root }).catch(() => null);
        let dirs;
        if (top && top.code === 0) dirs = [top.stdout.trim()];
        else {
          const found = await exec("find", [root, "-mindepth", "2", "-maxdepth", "2", "-name", ".git"]);
          dirs = found.stdout.split("\n").filter(Boolean).map((p) => p.replace(/\/\.git$/, "")).sort();
        }
        const repos = [];
        for (const dir of dirs) {
          const s = await exec("git", [...SAFE, "status", "--porcelain=v2", "--branch"], { cwd: dir }).catch(() => null);
          if (!s || s.code !== 0) continue;
          const r = { dir, name: dir === root ? dir.split("/").pop() : dir.slice(root.length + 1), ...parse(s.stdout) };
          // Open a repo the first time it has changes; after that the user's fold wins.
          if (r.files.length && !this.seen.has(dir)) { this.open.add(dir); }
          this.seen.add(dir);
          repos.push(r);
        }
        this.root = root;
        this.repos = repos;
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
  }

  // Click a file: its diff inline under the row (again: hide it). Untracked files show their
  // first lines as added. At most DIFF_LINES lines; the full diff stays a git command away.
  toggleDiff(cx, dir, f) {
    const k = `${dir}\0${f.path}`;
    if (k in this.diffs) { delete this.diffs[k]; cx.notify(); return; }
    this.diffs[k] = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let lines;
      try {
        {
          // No `git diff` on the work tree: it would run the repo's clean filters and textconv
          // drivers, i.e. programs a cloned repo picks. cat-file reads the HEAD blob raw, Herdr
          // reads the file, and the diff is computed here.
          const old = f.code === "A" || f.code === "U" ? { code: 0, stdout: "" } : await exec("git", [...SAFE, "cat-file", "blob", `HEAD:${f.path}`], { cwd: dir }).catch(() => ({ code: 1, stdout: "" }));
          // Like git: a symlink is its target text, never followed (a repo could point one at
          // ~/.ssh/...); anything that isn't a regular file isn't read. readTextFile caps at 1 MiB.
          const full = `${dir}/${f.path}`;
          let now = "";
          if (f.code !== "D") {
            if ((await exec("test", ["-L", full])).code === 0) now = (await exec("readlink", [full])).stdout.replace(/\n$/, "");
            else if ((await exec("test", ["-f", full])).code === 0) now = (await readTextFile(full)) ?? "";
          }
          lines = unified(old.code === 0 ? old.stdout : "", now);
        }
      } catch (e) { lines = [`(can't read: ${e?.message ?? e})`]; }
      if (k in this.diffs) { this.diffs[k] = lines; cx.notify(); }
    });
  }

  diffView(t, lines) {
    if (!lines) return div().ml(44).py(2).text_size(11).text_color(t.dim).child("…");
    const rows = lines.slice(0, DIFF_LINES).map((l) => {
      const c = l[0] === "+" ? t.done : l[0] === "-" ? t.blocked : l.startsWith("@@") ? t.dim : t.muted;
      return div().px(8).truncate().text_size(11).text_color(c).bg(l[0] === "+" ? tint(t.done, "14") : l[0] === "-" ? tint(t.blocked, "14") : "#00000000").child(l || " ");
    });
    if (lines.length > DIFF_LINES) rows.push(div().px(8).text_size(11).text_color(t.dim).child(`… ${lines.length - DIFF_LINES} more lines`));
    return v_flex().ml(32).mr(8).my(2).py(4).rounded(6).bg(t.background).border_1().border_color(t.border)
      .when(Boolean(mono()), (el) => el.font_family(mono())).children(rows);
  }

  repo(t, r) {
    const open = this.open.has(r.dir);
    const dirty = r.files.length > 0;
    const head = h_flex().id(`rp-${r.dir}`).mx(6).px(6).h(26).gap(7).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { open ? this.open.delete(r.dir) : this.open.add(r.dir); cx.notify(); })
      .child(svg(asset(open ? "chevron-down" : "chevron-right")).size(11).flex_none().text_color(t.dim))
      .child(div().truncate().min_w(0).text_size(12.5).text_color(dirty ? t.foreground : t.muted).child(r.name))
      .child(h_flex().gap(4).items_center().flex_1().min_w(0)
        .child(svg(asset("git-branch")).size(11).flex_none().text_color(t.dim))
        .child(div().truncate().text_size(11).text_color(t.dim).child(r.branch)))
      .when(r.ahead > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(`↑${r.ahead}`)))
      .when(r.behind > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(`↓${r.behind}`)))
      .child(div().flex_none().text_size(11).text_color(dirty ? t.muted : t.dim).child(dirty ? String(r.files.length) : "clean"));
    const kids = [head];
    if (open && dirty) {
      for (const f of r.files.slice(0, MAX_FILES)) {
        const slash = f.path.lastIndexOf("/");
        const k = `${r.dir}\0${f.path}`;
        const shown = k in this.diffs;
        kids.push(
          h_flex().id(`f-${k}`).ml(26).mr(8).px(6).h(21).gap(8).items_center().rounded(5).text_size(11.5).cursor_pointer()
            .when(shown, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.toggleDiff(cx, r.dir, f))
            .child(div().w(10).flex_none().text_color(f.code === "D" ? t.blocked : t.dim).child(f.code))
            .child(div().flex_none().text_color(t.muted).child(f.path.slice(slash + 1)))
            .child(div().truncate().min_w(0).text_color(t.dim).child(slash > 0 ? f.path.slice(0, slash) : "")),
        );
        if (shown) kids.push(this.diffView(t, this.diffs[k]));
      }
      if (r.files.length > MAX_FILES) kids.push(div().ml(36).py(2).text_size(11).text_color(t.dim).child(`+${r.files.length - MAX_FILES} more`));
    }
    return v_flex().children(kids);
  }

  render(_cx) {
    const t = theme();
    const repos = this.repos ?? [];
    const dirty = repos.filter((r) => r.files.length).length;
    const header = h_flex().h(28).px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Changes"))
      .child(div().truncate().flex_1().min_w(0).text_size(11).text_color(t.dim).child(this.root ? tilde(this.root) : ""))
      .when(repos.length > 1, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${dirty}/${repos.length} changed`)));
    const note = (s) => div().px(16).py(12).text_size(12).text_color(t.dim).child(s);
    const body = this.error ? note(`Can't read git: ${this.error}`)
      : !this.repos ? note("Looking for repos…")
      : !repos.length ? note("No git repo here or below.")
      : v_flex().id("rex-changes-list").flex_1().min_h(0).overflow_y_scrollbar().py(4).gap(0)
        .children(repos.filter((r) => r.files.length || r.ahead || r.behind).map((r) => this.repo(t, r)))
        .when(repos.some((r) => !r.files.length && !r.ahead && !r.behind), (el) => el.child(
          div().px(16).pt(8).text_size(11).text_color(t.dim).truncate()
            .child(`Clean: ${repos.filter((r) => !r.files.length && !r.ahead && !r.behind).map((r) => r.name).join(", ")}`)));
    return v_flex().size_full().bg(t.chrome).child(header).child(body);
  }
}
