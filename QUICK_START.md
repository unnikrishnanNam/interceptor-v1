# Interceptor v1 - Quick Reference Guide

## 🚀 First Time Setup

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Start Application**

   ```bash
   npm start
   ```

3. **Follow Setup Wizard**

   - Enter proxy port (default: 5432)
   - Enter PostgreSQL host (default: localhost)
   - Enter PostgreSQL port (default: 5433)
   - Enter admin dashboard port (default: 3000)
   - Choose blocking policy (yes/no)
   - Create admin username and password

4. **Access Dashboard**
   - Open browser to `http://localhost:3000` (or your configured port)
   - Login with admin credentials

## 📋 Common Tasks

### Starting PostgreSQL (Docker)

```bash
npm run docker:up
```

### Connecting Your Application

Update your application's database connection string:

```
postgresql://user:password@localhost:5432/database?sslmode=disable
```

Note: Connect to **proxy port** (5432), not PostgreSQL port (5433)

### Adding a Peer User

1. Login as admin
2. Navigate to **Users** page
3. Click **Add User**
4. Enter username, password, and select role
5. Click **Create User**

### Approving/Rejecting Queries

1. Navigate to **Blocked Queries** page
2. Review pending query
3. Click **Approve** to execute or **Reject** to block

### Changing Configuration

1. Login as admin
2. Navigate to **Configuration** page
3. Update settings
4. Click **Save Configuration**
5. Restart proxy: `npm start`

### Viewing Audit Logs

1. Login as admin
2. Navigate to **Configuration** page (audit logs at bottom)
3. Or use API: `GET /api/audit`

## 🔑 Default Configuration

| Setting          | Default Value |
| ---------------- | ------------- |
| Proxy Port       | 5432          |
| PostgreSQL Host  | localhost     |
| PostgreSQL Port  | 5433          |
| Admin Port       | 3000          |
| Block by Default | yes           |

## 👥 User Roles

### Admin

- ✅ View logs and statistics
- ✅ Approve/reject queries
- ✅ Add/remove users
- ✅ Change configuration
- ✅ View audit logs

### Peer

- ✅ View logs and statistics
- ✅ Approve/reject queries
- ❌ Add/remove users
- ❌ Change configuration
- ❌ View audit logs

## 📁 File Locations

| File/Directory        | Purpose                  |
| --------------------- | ------------------------ |
| `data/interceptor.db` | SQLite database          |
| `src/`                | Source code              |
| `public/`             | Web dashboard files      |
| `package.json`        | Dependencies and scripts |

## 🛠️ npm Scripts

| Command               | Description                            |
| --------------------- | -------------------------------------- |
| `npm start`           | Start the proxy (runs setup if needed) |
| `npm run setup`       | Run setup wizard manually              |
| `npm run dev`         | Start with debugging enabled           |
| `npm run docker:up`   | Start PostgreSQL container             |
| `npm run docker:down` | Stop PostgreSQL container              |
| `npm run docker:logs` | View PostgreSQL logs                   |
| `npm run kill`        | Kill processes on ports                |

## 🔐 Security Best Practices

1. **Use Strong Passwords**: Minimum 8 characters with mix of letters, numbers, symbols
2. **Change Default Ports**: If exposed to network, use non-standard ports
3. **Regular Backups**: Backup `data/interceptor.db` regularly
4. **Monitor Audit Logs**: Review user actions periodically
5. **Limit Admin Access**: Only give admin role to trusted users
6. **Secure Network**: Don't expose proxy to public internet without firewall

## 🐛 Troubleshooting

### Port Already in Use

```bash
npm run kill
```

Or manually:

```bash
lsof -ti:3000 | xargs kill -9  # Kill admin port
lsof -ti:5432 | xargs kill -9  # Kill proxy port
```

### Reset Configuration

```bash
rm -rf data/interceptor.db
npm start
```

⚠️ This deletes all users, configuration, and audit logs!

### Can't Login

1. Reset database (see above)
2. Run setup wizard to create new admin
3. Or check browser console for errors

### Queries Not Being Blocked

1. Check **Configuration** page
2. Ensure "Block by Default" is set to "yes"
3. Restart proxy after changing settings

### Lost Admin Password

1. Stop proxy
2. Delete database: `rm data/interceptor.db`
3. Run setup wizard: `npm start`
4. Create new admin user

## 📊 Database Schema

### users

- `id`: Integer (Primary Key)
- `username`: Text (Unique)
- `password_hash`: Text
- `role`: Text (admin/peer)
- `created_at`: Integer (Unix timestamp)
- `last_login`: Integer (Unix timestamp)

### config

- `key`: Text (Primary Key)
- `value`: Text
- `updated_at`: Integer (Unix timestamp)

### audit_log

- `id`: Integer (Primary Key)
- `username`: Text
- `action`: Text
- `details`: Text (JSON)
- `ip_address`: Text
- `timestamp`: Integer (Unix timestamp)

### blocked_queries

- `id`: Integer (Primary Key)
- `conn_id`: Text
- `query_type`: Text (simple/extended)
- `query_preview`: Text
- `status`: Text (pending/approved/rejected)
- `created_at`: Integer (Unix timestamp)
- `resolved_at`: Integer (Unix timestamp)
- `resolved_by`: Text (username)

## 🌐 API Quick Reference

### Authentication

```bash
# Login
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"secret"}'

# Returns: {"token":"eyJhbGc...","user":{...}}
```

### Blocked Queries

```bash
# List blocked queries
curl http://localhost:3000/api/blocked \
  -H "Authorization: Bearer YOUR_TOKEN"

# Approve query
curl -X POST http://localhost:3000/api/approve \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":1}'

# Reject query
curl -X POST http://localhost:3000/api/reject \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":1}'
```

### Configuration (Admin Only)

```bash
# Get config
curl http://localhost:3000/api/config \
  -H "Authorization: Bearer YOUR_TOKEN"

# Update config
curl -X PUT http://localhost:3000/api/config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"block_by_default":"no"}'
```

### Users (Admin Only)

```bash
# List users
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create user
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"peer1","password":"secret","role":"peer"}'

# Delete user
curl -X DELETE http://localhost:3000/api/users/2 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📝 Tips & Tricks

1. **Monitor in Real-Time**: Keep dashboard open while testing queries
2. **Use Filtering**: Search logs by connection ID or query text
3. **Auto-Scroll**: Enable auto-scroll in logs page for live monitoring
4. **Keyboard Shortcuts**: Enter key submits login and forms
5. **Browser DevTools**: Use Network tab to debug API issues
6. **Database Inspection**: Use SQLite browser to inspect database
7. **Bulk Operations**: Approve multiple queries quickly in succession

## 🆘 Getting Help

1. Check this guide
2. Review README.md
3. Check CHANGELOG.md for recent changes
4. Inspect browser console for errors
5. Check terminal output for server errors
6. Review audit logs for action history

## 📚 Learn More

- **PostgreSQL Wire Protocol**: https://www.postgresql.org/docs/current/protocol.html
- **JWT**: https://jwt.io/introduction
- **bcrypt**: https://en.wikipedia.org/wiki/Bcrypt
- **SQLite**: https://www.sqlite.org/docs.html
