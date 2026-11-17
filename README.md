# ReClaim It — Campus Lost & Found

This full-stack project uses React + TypeScript + Vite, Node.js + Express, SQLite (`better-sqlite3`), Firebase Authentication for Google sign-in, and Google Gemini for optional AI features. It is not a Django/MySQL build.

## Requirements
- Windows 10/11
- Node.js 20.19+ (Node.js 22 LTS recommended) and npm

Check versions in PowerShell: `node -v` and `npm -v`.

## Run on Windows
1. Extract the ZIP to a folder, for example `C:\Users\YourName\Downloads\reclaim-it`.
2. Open that folder in VS Code and choose Terminal → New Terminal.
3. Install packages (first time only):

   ```powershell
   npm install
   ```

4. Create the environment file in the same folder as `package.json`:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Open `.env`. Add your own Gemini API key for AI image analysis and AI chat:

   ```env
   GEMINI_API_KEY=your_real_gemini_api_key
   ```

   The website can start without the key, but Gemini features need it. Keep `.env` private and never upload it to GitHub. `APP_URL` is only needed for hosted deployment.

6. Start the full-stack app:

   ```powershell
   npm run dev
   ```

7. Open **http://localhost:3000** in Chrome or Edge.
8. Check the backend at **http://localhost:3000/api/health**. It should return JSON with `"ok": true`.
9. Stop the server with **Ctrl + C** in the terminal.

## Useful commands

```powershell
npm run dev      # Start frontend and backend together
npm run lint     # TypeScript checks
npm run build    # Build frontend assets
npm start        # Start server with tsx
```

Production-style local test after building:

```powershell
npm run build
$env:NODE_ENV="production"
npm start
```

Then open `http://localhost:3000`.

## Configuration and limitations
- Google sign-in requires the Google provider enabled in Firebase Authentication and your local/hosted domain listed under Firebase authorized domains.
- Gemini AI requires a valid `GEMINI_API_KEY` in `.env`.
- The current demo OTP is displayed in the interface; OTP emails are not actually sent. Connect an email/SMS provider and remove the OTP preview before public production use.
- Demo access and seeded demonstration accounts are for local testing only. Disable demo access and replace seeded credentials before public deployment.
- The current database is SQLite, not MySQL. The server initializes its database and uploads directory when it starts.

## Troubleshooting
- `npm is not recognized`: install Node.js LTS, reopen VS Code, then check `node -v` and `npm -v`.
- Missing package / `Cannot find module`: run `npm install` from the folder containing `package.json`.
- Port 3000 already in use: stop the other server with Ctrl+C, or run `$env:PORT=3001; npm run dev` and open `http://localhost:3001`.
- Gemini API key error: confirm `.env` is beside `package.json`, check the key, then restart the server.
- Google login fails: verify Firebase Google provider and authorized domains.
