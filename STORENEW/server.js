require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const csrf = require('csurf');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// DB
const dbPath = path.join(__dirname, 'data', 'neotech.sqlite');
const db = new sqlite3.Database(dbPath);

// Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    image_url TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    status TEXT DEFAULT 'PENDING',
    total_cents INTEGER NOT NULL,
    paystack_reference TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    unit_price_cents INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    action TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

// View engine/static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Security & middleware
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "'unsafe-inline'", "https://js.paystack.co"],
      "frame-src": ["'self'", "https://checkout.paystack.co"],
      "img-src": ["'self'", "data:", "https:"],
      "connect-src": ["'self'", "https://api.paystack.co"]
    }
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const limiter = rateLimit({ windowMs: 60*1000, max: 200 });
app.use(limiter);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false }
}));
const csrfProtection = csrf();

function requireAuth(req,res,next){ if(!req.session.user) return res.redirect('/login'); next(); }
function requireAdmin(req,res,next){ if(!req.session.user || !req.session.user.is_admin) return res.status(403).send('Admin only'); next(); }

// Helpers
function recsByCategory(db, categoryId, excludeId, cb){
  db.all(`SELECT p.*, IFNULL(SUM(oi.quantity),0) as sold
          FROM products p
          LEFT JOIN order_items oi ON p.id=oi.product_id
          WHERE p.active=1 AND p.category_id=? AND p.id<>?
          GROUP BY p.id
          ORDER BY sold DESC, p.created_at DESC
          LIMIT 6`, [categoryId, excludeId], (e, rows)=> cb(rows||[]));
}

// Routes
app.get('/', (req,res)=>{
  db.all('SELECT * FROM categories ORDER BY name', (e,cats)=>{
    db.all('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY p.created_at DESC', (err, products)=>{
      res.render('index', { user:req.session.user, categories: cats||[], products: products||[] });
    });
  });
});

app.get('/product/:id', (req,res)=>{
  const id = Number(req.params.id);
  db.get('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?', [id], (err, product)=>{
    if(!product) return res.status(404).send('Not found');
    if(req.session.user){ db.run('INSERT INTO events (user_id,product_id,action) VALUES (?,?,?)',[req.session.user.id,id,'view']); }
    recsByCategory(db, product.category_id, id, (recs)=>{
      res.render('product', { user:req.session.user, product, recs });
    });
  });
});

app.get('/category/:id', (req,res)=>{
  const id = Number(req.params.id);
  db.get('SELECT * FROM categories WHERE id=?', [id], (e, cat)=>{
    if(!cat) return res.status(404).send('Not found');
    db.all('SELECT * FROM products WHERE active=1 AND category_id=? ORDER BY created_at DESC', [id], (err, products)=>{
      res.render('category', { user:req.session.user, category: cat, products });
    });
  });
});

// Auth
app.get('/register', csrfProtection, (req,res)=> res.render('register',{ csrfToken:req.csrfToken(), user:req.session.user }));
app.post('/register', csrfProtection, async (req,res)=>{
  const { name, email, password } = req.body;
  if(!email || !password) return res.status(400).send('Missing fields');
  const hashed = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (name,email,password,is_admin) VALUES (?,?,?,0)', [name||'',email,hashed], function(err){
    if(err) return res.status(400).render('register',{ csrfToken:req.csrfToken(), error:'Email already used', user:null });
    req.session.user = { id:this.lastID, email, name, is_admin:0 };
    res.redirect('/');
  });
});
app.get('/login', csrfProtection, (req,res)=> res.render('login',{ csrfToken:req.csrfToken(), user:req.session.user }));
app.post('/login', csrfProtection, (req,res)=>{
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email=?', [email], async (err, user)=>{
    if(!user) return res.status(401).render('login',{ csrfToken:req.csrfToken(), error:'Invalid credentials', user:null });
    const ok = await bcrypt.compare(password, user.password);
    if(!ok) return res.status(401).render('login',{ csrfToken:req.csrfToken(), error:'Invalid credentials', user:null });
    req.session.user = { id:user.id, email:user.email, name:user.name, is_admin:!!user.is_admin };
    res.redirect('/');
  });
});
app.post('/logout', (req,res)=>{ req.session.destroy(()=>res.redirect('/')); });

// Cart
function getCart(req){ return req.session.cart || {}; }
function setCart(req,cart){ req.session.cart = cart; }

app.post('/cart/add', (req,res)=>{
  const { productId } = req.body;
  const cart = getCart(req);
  cart[productId] = (cart[productId]||0)+1;
  setCart(req,cart);
  res.json({ ok:true, cart });
});
app.get('/cart', (req,res)=>{
  const cart = getCart(req);
  const ids = Object.keys(cart).map(Number);
  if(ids.length===0) return res.render('cart', { user:req.session.user, items:[], total:0 });
  const placeholders = ids.map(()=>'?').join(',');
  db.all(`SELECT * FROM products WHERE id IN (${placeholders})`, ids, (err, rows)=>{
    const items = rows.map(p=>({ product:p, quantity: cart[p.id], lineTotal: cart[p.id]*p.price_cents }));
    const total = items.reduce((s,i)=>s+i.lineTotal,0);
    res.render('cart', { user:req.session.user, items, total });
  });
});

// Checkout with Paystack
app.post('/checkout', requireAuth, (req,res)=>{
  const cart = getCart(req);
  const ids = Object.keys(cart).map(Number);
  if(!ids.length) return res.redirect('/cart');
  const placeholders = ids.map(()=>'?').join(',');
  db.all(`SELECT * FROM products WHERE id IN (${placeholders})`, ids, (err, rows)=>{
    const items = rows.map(p=>({ product_id:p.id, quantity: cart[p.id], unit_price_cents: p.price_cents }));
    const total = items.reduce((s,i)=>s+i.quantity*i.unit_price_cents,0);
    db.run('INSERT INTO orders (user_id,status,total_cents) VALUES (?,?,?)', [req.session.user.id,'PENDING', total], function(err2){
      if(err2) return res.status(500).send('Order error');
      const orderId = this.lastID;
      const stmt = db.prepare('INSERT INTO order_items (order_id,product_id,quantity,unit_price_cents) VALUES (?,?,?,?)');
      items.forEach(i=> stmt.run([orderId,i.product_id,i.quantity,i.unit_price_cents]));
      stmt.finalize();
      const reference = 'neotech-' + Date.now() + '-' + Math.floor(Math.random()*10000);
      fetch('https://api.paystack.co/transaction/initialize', {
        method:'POST',
        headers:{ 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type':'application/json' },
        body: JSON.stringify({ email: req.session.user.email, amount: total, reference, callback_url: `${BASE_URL}/paystack/callback?order=${orderId}` })
      }).then(r=>r.json()).then(data=>{
        if(data.status && data.data && data.data.authorization_url){
          db.run('UPDATE orders SET paystack_reference=? WHERE id=?', [reference, orderId], ()=>{
            setCart(req, {});
            res.redirect(data.data.authorization_url);
          });
        } else {
          res.status(500).send('Paystack init failed');
        }
      }).catch(e=>res.status(500).send('Paystack error: '+e.message));
    });
  });
});

app.get('/paystack/callback', (req,res)=>{
  const { reference, order } = req.query;
  if(!reference || !order) return res.status(400).send('Missing params');
  fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers:{ 'Authorization': 'Bearer ' + PAYSTACK_SECRET }
  }).then(r=>r.json()).then(data=>{
    if(data.status && data.data && (data.data.status==='success' || data.data.gateway_response==='Successful')){
      db.run('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', ['PAID', order], ()=> res.redirect(`/success?order=${order}`) );
    } else {
      res.redirect('/cart');
    }
  }).catch(e=>res.status(500).send('Verify error: '+e.message));
});

app.get('/success', (req,res)=>{
  const orderId = Number(req.query.order);
  res.render('success', { user:req.session.user, orderId });
});

// Admin
app.get('/admin', requireAdmin, (req,res)=> res.render('admin', { user:req.session.user }));
app.get('/admin/products', requireAdmin, (req,res)=>{
  db.all('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.created_at DESC', (err, products)=>{
    db.all('SELECT * FROM categories ORDER BY name', (e, cats)=> res.render('admin_products', { user:req.session.user, products, categories: cats||[] }));
  });
});
app.post('/admin/products/new', requireAdmin, (req,res)=>{
  const { name, description, price_cents, image_url, active, category_id } = req.body;
  db.run('INSERT INTO products (category_id,name,description,price_cents,image_url,active) VALUES (?,?,?,?,?,?)',
    [category_id||null, name, description, Number(price_cents), image_url||null, active?1:0],
    ()=> res.redirect('/admin/products'));
});
app.post('/admin/products/:id/delete', requireAdmin, (req,res)=>{
  db.run('DELETE FROM products WHERE id=?', [req.params.id], ()=> res.redirect('/admin/products'));
});

app.get('/admin/categories', requireAdmin, (req,res)=>{
  db.all('SELECT * FROM categories ORDER BY name', (e, cats)=> res.render('admin_categories', { user:req.session.user, categories: cats||[] }));
});
app.post('/admin/categories/new', requireAdmin, (req,res)=>{
  const { name } = req.body;
  db.run('INSERT INTO categories (name) VALUES (?)', [name], ()=> res.redirect('/admin/categories'));
});
app.post('/admin/categories/:id/delete', requireAdmin, (req,res)=>{
  db.run('DELETE FROM categories WHERE id=?', [req.params.id], ()=> res.redirect('/admin/categories'));
});

app.get('/admin/orders', requireAdmin, (req,res)=>{
  db.all('SELECT o.*, u.email as user_email FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC', (e, orders)=>{
    res.render('admin_orders', { user:req.session.user, orders: orders||[] });
  });
});
app.post('/admin/orders/:id/status', requireAdmin, (req,res)=>{
  const { id } = req.params;
  const { status } = req.body;
  db.run('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, id], ()=> res.redirect('/admin/orders'));
});

// Account
app.get('/account', requireAuth, (req,res)=>{
  db.all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC', [req.session.user.id], (e, orders)=>{
    res.render('account', { user:req.session.user, orders: orders||[] });
  });
});

// 404
app.use((req,res)=> res.status(404).send('Not found'));

app.listen(PORT, ()=> console.log('NeoTech Store running on ' + BASE_URL) );
