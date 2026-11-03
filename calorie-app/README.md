# LeanMode

A calorie-deficit tracker with AI food photos, label scanning and a built-in food database (about 530 foods, with Indian staples and a big Australian / Coles section). No npm install, no build step. It only needs Node 22.5 or newer.

```bash
cd calorie-app
npm start        # then open http://localhost:3000
```

On your phone, open it over your home Wi-Fi with `HOST=0.0.0.0 npm start` and browse to `http://<your-computer-ip>:3000`. Only do that on a network you trust, because there is no login.

## Your OpenAI key (enter once)

Open **Settings** and paste it in the OpenAI box. The server stores it in `data/secrets.json` (chmod 600, git-ignored) and never sends it to the browser, so you never type it again. Alternatives: `OPENAI_API_KEY` env var, or a `.env` file (see `.env.example`). The key is not in the repo and should never be committed.

## How the photo analysis works

`server/analyze.js` is the algorithm, in four stages:

1. **Vision.** 2 passes by default, each using a different strategy (plate-fraction, bottom-up volume, conservative audit). Each pass names every food and drink, uses scale references (plate, fork, katori) to estimate edible grams, splits dishes into ingredients including hidden oil, ghee, cream and sugar, and gives a confidence. Your note ("ate half", "about 150 g rice") overrides the visual guess.
2. **Grounding.** Every item and ingredient is matched against the database with a fuzzy matcher (aliases, typos, cooking methods). Your own saved products win ties. Database numbers beat the model's numbers. A sanity check rejects matches that contradict what was seen, and with no match the model's estimate is used and flagged.
3. **Merge.** Passes are clustered by name and grams are averaged. Disagreement between passes lowers confidence, and items only one pass saw are flagged.
4. **Math.** Nutrition equals per-100g multiplied by grams, summed per dish and per meal.

You review everything on an editable screen (grams, remove items, add missed items, portion slider) before it is logged.

## Label scanning ("recognise it later")

Photograph the back of a pack. The nutrition table is transcribed, normalised to per 100 g (kJ to kcal, per-serving to per-100g, energy checked against macros) and saved under **My foods**. After that it is found by name, by barcode, and it is passed to the photo analysis so it can be recognised in meal photos. Open Food Facts search (Australian products first) and barcode lookup are built in for items you do not want to photograph.

## Notes

- Seed values are typical averages (`server/data/foods.txt`, 12 columns, per 100 g). Packaged and restaurant items vary, so your own label scans always take priority. Edit the file to add foods and restart.
- Your data lives in `data/leanmode.db` (SQLite, git-ignored). Back that folder up.
- `npm test` runs matcher, grounding, label and data-integrity tests. `npm run dev:mock` runs with canned AI answers, with no key needed.
- The deficit calculator uses Mifflin-St Jeor and enforces a minimum intake. It is an estimate, not medical advice.
