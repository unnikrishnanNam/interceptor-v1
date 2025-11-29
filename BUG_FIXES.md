# Bug Fixes - November 29, 2025

## Issues Fixed

### 1. ✅ Page Reload Resets Dashboard and Live Logs

**Problem:** When the page was refreshed, the dashboard would lose all statistics, logs, and connections even though the user was still authenticated.

**Solution:**

- Modified `showDashboard()` function to initialize the app when showing the dashboard
- Added `window.appInitialized` flag to prevent multiple initializations
- Changed the initial authentication check to call `showDashboard()` instead of `initializeApp()` directly
- This ensures that on page reload, the authenticated user sees the dashboard AND the app initializes properly

**Files Changed:**

- `public/main.js` - Modified `showDashboard()` and initialization logic

---

### 2. ✅ Approve Button Background Color Issue

**Problem:** The approve button had incorrect background color due to CSS conflicts.

**Solution:**

- Removed duplicate/conflicting CSS rule for `.btn-approve` that was setting `background: var(--good)` and `color: #0b1020`
- The correct rule already exists at line 637-642 with `background: var(--accent-green)` and `color: white`
- This ensures the approve button displays with the proper green color

**Files Changed:**

- `public/styles.css` - Removed conflicting `.btn-approve` rule at line 1031-1034

---

### 3. ✅ Auto-Scroll Not Working

**Problem:** The auto-scroll feature in the logs page was not working properly.

**Solution:**

- Changed from using `div.scrollIntoView()` to scrolling the table container directly
- Modified `renderRow()` to use `table.scrollTop = table.scrollHeight`
- Added `setTimeout` to ensure DOM is updated before scrolling
- Added null check for `autoScroll` element before accessing its `checked` property

**Files Changed:**

- `public/main.js` - Modified `renderRow()` function auto-scroll logic

---

### 4. ✅ Added Export Logs Functionality

**Problem:** No way to export logs for analysis or record-keeping.

**Solution:**

- Added new `exportLogs()` function that exports filtered logs to CSV format
- Creates CSV with columns: Timestamp, Direction, Connection, Message
- Properly escapes quotes in messages
- Downloads file with name format: `interceptor-logs-YYYY-MM-DD.csv`
- Added "Export" button with download icon to the logs page header
- Only exports logs that match current filters (respects search and level filter)
- Shows alert if no logs to export

**Files Changed:**

- `public/main.js` - Added `exportLogs()` function and button listener
- `public/index.html` - Added Export button to logs page controls
- `public/styles.css` - Added button styling for header controls

**Features:**

- CSV format compatible with Excel and other tools
- Respects current filters (only exports visible logs)
- Automatic filename with current date
- Handles special characters and quotes properly

---

### 5. ✅ Users Page Access Control for Peers

**Problem:** Peer users could access the Users page even though they shouldn't have permission.

**Solution:**

- Added access control check in navigation handler
- When a peer tries to access the Users page:
  - Shows alert: "Access Denied: Only administrators can access user management."
  - Automatically redirects back to home page
  - Prevents navigation from completing
- The Users navigation item is already hidden for peers in the sidebar, but this adds an extra security layer

**Files Changed:**

- `public/main.js` - Added role check in navigation click handler

---

## Testing

All fixes have been tested and verified:

1. ✅ Page reload now maintains dashboard state
2. ✅ Approve button shows correct green background
3. ✅ Auto-scroll works smoothly in logs page
4. ✅ Export logs creates CSV file with proper formatting
5. ✅ Peers cannot access Users page even if they try

## Additional Improvements

- Added flexbox styling for header control buttons to ensure proper alignment
- Added SVG icon to Export button for better UX
- Improved button spacing in header controls
- Added proper null checks for safer code execution

## Security

- User role is checked on client-side for UX (shows alert)
- Server-side authentication still enforces all API restrictions
- Export only exports logs the user has already seen (no additional data exposure)

## No Breaking Changes

All fixes are backwards compatible and don't affect existing functionality.
