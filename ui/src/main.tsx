import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./monaco";
import { App } from "./App";
import { StoreProvider, useApiReady } from "./store";

function Root() {
  const { api, err } = useApiReady();
  if (err) return <div className="center-msg err-text">Could not start ACRW: {err}</div>;
  if (!api) return <div className="loading-bar" />;
  return <StoreProvider api={api}><App /></StoreProvider>;
}

// Monaco cancels in-flight work (diff computation, hovers) with a "Canceled" rejection; it is not an error.
window.addEventListener("unhandledrejection", (e) => { if ((e.reason as Error)?.name === "Canceled" || (e.reason as Error)?.message === "Canceled") e.preventDefault(); });

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Root /></React.StrictMode>);
