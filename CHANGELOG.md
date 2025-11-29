# Changelog

All notable changes to the Interceptor v1 project will be documented in this file.

## [1.3.0] - 2025-11-29

### ✨ New Features

#### Peer Approval System

- **Multi-Peer Voting**: Queries can now require approval from multiple peers before execution
- **Configurable Threshold**: Set minimum vote count required for approval/rejection
- **Vote Tracking**: See who voted and current vote counts in real-time
- **Auto Resolution**: Queries automatically approved/rejected when threshold is met
- **Flexible Configuration**: Enable/disable peer approval system per deployment
- **Admin Override**: Admins can still directly approve/reject queries

**New Configuration Options:**

- `peer_approval_enabled` - Enable/disable peer approval system (true/false)
- `peer_approval_min_votes` - Minimum number of votes required (default: 1)

**New Database Tables:**

- `query_approvals` - Tracks individual peer votes with timestamps
- Enhanced `blocked_queries` - Now tracks approval/rejection counts

**New API Endpoints:**

- `POST /api/vote` - Submit a vote (approve/reject) for a query
- `GET /api/vote-status/:id` - Get voting status for a query

**UI Enhancements:**

- Peer users see vote buttons instead of direct approve/reject
- Real-time display of approval/rejection counts
- Shows which peers have voted
- Visual indicators for queries requiring peer approval
- Disabled vote buttons after voting (prevents double voting)

**How It Works:**

1. Admin enables peer approval in configuration and sets minimum votes (e.g., 3)
2. Blocked queries require votes from peers
3. Peers vote to approve or reject
4. When minimum votes threshold is met (e.g., 3 approvals OR 3 rejections), query is auto-executed or blocked
5. Admins can override and directly approve/reject at any time

### 📊 Technical Details

- Vote persistence in SQLite database
- Simple threshold: Minimum number of approvals OR rejections needed
- Audit trail for all voting actions
- Real-time vote status updates via existing SSE stream
- Prevents duplicate votes from same user

## [1.2.1] - 2025-11-29

### 🔧 Improvements

#### Automatic Port Cleanup

- **Auto Port Management**: Automatically detects and frees ports in use before starting
- **Port Cleanup Utility**: New `src/portCleanup.js` module for port management
- **Kill Ports Script**: Added `npm run kill` command to manually free ports
- **Startup Integration**: Ports are automatically checked and freed during startup
- **Better Error Handling**: Clear messages if port cleanup fails
- **Prevents EADDRINUSE Errors**: No more "address already in use" errors on startup

**New Commands:**

- `npm run kill` - Manually free admin and proxy ports
- `npm run start:clean` - Kill ports then start (explicit cleanup)

**Benefits:**

- No need to manually kill processes before starting
- Smoother development workflow
- Handles stale processes from previous crashes
- Works on macOS and Linux (uses lsof and kill)

### 🐛 Bug Fixes

- Fixed page reload resetting dashboard and live logs
- Fixed approve button background color issue
- Fixed auto-scroll not working in logs page
- Added export logs to CSV functionality
- Blocked users page access for peer users

---

## [1.2.0] - 2025-11-29

### 🎉 Major Features Added

#### Persistence & Database

- **SQLite Database Integration**: All application data is now persisted in `data/interceptor.db`
- **Database Schema**:
  - `users` table: User accounts with hashed passwords and roles
  - `config` table: Key-value configuration storage
  - `audit_log` table: Complete audit trail with timestamps and IP addresses
  - `blocked_queries` table: History of intercepted queries with approval status
- **Automatic Database Creation**: Database and tables created automatically on first run

#### Authentication & Security

- **JWT Authentication**: Secure token-based authentication with 24-hour expiration
- **Password Hashing**: bcrypt with 10 salt rounds for secure password storage
- **Role-Based Access Control**:
  - **Admin** role: Full access including user management and configuration
  - **Peer** role: Can view logs and approve/reject queries
- **Audit Logging**: All user actions tracked with:
  - Username
  - Action type
  - Timestamp
  - IP address
  - Detailed metadata

#### Configuration Management

- **Interactive Setup Wizard**: First-run CLI wizard for initial configuration
  - Proxy listening port (default: 5432)
  - PostgreSQL target host (default: localhost)
  - PostgreSQL target port (default: 5433)
  - Admin dashboard port (default: 3000)
  - Block-by-default policy (yes/no)
  - Admin user creation with password
- **Persistent Configuration**: All settings stored in database
- **Runtime Configuration Updates**: Change settings through web UI (requires restart)
- **Configuration API**: RESTful API for reading and updating configuration

#### User Management

- **User CRUD Operations**:
  - Create new users (admin only)
  - List all users with metadata
  - Delete users (admin only, cannot delete self)
  - Update passwords
- **User Metadata**:
  - Created date
  - Last login timestamp
  - Role assignment
- **User Management UI**: Modern web interface for managing users

### 🔧 API Endpoints

#### Public Endpoints

- `POST /api/login` - Authenticate and receive JWT token
- `POST /api/logout` - Logout and invalidate session
- `POST /api/refresh` - Refresh JWT token

#### Protected Endpoints (Requires Authentication)

- `GET /api/blocked` - List blocked queries
- `POST /api/approve` - Approve a blocked query
- `POST /api/reject` - Reject a blocked query
- `GET /api/config` - Get current configuration
- `GET /api/audit` - View audit logs (admin only)
- `GET /events` - SSE stream for real-time updates
- `POST /api/change-password` - Change current user's password

#### Admin-Only Endpoints

- `POST /api/users` - Create new user
- `GET /api/users` - List all users
- `DELETE /api/users/:id` - Delete user
- `PUT /api/config` - Update configuration

### 🎨 Frontend Updates

#### New Pages

- **Configuration Page**:
  - Edit proxy settings
  - Change blocking policy
  - View connection information
  - Real-time validation
- **User Management Page**:
  - Add new users
  - View user list with metadata
  - Delete users
  - Role management

#### Enhanced Features

- **Login Screen**: Modern authentication UI
- **Role-Based UI**: Features shown/hidden based on user role
- **Configuration Editor**: Live configuration updates with validation
- **User Profile Display**: Shows current user and role in sidebar

### 📦 New Modules

#### src/db.js

- SQLite database wrapper using `better-sqlite3`
- Configuration management functions
- User CRUD operations
- Audit logging functions
- Blocked queries persistence
- Automatic database initialization

#### src/auth.js

- Password hashing and verification (bcrypt)
- JWT token generation and verification
- Token refresh functionality
- Login/logout handlers
- Secure authentication flow

#### src/setup.js

- Interactive CLI wizard
- Password input masking
- Configuration validation
- Admin user creation
- First-run detection

### 🔒 Security Enhancements

- **JWT Secret**: Automatically generated 64-byte hex string
- **Password Requirements**: Minimum 4 characters (configurable)
- **Request Body Limits**: 1MB maximum to prevent DoS
- **SQL Injection Protection**: Parameterized queries throughout
- **Session Management**: Token-based with expiration
- **Audit Trail**: Complete history of all actions

### 📝 Documentation Updates

- **Enhanced README**:
  - Quick start guide
  - Setup wizard documentation
  - API endpoint reference
  - Security considerations
  - User role descriptions
- **New CHANGELOG**: This file!
- **Inline Documentation**: Comments and JSDoc throughout code

### 🐛 Bug Fixes

- Fixed potential race conditions in database initialization
- Improved error handling in authentication flow
- Fixed CSS styling for new form elements
- Corrected navigation handling for new pages

### ⚡ Performance

- **Indexed Database Queries**: Indexes on frequently queried columns
- **Connection Pooling**: Single database connection reused
- **WAL Mode**: SQLite Write-Ahead Logging for better concurrency

### 🔄 Breaking Changes

- **Environment Variables**: Now optional, configuration stored in database
- **First Run**: Requires interactive setup wizard on first run
- **Authentication Required**: All admin endpoints now require JWT token

### 📊 Dependencies Added

- `better-sqlite3`: ^12.4.6 - SQLite database
- `bcrypt`: ^6.0.0 - Password hashing
- `jsonwebtoken`: ^9.0.2 - JWT authentication

### 🔜 Future Enhancements

- [ ] Password strength requirements
- [ ] Session timeout configuration
- [ ] Multi-factor authentication
- [ ] Email notifications
- [ ] Query history and analytics
- [ ] Export audit logs to CSV
- [ ] Database backup and restore
- [ ] LDAP/SSO integration

---

## [1.1.0] - Previous Version

### Performance Optimizations

- Parser optimizations
- Buffer pooling
- Reduced allocations
- Frontend debouncing
- DocumentFragment batching

### Code Quality

- Removed dead code
- Streamlined error handling
- Improved TLS passthrough

---

## [1.0.0] - Initial Release

### Core Features

- PostgreSQL wire protocol proxy
- Real-time query interception
- Admin web portal
- Query blocking and approval
- SSE-based live logs
- Docker support
