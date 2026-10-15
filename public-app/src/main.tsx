import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { configurePreferences } from "@mycity/ui";
import { App } from "./App";
import { initEnvironment } from "./lib/environment";

/* The public site keeps its visitors' own theme key (index.html reads it before first paint). */
configurePreferences({ themeKey: "mc-public-theme" });
initEnvironment();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
