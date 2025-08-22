
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
