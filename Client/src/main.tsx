import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { HeartWipeProvider } from "./components/HeartWipe";
import { getSpacetime } from "./lib/spacetime";
import "./index.css";

getSpacetime();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <HeartWipeProvider>
        <App />
      </HeartWipeProvider>
    </BrowserRouter>
  </StrictMode>,
);
