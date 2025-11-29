const readline = require("readline");
const { users, config, audit } = require("./db");
const { hashPassword } = require("./auth");

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify question
function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Hidden password input
function questionHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(prompt);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";
    const listener = (char) => {
      if (char === "\n" || char === "\r" || char === "\u0004") {
        // Enter or Ctrl+D
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", listener);
        stdout.write("\n");
        resolve(password);
      } else if (char === "\u0003") {
        // Ctrl+C
        process.exit();
      } else if (char === "\u007f" || char === "\b") {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write("\b \b");
        }
      } else {
        password += char;
        stdout.write("*");
      }
    };

    stdin.on("data", listener);
  });
}

// Main setup function
async function setup() {
  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   🚀 Interceptor-v1 Initial Setup Wizard   ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  try {
    // Step 1: Proxy Configuration
    console.log("📡 Proxy Configuration\n");
    console.log(
      "   The proxy intercepts connections between your app and PostgreSQL."
    );
    console.log(
      "   Your app will connect to the proxy port, and the proxy forwards"
    );
    console.log("   to the actual PostgreSQL server.\n");

    const proxyPort = await question(
      "   Proxy listening port [default: 5432]: "
    );
    const targetHost = await question(
      "   PostgreSQL target host [default: localhost]: "
    );
    const targetPort = await question(
      "   PostgreSQL target port [default: 5433]: "
    );

    // Step 2: Admin Server Configuration
    console.log("\n🌐 Admin Dashboard Configuration\n");
    const adminPort = await question(
      "   Admin dashboard port [default: 3000]: "
    );

    // Step 3: Query Blocking
    console.log("\n🛡️  Query Blocking Policy\n");
    console.log(
      "   Should queries be blocked by default for approval? (yes/no)"
    );
    console.log("   - yes: All queries require approval before execution");
    console.log("   - no: Queries pass through (monitoring only)\n");
    const blockByDefault = await question(
      "   Block by default? [default: yes]: "
    );

    // Step 3.5: Peer Approval System
    console.log("\n🤝 Peer Approval System\n");
    console.log("   Enable peer approval system? (yes/no)");
    console.log("   - yes: Queries require votes from multiple peers");
    console.log("   - no: Admin can directly approve/reject\n");
    const peerApprovalEnabled = await question(
      "   Enable peer approval? [default: no]: "
    );

    let minVotes = "1";

    if (peerApprovalEnabled.toLowerCase() === "yes") {
      console.log("\n   Configure approval threshold:\n");
      minVotes = await question(
        "   Minimum number of votes required to approve/reject [default: 1]: "
      );
    }

    // Step 4: Admin User Creation
    console.log("\n👤 Create Admin User\n");
    console.log("   This user will have full access to the dashboard.\n");

    let adminUsername = "";
    while (!adminUsername || adminUsername.trim().length === 0) {
      adminUsername = await question("   Admin username: ");
      if (!adminUsername || adminUsername.trim().length === 0) {
        console.log("   ⚠️  Username cannot be empty!");
      }
    }

    let adminPassword = "";
    let confirmPassword = "";
    while (true) {
      adminPassword = await questionHidden("   Admin password: ");
      if (!adminPassword || adminPassword.length < 4) {
        console.log("   ⚠️  Password must be at least 4 characters!");
        continue;
      }
      confirmPassword = await questionHidden("   Confirm password: ");
      if (adminPassword !== confirmPassword) {
        console.log("   ⚠️  Passwords don't match! Try again.\n");
        continue;
      }
      break;
    }

    // Step 5: Save Configuration
    console.log("\n💾 Saving configuration...\n");

    config.set("proxy_port", proxyPort || "5432");
    config.set("target_host", targetHost || "localhost");
    config.set("target_port", targetPort || "5433");
    config.set("admin_port", adminPort || "3000");
    config.set(
      "block_by_default",
      blockByDefault.toLowerCase() === "no" ? "false" : "true"
    );
    config.set(
      "peer_approval_enabled",
      peerApprovalEnabled.toLowerCase() === "yes" ? "true" : "false"
    );
    config.set("peer_approval_min_votes", minVotes || "1");
    config.set("setup_complete", "true");

    // Create admin user
    const passwordHash = await hashPassword(adminPassword);
    const userId = users.create(adminUsername.trim(), passwordHash, "admin");

    audit.log(adminUsername, "setup_completed", "Initial setup", "localhost");

    console.log("✅ Setup complete!\n");
    console.log("Configuration saved:");
    console.log(
      `   • Proxy: 0.0.0.0:${proxyPort || "5432"} → ${
        targetHost || "localhost"
      }:${targetPort || "5433"}`
    );
    console.log(
      `   • Admin Dashboard: http://localhost:${adminPort || "3000"}`
    );
    console.log(
      `   • Block by default: ${
        blockByDefault.toLowerCase() === "no" ? "NO" : "YES"
      }`
    );
    console.log(`   • Admin user: ${adminUsername} (ID: ${userId})\n`);

    console.log("🎉 You can now start the proxy with: npm start\n");
  } catch (err) {
    console.error("\n❌ Setup failed:", err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run setup if called directly
if (require.main === module) {
  setup().then(() => process.exit(0));
}

module.exports = { setup };
