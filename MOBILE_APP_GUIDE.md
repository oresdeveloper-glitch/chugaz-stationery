# CHUGAZ Stationery — Convert to Mobile App

Full system (POS, Inventory, Shop, Reports) converted to mobile via **Capacitor** (wraps your existing React web app) + **PWA**. No rewrite needed — reuses `frontend/dist` and `backend` API.

## Option 1 — PWA (instant, no store, 2 min)

Already added:
- `frontend/public/manifest.json` — installable, standalone, theme #0e6ea8
- `frontend/index.html` — manifest + theme-color + apple tags

**Test:** `cd frontend && npm run build && npm run preview` → open `http://localhost:4173` on phone → Chrome menu → **Install app / Add to Home screen** → works offline for UI, API needs network.

## Option 2 — Native Android APK (Capacitor, recommended for Play Store)

### 1. Install (once)
```bash
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/android
# iOS (Mac only): npm install @capacitor/ios
```

### 2. Build web + init Capacitor (already created `capacitor.config.json`)
```bash
npm run build
npx cap init "CHUGAZ Stationery" com.chugaz.stationery --web-dir=dist
npx cap add android
# npx cap add ios
```

### 3. Configure API URL for mobile
Mobile cannot use `localhost`. Host backend:
- **Local network:** set `VITE_API_URL=http://192.168.x.x:4000` in `frontend/.env` (your PC LAN IP), rebuild.
- **Production:** deploy backend to VPS/Render/Railway, set `VITE_API_URL=https://api.chugaz.co.tz`

Update `frontend/src/lib/api.js` to use:
```js
const API_BASE = import.meta.env.VITE_API_URL || ''
// fetch(`${API_BASE}/api/...`)
```

And allow CORS in `backend/server.js` already `cors()` — add your mobile origin if needed.

### 4. Sync + Open in Android Studio
```bash
npx cap sync
npx cap open android
```
In Android Studio: **Run ▶** on emulator/device. Camera permission for barcode (`@zxing/library`) auto-requests — add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
```

### 5. Build APK/AAB for Play Store
In Android Studio: **Build → Generate Signed Bundle / APK** → choose `Android App Bundle` → create keystore → `app-release.aab` → upload to Play Console.

Or CLI:
```bash
cd android && ./gradlew bundleRelease
# output: android/app/build/outputs/bundle/release/app-release.aab
```

### 6. iOS (Mac)
```bash
npx cap add ios
npx cap sync
npx cap open ios
```
In Xcode: select team, **Product → Archive** → upload to App Store.

## Backend for Mobile

Keep `backend` hosted:
- Docker: `docker compose up -d --build` (already ready) → expose `4000`
- Env: `PORT=4000`, `JWT_SECRET=...`, `DB_PATH=...`, `SERVE_FRONTEND=0` (mobile uses API only)
- Ensure `https` for camera: Capacitor requires `https` or `localhost`; use `https` in production or `http://192.168.x.x` with `androidScheme: http` for local.

## Features Working Natively

- **POS + Barcode:** `@zxing` camera works in WebView after permission
- **Printing:** Uses `window.print()` → Android print dialog; for thermal, add `capacitor-plugin-printer` if needed
- **Offline:** PWA caches UI; for full offline POS, add service worker + local SQLite sync (next phase)

## Quick Test Without Building

On phone Chrome, open `http://192.168.x.x:5173` (run `npm run dev -- --host` on PC) → **Add to Home screen** → behaves like native app immediately.

## Need APK Built Now?

If you send LAN IP or production API URL, I can generate the Android project and provide the `app-debug.apk` for sideloading.

