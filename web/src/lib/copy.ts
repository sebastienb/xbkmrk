// navigator.clipboard only exists in secure contexts (https / localhost), and
// this app is typically reached over plain http on a LAN or tailnet — so fall
// back to the legacy hidden-textarea + execCommand path when it's missing.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // permission denied or transient failure — try the legacy path
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy command rejected");
  } finally {
    ta.remove();
  }
}
