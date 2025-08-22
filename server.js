
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'secret', resave: false, saveUninitialized: true }));

const db = new sqlite3.Database('./database.db');
// Ensure default admin exists
db.get("SELECT * FROM users WHERE email = ?", ["admin@neotech.local"], (err, row) => {
  if (!row) {
    const bcrypt = require("bcrypt");
    const hashedPassword = bcrypt.hashSync("admin123", 10);
    db.run("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", 
      ["admin@neotech.local", hashedPassword, "admin"]);
    console.log("✅ Default admin created: admin@neotech.local / admin123");
  }
});

// Middleware to check user login
app.use((req,res,next)=>{
    res.locals.user = req.session.user || null;
    next();
});

// Routes
app.get('/', (req,res)=>{
    db.all("SELECT * FROM products", (err, products)=>{
        res.render('index',{products});
    });
});

// Registration
app.get('/register',(req,res)=>res.render('register'));
app.post('/register',(req,res)=>{
    const {email,password} = req.body;
    bcrypt.hash(password,10,(err,hash)=>{
        db.run("INSERT INTO users (email,password,role) VALUES (?,?,?)",[email,hash,'user'],()=>{
            res.redirect('/login');
        });
    });
});

// Login
app.get('/login',(req,res)=>res.render('login'));
app.post('/login',(req,res)=>{
    const {email,password} = req.body;
    db.get("SELECT * FROM users WHERE email=?",[email],(err,user)=>{
        if(!user) return res.redirect('/login');
        bcrypt.compare(password,user.password,(err,result)=>{
            if(result){
                req.session.user={id:user.id,email:user.email,role:user.role};
                res.redirect('/');
            }else{
                res.redirect('/login');
            }
        });
    });
});

// Logout
app.get('/logout',(req,res)=>{
    req.session.destroy();
    res.redirect('/');
});

app.listen(process.env.PORT || 3000,()=>console.log('Server running'));

// Admin middleware
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.email === "admin@neotech.local") {
    return next();
  }
  res.redirect("/login");
}

// Admin dashboard
app.get("/admin", isAdmin, (req, res) => {
  db.all("SELECT * FROM products", [], (err, products) => {
    db.all("SELECT * FROM categories", [], (err, categories) => {
      res.render("admin", { products, categories, user: req.session.user });
    });
  });
});

// Add product
app.post("/admin/product/add", isAdmin, (req, res) => {
  const { name, price, category_id, description } = req.body;
  db.run("INSERT INTO products (name, price, category_id, description) VALUES (?, ?, ?, ?)",
    [name, price, category_id, description],
    () => res.redirect("/admin")
  );
});

// Edit product
app.post("/admin/product/edit/:id", isAdmin, (req, res) => {
  const { name, price, category_id, description } = req.body;
  db.run("UPDATE products SET name=?, price=?, category_id=?, description=? WHERE id=?",
    [name, price, category_id, description, req.params.id],
    () => res.redirect("/admin")
  );
});

// Delete product
app.get("/admin/product/delete/:id", isAdmin, (req, res) => {
  db.run("DELETE FROM products WHERE id=?", [req.params.id], () => res.redirect("/admin"));
});
// Add Category
app.post("/admin/category/add", isAdmin, (req, res) => {
  const { name } = req.body;
  db.run("INSERT INTO categories (name) VALUES (?)", [name], () => res.redirect("/admin"));
});

// Edit Category
app.post("/admin/category/edit/:id", isAdmin, (req, res) => {
  const { name } = req.body;
  db.run("UPDATE categories SET name=? WHERE id=?", [name, req.params.id], () => res.redirect("/admin"));
});

// Delete Category
app.get("/admin/category/delete/:id", isAdmin, (req, res) => {
  db.run("DELETE FROM categories WHERE id=?", [req.params.id], () => res.redirect("/admin"));
});

