import { firebaseConfig, OPENROUTER_API_KEY, VISION_MODEL } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  addDoc, onSnapshot, query, orderBy, writeBatch, serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const UNIT_OPTIONS = ["Yard", "Roll", "Piece", "Meter"];
const TIER_DEFS = [
  { key: "retail", label: "Retail customer" },
  { key: "tailor", label: "Tailor / Business" },
  { key: "wholesale", label: "Wholesale / Bulk buyer" }
];

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
function switchView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  show(id);
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function fmt(n, dp = 3) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(dp).replace(/\.?0+$/, (m) => (dp <= 0 ? "" : m.length > 1 ? "" : m)) || Number(n).toFixed(dp);
}
function fmtMoney(n, dp = 3) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(dp);
}
function dateStr(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- state ----------
let currentUser = null;
let companiesCache = []; // [{id, name, nameLower, itemCount, updatedAt}]
let currentCompanyId = null;
let currentCompanyItemsCache = []; // for matching + rendering
let exchangeRate = 0.10; // sensible fallback until settings load
let pickedImages = []; // [{mime, base64, previewUrl}] — one or more invoice photos in the current scan batch
let reviewRows = []; // working rows in the review screen
let detailItem = null; // {id, ...data} of item currently open in the detail modal

// ============================================================
// AUTH
// ============================================================
// ============================================================
// AUTH — silent, anonymous. No login screen, no button.
// ============================================================
signInAnonymously(auth).catch((err) => {
  $("login-error").textContent = "Couldn't connect: " + err.message;
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadSettings();
    switchView("view-home");
    listenCompanies();
  } else {
    currentUser = null;
    switchView("view-login");
  }
});

// ============================================================
// SETTINGS (exchange rate)
// ============================================================
async function loadSettings() {
  const ref = doc(db, "settings", "main");
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().exchangeRate) {
    exchangeRate = snap.data().exchangeRate;
  } else {
    await setDoc(ref, { exchangeRate }, { merge: true });
  }
  $("settings-rate").value = exchangeRate;
  updateExchangeNote();
}
function getOpenRouterKey() {
  return localStorage.getItem("openrouterKey") || OPENROUTER_API_KEY || "";
}

$("btn-settings").addEventListener("click", () => {
  $("settings-rate").value = exchangeRate;
  $("settings-orkey").value = localStorage.getItem("openrouterKey") || "";
  switchView("view-settings");
});
$("btn-save-orkey").addEventListener("click", () => {
  const val = $("settings-orkey").value.trim();
  if (!val) { toast("Enter a key first"); return; }
  localStorage.setItem("openrouterKey", val);
  show("orkey-saved");
  setTimeout(() => hide("orkey-saved"), 1800);
});
$("btn-settings-back").addEventListener("click", () => switchView("view-home"));
$("btn-save-rate").addEventListener("click", async () => {
  const val = parseFloat($("settings-rate").value);
  if (!val || val <= 0) { toast("Enter a valid rate"); return; }
  exchangeRate = val;
  await setDoc(doc(db, "settings", "main"), { exchangeRate }, { merge: true });
  show("settings-saved");
  setTimeout(() => hide("settings-saved"), 1800);
  updateExchangeNote();
  recalcAllRows();
});

// ============================================================
// HOME — company list
// ============================================================
function listenCompanies() {
  const q = query(collection(db, "companies"), orderBy("updatedAt", "desc"));
  onSnapshot(q, (snap) => {
    companiesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCompanyList(companiesCache);
    renderCompanyDatalist();
  });
}
function renderCompanyList(list) {
  const wrap = $("company-list");
  wrap.innerHTML = "";
  if (list.length === 0) { show("home-empty"); return; }
  hide("home-empty");
  list.forEach((c) => {
    const row = document.createElement("div");
    row.className = "company-row";
    row.innerHTML = `
      <div class="company-row-main">
        <p class="company-row-name">${escapeHtml(c.name)}</p>
        <p class="company-row-sub">${c.itemCount || 0} item${(c.itemCount || 0) === 1 ? "" : "s"} · updated ${c.updatedAt ? dateStr(c.updatedAt) : "—"}</p>
      </div>
      <span class="company-row-arrow">›</span>`;
    row.addEventListener("click", () => openCompany(c.id, c.name));
    wrap.appendChild(row);
  });
}
$("company-search").addEventListener("input", (e) => {
  const term = e.target.value.trim().toLowerCase();
  const filtered = term ? companiesCache.filter((c) => c.name.toLowerCase().includes(term)) : companiesCache;
  renderCompanyList(filtered);
});
function renderCompanyDatalist() {
  const dl = $("company-datalist");
  dl.innerHTML = companiesCache.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join("");
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
// SCAN
// ============================================================
$("btn-scan").addEventListener("click", () => { resetScan(); switchView("view-scan"); });
$("btn-scan-back").addEventListener("click", () => switchView("view-home"));
$("btn-camera").addEventListener("click", () => $("input-camera").click());
$("btn-gallery").addEventListener("click", () => $("input-gallery").click());
$("btn-camera-2").addEventListener("click", () => $("input-camera").click());
$("btn-gallery-2").addEventListener("click", () => $("input-gallery").click());
$("input-camera").addEventListener("change", (e) => handleFiles(e.target.files));
$("input-gallery").addEventListener("change", (e) => handleFiles(e.target.files));
$("btn-retake").addEventListener("click", resetScan);

function resetScan() {
  pickedImages = [];
  hide("scan-preview-wrap"); hide("scan-loading"); show("scan-drop");
  $("scan-error").textContent = "";
  $("input-camera").value = ""; $("input-gallery").value = "";
  renderScanThumbs();
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  for (const file of files) {
    try {
      const compressed = await compressImage(file);
      pickedImages.push(compressed);
    } catch {
      // skip a file that fails to load rather than blocking the rest of the batch
    }
  }
  $("input-camera").value = ""; $("input-gallery").value = "";
  hide("scan-drop"); show("scan-preview-wrap");
  renderScanThumbs();
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Shrink large camera photos before sending — a full-size 4000px+
        // phone photo can take minutes to upload on a weak connection and
        // time out. 1600px on the long side is still plenty sharp for reading
        // invoice text, and uploads in a few seconds instead.
        const MAX_DIM = 1600;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ mime: "image/jpeg", base64: dataUrl.split(",")[1], previewUrl: dataUrl });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderScanThumbs() {
  const wrap = $("scan-thumbs");
  wrap.innerHTML = pickedImages.map((img, i) => `
    <div class="scan-thumb">
      <img src="${img.previewUrl}" alt="Invoice photo ${i + 1}" />
      <span class="scan-thumb-count">${i + 1}</span>
      <button class="scan-thumb-remove" data-idx="${i}">✕</button>
    </div>`).join("");
  wrap.querySelectorAll(".scan-thumb-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      pickedImages.splice(parseInt(btn.dataset.idx, 10), 1);
      if (pickedImages.length === 0) { resetScan(); return; }
      renderScanThumbs();
    });
  });
  $("btn-analyze").textContent = pickedImages.length > 1 ? `Read ${pickedImages.length} invoices` : "Read this invoice";
}

$("btn-analyze").addEventListener("click", analyzeInvoice);

async function analyzeInvoice() {
  if (pickedImages.length === 0) return;
  hide("scan-preview-wrap"); show("scan-loading");
  $("scan-error").textContent = "";
  const mergedItemsByName = new Map(); // nameLower -> item, later scans overwrite earlier ones
  let mergedCompany = "";
  let failedCount = 0;

  for (let i = 0; i < pickedImages.length; i++) {
    if (pickedImages.length > 1) {
      $("scan-loading-text").textContent = `Reading invoice ${i + 1} of ${pickedImages.length}…`;
    }
    try {
      const extracted = await extractInvoiceWithAI(pickedImages[i].base64, pickedImages[i].mime);
      if (extracted.company && !mergedCompany) mergedCompany = extracted.company;
      (extracted.items || []).forEach((it) => {
        const key = (it.name || "").trim().toLowerCase();
        if (key) mergedItemsByName.set(key, it);
      });
    } catch (err) {
      console.error(err);
      failedCount++;
    }
  }

  if (mergedItemsByName.size === 0) {
    hide("scan-loading"); show("scan-preview-wrap");
    $("scan-error").textContent = failedCount > 0
      ? "Couldn't read any of those invoices. Try clearer, well-lit photos."
      : "Couldn't find any items. Try a clearer, well-lit photo, or a different angle.";
    return;
  }

  const extracted = { company: mergedCompany, items: Array.from(mergedItemsByName.values()) };
  if (failedCount > 0) {
    toast(`Read ${pickedImages.length - failedCount} of ${pickedImages.length} photos OK`);
  }
  await openReviewFromExtraction(extracted);
}

const EXTRACTION_PROMPT = `You are reading a supplier invoice photo from a textile/clothing wholesale business in Dubai, written to a buyer in Oman. Invoices vary a lot — some are clean printed tax invoices, some are handwritten cash memos. Read carefully either way.

Return ONLY raw JSON (no markdown fences, no commentary) in exactly this shape:
{"company": "<supplier/company name as printed on invoice, best guess>", "items": [{"name": "<item name/description as printed>", "rate": <number, per-unit price in AED as a plain number>, "unit": "Meter" | "Yard" | "Piece" | "Roll", "qty": <number or null if not visible>}]}

Rules:
- "rate" is the true PER-UNIT cost in AED (UAE Dirham) — what he actually ends up paying per unit, VAT included, not the line total.
- **How to get the right rate — in this priority order:**
  1. If a line total INCLUDING VAT is printed (column like "Total Amt withVat", "Amount Incl.Vat", "Amount incl VAT", "Gross Amt") — ALWAYS compute rate = that total ÷ quantity. Do this even if the row also shows a separate "Rate" or "Price" column, because that column is very often the pre-tax rate and would undercount the real cost. The line total is the most trustworthy number on the invoice.
  2. Only if no such VAT-included total is printed for the line, fall back to a "Rate Incl VAT" / "Price Incl VAT" column if one exists.
  3. Only if neither of the above exists, use a plain "Rate" / "Price" column as-is.
- If only a line total and quantity are printed (no rate column at all), divide total by quantity to get the per-unit rate — same idea as rule 1.
- Most of these invoices measure cloth in Meters (column labeled "Mtr", "Meters", "MTR") — use "Meter" as the unit in that case. Only use "Yard" if the invoice itself says yards. Use "Piece" or "Roll" only if the invoice is clearly priced that way instead of by length.
- Handwritten invoices sometimes write decimals with a dash or slash instead of a dot — e.g. "2-00" means 2.00, "22/86" means 22.86. Interpret these as decimals.
- Keep item names close to the invoice wording. You can drop stock/design codes (like "BR/5520") from the name — the description alone is enough.
- If the company name isn't clearly printed, make your best guess from a logo/letterhead, or use "".
- If a specific item's rate is genuinely illegible, set its rate to 0 rather than guessing, and add "(check rate)" to the end of that item's name so it's flagged for review.
- If you truly cannot read the invoice at all, return {"company": "", "items": []}.
- Output valid JSON only.`;

async function callVisionModel(base64, mime) {
  const key = getOpenRouterKey();
  if (!key || key.startsWith("PASTE_")) {
    throw new Error("Add your OpenRouter key in Settings first");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } }
          ]
        }]
      })
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Took too long to respond (45s) — try again");
    throw new Error("Couldn't reach the AI — check your connection and try again");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const data = await res.json();
  let text = data.choices?.[0]?.message?.content || "";
  text = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  // The free model rotates and sometimes wraps the JSON in extra commentary —
  // pull out just the {...} block instead of requiring the whole reply to be clean JSON.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("AI reply wasn't valid JSON"); }
  if (!parsed || !Array.isArray(parsed.items)) throw new Error("AI reply missing items");
  return parsed;
}

async function extractInvoiceWithAI(base64, mime) {
  try {
    return await callVisionModel(base64, mime);
  } catch (err) {
    // The free router picks a different model each call — one retry often
    // lands on a model that follows the JSON instruction properly.
    return await callVisionModel(base64, mime);
  }
}

// ============================================================
// REVIEW
// ============================================================
async function openReviewFromExtraction(extracted) {
  hide("scan-loading");
  $("review-company").value = extracted.company || "";
  reviewRows = (extracted.items || []).map((it) => ({
    localId: cryptoId(),
    name: it.name || "",
    rateAED: typeof it.rate === "number" ? it.rate : (parseFloat(it.rate) || 0),
    boughtUnit: UNIT_OPTIONS.includes(it.unit) ? it.unit : "Meter",
    margin: 0,
    matchedItemId: null,
    matchedHistory: null
  }));
  if (reviewRows.length === 0) reviewRows.push(blankRow());
  await refreshMatchesForCompany();
  renderReviewRows();
  updateExchangeNote();
  switchView("view-review");
}
function blankRow() { return { localId: cryptoId(), name: "", rateAED: 0, boughtUnit: "Meter", margin: 0, matchedItemId: null, matchedHistory: null }; }
function cryptoId() { return Math.random().toString(36).slice(2, 10); }

$("btn-review-back").addEventListener("click", () => switchView("view-scan"));
$("btn-add-row").addEventListener("click", () => { reviewRows.push(blankRow()); renderReviewRows(); });
$("btn-edit-rate-inline").addEventListener("click", () => { $("settings-rate").value = exchangeRate; switchView("view-settings"); });

$("review-company").addEventListener("change", refreshMatchesForCompanyAndRerender);
$("review-company").addEventListener("blur", refreshMatchesForCompanyAndRerender);

async function refreshMatchesForCompanyAndRerender() {
  await refreshMatchesForCompany();
  renderReviewRows();
}

async function refreshMatchesForCompany() {
  const name = $("review-company").value.trim();
  currentCompanyItemsCache = [];
  if (!name) { $("review-company-hint").textContent = ""; return; }
  const existing = companiesCache.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    $("review-company-hint").textContent = `Existing company — ${existing.itemCount || 0} item(s) on file.`;
    const itemsSnap = await getDocs(collection(db, "companies", existing.id, "items"));
    currentCompanyItemsCache = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    $("review-company-hint").textContent = "New company — will be created.";
  }
  // re-match rows by name
  reviewRows.forEach((row) => {
    const match = currentCompanyItemsCache.find((it) => it.nameLower === row.name.trim().toLowerCase());
    if (match) {
      row.matchedItemId = match.id;
      row.matchedHistory = match;
      if (!row.margin) row.margin = match.marginOMR || 0;
      if (match.boughtUnit) row.boughtUnit = match.boughtUnit;
    } else {
      row.matchedItemId = null;
      row.matchedHistory = null;
    }
  });
}

function renderReviewRows() {
  const wrap = $("review-items");
  wrap.innerHTML = "";
  const itemNames = currentCompanyItemsCache.map((it) => it.name);
  const dlId = "item-name-datalist";
  let dl = document.getElementById(dlId);
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = dlId;
    document.body.appendChild(dl);
  }
  dl.innerHTML = itemNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");

  reviewRows.forEach((row) => {
    const card = document.createElement("div");
    card.className = "item-card";
    const isExisting = !!row.matchedItemId;
    card.innerHTML = `
      <span class="item-match-badge ${isExisting ? "existing" : "new"}" data-badge>${isExisting ? "Existing — rate will update" : "New item"}</span>
      <div class="item-card-top">
        <input type="text" list="${dlId}" placeholder="Item name" value="${escapeHtml(row.name)}" data-field="name" />
      </div>
      <div class="item-card-row">
        <div>
          <label>Dubai rate (AED)</label>
          <input type="number" step="0.01" inputmode="decimal" value="${row.rateAED || ""}" data-field="rateAED" />
        </div>
        <div>
          <label>Per</label>
          <select data-field="boughtUnit">
            ${UNIT_OPTIONS.map((u) => `<option value="${u}" ${row.boughtUnit === u ? "selected" : ""}>${u}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Your margin (OMR)</label>
          <input type="number" step="0.001" inputmode="decimal" value="${row.margin || ""}" data-field="margin" />
        </div>
      </div>
      <div class="item-card-omr">
        <span>Oman selling price</span>
        <strong data-omr>${fmtMoney(computeOMR(row))} OMR</strong>
      </div>
      <p class="hint-text" style="margin:8px 0 0" data-prev-rate>${isExisting && row.matchedHistory ? `Previous rate: ${fmtMoney(row.matchedHistory.currentRateAED, 2)} AED` : ""}</p>
      <button class="item-card-remove" data-remove>Remove item</button>
    `;
    const nameInput = card.querySelector('[data-field="name"]');
    const badgeEl = card.querySelector('[data-badge]');
    const prevRateEl = card.querySelector('[data-prev-rate]');

    nameInput.addEventListener("input", () => {
      // Update the row and re-check for a matching existing item WITHOUT
      // rebuilding the input itself — rebuilding mid-typing steals focus
      // and closes the on-screen keyboard on mobile.
      row.name = nameInput.value;
      const match = currentCompanyItemsCache.find((it) => it.nameLower === row.name.trim().toLowerCase());
      row.matchedItemId = match ? match.id : null;
      row.matchedHistory = match || null;
      if (match && match.boughtUnit) row.boughtUnit = match.boughtUnit;
      const isNowExisting = !!row.matchedItemId;
      badgeEl.textContent = isNowExisting ? "Existing — rate will update" : "New item";
      badgeEl.className = `item-match-badge ${isNowExisting ? "existing" : "new"}`;
      prevRateEl.textContent = isNowExisting && row.matchedHistory ? `Previous rate: ${fmtMoney(row.matchedHistory.currentRateAED, 2)} AED` : "";
    });

    card.querySelectorAll('input:not([data-field="name"]), select').forEach((inp) => {
      inp.addEventListener("input", () => {
        const field = inp.dataset.field;
        row[field] = field === "boughtUnit" ? inp.value : (parseFloat(inp.value) || 0);
        card.querySelector("[data-omr]").textContent = fmtMoney(computeOMR(row)) + " OMR";
      });
    });
    card.querySelector("[data-remove]").addEventListener("click", () => {
      reviewRows = reviewRows.filter((r) => r.localId !== row.localId);
      renderReviewRows();
    });
    wrap.appendChild(card);
  });
}
function computeOMR(row) { return (row.rateAED || 0) * exchangeRate + (row.margin || 0); }
function recalcAllRows() { renderReviewRows(); }
function updateExchangeNote() { $("exchange-note-text").textContent = `Using 1 AED = ${exchangeRate} OMR`; }

$("btn-save-review").addEventListener("click", saveReview);

async function saveReview() {
  const companyName = $("review-company").value.trim();
  $("review-error").textContent = "";
  if (!companyName) { $("review-error").textContent = "Enter a company name."; return; }
  const validRows = reviewRows.filter((r) => r.name.trim() && r.rateAED > 0);
  if (validRows.length === 0) { $("review-error").textContent = "Add at least one item with a name and rate."; return; }

  $("btn-save-review").disabled = true;
  $("btn-save-review").textContent = "Saving…";
  try {
    let companyRef;
    const existing = companiesCache.find((c) => c.name.toLowerCase() === companyName.toLowerCase());
    let newItemCount = 0;
    if (existing) {
      companyRef = doc(db, "companies", existing.id);
    } else {
      companyRef = doc(collection(db, "companies"));
      await setDoc(companyRef, { name: companyName, nameLower: companyName.toLowerCase(), itemCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    const itemsCol = collection(db, "companies", companyRef.id, "items");
    for (const row of validRows) {
      const nameLower = row.name.trim().toLowerCase();
      let itemRef = row.matchedItemId ? doc(itemsCol, row.matchedItemId) : null;
      if (!itemRef) {
        const existingSnap = await getDocs(itemsCol);
        const dup = existingSnap.docs.find((d) => d.data().nameLower === nameLower);
        if (dup) itemRef = doc(itemsCol, dup.id);
      }
      const sellingPriceOMR = computeOMR(row);
      if (itemRef) {
        const prevSnap = await getDoc(itemRef);
        const prev = prevSnap.exists() ? prevSnap.data() : null;
        const rateUnchanged = prev && prev.currentRateAED === row.rateAED && (prev.boughtUnit || "Meter") === row.boughtUnit;
        if (rateUnchanged) {
          // Same item, same rate as last time — nothing worth re-saving or
          // logging as a "change" in history. Just keep the name in sync.
          if (prev.name !== row.name.trim()) {
            await updateDoc(itemRef, { name: row.name.trim(), nameLower });
          }
        } else {
          const history = prev?.history ? [...prev.history] : [];
          if (prev && typeof prev.currentRateAED === "number") {
            history.unshift({ rateAED: prev.currentRateAED, date: prev.lastUpdated || Timestamp.now() });
          }
          await updateDoc(itemRef, {
            name: row.name.trim(),
            nameLower,
            currentRateAED: row.rateAED,
            boughtUnit: row.boughtUnit,
            marginOMR: row.margin,
            sellingPriceOMR,
            lastUpdated: serverTimestamp(),
            history: history.slice(0, 20)
          });
        }
      } else {
        await addDoc(itemsCol, {
          name: row.name.trim(),
          nameLower,
          currentRateAED: row.rateAED,
          boughtUnit: row.boughtUnit,
          marginOMR: row.margin,
          sellingPriceOMR,
          lastUpdated: serverTimestamp(),
          history: []
        });
        newItemCount++;
      }
    }
    await updateDoc(companyRef, {
      updatedAt: serverTimestamp(),
      itemCount: (existing ? (existing.itemCount || 0) : 0) + newItemCount
    });
    toast("Saved to ledger");
    switchView("view-home");
  } catch (err) {
    console.error(err);
    $("review-error").textContent = "Couldn't save: " + err.message;
  } finally {
    $("btn-save-review").disabled = false;
    $("btn-save-review").textContent = "Save to ledger";
  }
}

// ============================================================
// COMPANY DETAIL
// ============================================================
function openCompany(id, name) {
  currentCompanyId = id;
  $("company-detail-name").textContent = name;
  switchView("view-company");
  const q = query(collection(db, "companies", id, "items"), orderBy("lastUpdated", "desc"));
  onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("company-item-count").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    $("company-last-updated").textContent = items[0] ? `last updated ${dateStr(items[0].lastUpdated)}` : "";
    renderCompanyItems(items);
  });
}
$("btn-company-back").addEventListener("click", () => switchView("view-home"));
$("btn-company-rename").addEventListener("click", async () => {
  if (!currentCompanyId) return;
  const current = $("company-detail-name").textContent;
  const next = prompt("Rename company", current);
  if (!next || !next.trim() || next.trim() === current) return;
  const name = next.trim();
  await updateDoc(doc(db, "companies", currentCompanyId), { name, nameLower: name.toLowerCase(), updatedAt: serverTimestamp() });
  $("company-detail-name").textContent = name;
  toast("Renamed");
});

function renderCompanyItems(items) {
  const wrap = $("company-items-list");
  wrap.innerHTML = "";
  items.forEach((it) => {
    const prevRate = it.history && it.history[0] ? it.history[0].rateAED : null;
    let changeHtml = "";
    if (prevRate !== null) {
      const diff = it.currentRateAED - prevRate;
      if (Math.abs(diff) > 0.001) {
        changeHtml = `<span class="rate-change ${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(diff), 2)}</span>`;
      }
    }
    const row = document.createElement("div");
    row.className = "ledger-item";
    row.innerHTML = `
      <div class="ledger-item-top">
        <span class="ledger-item-name">${escapeHtml(it.name)}</span>
        <span class="ledger-item-date">${dateStr(it.lastUpdated)}</span>
      </div>
      <div class="ledger-item-rates">
        <span><span class="rate-label">Dubai (AED)</span>${fmtMoney(it.currentRateAED, 2)}/${it.boughtUnit || "Meter"}${changeHtml}</span>
        <span><span class="rate-label">Selling from</span>${firstTierSummary(it)}</span>
      </div>`;
    row.addEventListener("click", () => openItemDetail(it));
    wrap.appendChild(row);
  });
}

function firstTierSummary(it) {
  const tiers = it.sellPrices || {};
  for (const def of TIER_DEFS) {
    const t = tiers[def.key];
    if (t && t.price) return `${fmtMoney(t.price, 3)} OMR/${t.unit}`;
  }
  return "—";
}

function openItemDetail(item) {
  detailItem = item;
  $("detail-item-name").value = item.name;

  // buy rate
  $("detail-rate-input").value = item.currentRateAED || "";
  $("detail-rate-unit").value = item.boughtUnit || "Meter";
  $("detail-buy-updated").textContent = `Last updated ${dateStr(item.lastUpdated)}`;

  // roll note
  $("detail-roll-note").value = item.rollNote || "";

  // tiers
  const tiers = item.sellPrices || {};
  const tierWrap = $("tier-rows");
  tierWrap.innerHTML = TIER_DEFS.map((def) => {
    const t = tiers[def.key] || {};
    return `
      <div class="tier-row" data-tier="${def.key}">
        <span class="tier-label">${def.label}</span>
        <select data-tier-unit>
          ${UNIT_OPTIONS.map((u) => `<option value="${u}" ${t.unit === u ? "selected" : ""}>${u}</option>`).join("")}
        </select>
        <input type="number" step="0.001" inputmode="decimal" placeholder="OMR" data-tier-price value="${t.price || ""}" />
      </div>`;
  }).join("");

  // history
  const list = $("history-list");
  const rows = [{ rateAED: item.currentRateAED, date: item.lastUpdated, current: true }, ...(item.history || [])];
  list.innerHTML = rows.map((r) => `
    <div class="history-row">
      <span>${r.current ? "Current" : "Previous"} — ${fmtMoney(r.rateAED, 2)} AED</span>
      <span class="history-date">${dateStr(r.date)}</span>
    </div>`).join("");

  show("modal-history");
}
$("btn-close-history").addEventListener("click", () => hide("modal-history"));
$("modal-history").addEventListener("click", (e) => { if (e.target.id === "modal-history") hide("modal-history"); });

$("btn-save-tiers").addEventListener("click", async () => {
  if (!detailItem || !currentCompanyId) return;
  const btn = $("btn-save-tiers");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const itemRef = doc(db, "companies", currentCompanyId, "items", detailItem.id);
    const newName = $("detail-item-name").value.trim() || detailItem.name;
    const newRate = parseFloat($("detail-rate-input").value) || 0;
    const newUnit = $("detail-rate-unit").value;

    const updates = {
      name: newName,
      nameLower: newName.toLowerCase(),
      rollNote: $("detail-roll-note").value.trim()
    };

    const sellPrices = {};
    $("tier-rows").querySelectorAll(".tier-row").forEach((row) => {
      const key = row.dataset.tier;
      const unit = row.querySelector("[data-tier-unit]").value;
      const priceVal = row.querySelector("[data-tier-price]").value;
      if (priceVal !== "") sellPrices[key] = { unit, price: parseFloat(priceVal) || 0 };
    });
    updates.sellPrices = sellPrices;

    // Only touch the rate/history/lastUpdated if the buying rate actually
    // changed here — editing just the name or selling prices shouldn't
    // create a fake "rate changed today" entry in the history.
    const rateChanged = newRate !== detailItem.currentRateAED || newUnit !== (detailItem.boughtUnit || "Meter");
    if (rateChanged) {
      const history = detailItem.history ? [...detailItem.history] : [];
      history.unshift({ rateAED: detailItem.currentRateAED, date: detailItem.lastUpdated || Timestamp.now() });
      updates.currentRateAED = newRate;
      updates.boughtUnit = newUnit;
      updates.lastUpdated = serverTimestamp();
      updates.history = history.slice(0, 20);
    }

    await updateDoc(itemRef, updates);
    detailItem = { ...detailItem, ...updates, name: newName, currentRateAED: newRate, boughtUnit: newUnit };
    show("detail-save-status");
    setTimeout(() => hide("detail-save-status"), 1800);
  } catch (err) {
    console.error(err);
    $("detail-save-status").textContent = "Couldn't save: " + err.message;
    show("detail-save-status");
  } finally {
    btn.disabled = false; btn.textContent = "Save changes";
  }
});

// ---------- register service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
