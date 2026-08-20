const { clipboard } = require("electron");
const { spawn } = require("child_process");

// Writes text to the clipboard and simulates Ctrl+V so it lands in
// whatever text box currently has focus in any application. Only the
// overlay/settings windows are non-focusable, so focus stays on the
// external app that had it before the hotkey was pressed.
function pasteText(text) {
  return new Promise((resolve) => {
    if (!text) { resolve(); return; }

    const previousClipboardText = clipboard.availableFormats().includes("text/plain")
      ? clipboard.readText()
      : null;

    clipboard.writeText(text);

    if (process.platform !== "win32") {
      // Non-Windows dev environments: clipboard is set, but there is no
      // reliable keystroke-injection path here. Caller can paste manually.
      resolve();
      return;
    }

    const script =
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "Start-Sleep -Milliseconds 60;" +
      "[System.Windows.Forms.SendKeys]::SendWait('^v')";

    const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
      windowsHide: true,
    });

    ps.on("close", () => {
      if (previousClipboardText !== null) {
        setTimeout(() => {
          try { clipboard.writeText(previousClipboardText); } catch { /* best effort */ }
        }, 400);
      }
      resolve();
    });

    ps.on("error", () => resolve());
  });
}

module.exports = { pasteText };
