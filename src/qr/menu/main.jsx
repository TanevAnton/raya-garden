import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MenuApp from "./MenuApp.jsx";
import ErrorBoundary from "../shared/ErrorBoundary.jsx";
import "../qr.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary title="Нещо се обърка · Something went wrong" text="Поръчките Ви са запазени. Your orders are safe." button="Презареди · Reload">
      <MenuApp />
    </ErrorBoundary>
  </StrictMode>
);
