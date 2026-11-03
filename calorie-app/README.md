# LeanMode

A calorie-deficit tracker with AI food photos, label scanning and a built-in food database (about 530 foods, with Indian staples and a big Australian / Coles section). No npm install, no build step. It only needs Node 22.5 or newer.

## Run it on your phone only (no computer, works anytime)

The app is a static web app that runs entirely in your phone's browser. Your diary, scanned products and recipes are stored on the phone, and the OpenAI key is stored there too and sent straight from the phone to OpenAI. There is no server.

1. Host the files for free on GitHub Pages. In this repo go to **Settings, Pages**, choose **Deploy from a branch**, pick the branch (this branch, or `main` after merging) and the `/ (root)` folder, then Save.
2. After a minute, open `https://<your-github-username>.github.io/ad/calorie-app/public/` on your phone.
3. **Install it:** iPhone Safari, tap Share then Add to Home Screen. Android Chrome, menu then Install app. Installed copies open full screen, work offline, and are protected from the browser clearing your data.
4. Open **Settings**, paste your OpenAI key once, done.

The page is public but contains no keys and no data. Each phone keeps its own data. Use **Settings, Backup** now and then (and before changing phones). The browser can wipe site data if the app is not installed.

Camera barcode scanning needs Chrome on Android (Safari has no barcode API). On iPhone type the number or scan the label with the camera instead.

## Run it on a computer instead (optional)

```bash
cd calorie-app
npm start        # then open http://localhost:3000
```

With a server running, the app uses it and stores data in `data/leanmode.db`. Use `HOST=0.0.0.0 npm start` to reach it from a phone on the same Wi-Fi (no login, so only on a network you trust).

## Your OpenAI key (enter once)

Open **Settings** and paste it in the OpenAI box. In phone mode it is stored on the phone only. In server mode the server keeps it in `data/secrets.json` (chmod 600, git-ignored) and never sends it to the browser. You only type it once. Server-mode alternatives: `OPENAI_API_KEY` env var, or a `.env` file (see `.env.example`). The key is not in the repo and should never be committed.

## How the photo analysis works

`public/core/analyze.js` is the algorithm, in four stages:

1. **Vision.** 2 passes by default, each using a different strategy (plate-fraction, bottom-up volume, conservative audit). Each pass names every food and drink, uses scale references (plate, fork, katori) to estimate edible grams, splits dishes into ingredients including hidden oil, ghee, cream and sugar, and gives a confidence. Your note ("ate half", "about 150 g rice") overrides the visual guess.
2. **Grounding.** Every item and ingredient is matched against the database with a fuzzy matcher (aliases, typos, cooking methods). Your own saved products win ties. Database numbers beat the model's numbers. A sanity check rejects matches that contradict what was seen, and with no match the model's estimate is used and flagged.
3. **Merge.** Passes are clustered by name and grams are averaged. Disagreement between passes lowers confidence, and items only one pass saw are flagged.
4. **Math.** Nutrition equals per-100g multiplied by grams, summed per dish and per meal.

You review everything on an editable screen (grams, remove items, add missed items, portion slider) before it is logged.

## Questions, memory and meal prep

- **Clarifying questions.** After a photo analysis the AI asks only what would move the calories (how much oil or ghee, sugar in the chai, sauce amount, how much of the batch you served), with tap-to-answer options. Answer and it re-estimates. Your answers are remembered as habits (see Settings), so it stops asking the same thing and applies them next time.
- **Meal prep / cooked batch.** Tap + then Meal prep. Describe what went in (raw weights) and the weight of the whole cooked pot, or add ingredients by hand. Per 100 g is calculated on the cooked weight, so you get exact per-portion numbers. It is saved as a food, so you pick it from search and log portions all week. It is also shown to the photo analysis, which will recognise your own dish on the plate. In a photo review, any dish with ingredients has a "Save as my dish" button too.

## Label scanning ("recognise it later")

Photograph the back of a pack. The nutrition table is transcribed, normalised to per 100 g (kJ to kcal, per-serving to per-100g, energy checked against macros) and saved under **My foods**. After that it is found by name, by barcode, and it is passed to the photo analysis so it can be recognised in meal photos. Open Food Facts search (Australian products first) and barcode lookup are built in for items you do not want to photograph.

## Notes

- Seed values are typical averages (`public/core/foods.txt`, 12 columns, per 100 g). Packaged and restaurant items vary, so your own label scans always take priority. Edit the file to add foods and restart.
- Your data lives in `data/leanmode.db` (SQLite, git-ignored). Back that folder up.
- `npm test` runs matcher, grounding, label and data-integrity tests. `npm run dev:mock` runs with canned AI answers, with no key needed.
- The deficit calculator uses Mifflin-St Jeor and enforces a minimum intake. It is an estimate, not medical advice.
