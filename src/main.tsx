import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./pages/Overlay";
import "./index.css";

// Determine which component to render based on URL path
const path = window.location.pathname;
const isOverlay = path === "/overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <Overlay /> : <App />}
  </React.StrictMode>
);
