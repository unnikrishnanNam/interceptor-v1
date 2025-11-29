const { execSync } = require("child_process");

/**
 * Check if a port is in use
 */
function isPortInUse(port) {
  try {
    const result = execSync(`lsof -ti:${port}`, { encoding: "utf8" });
    return result.trim().length > 0;
  } catch (error) {
    // If lsof returns no results, it throws an error
    return false;
  }
}

/**
 * Kill process using a specific port
 */
function killProcessOnPort(port) {
  try {
    const pids = execSync(`lsof -ti:${port}`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((pid) => pid);

    if (pids.length === 0) {
      return false;
    }

    pids.forEach((pid) => {
      try {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      } catch (e) {
        // Process might already be dead
      }
    });

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Ensure ports are free, killing processes if necessary
 */
async function ensurePortsFree(ports, options = {}) {
  const { autoKill = true, verbose = true } = options;
  const portsToCheck = Array.isArray(ports) ? ports : [ports];
  const busyPorts = [];

  // Check which ports are in use
  for (const port of portsToCheck) {
    if (isPortInUse(port)) {
      busyPorts.push(port);
    }
  }

  if (busyPorts.length === 0) {
    return { success: true, message: "All ports are free" };
  }

  if (!autoKill) {
    return {
      success: false,
      busyPorts,
      message: `Ports in use: ${busyPorts.join(", ")}`,
    };
  }

  // Kill processes on busy ports
  if (verbose) {
    console.log(`\n⚠️  Found processes on ports: ${busyPorts.join(", ")}`);
    console.log("   Attempting to free ports...");
  }

  const freed = [];
  const failed = [];

  for (const port of busyPorts) {
    if (killProcessOnPort(port)) {
      freed.push(port);
      if (verbose) {
        console.log(`   ✓ Freed port ${port}`);
      }
    } else {
      failed.push(port);
      if (verbose) {
        console.log(`   ✗ Failed to free port ${port}`);
      }
    }
  }

  // Wait a moment for ports to be fully released
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (failed.length > 0) {
    return {
      success: false,
      freed,
      failed,
      message: `Failed to free ports: ${failed.join(", ")}`,
    };
  }

  if (verbose) {
    console.log("   ✓ All ports freed successfully\n");
  }

  return {
    success: true,
    freed,
    message: "All ports freed successfully",
  };
}

module.exports = {
  isPortInUse,
  killProcessOnPort,
  ensurePortsFree,
};
