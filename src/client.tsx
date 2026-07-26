/// <reference types="vite/client" />
import { createRoot, hydrateRoot } from "react-dom/client";
import { AppForPath } from "./App";
import { findRoute } from "./routes";
import { siteData } from "./generated/site-data";
import "./styles.css";
import { initPageMotion } from "./motion";
import { initContentEnhancements } from "./enhance";

async function boot() {
  const root = document.getElementById("root") as HTMLElement;
  let site = siteData;

  if (import.meta.env.DEV) {
    try {
      // Dev server has no pre-rendered DOM, so load the full dataset instead.
      site = (await import("./generated/site-data-full")).siteDataFull;
    } catch {
      /* first run before any build: fall back to whatever data exists */
    }
  } else {
    // Production pages ship a slim dataset without article HTML; recover the
    // current article's body from the server-rendered DOM before hydrating.
    const route = findRoute(window.location.pathname, site);
    const manuscript = root.querySelector<HTMLElement>(".manuscript");
    if (route.kind === "evidence" && manuscript) {
      route.evidence.html = manuscript.innerHTML;
    }
  }

  const app = <AppForPath path={window.location.pathname} site={site} />;
  if (root.firstElementChild) {
    hydrateRoot(root, app);
  } else {
    createRoot(root).render(app);
  }

  initPageMotion();
  window.requestAnimationFrame(() => initContentEnhancements());
}

void boot();
