# Interceptor v1 — PostgreSQL Wire Protocol Proxy

A high-performance PostgreSQL wire-protocol proxy that intercepts and logs messages flowing between client and server. Features real-time query blocking with an admin approval workflow, user authentication, and persistent storage using SQLite.

## Features

- ✅ **Zero-copy forwarding** — Forwards bytes unmodified (no TLS termination)
- 🔍 **Protocol parsing** — Startup/Authentication, Extended Query protocol (Parse/Bind/Execute), Simple Query
- 🚫 **Query blocking** — Intercept queries for manual approval/rejection before execution
- 📊 **Real-time admin UI** — Modern web portal with SSE-based live logs
- 🔐 **Authentication & Authorization** — JWT-based authentication with admin/peer roles
- 💾 **Persistent Storage** — SQLite database for users, config, audit logs, and blocked queries
- ⚙️ **Interactive Setup** — CLI wizard for initial configuration
- 👥 **User Management** — Admin can add/remove peer users
- 🔧 **Dynamic Configuration** — Change proxy settings without editing code
- ⚡ **Performance optimizations** — Buffer pooling, reduced allocations, optimized parsing

## New in v1.2.0

### Persistence & Database

- **SQLite Database**: All configuration, users, audit logs, and blocked queries are persisted
- **Database Schema**: Tables for users, config, audit_log, and blocked_queries
- **Automatic Backups**: Database stored in `data/interceptor.db`

### Authentication & Security

- **JWT Authentication**: Secure token-based authentication with 24-hour expiration
- **Password Hashing**: bcrypt with salt rounds for secure password storage
- **Role-Based Access**: Admin and Peer roles with different permissions
- **Audit Logging**: All user actions tracked with IP addresses and timestamps

### Configuration Management

- **Interactive Setup**: First-run wizard for initial configuration
  - Proxy port (default: 5432)
  - PostgreSQL target (default: localhost:5433)
  - Admin dashboard port (default: 3000)
  - Block-by-default policy
  - Admin user creation
- **Persistent Config**: All settings stored in database
- **Runtime Updates**: Change configuration through web UI (requires restart)

### Critical Command Detection

- Classifies queries using configurable keyword lists
- Defaults:
  - Critical: `DROP, ALTER, TRUNCATE, DELETE, GRANT, REVOKE, CREATE EXTENSION`
  - Allowed: `SELECT, INSERT, UPDATE, CREATE TABLE`
- Behavior:
  - Critical → blocked and requires approval
  - Allowed → forwarded directly
  - Others → follow block-by-default policy

## How SSL/TLS affects logging

- Clients typically begin with an SSLRequest. The server replies with a single byte: `S` (accept TLS) or `N` (deny).
- If TLS is accepted, all subsequent traffic is encrypted. Since this proxy doesn’t terminate TLS, it cannot parse or log those messages.
- To see full message logs, connect with SSL disabled (e.g., `sslmode=disable`) or implement TLS termination in the proxy (advanced).

## Prerequisites

- Node.js 16+
- Docker (optional; repo includes a `docker-compose.yml` for Postgres)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Initial Setup

On first run, the application will launch an interactive setup wizard:

```bash
npm start
```

You'll be prompted to configure:

- **Proxy listening port** (default: 5432) - Where your application connects
- **PostgreSQL target host** (default: localhost)
- **PostgreSQL target port** (default: 5433) - Where your actual PostgreSQL runs
- **Admin dashboard port** (default: 3000)
- **Block-by-default policy** (yes/no) - Whether to require approval for all queries
- **Admin credentials** - Username and password for the admin user

### 3. Start PostgreSQL

If you don't have a PostgreSQL instance running, use the included Docker setup:

```bash
npm run docker:up
```

This starts PostgreSQL on port `5433` with:

- Database: `testdb`
- User: `testuser`
- Password: `testpass@123`

### 4. Access the Admin Dashboard

Open your browser to the admin port you configured (default: http://localhost:3000)

Login with the admin credentials you created during setup.

## Admin Dashboard Features

### 🏠 Dashboard

- Real-time statistics (active connections, queries, blocked queries, errors)
- Recent activity feed
- Connection monitoring

### 📝 Logs

- Real-time query logs with SSE streaming
- Filter by level (client, server, connection, error)
- Search functionality
- Auto-scroll option

### 🚫 Blocked Queries

- View all pending blocked queries
- Approve or reject queries individually
- Track who approved/rejected each query

### ⚙️ Configuration (Admin Only)

- Update proxy settings
- Change blocking policy
- Modify connection parameters
- Note: Changes require proxy restart

### 👥 Users (Admin Only)

- Add new peer users
- Delete users
- View user activity (created date, last login)
- Manage roles (Admin/Peer)

## User Roles

- **Admin**: Full access to all features including user management and configuration
- **Peer**: Can view logs, approve/reject queries, but cannot manage users or change configuration

## Usage

### Connecting Your Application

Once the proxy is running, configure your application to connect to the proxy port (default: 5432) instead of directly to PostgreSQL:

- **With psql** (plaintext for full logs):

  ```bash
  psql "postgresql://testuser:testpass%40123@127.0.0.1:5432/testdb?sslmode=disable"
  ```

- **With DataGrip**:

  - Host: `127.0.0.1`, Port: `5432` (proxy port)
  - SSL Mode: `disable` (or set `sslmode=disable` in Advanced)

- **Connection String**:
  ```
  postgresql://user:password@localhost:5432/database?sslmode=disable
  ```

### Query Blocking Workflow

When block-by-default is enabled:

1. Application sends a query to the proxy (port 5432)
2. Query is intercepted and stored as "pending"
3. Query appears in the admin dashboard under "Blocked Queries"
4. Admin/Peer user can:
   - **Approve**: Query is forwarded to PostgreSQL and executed
   - **Reject**: Query is blocked and client receives an error
5. All approvals/rejections are logged in the audit trail

### Managing Configuration

To change configuration after initial setup:

1. Login to admin dashboard
2. Navigate to **Configuration** page (admin only)
3. Update settings as needed
4. Click **Save Configuration**
5. Restart the proxy: `npm start`

### Adding Users

Admins can add peer users:

1. Navigate to **Users** page
2. Click **Add User**
3. Enter username, password, and select role
4. New user can immediately login

### Re-running Setup

To reset configuration and run setup again:

```bash
# Delete the database file
rm -rf data/interceptor.db

# Run the application
npm start
```

## Development

```bash
# Start proxy (with setup wizard if needed)
# Automatically frees ports if they're in use
npm start

# Start with manual port cleanup first (optional)
npm run start:clean

# Run setup wizard explicitly
npm run setup

# Start with debugging
npm run dev

# Docker management
npm run docker:up      # Start Postgres container
npm run docker:down    # Stop and remove containers
npm run docker:logs    # View Postgres logs

# Kill processes on ports manually (if needed)
npm run kill
```

## Port Management

The proxy automatically detects and frees ports that are in use before starting. If you encounter port conflicts:

1. **Automatic cleanup**: The proxy will attempt to kill processes on required ports automatically
2. **Manual cleanup**: Run `npm run kill` to manually free ports
3. **Alternative**: Use `npm run start:clean` to ensure ports are freed before starting

### Troubleshooting Port Issues

If you see "address already in use" errors:

```bash
# Check which processes are using ports
lsof -ti:3000  # Admin port
lsof -ti:5432  # Proxy port

# Kill specific port
npm run kill

# Or kill specific process manually
kill -9 <PID>
```

The proxy checks and frees these ports on startup:

- Admin dashboard port (default: 3000)
- Proxy listening port (default: 5432)

## Database Schema

The SQLite database (`data/interceptor.db`) contains:

- **users**: User accounts with hashed passwords and roles
- **config**: Key-value configuration storage
- **audit_log**: All user actions with timestamps and IP addresses
- **blocked_queries**: History of intercepted queries with approval status

## API Endpoints

### Public

- `POST /api/login` - Authenticate and receive JWT token
- `POST /api/logout` - Logout and invalidate session

### Protected (requires JWT token)

- `GET /api/blocked` - List blocked queries
- `POST /api/approve` - Approve a blocked query
- `POST /api/reject` - Reject a blocked query
- `GET /api/config` - Get configuration
- `GET /events` - SSE stream for real-time updates

### Admin Only

- `POST /api/users` - Create new user
- `DELETE /api/users/:id` - Delete user
- `GET /api/users` - List all users
- `PUT /api/config` - Update configuration
- `GET /api/audit` - View audit logs

## Security Considerations

- **JWT Secret**: Automatically generated and stored in database
- **Password Storage**: bcrypt with 10 salt rounds
- **Token Expiration**: 24 hours
- **Audit Trail**: All actions logged with user and IP
- **Role-Based Access**: Admins have elevated privileges
- **Request Body Limits**: 1MB max to prevent DoS

## Performance Tips

- For **high-throughput scenarios**, consider:

  - Reducing console logging (comment out `debugLog` calls in production)
  - Increasing Node.js memory limit: `node --max-old-space-size=4096 src/index.js`
  - Using `NODE_ENV=production` to disable verbose logging

- **Memory usage**: The proxy maintains in-memory logs and blocked queries. For long-running sessions, implement periodic cleanup or log rotation.

## Advanced: TLS termination (not implemented)

To log messages when TLS is required, you’d need to accept TLS from the client using a certificate the client trusts (e.g., a custom CA), then proxy to Postgres (TLS or plaintext) and parse frames in the middle. That requires managing keys/certs and is outside this minimal proxy’s scope.
