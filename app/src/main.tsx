import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { initEnvironment } from "@mycity/ui";
import { App } from "./App";
import { startPwa } from "./shell/pwa";

initEnvironment({ allowQuery: import.meta.env.DEV });
startPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
