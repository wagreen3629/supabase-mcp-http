// start.js
import { spawn } from "node:child_process";

const PORT = "3000";         // Render will route to whatever you bind
const HOST = "0.0.0.0";                           // bind on all interfaces
const PROJECT_REF = process.env.PROJECT_REF;      // e.g., abcd1234 (no spaces)
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF) {
  console.error("ERROR: Missing PROJECT_REF (Supabase project ref)."); process.exit(1);
}
if (!SUPABASE_ACCESS_TOKEN) {
  console.error("ERROR: Missing SUPABASE_ACCESS_TOKEN."); process.exit(1);
}

// IMPORTANT: provide the child MCP command as command+args, not a single string.
const gatewayCmd = "npx";
const gatewayArgs = [
  "@smithery/gateway",
  "--host", HOST,
  "--port", PORT,

  // 👇 This is the key bit. Do NOT use `--stdio "<string>"`.
  "--stdio.command", "npx",
  "--stdio.args", "-y",
  "--stdio.args", "@supabase-community/supabase-mcp",
  "--stdio.args", "--read-only",
  "--stdio.args", `--project-ref=${PROJECT_REF}`,
];

console.log("[launcher] Starting MCP gateway");
console.log("[launcher] HOST        =", HOST);
console.log("[launcher] PORT        =", PORT);
console.log("[launcher] PROJECT_REF =", PROJECT_REF);
console.log("[launcher] Token present =", Boolean(SUPABASE_ACCESS_TOKEN));

const child = spawn(gatewayCmd, gatewayArgs, {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, SUPABASE_ACCESS_TOKEN },
});

child.on("exit", (code) => {
  console.error("[launcher] Gateway exited with code:", code);
  process.exit(code ?? 1);
});
