Vercel deployment structure

instagram-checker/
├── index.html
└── api/
    └── check.js

Upload both files to the same GitHub repository connected to Vercel.

Important:
- index.html calls /api/check?username=...
- api/check.js runs as a Vercel Function.
- No external CORS proxy is used.
- Instagram can rate-limit/block automated requests, so no third-party checker can guarantee every account at all times.
- The checker does not ask for an Instagram password/session cookie.
