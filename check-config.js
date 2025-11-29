#!/usr/bin/env node

// Quick script to check current configuration values
const { config } = require("./src/db");

console.log("\n📋 Current Configuration:\n");
const allConfig = config.getAll();

for (const [key, value] of Object.entries(allConfig)) {
  if (key === "jwt_secret") {
    console.log(`  ${key}: [HIDDEN]`);
  } else {
    console.log(`  ${key}: ${value}`);
  }
}

console.log("\n🔍 Blocking Configuration:");
console.log(`  block_by_default = "${config.get("block_by_default")}"`);
console.log(
  `  Is blocking enabled? ${
    config.get("block_by_default") === "true" ? "YES ✅" : "NO ❌"
  }`
);

console.log("\n🤝 Peer Approval Configuration:");
console.log(
  `  peer_approval_enabled = "${config.get("peer_approval_enabled")}"`
);
console.log(
  `  Is peer approval enabled? ${
    config.get("peer_approval_enabled") === "true" ? "YES ✅" : "NO ❌"
  }`
);
console.log(
  `  peer_approval_min_votes = "${config.get("peer_approval_min_votes")}"`
);

console.log("\n");
process.exit(0);
