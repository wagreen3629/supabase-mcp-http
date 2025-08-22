// server.js - Custom MCP-over-HTTP implementation
import { spawn } from "node:child_process";
import express from "express";
import cors from "cors";

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

console.log("[server] Starting custom MCP HTTP server");
console.log("[server] HOST        =", HOST);
console.log("[server] PORT        =", PORT);
console.log("[server] PROJECT_REF =", PROJECT_REF);
console.log("[server] Token present =", Boolean(SUPABASE_ACCESS_TOKEN));

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// Log all requests
app.use((req, res, next) => {
  console.log(`[request] ${req.method} ${req.url} from ${req.ip}`);
  console.log(`[request] User-Agent: ${req.get('User-Agent') || 'none'}`);
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  console.log("[health] Health check requested");
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    server: "custom-mcp-http",
    project_ref: PROJECT_REF
  });
});

// MCP child process management
let mcpChild = null;
let childReady = false;

function startMCPChild() {
  console.log("[mcp] Starting Supabase MCP child process");
  
  mcpChild = spawn("npx", [
    "-y", 
    "@supabase/mcp-server-supabase",
    "--read-only",
    `--project-ref=${PROJECT_REF}`
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SUPABASE_ACCESS_TOKEN },
  });

  mcpChild.on("spawn", () => {
    console.log("[mcp] Child process spawned successfully");
    childReady = true;
  });

  mcpChild.on("error", (error) => {
    console.error("[mcp] Child spawn error:", error.message);
    childReady = false;
  });

  mcpChild.on("exit", (code, signal) => {
    console.error(`[mcp] Child exited with code ${code}, signal ${signal}`);
    childReady = false;
    mcpChild = null;
  });

  mcpChild.stderr.on("data", (data) => {
    console.error("[mcp] Child stderr:", data.toString().trim());
  });

  // Give the child process time to initialize
  setTimeout(() => {
    if (mcpChild && !mcpChild.killed) {
      childReady = true;
      console.log("[mcp] Child process ready");
    }
  }, 2000);

  return mcpChild;
}

// Start MCP child process
startMCPChild();

// SSE/MCP endpoint - handle both GET (SSE) and POST (JSON-RPC)
app.get("/sse", (req, res) => {
  console.log("[sse] GET request - SSE connection from:", req.ip);
  console.log("[sse] User-Agent:", req.get('User-Agent'));
  console.log("[sse] Headers:", JSON.stringify(req.headers, null, 2));
  console.log("[sse] Query params:", req.query);
  
  // Set SSE headers with additional n8n compatibility
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control, Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "X-Accel-Buffering": "no", // Disable proxy buffering
    "Access-Control-Expose-Headers": "*"
  });

  // Send initial connection event
  const connectionEvent = {
    type: "connection",
    status: "connected",
    server: "custom-mcp-http",
    timestamp: new Date().toISOString(),
    mcp_ready: childReady
  };
  
  res.write("data: " + JSON.stringify(connectionEvent) + "\n\n");

  // Keep connection alive with periodic pings
  const keepAlive = setInterval(() => {
    if (!res.destroyed) {
      const pingEvent = {
        type: "ping",
        timestamp: Date.now(),
        mcp_ready: childReady
      };
      res.write("data: " + JSON.stringify(pingEvent) + "\n\n");
    }
  }, 30000);

  // Handle connection close
  req.on("close", () => {
    console.log("[sse] SSE connection closed");
    clearInterval(keepAlive);
  });

  req.on("error", (error) => {
    console.error("[sse] SSE connection error:", error.message);
    clearInterval(keepAlive);
  });
});

// Handle POST requests to /sse (n8n MCP Client sends these)
app.post("/sse", async (req, res) => {
  console.log("[sse] POST request - MCP JSON-RPC from:", req.ip);
  console.log("[sse] User-Agent:", req.get('User-Agent'));
  console.log("[sse] Request body:", JSON.stringify(req.body, null, 2));

  // This is the same logic as /message endpoint
  // Ensure we have a working MCP child
  if (!mcpChild || mcpChild.killed || !childReady) {
    console.log("[sse] MCP child not ready, restarting...");
    startMCPChild();
    
    // Wait for child to be ready
    return setTimeout(() => {
      if (!childReady) {
        return res.status(503).json({ 
          error: "MCP service unavailable", 
          message: "Child process not ready" 
        });
      }
    }, 3000);
  }

  try {
    // Prepare JSON-RPC message
    const message = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const messageWithNewline = message + "\n";
    
    console.log("[sse] Sending to MCP child:", messageWithNewline.trim());

    // Set up response handling with timeout
    let responseReceived = false;
    
    const responseTimeout = setTimeout(() => {
      if (!responseReceived) {
        console.error("[sse] MCP response timeout");
        res.status(504).json({ 
          error: "MCP timeout", 
          message: "No response from MCP child within 15 seconds" 
        });
        responseReceived = true;
      }
    }, 15000);

    // Listen for response from MCP child
    const onData = (data) => {
      if (responseReceived) return;
      
      clearTimeout(responseTimeout);
      responseReceived = true;
      
      const responseText = data.toString().trim();
      console.log("[sse] MCP raw response:", responseText);
      
      try {
        const response = JSON.parse(responseText);
        console.log("[sse] MCP parsed response:", JSON.stringify(response, null, 2));
        res.json(response);
      } catch (parseError) {
        console.error("[sse] Failed to parse MCP response:", parseError.message);
        console.error("[sse] Raw response was:", responseText);
        res.status(500).json({ 
          error: "Invalid MCP response", 
          message: parseError.message,
          raw_response: responseText
        });
      }
      
      // Remove this specific listener
      mcpChild.stdout.removeListener("data", onData);
    };

    // Add response listener
    mcpChild.stdout.on("data", onData);
    
    // Send message to MCP child
    mcpChild.stdin.write(messageWithNewline);

  } catch (error) {
    console.error("[sse] Error processing request:", error.message);
    res.status(500).json({ 
      error: "Internal server error", 
      message: error.message 
    });
  }
});

// Handle CORS preflight with n8n specific headers
app.options("*", (req, res) => {
  console.log("[cors] CORS preflight from:", req.ip);
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
  res.header("Access-Control-Max-Age", "86400");
  res.sendStatus(200);
});

// MCP message endpoint for JSON-RPC communication
app.post("/message", async (req, res) => {
  console.log("[message] Received request from:", req.ip);
  console.log("[message] Request body:", JSON.stringify(req.body, null, 2));

  // Ensure we have a working MCP child
  if (!mcpChild || mcpChild.killed || !childReady) {
    console.log("[message] MCP child not ready, restarting...");
    startMCPChild();
    
    // Wait for child to be ready
    return setTimeout(() => {
      if (!childReady) {
        return res.status(503).json({ 
          error: "MCP service unavailable", 
          message: "Child process not ready" 
        });
      }
    }, 3000);
  }

  try {
    // Prepare JSON-RPC message
    const message = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const messageWithNewline = message + "\n";
    
    console.log("[message] Sending to MCP child:", messageWithNewline.trim());

    // Set up response handling with timeout
    let responseReceived = false;
    
    const responseTimeout = setTimeout(() => {
      if (!responseReceived) {
        console.error("[message] MCP response timeout");
        res.status(504).json({ 
          error: "MCP timeout", 
          message: "No response from MCP child within 15 seconds" 
        });
        responseReceived = true;
      }
    }, 15000);

    // Listen for response from MCP child
    const onData = (data) => {
      if (responseReceived) return;
      
      clearTimeout(responseTimeout);
      responseReceived = true;
      
      const responseText = data.toString().trim();
      console.log("[message] MCP raw response:", responseText);
      
      try {
        const response = JSON.parse(responseText);
        console.log("[message] MCP parsed response:", JSON.stringify(response, null, 2));
        res.json(response);
      } catch (parseError) {
        console.error("[message] Failed to parse MCP response:", parseError.message);
        console.error("[message] Raw response was:", responseText);
        res.status(500).json({ 
          error: "Invalid MCP response", 
          message: parseError.message,
          raw_response: responseText
        });
      }
      
      // Remove this specific listener
      mcpChild.stdout.removeListener("data", onData);
    };

    // Add response listener
    mcpChild.stdout.on("data", onData);
    
    // Send message to MCP child
    mcpChild.stdin.write(messageWithNewline);

  } catch (error) {
    console.error("[message] Error processing request:", error.message);
    res.status(500).json({ 
      error: "Internal server error", 
      message: error.message 
    });
  }
});

// Catch all other routes
app.use("*", (req, res) => {
  console.log(`[server] 404 - ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: "Not found", 
    available_endpoints: ["/health", "/sse", "/message"] 
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("[server] Global error:", error.message);
  console.error("[server] Stack:", error.stack);
  
  if (!res.headersSent) {
    res.status(500).json({ 
      error: "Internal server error",
      message: error.message 
    });
  }
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`[server] Received ${signal}, shutting down gracefully`);
  
  if (mcpChild && !mcpChild.killed) {
    console.log("[server] Terminating MCP child process");
    mcpChild.kill(signal);
  }
  
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start HTTP server
const server = app.listen(PORT, HOST, () => {
  console.log(`[server] Custom MCP HTTP server listening on ${HOST}:${PORT}`);
  console.log(`[server] Health endpoint: http://${HOST}:${PORT}/health`);
  console.log(`[server] SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.log(`[server] Message endpoint: http://${HOST}:${PORT}/message`);
  console.log(`[server] Public URL: https://supabase-mcp-http.onrender.com`);
});

server.on("error", (error) => {
  console.error("[server] Server error:", error.message);
  process.exit(1);
});
