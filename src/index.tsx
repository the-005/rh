import * as React from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "~/src/index.css";
import { loadSiteData } from "~/src/work/data";

// What the site shows comes from storage (src/work/data); the app is imported
// only once it's in, so every module that lists projects reads the loaded list.
loadSiteData().then(async () => {
  const { App } = await import("~/src/app");
  createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Router>
        <App />
      </Router>
    </React.StrictMode>
  );
});
