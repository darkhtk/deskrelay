/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing in index.html");
render(() => <App />, root);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The app works without a service worker.
    });
  });
}
