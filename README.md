# Sourcing Ledger

Tracks what you buy from each Dubai company and at what rate, by reading
invoice photos automatically.

## What it does
1. Tap **Scan invoice** → take a photo, or choose one or more invoice
   images at once (all from the same company? select them all
   together — no need to scan-save-scan-save one at a time).
2. The app reads every photo and merges everything it finds into one
   list — company name and every item + rate (AED). If the same item
   name shows up on more than one of the photos, the last one wins.
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
Get a free key at https://openrouter.ai/keys — **don't** put it in
`firebase-config.js`. Instead, open the live app once it's deployed,
go to **Settings**, and paste it into the "OpenRouter API key" field
there. It's saved only in your phone's browser storage, never
committed to GitHub — so it can never get caught by a secret scanner
or auto-disabled, and your repo can stay public (required for free
GitHub Pages hosting) with zero risk to the key.
- The model is set to `openrouter/free`, OpenRouter's auto-router — it
  picks whichever free model currently supports image reading, since
  the free-model lineup on OpenRouter changes often. No cost either way.

### 3. Exchange rate
Same **Settings** screen — set your AED → OMR rate. You can change
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
git commit -m "Sourcing Ledger app"
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
- Your OpenRouter key lives only in this browser's storage (not in
  the code, not on GitHub). If you ever clear Chrome's site data for
  this app, or open it in a different browser, you'll need to paste
  the key into Settings again — it's a one-time re-entry, not a
  repeated hassle, and it means the key is never at risk of being
  auto-disabled again.
