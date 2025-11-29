const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { users, audit, config } = require("./db");

const SALT_ROUNDS = 10;

// Generate JWT secret if it doesn't exist
function getJWTSecret() {
  let secret = config.get("jwt_secret");
  if (!secret) {
    secret = crypto.randomBytes(64).toString("hex");
    config.set("jwt_secret", secret);
  }
  return secret;
}

// Hash password using bcrypt
async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

// Verify password against hash
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// Generate JWT token
function generateToken(user) {
  const secret = getJWTSecret();
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    secret,
    { expiresIn: "24h" }
  );
}

// Verify JWT token
function verifyToken(token) {
  try {
    const secret = getJWTSecret();
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
}

// Refresh token (issue a new one if still valid)
function refreshToken(token) {
  const decoded = verifyToken(token);
  if (!decoded) return null;

  const user = users.findById(decoded.id);
  if (!user) return null;

  return generateToken(user);
}

// Login function
async function login(username, password, ipAddress = null) {
  const user = users.findByUsername(username);

  if (!user) {
    audit.log(username, "login_failed", "User not found", ipAddress);
    return { success: false, message: "Invalid username or password" };
  }

  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    audit.log(username, "login_failed", "Invalid password", ipAddress);
    return { success: false, message: "Invalid username or password" };
  }

  // Update last login
  users.updateLastLogin(user.id);

  // Generate token
  const token = generateToken(user);

  audit.log(username, "login_success", null, ipAddress);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  };
}

// Logout function
function logout(username, ipAddress = null) {
  audit.log(username, "logout", null, ipAddress);
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  refreshToken,
  login,
  logout,
};
