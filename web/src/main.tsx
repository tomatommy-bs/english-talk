import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { preloadVoice } from "./lib/session";
import { set } from "./lib/store";
import { registerTools } from "./lib/tools";

// ツールと音声モデルは React の外で一度だけ用意する
const mcp = registerTools();
setInterval(() => set({ connected: !!mcp.isConnected }), 1000);
preloadVoice();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
