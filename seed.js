
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./database.db');

function seed(){
    db.serialize(()=>{
        db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY,email TEXT,password TEXT,role TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY,name TEXT)");
        db.run("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY,name TEXT,category TEXT,price REAL)");
        // Seed admin
        const admin = JSON.parse(fs.readFileSync('./data/admin.json'));
        bcrypt.hash(admin.password,10,(err,hash)=>{
            db.run("INSERT OR IGNORE INTO users (email,password,role) VALUES (?,?,?)",[admin.email,hash,'admin']);
        });
        // Seed categories
        const categories = JSON.parse(fs.readFileSync('./data/categories.json'));
        categories.forEach(cat=>{ db.run("INSERT OR IGNORE INTO categories (name) VALUES (?)",[cat]); });
        // Seed products
        const products = JSON.parse(fs.readFileSync('./data/products.json'));
        products.forEach(p=>{
            db.run("INSERT OR IGNORE INTO products (name,category,price) VALUES (?,?,?)",[p.name,p.category,p.price]);
        });
        console.log("Seeding complete");
        db.close();
    });
}
seed();
