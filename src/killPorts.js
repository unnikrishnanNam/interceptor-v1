#!/usr/bin/env node

const { ensurePortsFree } = require("./portCleanup");
const { config } = require("./db");

async function killPorts() {
  console.log("\n🔧 Killing processes on Interceptor ports...\n");

  // Try to get ports from config, fallback to defaults
  let ports = [3000, 5432]; // defaults

  try {
    if (config.isConfigured()) {
      const adminPort = parseInt(config.get("admin_port") || "3000");
      const proxyPort = parseInt(config.get("proxy_port") || "5432");
      ports = [adminPort, proxyPort];
    }
  } catch (e) {
    console.log("   Using default ports (config not available)");
  }

  const result = await ensurePortsFree(ports, {
    autoKill: true,
    verbose: true,
  });

  if (result.success) {
    console.log("\n✅ All ports freed successfully!\n");
    process.exit(0);
  } else {
    console.error(`\n❌ Failed to free some ports: ${result.message}\n`);
    process.exit(1);
  }
}

killPorts();
