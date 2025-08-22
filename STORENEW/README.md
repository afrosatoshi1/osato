# NeoTech Store — Render-Ready (Paystack + Admin + Accounts)

## Deploy on Render
1) Push this folder to a GitHub repo (root contains package.json).
2) On Render: New → Web Service → select the repo.
3) Environment Variables:
   - SESSION_SECRET = (any long random string)
   - PAYSTACK_SECRET_KEY = (from Paystack)
   - PAYSTACK_PUBLIC_KEY = (from Paystack)
   - BASE_URL = (your Render URL e.g. https://your-app.onrender.com)
4) After first deploy, open Render Shell and run:
   ```
   npm run seed
   ```
   Admin login: **admin@neotech.local** / **admin123**

## Local Dev
```
cp .env.example .env
npm i
npm run seed
npm start
```
Open http://localhost:3000
