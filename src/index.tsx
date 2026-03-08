import * as React from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "~/src/index.css";
import { App } from "~/src/app";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
