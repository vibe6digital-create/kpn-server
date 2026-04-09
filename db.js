const Database = require('better-sqlite3');
const path = require('path');

// Glitch uses .data/, Render uses /tmp, local uses data/
const dataDir = process.env.PROJECT_DOMAIN
  ? path.join(__dirname, '.data')
  : process.env.RENDER
    ? '/tmp'
    : path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    mobile TEXT DEFAULT '',
    password_hash TEXT DEFAULT '',
    is_subscribed INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate existing table — make columns nullable if they were NOT NULL
try {
  // Check if password_hash is NOT NULL by trying an empty insert (will fail if NOT NULL)
  // Instead, just recreate if needed by altering defaults
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const passwordCol = tableInfo.find(c => c.name === 'password_hash');
  if (passwordCol && passwordCol.notnull === 1) {
    // SQLite doesn't support ALTER COLUMN, so we recreate the table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT DEFAULT '',
        mobile TEXT DEFAULT '',
        password_hash TEXT DEFAULT '',
        is_subscribed INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, name, email, mobile, password_hash, is_subscribed, created_at)
        SELECT id, name, COALESCE(email,''), COALESCE(mobile,''), COALESCE(password_hash,''), is_subscribed, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }
} catch (e) {
  // Table might not exist yet or migration already done — ignore
}

module.exports = db;
