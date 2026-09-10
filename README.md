# Dubai Rate Book

Tracks what you buy from each Dubai company and at what rate, by reading
invoice photos automatically.

## What it does
1. Tap **Scan invoice** → take a photo or pick one from your gallery.
2. The app sends it to an AI vision model that reads the company name and
   every item + rate (AED) on the invoice.
3. You see a **review screen** — edit anything the AI got wrong, add a
   margin per item, then tap **Save to ledger**.
4. New company/item names are created automatically. If an item already
   exists for that company, its rate is updated and the old rate is kept
   in its history.
5. Open any company to see every item you buy from them and its current
   Dubai rate. Tap an item to open its detail sheet:
   - **Selling prices** — set a separate price + unit (Yard / Roll /
     Piece / Meter) for Retail customers, Tailors/Businesses, and
     Wholesale/Bulk buyers. Leave any of the three blank if you don't
     sell that item that way. A free-text "roll size note" field is
     there too, since yards-per-roll varies shipment to shipment.
   - **Rate history** — every past Dubai rate for that item, with dates.

## One-time setup (10 minutes)

### 1. Firebase
Reuse your existing Firebase project (the one Shop Ops Hub / the
Inventory PWA already use):
- Firebase console → your project → **Build → Firestore Database** →
  make sure it's created (it already is, from your other apps).
- **Project settings → your web app** → copy the config object.
- Paste those six values into `firebase-config.js` in place of the
  `PASTE_YOUR_...` placeholders.
- **Build → Authentication → Sign-in method** → enable **Anonymous**
  (not Google — this app signs itself in silently, no login screen).
- **Firestore Database → Rules** → add the rules from `firestore.rules`
  in this folder alongside whatever rules you already have for your
  other apps' collections, then **Publish**.

### 2. OpenRouter (the AI that reads invoices)
- Use the same OpenRouter API key you already set up for Fustan AI, or
  get a free one at https://openrouter.ai/keys
- Paste it into `firebase-config.js` as `OPENROUTER_API_KEY`.
- The free Gemini model is already selected — no cost as long as you
  stay on the free tier.

### 3. Exchange rate
First time you open the app, go to **Settings** (gear icon, top right
of the Companies screen) and set your AED → OMR rate. You can change
it anytime — it only affects new saves, not past records.

## Deploy from Termux

```bash
cd ~
# if you don't already have a repo for this, create one on GitHub first
# (github.com → New repository → name it e.g. dubai-rate-book), then:
git clone https://github.com/<your-username>/dubai-rate-book.git
cd dubai-rate-book
# copy in these files (unzip this project into the repo folder), then:
git add .
git commit -m "Dubai Rate Book app"
git push origin main
```

Then in the GitHub repo on your phone browser: **Settings → Pages →
Branch: main → Save**. Your app will be live at
`https://<your-username>.github.io/dubai-rate-book/` within a minute or two.

## Notes
- Item matching for "is this the same item as before" is by exact name
  match (not case-sensitive) within the same company. If the AI reads a
  name slightly differently each time, use the item name field's
  autocomplete on the review screen — it suggests existing item names
  for that company, so you can pick the right one instead of creating a
  duplicate.
- Most of your suppliers bill by the **Meter**, not the yard — the app now
  captures whichever unit the invoice actually uses (Meter / Yard / Piece
  / Roll) per item, and shows it next to the rate.
- When an invoice shows both a VAT-excluded and VAT-included rate, the
  app is told to use the VAT-included one — that's your real cost.
- **Printed tax invoices** (most of your suppliers) should read
  reliably. **Handwritten cash memos** (a few of your suppliers write
  these instead) are harder for any AI to read accurately — decimals
  written as "2-00" or "22/86" instead of "2.00"/"22.86" are handled,
  but always double-check handwritten invoices on the review screen
  before saving. If a rate comes out clearly wrong, just fix it there.
- Margin (on the scan/review screen) is a flat OMR amount added to the
  converted Dubai rate, not a percentage. It's remembered per item, so
  next time that item's rate updates, its last margin is pre-filled.
  It's just a starting point — your real selling prices are the three
  tiers you set on the item's detail sheet.
- History keeps the last 20 rate changes per item.
- No item photos yet — Firebase Storage needs the paid "Blaze" plan,
  which you're skipping for now. Everything else (scanning, rates,
  selling price tiers) works fully on the free plan. Add photos later
  by upgrading the project and asking me to bring that feature back.
