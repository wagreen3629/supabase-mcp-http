// start.js — force Smithery gateway to bind to Render's PORT and pass env cleanly import { spawn } from "node:child_process";

const PORT = process.env.PORT || "3000"; const PROJECT_REF = process.env.PROJECT_REF; const SUPA-BASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

// sanity checks
if (!PROJECT_REF || /\s/.test(PROJECT_REF)) {
  console.error(
    "ERROR: PROJECT_REF is missing or contains spaces. " +
    "Set it to your Supabase project reference (e.g., abcd1234), not the project NAME."
  );
  process.exit(1);
}
if (!SUPABASE_ACCESS_TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN is missing.");
  process.exit(1);
}

// NOTE: we call smithery gateway which spawns the official Supabase MCP server via npx const command = "npx"; const args = [
  "@smithery/gateway",
  "--stdio",
  // spawn the official Supabase MCP server (read-only) with your project ref
  `npx -y @supabase-community/supabase-mcp --read-only --project-ref=${PROJECT_REF}`,
  "--port",
  PORT
];

console.log("[launcher] Starting MCP gateway on port", PORT); console.log("[launcher] Using PRO-JECT_REF:", PROJECT_REF);

const child = spawn(command, args, {
  env: {
    ...process.env,
    SUPABASE_ACCESS_TOKEN // ensure child receives PAT
  },
  stdio: "inherit",
  shell: true
});

child.on("exit", (code) => {
  console.error("[launcher] Gateway exited with code:", code);
  process.exit(code ?? 1);
});
