
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const dbPath = path.join(__dirname, 'data', 'neotech.sqlite');

if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(async () => {
  db.run("DROP TABLE IF EXISTS users");
  db.run("DROP TABLE IF EXISTS products");
  db.run("DROP TABLE IF EXISTS categories");

  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT
  )`);

  db.run(`CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )`);

  db.run(`CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price INTEGER,
    category_id INTEGER,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`);

  // Insert admin
  const hash = await bcrypt.hash("admin123", 10);
  db.run("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", 
    ["admin@neotech.local", hash, "admin"]);

  // Insert categories
  db.run("INSERT INTO categories (name) VALUES ('Electronics')");
  db.run("INSERT INTO categories (name) VALUES ('Clothing')");

  // Insert products
  db.run("INSERT INTO products (name, price, category_id) VALUES ('Smartphone', 150000, 1)");
  db.run("INSERT INTO products (name, price, category_id) VALUES ('Laptop', 350000, 1)");
  db.run("INSERT INTO products (name, price, category_id) VALUES ('T-Shirt', 5000, 2)");
  db.run("INSERT INTO products (name, price, category_id) VALUES ('Jeans', 12000, 2)");

  console.log("Database seeded.");
});

db.close();
