import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MenuApp from "./MenuApp.jsx";
import "../qr.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MenuApp />
  </StrictMode>
);
