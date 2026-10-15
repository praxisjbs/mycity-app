import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./gallery.css";
import { configurePreferences } from "../src";
import { Gallery } from "./Gallery";

configurePreferences({ densityKey: "mc-gallery-density" });

/*
 * The page itself stays light: every state is drawn twice, in a light and a dark
 * frame side by side, so the device setting must not tint the light frame.
 */
document.documentElement.setAttribute("data-theme", "light");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
