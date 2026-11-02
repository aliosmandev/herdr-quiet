// Title bar of a Rex floating terminal (an overlay window opened by rex-sidebar / rex-focus).
// Drag by the bar; "Dock" jumps to the terminal's own pane; x closes the float.
// Props: { terminal, overlay }.

import { View, div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, panes, run, theme, props, closeOverlay } from "herdr";

const WORDS = { working: "Working", blocked: "Needs you", done: "Finished", idle: "Idle" };

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class RexFloat extends View {
  render() {
    const t = theme();
    const { terminal, overlay } = props() ?? {};
    const k = terminals().find((x) => x.address === terminal);
    const a = agents().find((x) => x.address === terminal);
    const st = a?.status ?? null;
    const dot = st === "blocked" ? t.blocked : st === "done" ? t.done : st === "working" ? t.working : t.idle;
    const home = panes().some((p) => p.terminal === terminal);
    const btn = (id, label, fn) =>
      div().id(id).px(8).py(2).rounded(5).text_size(11.5).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(fn).child(label);
    return h_flex().size_full().px(12).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
      .child(div().size(7).flex_none().rounded(4).bg(dot))
      .when(Boolean(icon(a?.program ?? k?.program, 14, t.foreground)), (el) => el.child(icon(a?.program ?? k?.program, 14, t.foreground)))
      .child(div().truncate().font_semibold().text_color(t.foreground).child(a?.title || k?.name || k?.program?.name || terminal || ""))
      .when(Boolean(st), (el) => el.child(div().flex_none().text_color(st === "blocked" ? t.blocked : t.muted).child(WORDS[st])))
      .child(div().flex_1())
      .when(home, (el) => el.child(btn("dock", "Go to pane", () => { run("pane.focus", { terminal }); closeOverlay(overlay); })))
      .child(btn("close", "Close", () => closeOverlay(overlay)));
  }
}
