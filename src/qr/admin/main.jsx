import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./AdminApp.jsx";
import ErrorBoundary from "../shared/ErrorBoundary.jsx";
import "../qr.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary title="Нещо се обърка" text="Екранът спря да се показва. Поръчките са запазени на сървъра — презаредете." button="Презареди">
      <AdminApp />
    </ErrorBoundary>
  </StrictMode>
);
