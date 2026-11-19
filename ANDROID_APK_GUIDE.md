# SHAYON FIRE MAX — Architecture & Android APK Build Guide

## 1. Architecture Overview
- **Frontend 3D Engine**: React 19 + TypeScript + Three.js PBR WebGL Renderer (`RoomEnvironment`, `ACESFilmicToneMapping`, dynamic Day/Night cycle, weather particle systems, procedural composite 3D characters, weapons, vehicles, and 5 arenas).
- **Multiplayer Server**: Node.js + Express + `ws` WebSocket server running on port 3000 with server-authoritative room state, matchmaking queues, custom rooms, squad invites, and voice/chat safety filters.
- **Database**: SQLite (`better-sqlite3`) persisted at `./data/shayon.db` for accounts, salted scrypt authentication, inventory, weapon Evo levels, missions, Battle Pass, friends, events, catalog overrides, and patch notes.

## 2. Running Locally
1. `npm install`
2. `npm run dev` (starts Express + WebSocket + Vite dev middleware on port `3000`)
3. Production build & run: `npm run build && npm run start`

## 3. Building the Android APK (via Capacitor)
1. Build the production web bundle:
   ```bash
   npm run build
   ```
2. Install Capacitor & Android platform:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android
   npx cap add android
   npx cap sync android
   ```
3. Configure Landscape Orientation & Permissions in `android/app/src/main/AndroidManifest.xml`:
   - Set `android:screenOrientation="sensorLandscape"` on `MainActivity`.
   - Include `<uses-permission android:name="android.permission.INTERNET" />` and `<uses-permission android:name="android.permission.RECORD_AUDIO" />` for voice chat.
4. Build Signed Release APK:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```
   Output APK location: `android/app/build/outputs/apk/release/app-release.apk`.
5. Point `VITE_SERVER_URL` in `.env` to your hosted Express/WebSocket server URL before running `npm run build` so Android APK clients connect to your live multiplayer backend.
