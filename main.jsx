import React from "react";
import ReactDOM from "react-dom/client";
import RecipeFinder from "./RecipeFinder.jsx";

// If this is running inside Telegram (as a bot Web App), tell Telegram
// the app is ready and let it take up the full available height.
// Does nothing and throws no errors when opened as a normal website.
if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RecipeFinder />
  </React.StrictMode>
);
