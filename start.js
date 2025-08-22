// start.js - Fixed for Render.com
import { spawn } from "node:child_process";

// ✅ CRITICAL FIX: Use Render's assigned PORT
const PORT = process.env.PORT || "3000";
const HOST = "0.0.0.0";
const PROJECT_REF = process.env.PROJECT_REF;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF) {
  console.error("ERROR: Missing PROJECT_REF (Supabase project ref)."); 
  process.exit(1);
}
if (!SUPABASE_ACCESS_TOKEN) {
  console.error("ERROR: Missing SUPABASE_ACCESS_TOKEN."); 
  process.exit(1);
}

// ✅ Try different gateway versions to avoid the bug
const gatewayArgs = [
  "@smithery/gateway@0.0.7", // Try an older version
  "--host", HOST,
  "--port", PORT,
  "--stdio", JSON.stringify({
    command: "npx",
    args: ["-y", "@supabase-community/supabase-mcp", "--read-only", `--project-ref=${PROJECT_REF}`]
  })
];

console.log("[launcher] Starting MCP gateway");
console.log("[launcher] HOST        =", HOST);
console.log("[launcher] PORT        =", PORT); // This should show Render's assigned port
console.log("[launcher] PROJECT_REF =", PROJECT_REF);
console.log("[launcher] Token present =", Boolean(SUPABASE_ACCESS_TOKEN));

const child = spawn("npx", gatewayArgs, {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, SUPABASE_ACCESS_TOKEN },
});

// ✅ Add error handling
child.on("error", (error) => {
  console.error("[launcher] Failed to start gateway:", error.message);
  process.exit(1);
});

child.on("exit", (code) => {
  console.error("[launcher] Gateway exited with code:", code);
  if (code === 1) {
    console.log("[launcher] Restarting gateway in 5 seconds...");
    setTimeout(() => {
      // Restart the gateway
      const newChild = spawn("npx", gatewayArgs, {
        shell: true,
        stdio: "inherit",
        env: { ...process.env, SUPABASE_ACCESS_TOKEN },
      });
      // Copy event handlers to new child
      newChild.on("error", (error) => {
        console.error("[launcher] Failed to start gateway:", error.message);
        process.exit(1);
      });
      newChild.on("exit", (code) => {
        console.error("[launcher] Gateway exited with code:", code);
        process.exit(code ?? 1);
      });
    }, 5000);
  } else {
    process.exit(code ?? 1);
  }
});
