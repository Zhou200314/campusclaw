import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyStoredTheme } from "./lib/theme";
import "./styles.css";

applyStoredTheme();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  );
}
