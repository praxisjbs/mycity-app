import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { initEnvironment } from "@mycity/ui";
import { App } from "./App";
import { resumeTrail } from "./lib/trail";
import { startPwa } from "./shell/pwa";

initEnvironment({ allowQuery: import.meta.env.DEV });
startPwa();
// The installed app opening fresh goes back to where the person was, before anything draws (F29).
resumeTrail();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
