IG BOOST — Vercel fix

GitHub repo:
  index.html
  api/check.js

The frontend calls:
  /api/check?username=...

The API tries the public Instagram profile page first and the web profile
endpoint second. Instagram can still rate-limit automated requests (429).
No third-party CORS proxy is used.

After committing to GitHub, Vercel should redeploy automatically.
