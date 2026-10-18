# Wechsel – offline currency converter

A small installable web app (PWA). No build step, no dependencies: open `index.html` through any web server.

## Put it on your iPhone

1. Upload this folder to any free static host that serves HTTPS (needed for offline mode and Add to Home Screen):
   - Netlify Drop: drag the folder onto app.netlify.com/drop
   - GitHub Pages: push the folder to a repo, then Settings > Pages
   - Cloudflare Pages: "Direct upload"
2. Open the URL in Safari on your iPhone, tap Share, then **Add to Home Screen**.
3. Open it once from the Home Screen icon while online. That stores the app files and the latest rates.
4. Check offline mode: switch on Airplane mode and open the app again.

No Apple developer account and no Mac needed.

## How it works

- Rates: ECB reference rates from the Frankfurter API (frankfurter.dev). The ECB publishes on working days around 16:00 CET.
- The app refreshes the rates when you open it and the stored ones are older than 2 hours.
- Offline, it uses the last stored rates and says how old they are. A snapshot from 16 Oct 2026 is built in for the very first launch.
- Your three buttons and the target currency per button are saved on the device. Change them with **Edit currencies**.

## Changing things

- Default three currencies: `DEFAULT_FAVS` in `app.js` (only affects a fresh install).
- Colours per currency: `IDENTITY` in `app.js`.
- After you edit any file, change `VERSION` in `sw.js` (for example to `wechsel-v2`). Phones pick up the new copy the second time they open the app.
- Try it locally with `python3 -m http.server 8000` in this folder, then open http://localhost:8000. An iPhone needs the HTTPS host above.

The font (Archivo) is bundled under the SIL Open Font License; see `fonts/ARCHIVO-LICENSE.txt`.
