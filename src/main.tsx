/**
 * Entry: load the engine (wasm) first — UI modules call into it as they load (Sing mode builds
 * its syllables at import time) — then import and render the app. A failed load can be retried.
 */
import "./ui/styles.css";
import { initChimera } from "./wasm/chimera.ts";

const root = document.getElementById("root")!;

async function boot(): Promise<void> {
  try {
    await initChimera();
    const { mount } = await import("./ui/mount.tsx");
    await mount(root);
  } catch (err) {
    root.replaceChildren();
    const box = document.createElement("div");
    box.className = "boot-error";
    const msg = document.createElement("p");
    msg.textContent = `The voice engine could not load: ${err instanceof Error ? err.message : String(err)}`;
    const retry = document.createElement("button");
    retry.className = "primary";
    retry.textContent = "Try again";
    retry.onclick = () => void boot();
    box.append(msg, retry);
    root.append(box);
  }
}

/**
 * Offline: a service worker keeps what the page has loaded (public/sw.js), so once opened it opens
 * again with no network. Only in a built site, and only where the browser allows one (not over a
 * self-signed certificate): a failure here is not an error.
 */
function keepOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => {
      // a moment later, when the page's own files (the engine, the fonts, its lazy parts) are in
      const send = () => {
        const here = location.origin;
        const urls = performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((u) => u.startsWith(here));
        reg.active?.postMessage({ keep: [here + import.meta.env.BASE_URL, ...urls] });
      };
      setTimeout(send, 4000);
      setTimeout(send, 20000);
    })
    .catch(() => {});
}

void boot().then(keepOffline);
