/// <reference types="vite/client" />
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
declare global {
  interface Window {
    studioProfile?: {
      commits: number;
      actualMilliseconds: number;
      recent: number[];
    };
  }
}
const root = createRoot(document.getElementById("root")!);
root.render(
  import.meta.env.DEV && new URLSearchParams(location.search).has("profile") ? (
    <Profiler
      id="Studio"
      onRender={(_id, _phase, duration) => {
        const metrics = (window.studioProfile ??= {
          commits: 0,
          actualMilliseconds: 0,
          recent: [],
        });
        metrics.commits++;
        metrics.actualMilliseconds += duration;
        metrics.recent.push(duration);
        if (metrics.recent.length > 120) metrics.recent.shift();
      }}
    >
      <App />
    </Profiler>
  ) : (
    <App />
  ),
);
