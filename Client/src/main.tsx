import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SpacetimeDBProvider } from "spacetimedb/react";
import App from "./App";
import { connectionBuilder } from "./lib/spacetime";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SpacetimeDBProvider>
  </StrictMode>,
);
