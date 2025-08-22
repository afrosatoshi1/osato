const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'neotech.sqlite');
const db = new sqlite3.Database(dbPath);

function readJSON(file){ return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8')); }

db.serialize(async () => {
  const admin = readJSON('admin.json');
  const categories = readJSON('categories.json');
  const products = readJSON('products.json');

  // Ensure tables (mirrors app)
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, is_admin INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, name TEXT, description TEXT, price_cents INTEGER, image_url TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, status TEXT DEFAULT 'PENDING', total_cents INTEGER NOT NULL, paystack_reference TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, product_id INTEGER, quantity INTEGER, unit_price_cents INTEGER)`);

  // Seed admin
  const hashed = await bcrypt.hash(admin.password, 10);
  db.run('INSERT OR IGNORE INTO users (id,name,email,password,is_admin) VALUES (1,?,?,?,1)',
    ['Admin', admin.email, hashed]);

  // Seed categories
  const catStmt = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  categories.forEach(c => catStmt.run([c.name]));
  catStmt.finalize();

  // Get category IDs
  db.all('SELECT * FROM categories', (e, rows)=>{
    const catMap = {}; rows.forEach(r=> catMap[r.name]=r.id);
    const pStmt = db.prepare('INSERT OR IGNORE INTO products (category_id,name,description,price_cents,image_url,active) VALUES (?,?,?,?,?,1)');
    products.forEach(p=> pStmt.run([catMap[p.category]||null, p.name, p.description, p.price_cents, p.image_url||null]));
    pStmt.finalize();
    console.log('Seed complete. Admin:', admin.email);
    db.close();
  });
});
