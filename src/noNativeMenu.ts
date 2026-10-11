/**
 * The browser's own right-click menu (Back, Refresh, Save as, Print, Inspect) has nothing to do in the app: it is suppressed everywhere,
 * except in a text field, where Cut / Copy / Paste are still wanted. The app's own menus open on `contextmenu` too, from handlers of their
 * own, which this does not get in the way of (it only cancels the default action).
 */
const TEXT_INPUTS = new Set(["text", "search", "number", "password", "email", "url", "tel"]);

export function installNoNativeMenu() {
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    const editable = !!t && (t.isContentEditable || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && TEXT_INPUTS.has((t as HTMLInputElement).type)));
    if (!editable) e.preventDefault();
  }, true);
}
