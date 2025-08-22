// start.js — Launch Smithery gateway (HTTP/SSE) and run Supabase MCP via STDIO.
// Fixes: 1) bind to Render's PORT, 2) pass full child command (not just "npx").
import { spawn } from "node:child_process";

const PORT = process.env.PORT || "3000";     // Render injects PORT at runtime
const PROJECT_REF = process.env.PROJECT_REF; // e.g., abcd1234 (no spaces)
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF) {
    console.error("ERROR: Missing PROJECT_REF (Supabase project ref). Set in Render > Environment.");
    process.exit(1);
}

if (!SUPABASE_ACCESS_TOKEN) {
    console.error("ERROR: Missing SUPABASE_ACCESS_TOKEN. Set in Render > Environment.");
    process.exit(1);
}

// We pass the child command using --stdio.command + repeated --stdio.args
// so the gateway receives the entire command and its arguments.
const gatewayCmd = "npx";
const gatewayArgs = [
    "@smithery/gateway",
    "--stdio.command", "npx",
    "--stdio.args", "-y",
    "--stdio.args", "@supabase-community/supabase-mcp",
    "--stdio.args", "--read-only",
    "--stdio.args", `--project-ref=${PROJECT_REF}`,
    "--port", PORT
];

console.log("[launcher] Starting MCP gateway on port", PORT);
console.log("[launcher] Using PROJECT_REF:", PROJECT_REF);
console.log("[launcher] Token present:", Boolean(SUPABASE_ACCESS_TOKEN));

const child = spawn(gatewayCmd, gatewayArgs, {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN }, // ensure PAT is visible to child
    stdio: "inherit",
    shell: true
});

child.on("exit", (code) => {
    console.error("[launcher] Gateway exited with code:", code);
    process.exit(code ?? 1);
});
