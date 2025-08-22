// start.js
import { spawn } from "node:child_process";

const PORT = "3000";      // Render injects PORT at runtime
const HOST = "0.0.0.0";                        // bind to all interfaces
const PROJECT_REF = process.env.PROJECT_REF;   // e.g. abcdefgh (no spaces)
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF) {
    console.error("ERROR: Missing PROJECT_REF env var (Supabase project ref).");
    process.exit(1);
}

if (!SUPABASE_ACCESS_TOKEN) {
    console.error("ERROR: Missing SUPABASE_ACCESS_TOKEN env var.");
    process.exit(1);
}

// IMPORTANT: pass the entire child command as ONE string after --stdio.
// Also force host=0.0.0.0 so Render can reach it.
const stdioCommand = `npx -y @supabase-community/supabase-mcp --read-only --project-ref=${PROJECT_REF}`;
const args = [
    "@smithery/gateway",
    "--host", HOST,
    "--port", PORT,
    "--stdio", stdioCommand
];

console.log("[launcher] Starting MCP gateway");
console.log("[launcher] PORT         =", PORT);
console.log("[launcher] HOST         =", HOST);
console.log("[launcher] PROJECT_REF  =", PROJECT_REF);
console.log("[launcher] Token present =", Boolean(SUPABASE_ACCESS_TOKEN));

const child = spawn("npx", args, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN }
});

child.on("exit", (code) => process.exit(code ?? 1));
