import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase Client ──
function getSupaURL() { return import.meta.env.VITE_SUPABASE_URL || ""; }
function getSupaKey() { return import.meta.env.VITE_SUPABASE_ANON_KEY || ""; }

// Auth client (used for Google sign-in / session). Data calls still use raw fetch below.
const supabase = createClient(getSupaURL(), getSupaKey());

// Invite-only allowlist — only these emails may use the app.
const ALLOWED_EMAILS = ["lisa2mj@gmail.com", "s.s.washington2426@gmail.com", "niararenee@gmail.com"];
function isAllowed(email) {
  return !!email && ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

// Current signed-in identity (set by auth state changes). Used so each user's
// data requests authenticate as them (so per-user security rules apply).
let _authToken = null;
let _userId = null;
function setAuthContext(token, uid) { _authToken = token; _userId = uid; }

function getSupaHeaders() {
  const key = getSupaKey();
  return { "apikey": key, "Authorization": "Bearer " + (_authToken || key), "Content-Type": "application/json" };
}
async function supaGetTasks() {
  try {
    const r = await fetch(getSupaURL() + "/rest/v1/tasks?order=priority.asc", { headers: getSupaHeaders() });
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function supaUpsert(tasks) {
  try {
    const stamped = (Array.isArray(tasks) ? tasks : [tasks]).map(t => ({ ...t, user_id: _userId }));
    await fetch(getSupaURL() + "/rest/v1/tasks", {
      method: "POST",
      headers: { ...getSupaHeaders(), "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(stamped)
    });
  } catch(e) { console.error("save error", e); }
}
async function supaUpdate(id, changes) {
  try {
    await fetch(getSupaURL() + "/rest/v1/tasks?id=eq." + id, {
      method: "PATCH", headers: getSupaHeaders(), body: JSON.stringify(changes)
    });
  } catch(e) { console.error("update error", e); }
}
async function supaDelete(id) {
  try {
    await fetch(getSupaURL() + "/rest/v1/tasks?id=eq." + id, {
      method: "DELETE", headers: getSupaHeaders()
    });
  } catch(e) { console.error("delete error", e); }
}
async function supaGetBudgets() {
  try {
    const r = await fetch(getSupaURL() + "/rest/v1/bucket_budgets", { headers: getSupaHeaders() });
    return r.ok ? r.json() : [];
  } catch { return []; }
}
async function supaSaveBudget(bucket, amount, period) {
  try {
    await fetch(getSupaURL() + "/rest/v1/bucket_budgets", {
      method: "POST",
      headers: { ...getSupaHeaders(), "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify([{ bucket, amount, period: period || "none", user_id: _userId }])
    });
  } catch(e) { console.error("budget save error", e); }
}
async function supaDeleteBudget(bucket) {
  try {
    await fetch(getSupaURL() + "/rest/v1/bucket_budgets?bucket=eq." + bucket, {
      method: "DELETE", headers: getSupaHeaders()
    });
  } catch(e) { console.error("budget delete error", e); }
}

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');`;

// ── PIN System ──
function generateRecoveryCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function PinDot({ filled }) {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: "50%",
      background: filled ? "#FF2D78" : "transparent",
      border: `2px solid ${filled ? "#FF2D78" : "#EBE2D4"}`,
      transition: "all 0.15s",
      boxShadow: filled ? "0 0 8px #FF2D7866" : "none",
    }}/>
  );
}

function PinKey({ label, sub, onClick, danger }) {
  return (
    <button onClick={onClick} style={{
      background: danger ? "#FFF0F5" : "#FCF8F2",
      border: `1px solid ${danger ? "#FF2D7844" : "#EBE2D4"}`,
      borderRadius: 14, padding: "16px 0", cursor: "pointer",
      fontFamily: "Syne, sans-serif", fontWeight: 800,
      fontSize: label === "⌫" ? 22 : 22, color: danger ? "#FF2D78" : "#1E1A2E",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 2, transition: "all 0.12s", lineHeight: 1,
      WebkitTapHighlightColor: "transparent",
    }}
    onMouseDown={e => { e.currentTarget.style.transform = "scale(0.94)"; e.currentTarget.style.background = danger ? "#FFE0EC" : "#FBF7F2"; }}
    onMouseUp={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.background = danger ? "#FFF0F5" : "#FCF8F2"; }}
    onTouchStart={e => { e.currentTarget.style.transform = "scale(0.94)"; e.currentTarget.style.background = danger ? "#FFE0EC" : "#FBF7F2"; }}
    onTouchEnd={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.background = danger ? "#FFF0F5" : "#FCF8F2"; }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: 9, fontFamily: "Plus Jakarta Sans", fontWeight: 600, color: "#B4A88F", letterSpacing: 1 }}>{sub}</span>}
    </button>
  );
}

// ── PIN Setup Screen ──
function PinSetup({ onComplete }) {
  const [step, setStep]           = useState("create"); // create | confirm
  const [pin, setPin]             = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError]         = useState("");
  const [recoveryCode]            = useState(generateRecoveryCode);
  const [showRecovery, setShowRecovery] = useState(false);
  const PINK = "#FF2D78", ORANGE = "#FF6B00";

  const current = step === "create" ? pin : confirmPin;
  const setter  = step === "create" ? setPin : setConfirmPin;

  function pressKey(k) {
    if (current.length >= 4) return;
    const next = current + k;
    setter(next);
    setError("");
    if (next.length === 4) {
      setTimeout(() => {
        if (step === "create") { setStep("confirm"); }
        else {
          if (next === pin) { setShowRecovery(true); }
          else { setError("PINs don't match. Try again."); setConfirmPin(""); }
        }
      }, 200);
    }
  }

  function pressBack() { setter(p => p.slice(0, -1)); setError(""); }

  if (showRecovery) return (
    <div style={{ minHeight:"100vh", background:"#FBF7F2", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"#fff", borderRadius:24, padding:32, maxWidth:400, width:"100%", boxShadow:"0 8px 40px #CABEA820", textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔐</div>
        <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:20, color:"#1E1A2E", marginBottom:8 }}>Save Your Recovery Code</div>
        <div style={{ fontSize:13, color:"#9C8C76", fontWeight:500, marginBottom:20, lineHeight:1.6 }}>
          If you ever forget your PIN, use this code to get back in. Screenshot it and keep it somewhere safe — it won't be shown again.
        </div>
        <div style={{ background:"#FCF8F2", border:"2px dashed #EBE2D4", borderRadius:16, padding:"20px 24px", marginBottom:24 }}>
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:22, color:"#1E1A2E", letterSpacing:3 }}>{recoveryCode}</div>
        </div>
        <div style={{ background:"#FFF8E0", border:"1px solid #D4A80044", borderRadius:10, padding:"10px 14px", marginBottom:24, fontSize:12, color:"#A07800", fontWeight:600 }}>
          ⚑ Screenshot this now — you cannot recover it later
        </div>
        <button onClick={() => onComplete(pin, recoveryCode)} style={{
          background:`linear-gradient(135deg,${PINK},${ORANGE})`, color:"#fff", border:"none",
          padding:"14px 32px", borderRadius:12, fontFamily:"Syne,sans-serif", fontWeight:800,
          fontSize:15, cursor:"pointer", width:"100%", boxShadow:`0 4px 16px ${PINK}44`,
        }}>I've Saved It — Enter Flourish ✨</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#FBF7F2", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"#fff", borderRadius:24, padding:"32px 28px", maxWidth:360, width:"100%", boxShadow:"0 8px 40px #CABEA820" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:24,
            background:`linear-gradient(135deg,${PINK},${ORANGE})`, WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent", backgroundClip:"text", marginBottom:4 }}>flourish</div>
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:18, color:"#1E1A2E", marginBottom:6 }}>
            {step === "create" ? "Create Your PIN" : "Confirm Your PIN"}
          </div>
          <div style={{ fontSize:13, color:"#9C8C76", fontWeight:500 }}>
            {step === "create" ? "Choose a 4-digit PIN to protect your app" : "Enter your PIN again to confirm"}
          </div>
        </div>
        <div style={{ display:"flex", gap:16, justifyContent:"center", marginBottom:8 }}>
          {[0,1,2,3].map(i => <PinDot key={i} filled={i < current.length}/>)}
        </div>
        {error && <div style={{ textAlign:"center", color:PINK, fontSize:12, fontWeight:700, marginBottom:8, minHeight:18 }}>{error}</div>}
        {!error && <div style={{ minHeight:18, marginBottom:8 }}/>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:8 }}>
          {[1,2,3,4,5,6,7,8,9].map(n => <PinKey key={n} label={String(n)} onClick={()=>pressKey(String(n))}/>)}
          <div/>
          <PinKey label="0" onClick={()=>pressKey("0")}/>
          <PinKey label="⌫" onClick={pressBack} danger/>
        </div>
      </div>
    </div>
  );
}

// ── PIN Lock Screen ──
function PinLock({ onUnlock, recoveryCode }) {
  const [pin, setPin]         = useState("");
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError]     = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [shake, setShake]     = useState(false);
  const timerRef = useRef(null);
  const PINK = "#FF2D78", ORANGE = "#FF6B00";

  useEffect(() => {
    if (cooldown > 0) {
      timerRef.current = setTimeout(() => setCooldown(c => c - 1), 1000);
    } else if (cooldown === 0 && attempts >= 3) {
      setAttempts(0); setError("");
    }
    return () => clearTimeout(timerRef.current);
  }, [cooldown]);

  function pressKey(k) {
    if (cooldown > 0 || pin.length >= 4) return;
    const next = pin + k;
    setPin(next); setError("");
    if (next.length === 4) {
      setTimeout(() => {
        if (onUnlock(next)) { /* success handled by parent */ }
        else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          setShake(true); setTimeout(() => setShake(false), 500);
          setPin("");
          if (newAttempts >= 3) {
            setCooldown(30);
            setError("Too many attempts. Wait 30 seconds.");
          } else {
            setError(`Incorrect PIN. ${3 - newAttempts} attempt${3-newAttempts!==1?"s":""} left.`);
          }
        }
      }, 200);
    }
  }

  function pressBack() { if (cooldown > 0) return; setPin(p => p.slice(0,-1)); setError(""); }

  function tryRecovery() {
    if (recoveryInput.replace(/-/g,"").toUpperCase() === recoveryCode.replace(/-/g,"")) {
      onUnlock("__RECOVERY__");
    } else { setRecoveryError("Recovery code doesn't match. Check and try again."); }
  }

  if (showRecovery) return (
    <div style={{ minHeight:"100vh", background:"#FBF7F2", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"#fff", borderRadius:24, padding:32, maxWidth:380, width:"100%", boxShadow:"0 8px 40px #CABEA820", textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🔑</div>
        <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:18, color:"#1E1A2E", marginBottom:8 }}>Enter Recovery Code</div>
        <div style={{ fontSize:13, color:"#9C8C76", fontWeight:500, marginBottom:20, lineHeight:1.6 }}>
          Enter the 16-character recovery code you saved when you set up your PIN.
        </div>
        <input value={recoveryInput} onChange={e=>setRecoveryInput(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          style={{ width:"100%", background:"#FCF8F2", border:`1px solid ${recoveryError?PINK:"#EBE2D4"}`,
            borderRadius:12, padding:"12px 16px", fontFamily:"Syne,sans-serif", fontWeight:700,
            fontSize:16, color:"#1E1A2E", outline:"none", textAlign:"center", letterSpacing:2, marginBottom:8 }}/>
        {recoveryError && <div style={{ color:PINK, fontSize:12, fontWeight:700, marginBottom:12 }}>{recoveryError}</div>}
        <button onClick={tryRecovery} style={{ background:`linear-gradient(135deg,${PINK},${ORANGE})`, color:"#fff",
          border:"none", padding:"12px 24px", borderRadius:10, fontFamily:"Syne,sans-serif",
          fontWeight:800, fontSize:14, cursor:"pointer", width:"100%", marginBottom:12 }}>
          Unlock
        </button>
        <button onClick={()=>setShowRecovery(false)} style={{ background:"none", border:"1px solid #EBE2D4",
          color:"#9C8C76", padding:"10px 20px", borderRadius:10, cursor:"pointer",
          fontFamily:"Plus Jakarta Sans", fontWeight:600, fontSize:13, width:"100%" }}>
          ← Back to PIN
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#FBF7F2", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"#fff", borderRadius:24, padding:"32px 28px", maxWidth:360, width:"100%", boxShadow:"0 8px 40px #CABEA820" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:800, fontSize:24,
            background:`linear-gradient(135deg,${PINK},${ORANGE})`, WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent", backgroundClip:"text", marginBottom:4 }}>flourish</div>
          <div style={{ fontSize:13, color:"#9C8C76", fontWeight:500 }}>Enter your PIN to continue</div>
        </div>
        <div style={{ display:"flex", gap:16, justifyContent:"center", marginBottom:8,
          animation: shake ? "pinShake 0.4s ease" : "none" }}>
          {[0,1,2,3].map(i => <PinDot key={i} filled={i < pin.length}/>)}
        </div>
        <div style={{ textAlign:"center", minHeight:20, marginBottom:8 }}>
          {cooldown > 0
            ? <span style={{ color:ORANGE, fontSize:12, fontWeight:700 }}>⏱ Try again in {cooldown}s</span>
            : error
            ? <span style={{ color:PINK, fontSize:12, fontWeight:700 }}>{error}</span>
            : <span/>
          }
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:8, opacity:cooldown>0?0.4:1, transition:"opacity 0.3s" }}>
          {[1,2,3,4,5,6,7,8,9].map(n => <PinKey key={n} label={String(n)} onClick={()=>pressKey(String(n))}/>)}
          <div/>
          <PinKey label="0" onClick={()=>pressKey("0")}/>
          <PinKey label="⌫" onClick={pressBack} danger/>
        </div>
        <button onClick={()=>setShowRecovery(true)}
          style={{ display:"block", margin:"20px auto 0", background:"none", border:"none",
            color:"#C6BAA6", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"Plus Jakarta Sans" }}>
          Forgot PIN? Use recovery code
        </button>
      </div>
      <style>{`@keyframes pinShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  );
}

const PINK   = "#FF2D78";
const ORANGE = "#FF6B00";
const YELLOW = "#D4A800";
const CYAN   = "#0099CC";
const PURPLE = "#C56B4A";
const YB     = "#FFE500";

const BUCKETS = [
  { id: "work",     label: "Work",            icon: "💼", color: PINK,   dark: "#C7185A", bg: "#FF2D7814" },
  { id: "family",   label: "Daily",            icon: "🏠", color: ORANGE, dark: "#B34D00", bg: "#FF6B0014" },
  { id: "church",   label: "Faith",            icon: "✝️",  color: CYAN,   dark: "#006E94", bg: "#0099CC14" },
  { id: "me",       label: "Me Time",          icon: "🌟", color: YELLOW, dark: "#8A6F00", bg: "#D4A80014" },
  { id: "projects", label: "Extras",           icon: "🎯", color: PURPLE, dark: "#9E4F30", bg: "#C56B4A14" },
];

const BUCKET_KEYWORDS = {
  work:     ["client","proposal","invoice","meeting","zoom","google workspace","domain","storefront","business","contract","sales","email campaign","pitch","revenue","onboard","workspace","podcast","episode","record","interview","sponsor","brand","marketing","social media","instagram","linkedin","website","logo","coaching","workshop","webinar","speaking","keynote","follow up","quote","estimate","payroll","taxes","llc","deck","slides"],
  family:   ["grocery","groceries","kids","dentist","doctor","car","oil change","school","pickup","pick up","drop off","dinner","household","bank","insurance","prescription","appointment","errand","errands","order","account","laundry","clean","cleaning","chores","cook","meal","target","walmart","costco","amazon","shopping","pharmacy","vet","pet","daycare","soccer","practice","homework","babysitter","gas","mechanic","registration","dmv","rent","mortgage","utilities","bill","bills","milk","mail","package","return","kid"],
  church:   ["sermon","bible","volunteer","retreat","ministry","prayer","pray","worship","congregation","pastor","church","mosque","synagogue","temple","service","devotion","devotional","faith","study","tithe","offering","scripture","quiet time","small group","fellowship","mission","outreach","choir","usher","greeter"],
  me:       ["workout","gym","book","read","vacation","getaway","spa","meditat","meditation","journal","hobby","rest","massage","self","self care","selfcare","me time","personal growth","yoga","run","exercise","nails","mani","pedi","manicure","pedicure","hair","salon","haircut","brows","lashes","facial","makeup","skincare","bath","nap","relax","date night","wine","coffee","brunch","movie","netflix","concert","pamper","wax","tan","retail therapy"],
  projects: ["conference","abstract","pack","research","write","draft","plan","event","launch","presentation","report","outline","prepare","project","develop","build","design","fix","repair","organize","declutter","donate","sell","gift","birthday","holiday","decorate","setup","install","sort","misc","side","experiment","idea","explore"],
};

function suggestBucket(title) {
  if (!title || title.trim().length < 3) return null;
  const lower = title.toLowerCase();
  const scores = {};
  for (const [bid, keywords] of Object.entries(BUCKET_KEYWORDS)) {
    scores[bid] = keywords.filter(kw => lower.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

const INIT_TASKS = [
  { id: 1,  title: "Set up Google Workspace",          bucket: "work",     priority: 1, dueDate: "2026-05-12", cost: 144,  budgetStatus: "fits",    status: "active",   source: "manual",     notes: "Business tier, annual plan" },
  { id: 2,  title: "Purchase Zoom Account",             bucket: "work",     priority: 2, dueDate: "2026-05-20", cost: 179,  budgetStatus: "fits",    status: "active",   source: "apple-note", notes: "" },
  { id: 3,  title: "Set up storefront",                 bucket: "work",     priority: 3, dueDate: "2026-06-01", cost: 500,  budgetStatus: "defer",   status: "deferred", source: "screenshot", notes: "Shopify Basic + setup", deferDate: "2026-07-01" },
  { id: 4,  title: "Update client proposal — Keystone", bucket: "work",     priority: 4, dueDate: "2026-05-10", cost: null, budgetStatus: "flagged", status: "active",   source: "google-doc", notes: "" },
  { id: 5,  title: "Register business domain",          bucket: "work",     priority: 5, dueDate: "2026-05-25", cost: 15,   budgetStatus: "fits",    status: "active",   source: "manual",     notes: "" },
  { id: 6,  title: "Grocery run — weekly shop",         bucket: "family",   priority: 1, dueDate: "2026-05-10", cost: 180,  budgetStatus: "fits",    status: "active",   source: "manual",     notes: "" },
  { id: 7,  title: "Schedule kids dental checkup",      bucket: "family",   priority: 2, dueDate: "2026-05-18", cost: null, budgetStatus: "flagged", status: "active",   source: "apple-note", notes: "" },
  { id: 8,  title: "Car oil change",                    bucket: "family",   priority: 3, dueDate: "2026-05-30", cost: 75,   budgetStatus: "fits",    status: "active",   source: "manual",     notes: "" },
  { id: 9,  title: "Prepare Sunday sermon notes",       bucket: "church",   priority: 1, dueDate: "2026-05-11", cost: null, budgetStatus: "flagged", status: "active",   source: "manual",     notes: "" },
  { id: 10, title: "Organize volunteer schedule",       bucket: "church",   priority: 2, dueDate: "2026-05-22", cost: null, budgetStatus: "flagged", status: "active",   source: "paste",      notes: "" },
  { id: 11, title: "Book retreat venue",                bucket: "church",   priority: 3, dueDate: "2026-06-15", cost: 350,  budgetStatus: "defer",   status: "deferred", source: "manual",     notes: "", deferDate: "2026-07-01" },
  { id: 12, title: "Morning workout routine",           bucket: "me",       priority: 1, dueDate: "2026-05-15", cost: 50,   budgetStatus: "fits",    status: "active",   source: "manual",     notes: "Gym membership" },
  { id: 13, title: "Read 2 chapters of current book",  bucket: "me",       priority: 2, dueDate: "2026-05-20", cost: null, budgetStatus: "flagged", status: "active",   source: "manual",     notes: "" },
  { id: 14, title: "Plan weekend getaway",              bucket: "me",       priority: 3, dueDate: "2026-06-10", cost: 400,  budgetStatus: "defer",   status: "deferred", source: "apple-note", notes: "", deferDate: "2026-08-01" },
  { id: 15, title: "Pack for annual conference",        bucket: "projects", priority: 1, dueDate: "2026-06-05", cost: null, budgetStatus: "flagged", status: "active",   source: "manual",     notes: "" },
  { id: 16, title: "Write abstract for DRJ",           bucket: "projects", priority: 2, dueDate: "2026-05-28", cost: null, budgetStatus: "flagged", status: "active",   source: "manual",     notes: "" },
];

function fmtDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "";
  const [y, m, d] = s.split("-");
  return `${m}/${d}/${y}`;
}

// today as YYYY-MM-DD (real current date, for budget period resets)
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
// a key identifying which period a date falls in, for the given cadence
function periodKey(dateStr, period) {
  if (!period || period === "none") return "all";
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "undated";
  if (period === "daily") return dateStr;
  if (period === "monthly") return dateStr.slice(0, 7);
  if (period === "weekly") {
    const d = new Date(dateStr + "T00:00:00");
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  return "all";
}
// does this task count toward the bucket's CURRENT period?
function inCurrentPeriod(task, period) {
  if (!period || period === "none") return true;
  if (!task.dueDate) return true; // undated costs always count
  return periodKey(task.dueDate, period) === periodKey(todayStr(), period);
}
// committed dollars in a bucket for its current period
function bucketCommitted(tasks, bid, period) {
  return tasks.filter(t => t.bucket === bid && t.cost && t.status !== "deferred" && inCurrentPeriod(t, period))
              .reduce((s, t) => s + Number(t.cost), 0);
}
// live status for a single task's cost relative to its bucket cap, within its own period
function taskBudgetState(task, tasks, bucketBudgets, bucketPeriods) {
  if (task.cost == null || task.cost === "") return "flagged";
  const cap = bucketBudgets ? bucketBudgets[task.bucket] : null;
  if (cap == null || cap === "") return "tracked";
  const period = (bucketPeriods && bucketPeriods[task.bucket]) || "none";
  const tk = periodKey(task.dueDate, period);
  const peers = tasks.filter(t => t.bucket === task.bucket && t.cost && t.status !== "deferred" && periodKey(t.dueDate, period) === tk)
                     .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  let run = 0;
  for (const t of peers) {
    run += Number(t.cost);
    if (t.id === task.id) return run > cap ? "over" : "fits";
  }
  return "fits";
}

function getUrgency(dueDateStr, status) {
  if (status === "deferred") return "deferred";
  if (!dueDateStr) return "clear";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + "T00:00:00");
  if (isNaN(due)) return "clear";
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "overdue";
  if (diff <= 2) return "critical";
  if (diff <= 7) return "soon";
  if (diff <= 14) return "upcoming";
  return "clear";
}

const UC = {
  overdue:  { label: "OVERDUE",   bg: "#FF2D7818", border: "#FF2D78", text: "#BC1655", dot: "#FF2D78" },
  critical: { label: "DUE SOON",  bg: "#FF6B0018", border: "#FF6B00", text: "#B34D00", dot: "#FF6B00" },
  soon:     { label: "THIS WEEK", bg: "#D4A80018", border: "#D4A800", text: "#7D5E00", dot: "#D4A800" },
  upcoming: { label: "UPCOMING",  bg: "#0099CC18", border: "#0099CC", text: "#005B83", dot: "#0099CC" },
  clear:    { label: "ON TRACK",  bg: "#00AA6618", border: "#00AA66", text: "#00663C", dot: "#00AA66" },
  deferred: { label: "DEFERRED",  bg: "#CCC0AB18", border: "#B4A88F", text: "#6B6051", dot: "#B4A88F" },
};

const SRC = { "manual":"✏️","apple-note":"📱","screenshot":"📸","google-doc":"📄","paste":"📋" };

function isDuplicate(title, existing) {
  const n = t => t.toLowerCase().trim();
  return existing.some(e => {
    const a=n(e.title), b=n(title);
    return a===b || (b.length>8 && a.includes(b.slice(0,10))) || (a.length>8 && b.includes(a.slice(0,10)));
  });
}

function InlineDate({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  if (editing) return (
    <input ref={ref} type="date" value={value}
      onChange={e => onChange(e.target.value)} onBlur={() => setEditing(false)}
      style={{ border:`1px solid ${PINK}`,borderRadius:6,padding:"2px 6px",fontSize:11,
        fontFamily:"Plus Jakarta Sans",background:"#fff",color:"#1E1A2E",outline:"none" }}/>
  );
  return (
    <span onClick={() => setEditing(true)} title="Tap to edit date"
      style={{ cursor:"pointer",borderBottom:`1px dashed ${PINK}88`,paddingBottom:1,color:"#5C5343",fontWeight:700 }}>
      📅 {fmtDate(value)}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:"block",fontSize:9,fontWeight:700,letterSpacing:"1.5px",
        textTransform:"uppercase",color:"#B7AA92",marginBottom:6 }}>{label}</label>
      {children}
    </div>
  );
}

// ── AI Bucket Suggestion Pill ──
function BucketSuggestion({ suggestion, current, onAccept, onDismiss }) {
  if (!suggestion || suggestion === current) return null;
  const b = BUCKETS.find(x => x.id === suggestion);
  if (!b) return null;
  return (
    <div style={{ display:"flex",alignItems:"center",gap:8,background:b.bg,
      border:`1px solid ${b.color}44`,borderRadius:10,padding:"8px 12px",marginBottom:12,
      animation:"slideDown 0.25s ease" }}>
      <span style={{ fontSize:16 }}>{b.icon}</span>
      <div style={{ flex:1 }}>
        <span style={{ fontSize:11,fontWeight:700,color:"#1E1A2E" }}>Suggested: </span>
        <span style={{ fontSize:11,fontWeight:800,color:b.color }}>{b.label}</span>
        <span style={{ fontSize:11,color:"#9C8C76",fontWeight:500 }}> — does this look right?</span>
      </div>
      <button onClick={onAccept} style={{ background:b.color,color:"#fff",border:"none",
        padding:"4px 12px",borderRadius:6,fontSize:11,fontWeight:800,cursor:"pointer" }}>
        ✓ Yes
      </button>
      <button onClick={onDismiss} style={{ background:"none",border:`1px solid ${b.color}44`,
        color:b.color,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer" }}>
        Change
      </button>
    </div>
  );
}


// ── Shared Review List ──
function ReviewList({ candidates, setCandidates, inputSty }) {
  function toggleAction(id, val) { setCandidates(p=>p.map(c=>c._id===id?{...c,action:val}:c)); }
  function updateField(id, f, v) { setCandidates(p=>p.map(c=>c._id===id?{...c,[f]:v}:c)); }
  function updateBucket(id, val) { setCandidates(p=>p.map(c=>c._id===id?{...c,bucket:val}:c)); }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:380,overflowY:"auto",marginBottom:16}}>
      {candidates.map(c=>{
        return (
          <div key={c._id} style={{
            background:c.action==="skip"?"#FCF8F2":c.isDup?"#FFFBF0":"#F8FFF8",
            border:`1px solid ${c.action==="skip"?"#EBE2D4":c.isDup?"#D4A80055":"#00AA6633"}`,
            borderRadius:12,padding:"12px 14px",opacity:c.action==="skip"?0.5:1,transition:"all 0.2s"
          }}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:8}}>
              <input value={c.title} onChange={e=>updateField(c._id,"title",e.target.value)}
                style={{flex:1,fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:13,color:"#1E1A2E",
                  background:"transparent",border:"none",outline:"none",borderBottom:"1px dashed #FF2D7844",paddingBottom:2}}/>
              {c.isDup&&c.action==="flag"&&(
                <span style={{background:"#FFF8E0",color:"#A07800",fontSize:9,fontWeight:700,
                  padding:"2px 8px",borderRadius:4,border:"1px solid #D4A80055",whiteSpace:"nowrap"}}>DUPLICATE?</span>
              )}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
              <div style={{flex:2,minWidth:110}}>
                <div style={{fontSize:8,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#C6BAA6",marginBottom:3}}>Bucket</div>
                <select value={c.bucket} onChange={e=>updateBucket(c._id,e.target.value)}
                  style={{...inputSty,padding:"6px 10px",fontSize:11}}>
                  {BUCKETS.map(bk=><option key={bk.id} value={bk.id}>{bk.icon} {bk.label}</option>)}
                </select>
              </div>
              <div style={{flex:2,minWidth:110}}>
                <div style={{fontSize:8,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#C6BAA6",marginBottom:3}}>Due Date</div>
                <input type="date" value={c.dueDate} onChange={e=>updateField(c._id,"dueDate",e.target.value)}
                  style={{...inputSty,padding:"6px 10px",fontSize:11}}/>
              </div>
              <div style={{flex:1,minWidth:80}}>
                <div style={{fontSize:8,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#C6BAA6",marginBottom:3}}>Cost ($)</div>
                <input type="number" placeholder="0.00" value={c.cost} onChange={e=>updateField(c._id,"cost",e.target.value)}
                  style={{...inputSty,padding:"6px 10px",fontSize:11}}/>
              </div>
            </div>
            {c.notes&&<div style={{fontSize:11,color:"#B4A88F",fontStyle:"italic",marginBottom:8}}>{c.notes}</div>}
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>toggleAction(c._id,"add")}
                style={{padding:"4px 12px",borderRadius:6,border:"1px solid",cursor:"pointer",fontSize:11,fontWeight:700,
                  borderColor:c.action==="add"?"#00AA66":"#EBE2D4",background:c.action==="add"?"#E8F8F0":"transparent",
                  color:c.action==="add"?"#00A060":"#9C8C76"}}>Add</button>
              <button onClick={()=>toggleAction(c._id,"skip")}
                style={{padding:"4px 12px",borderRadius:6,border:"1px solid",cursor:"pointer",fontSize:11,fontWeight:700,
                  borderColor:c.action==="skip"?"#B4A88F":"#EBE2D4",background:c.action==="skip"?"#F6F0E7":"transparent",
                  color:"#9C8C76"}}>Skip</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Image / Screenshot Import ──
function ImageImport({ existingTasks, onConfirm, onClose }) {
  const [step, setStep] = useState("idle");
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const PINK = "#FF2D78";
  const inputSty = { width:"100%",background:"#FCF8F2",border:"1px solid #EBE2D4",borderRadius:10,
    padding:"10px 13px",color:"#1E1A2E",fontFamily:"Plus Jakarta Sans,sans-serif",fontSize:13,fontWeight:500,outline:"none" };

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = () => rej(new Error("Could not read file"));
      r.readAsDataURL(file);
    });
    setPreview(URL.createObjectURL(file));
    setStep("reading");
    try {
      const mediaType = file.type || "image/jpeg";
      const response = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:2000,
          system:"You are a task extractor. The user has uploaded an image which could be a handwritten note, screenshot of Apple Notes, Microsoft Notes, email, text message, spreadsheet, or any document. Extract EVERY task, to-do, action item, or deliverable. For each task suggest the most likely bucket from: work, family, church, me, projects. Return ONLY a valid JSON array: [{title,bucket,dueDate,notes,cost}]. Output ONLY the JSON array.",
          messages:[{role:"user",content:[
            {type:"image",source:{type:"base64",media_type:mediaType,data:base64}},
            {type:"text",text:"Extract all tasks from this image."}
          ]}]
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message||"API error");
      const text = data.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      // Extract JSON array from anywhere in the response
      const jsonMatch = text.match(/\[.*\]/s);
      if (!jsonMatch) throw new Error("No tasks found in image");
      const raw = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(raw) || raw.length === 0) throw new Error("No tasks found in image");
      setCandidates(raw.map((t,i)=>({...t,_id:i,isDup:isDuplicate(t.title,existingTasks),
        action:isDuplicate(t.title,existingTasks)?"flag":"add",
        dueDate:t.dueDate||"",notes:t.notes||"",cost:t.cost||"",bucket:t.bucket||"work"})));
      setStep("review");
    } catch(e) { setError("Could not read image: "+e.message); setStep("idle"); }
  }

  const addCount = candidates.filter(c=>c.action==="add").length;

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:560}}>
        {step==="idle"&&(
          <>
            <div className="modal-title">Import from <span>Screenshot</span></div>
            <div style={{background:"#FCF8F2",border:"2px dashed #EBE2D4",borderRadius:16,
              padding:"32px 24px",textAlign:"center",marginBottom:20,cursor:"pointer"}}
              onClick={()=>fileRef.current?.click()}
              onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="#FF2D78";}}
              onDragLeave={e=>{e.currentTarget.style.borderColor="#EBE2D4";}}
              onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="#EBE2D4";handleFile(e.dataTransfer.files[0]);}}>
              <div style={{fontSize:48,marginBottom:12}}>📸</div>
              <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:16,color:"#1E1A2E",marginBottom:6}}>
                Drop an image or tap to choose
              </div>
              <div style={{fontSize:12,color:"#9C8C76",fontWeight:500,lineHeight:1.6}}>
                Handwritten notes · Apple Notes · Microsoft Notes<br/>
                Emails · Text messages · Spreadsheets · Any document
              </div>
              <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}}
                onChange={e=>handleFile(e.target.files[0])}/>
            </div>
            {error&&<div style={{color:PINK,fontSize:12,fontWeight:600,marginBottom:12,textAlign:"center"}}>Error: {error}</div>}
            <div className="modal-btns">
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
        {step==="reading"&&(
          <div style={{textAlign:"center",padding:"32px 0"}}>
            {preview&&<img src={preview} alt="preview" style={{maxHeight:160,borderRadius:12,marginBottom:20,objectFit:"contain"}}/>}
            <div style={{fontSize:36,marginBottom:12,animation:"pulse 1s infinite",display:"inline-block"}}>✨</div>
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"#1E1A2E",marginBottom:8}}>Reading your image...</div>
            <div style={{fontSize:13,color:"#9C8C76",fontWeight:500}}>Extracting tasks, dates, and costs</div>
          </div>
        )}
        {step==="review"&&(
          <>
            <div className="modal-title">Review <span>Tasks</span></div>
            {preview&&<img src={preview} alt="source" style={{width:"100%",maxHeight:120,objectFit:"contain",borderRadius:10,marginBottom:14,background:"#FCF8F2"}}/>}
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              <span style={{background:"#E8F8F0",color:"#00A060",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>{addCount} to add</span>
              <span style={{background:"#F6F0E7",color:"#9C8C76",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>{candidates.length} found</span>
            </div>
            <ReviewList candidates={candidates} setCandidates={setCandidates} inputSty={inputSty}/>
            <div className="modal-btns">
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
              <button className="cancel-btn" onClick={()=>{setStep("idle");setCandidates([]);setPreview(null);}}>Back</button>
              <button className="add-btn" disabled={addCount===0} style={{opacity:addCount===0?0.5:1}}
                onClick={()=>onConfirm(candidates.filter(c=>c.action==="add"))}>
                Add {addCount} Task{addCount!==1?"s":""} →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Paste / Freeform Import ──
function PasteImport({ existingTasks, onConfirm, onClose }) {
  const [step, setStep] = useState("idle");
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState(null);
  const PINK = "#FF2D78";
  const inputSty = { width:"100%",background:"#FCF8F2",border:"1px solid #EBE2D4",borderRadius:10,
    padding:"10px 13px",color:"#1E1A2E",fontFamily:"Plus Jakarta Sans,sans-serif",fontSize:13,fontWeight:500,outline:"none" };

  async function extractTasks() {
    if (!text.trim()) return;
    setStep("reading"); setError(null);
    try {
      const response = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:2000,
          system:"You are a task extractor. The user pasted freeform text which could be bullet points, numbered list, random notes, or anything. Extract EVERY task, to-do, action item, or deliverable. For each suggest the most likely bucket from: work, family, church, me, projects. Return ONLY a valid JSON array: [{title,bucket,dueDate,notes,cost}]. Output ONLY the JSON array.",
          messages:[{role:"user",content:"Extract all tasks from this text:\n\n"+text}]
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message||"API error");
      const raw_text = data.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      const jsonMatch2 = raw_text.match(/\[.*\]/s);
      if (!jsonMatch2) throw new Error("No tasks found in text");
      const raw = JSON.parse(jsonMatch2[0]);
      setCandidates(raw.map((t,i)=>({...t,_id:i,isDup:isDuplicate(t.title,existingTasks),
        action:isDuplicate(t.title,existingTasks)?"flag":"add",
        dueDate:t.dueDate||"",notes:t.notes||"",cost:t.cost||"",bucket:t.bucket||"work"})));
      setStep("review");
    } catch(e) { setError("Could not extract tasks: "+e.message); setStep("idle"); }
  }

  const addCount = candidates.filter(c=>c.action==="add").length;

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:560}}>
        {step==="idle"&&(
          <>
            <div className="modal-title">Paste Your <span>Notes</span></div>
            <div style={{fontSize:13,color:"#9C8C76",fontWeight:500,marginBottom:14,lineHeight:1.6}}>
              Paste anything — bullet points, numbered list, random notes. The AI will find every task.
            </div>
            <textarea value={text} onChange={e=>setText(e.target.value)}
              placeholder="Examples:&#10;• Call dentist to schedule appointment&#10;• Finish the Johnson proposal by Friday&#10;- Buy groceries: milk, eggs, bread&#10;1. Prepare Sunday sermon&#10;2. Follow up with vendor about invoice"
              style={{...inputSty,height:200,resize:"vertical",lineHeight:1.7}}/>
            {error&&<div style={{color:PINK,fontSize:12,fontWeight:600,marginTop:8}}>Error: {error}</div>}
            <div className="modal-btns" style={{marginTop:14}}>
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
              <button className="add-btn" disabled={!text.trim()} style={{opacity:!text.trim()?0.5:1}}
                onClick={extractTasks}>Extract Tasks</button>
            </div>
          </>
        )}
        {step==="reading"&&(
          <div style={{textAlign:"center",padding:"32px 0"}}>
            <div style={{fontSize:36,marginBottom:12,animation:"pulse 1s infinite",display:"inline-block"}}>✨</div>
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"#1E1A2E",marginBottom:8}}>Reading your notes...</div>
            <div style={{fontSize:13,color:"#9C8C76",fontWeight:500}}>Extracting tasks and suggestions</div>
          </div>
        )}
        {step==="review"&&(
          <>
            <div className="modal-title">Review <span>Tasks</span></div>
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              <span style={{background:"#E8F8F0",color:"#00A060",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>{addCount} to add</span>
              <span style={{background:"#F6F0E7",color:"#9C8C76",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>{candidates.length} found</span>
            </div>
            <ReviewList candidates={candidates} setCandidates={setCandidates} inputSty={inputSty}/>
            <div className="modal-btns">
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
              <button className="cancel-btn" onClick={()=>{setStep("idle");setCandidates([]);}}>Back</button>
              <button className="add-btn" disabled={addCount===0} style={{opacity:addCount===0?0.5:1}}
                onClick={()=>onConfirm(candidates.filter(c=>c.action==="add"))}>
                Add {addCount} Task{addCount!==1?"s":""} →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Google Drive Import ──
function DriveImport({ existingTasks, onConfirm, onClose, remaining }) {
  const [step, setStep] = useState("idle");
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [candidates, setCandidates] = useState([]);

  const inputSty = { width:"100%",background:"#FCF8F2",border:"1px solid #EBE2D4",borderRadius:10,
    padding:"10px 13px",color:"#1E1A2E",fontFamily:"Plus Jakarta Sans,sans-serif",fontSize:13,fontWeight:500,outline:"none" };

  async function searchFiles() {
    setStep("searching"); setError(null);
    try {
      const res = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:1000,
          system:`You are a Google Drive file searcher. Use the Google Drive tools to search for files inside the folder named "RWRLRR". Find files whose names contain "checklist" or "action plan" (case-insensitive). Return ONLY a valid JSON array: [{"id":"file_id","name":"file_name","mimeType":"mime"}]. If no files found return []. Output ONLY the JSON array.`,
          messages:[{role:"user",content:'Search the RWRLRR folder for files with "checklist" or "action plan" in the name.'}],
          mcp_servers:[{type:"url",url:"https://drivemcp.googleapis.com/mcp/v1",name:"gdrive"}],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message||"API error");
      const text = data.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      const clean = text.replace(/^```[a-z]*\n?/,"").replace(/\n?```$/,"").trim();
      setFiles(JSON.parse(clean));
      setStep("select");
    } catch(e) { setError("Could not search Drive: "+e.message); setStep("idle"); }
  }

  async function extractFromFile(file) {
    setSelectedFile(file); setStep("extracting"); setError(null);
    try {
      const res = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:2000,
          system:`You are a task extractor. Read the Google Drive file and extract every task, action item, to-do, or checklist item. Return ONLY a valid JSON array: [{"title":"task","dueDate":"YYYY-MM-DD or empty","notes":"context or empty","cost":null}]. Include dollar amounts as numbers if mentioned. Output ONLY the JSON array.`,
          messages:[{role:"user",content:`Read file ID: ${file.id} (name: ${file.name}) and extract all tasks.`}],
          mcp_servers:[{type:"url",url:"https://drivemcp.googleapis.com/mcp/v1",name:"gdrive"}],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message||"API error");
      const text = data.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim();
      const clean = text.replace(/^```[a-z]*\n?/,"").replace(/\n?```$/,"").trim();
      const raw = JSON.parse(clean);
      // RWRLRR always → Work, but still show suggestion for transparency
      const withMeta = raw.map((t,i) => ({
        ...t, _id:i,
        bucket:"work", // always work for RWRLRR
        isDup: isDuplicate(t.title, existingTasks),
        action: isDuplicate(t.title, existingTasks) ? "flag" : "add",
        dueDate: t.dueDate||"", notes:t.notes||"", cost:t.cost||"",
      }));
      setCandidates(withMeta);
      setStep("review");
    } catch(e) { setError("Could not read file: "+e.message); setStep("select"); }
  }

  function toggleAction(id, val) { setCandidates(p=>p.map(c=>c._id===id?{...c,action:val}:c)); }
  function updateField(id, f, v) { setCandidates(p=>p.map(c=>c._id===id?{...c,[f]:v}:c)); }
  function confirmImport() { onConfirm(candidates.filter(c=>c.action==="add")); }

  const addCount  = candidates.filter(c=>c.action==="add").length;
  const skipCount = candidates.filter(c=>c.action==="skip").length;
  const flagCount = candidates.filter(c=>c.action==="flag").length;

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:560}}>

        {step==="idle"&&(
          <>
            <div className="modal-title">Import from <span>Google Drive</span></div>
            <div style={{background:"#F0F8FF",border:"1px solid #0099CC33",borderRadius:14,padding:"18px 20px",marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#1E1A2E",marginBottom:4}}>📁 Folder:</div>
              <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:CYAN}}>RWRLRR</div>
              <div style={{fontSize:12,color:"#9C8C76",marginTop:4,fontWeight:500}}>Files with "checklist" or "action plan" in the name</div>
            </div>
            <div style={{background:"#FFF8F0",border:"1px solid #FF6B0033",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:12,color:"#A07800",fontWeight:600}}>
              💼 All RWRLRR tasks import into <strong>Work</strong> automatically
            </div>
            <div className="modal-btns">
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
              <button className="add-btn" onClick={searchFiles}>Search Drive</button>
            </div>
          </>
        )}

        {step==="searching"&&(
          <div style={{textAlign:"center",padding:"32px 0"}}>
            <div style={{fontSize:40,marginBottom:16,display:"inline-block",animation:"spin 1.5s linear infinite"}}>🔍</div>
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"#1E1A2E",marginBottom:8}}>Searching RWRLRR...</div>
            <div style={{fontSize:13,color:"#9C8C76",fontWeight:500}}>Looking for checklists and action plans</div>
          </div>
        )}

        {step==="select"&&(
          <>
            <div className="modal-title">Choose a <span>File</span></div>
            {files.length===0?(
              <div style={{textAlign:"center",padding:"24px 0"}}>
                <div style={{fontSize:32,marginBottom:12}}>📂</div>
                <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:16,color:"#1E1A2E",marginBottom:6}}>No files found</div>
                <div style={{fontSize:12,color:"#9C8C76",fontWeight:500}}>No files with "checklist" or "action plan" found in RWRLRR.</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                {files.map(f=>(
                  <button key={f.id} onClick={()=>extractFromFile(f)}
                    style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:12,
                      border:"1px solid #EBE2D4",background:"#FCF8F2",cursor:"pointer",textAlign:"left",width:"100%",transition:"all 0.18s"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=CYAN;e.currentTarget.style.background="#F0FAFF";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="#EBE2D4";e.currentTarget.style.background="#FCF8F2";}}>
                    <span style={{fontSize:26}}>{f.mimeType?.includes("spreadsheet")?"📊":"📄"}</span>
                    <div>
                      <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:14,color:"#1E1A2E"}}>{f.name}</div>
                      <div style={{fontSize:11,color:"#9C8C76",marginTop:2,fontWeight:500}}>
                        {f.mimeType?.includes("spreadsheet")?"Google Sheet":"Google Doc"} · Tap to extract tasks
                      </div>
                    </div>
                    <span style={{marginLeft:"auto",color:CYAN,fontSize:18}}>→</span>
                  </button>
                ))}
              </div>
            )}
            <div className="modal-btns">
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
              <button className="cancel-btn" onClick={()=>setStep("idle")}>← Back</button>
            </div>
          </>
        )}

        {step==="extracting"&&(
          <div style={{textAlign:"center",padding:"32px 0"}}>
            <div style={{fontSize:40,marginBottom:16,animation:"pulse 1s infinite",display:"inline-block"}}>✨</div>
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"#1E1A2E",marginBottom:8}}>
              Reading {selectedFile?.name}...
            </div>
            <div style={{fontSize:13,color:"#9C8C76",fontWeight:500}}>Extracting tasks, dates, and costs</div>
          </div>
        )}

        {step==="review"&&(
          <>
            <div className="modal-title">Review <span>Tasks</span></div>
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              <span style={{background:"#E8F8F0",color:"#00A060",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>✓ {addCount} to add</span>
              {flagCount>0&&<span style={{background:"#FFF8E0",color:"#A07800",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>⚑ {flagCount} possible duplicates</span>}
              {skipCount>0&&<span style={{background:"#F6F0E7",color:"#9C8C76",padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>✕ {skipCount} skipped</span>}
              <span style={{background:"#FF2D7814",color:PINK,padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>💼 All → Work</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:360,overflowY:"auto",marginBottom:16}}>
              {candidates.map(c=>{
                const b = BUCKETS.find(x=>x.id===c.bucket);
                return (
                  <div key={c._id} style={{background:c.action==="skip"?"#FCF8F2":c.isDup?"#FFFBF0":"#F8FFF8",
                    border:`1px solid ${c.action==="skip"?"#EBE2D4":c.isDup?"#D4A80055":"#00AA6633"}`,
                    borderRadius:12,padding:"12px 14px",opacity:c.action==="skip"?0.5:1,transition:"all 0.2s"}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:8}}>
                      <input value={c.title} onChange={e=>updateField(c._id,"title",e.target.value)}
                        style={{flex:1,fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:13,color:"#1E1A2E",
                          background:"transparent",border:"none",outline:"none",borderBottom:`1px dashed ${PINK}44`,paddingBottom:2}}/>
                      <span style={{background:b?.bg,color:b?.color,fontSize:9,fontWeight:700,
                        padding:"2px 8px",borderRadius:4,border:`1px solid ${b?.color}44`,whiteSpace:"nowrap"}}>
                        {b?.icon} {b?.label}
                      </span>
                      {c.isDup&&c.action==="flag"&&(
                        <span style={{background:"#FFF8E0",color:"#A07800",fontSize:9,fontWeight:700,
                          padding:"2px 8px",borderRadius:4,border:"1px solid #D4A80055",whiteSpace:"nowrap"}}>⚑ DUPLICATE?</span>
                      )}
                    </div>
                    <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:110}}>
                        <div style={{fontSize:8,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#C6BAA6",marginBottom:3}}>Due Date</div>
                        <input type="date" value={c.dueDate} onChange={e=>updateField(c._id,"dueDate",e.target.value)}
                          style={{width:"100%",background:"#FCF8F2",border:"1px solid #EBE2D4",borderRadius:8,padding:"6px 10px",color:"#1E1A2E",fontFamily:"Plus Jakarta Sans",fontSize:11,outline:"none"}}/>
                      </div>
                      <div style={{flex:1,minWidth:80}}>
                        <div style={{fontSize:8,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#C6BAA6",marginBottom:3}}>Cost ($)</div>
                        <input type="number" placeholder="0.00" value={c.cost} onChange={e=>updateField(c._id,"cost",e.target.value)}
                          style={{width:"100%",background:"#FCF8F2",border:"1px solid #EBE2D4",borderRadius:8,padding:"6px 10px",color:"#1E1A2E",fontFamily:"Plus Jakarta Sans",fontSize:11,outline:"none"}}/>
                      </div>
                    </div>
                    {c.notes&&<div style={{fontSize:11,color:"#B4A88F",fontStyle:"italic",marginBottom:8}}>{c.notes}</div>}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>toggleAction(c._id,"add")}
                        style={{padding:"4px 12px",borderRadius:6,border:"1px solid",cursor:"pointer",fontSize:11,fontWeight:700,
                          borderColor:c.action==="add"?"#00AA66":"#EBE2D4",background:c.action==="add"?"#E8F8F0":"transparent",
                          color:c.action==="add"?"#00A060":"#9C8C76"}}>✓ Add</button>
                      <button onClick={()=>toggleAction(c._id,"skip")}
                        style={{padding:"4px 12px",borderRadius:6,border:"1px solid",cursor:"pointer",fontSize:11,fontWeight:700,
                          borderColor:c.action==="skip"?"#B4A88F":"#EBE2D4",background:c.action==="skip"?"#F6F0E7":"transparent",
                          color:"#9C8C76"}}>✕ Skip</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {error&&<div style={{color:PINK,fontSize:12,marginBottom:12,fontWeight:600}}>⚠ {error}</div>}
            <div className="modal-btns">
              <button className="cancel-btn" onClick={onClose}>Cancel</button>
              <button className="cancel-btn" onClick={()=>setStep("select")}>← Back</button>
              <button className="add-btn" disabled={addCount===0} style={{opacity:addCount===0?0.5:1}} onClick={confirmImport}>
                Add {addCount} Task{addCount!==1?"s":""}  →
              </button>
            </div>
          </>
        )}
        {error&&step!=="review"&&<div style={{color:PINK,fontSize:12,marginTop:12,fontWeight:600,textAlign:"center"}}>⚠ {error}</div>}
      </div>
    </div>
  );
}

// ── Auth Screens ──
function AuthLoading() {
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#FBF7F2",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:26,background:"linear-gradient(135deg,#FF2D78,#FF6B00)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>flourish</div>
        <div style={{marginTop:10,color:"#9C8C76",fontSize:13}}>Loading…</div>
      </div>
    </div>
  );
}

function Login() {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) { setBusy(false); alert("Sign-in error: " + error.message); }
  }
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#FBF7F2",fontFamily:"'Plus Jakarta Sans',sans-serif",padding:20}}>
      <div style={{background:"#fff",border:"1px solid #EBE2D4",borderRadius:20,padding:"36px 30px",maxWidth:360,width:"100%",textAlign:"center",boxShadow:"0 10px 40px rgba(0,0,0,0.06)"}}>
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:30,background:"linear-gradient(135deg,#FF2D78,#FF6B00)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>flourish</div>
        <div style={{fontSize:11,letterSpacing:2,color:"#9C8C76",textTransform:"uppercase",marginBottom:24}}>your goals, blooming</div>
        <div style={{fontSize:15,color:"#1E1A2E",fontWeight:600,marginBottom:6}}>Welcome</div>
        <div style={{fontSize:13,color:"#9C8C76",marginBottom:24}}>Sign in to access your tasks and budgets.</div>
        <button onClick={signIn} disabled={busy} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"12px",borderRadius:12,border:"1px solid #EBE2D4",background:"#fff",cursor:busy?"default":"pointer",fontSize:14,fontWeight:700,color:"#1E1A2E"}}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-3.9 6.8-9.7 6.8-17.4z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.3-5.7c-2 1.4-4.6 2.2-7.7 2.2-6.3 0-11.7-3.7-13.6-9.4l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
          {busy ? "Opening Google…" : "Sign in with Google"}
        </button>
        <div style={{fontSize:11,color:"#B4A88F",marginTop:18}}>Invite-only · access is limited to approved testers.</div>
      </div>
    </div>
  );
}

function NotAllowed({ email, onSignOut }) {
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#FBF7F2",fontFamily:"'Plus Jakarta Sans',sans-serif",padding:20}}>
      <div style={{background:"#fff",border:"1px solid #EBE2D4",borderRadius:20,padding:"36px 30px",maxWidth:360,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:34,marginBottom:10}}>🌱</div>
        <div style={{fontSize:17,color:"#1E1A2E",fontWeight:700,marginBottom:8}}>You're not on the list yet</div>
        <div style={{fontSize:13,color:"#9C8C76",marginBottom:6}}>Flourish is invite-only during testing.</div>
        <div style={{fontSize:12,color:"#B4A88F",marginBottom:22}}>{email} isn't an approved tester.</div>
        <button onClick={onSignOut} style={{width:"100%",padding:"11px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#FF2D78,#FF6B00)",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Sign out</button>
      </div>
    </div>
  );
}

// ── MAIN APP ──
export default function Flourish() {
  // ── Auth (Phase A: Google sign-in + allowlist gate) ──
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const s = data.session;
      setAuthContext(s?.access_token || null, s?.user?.id || null);
      setUser(s?.user || null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthContext(session?.access_token || null, session?.user?.id || null);
      setUser(session?.user || null);
      setAuthReady(true);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  function handleSignOut() { supabase.auth.signOut(); }

  const [tasks, setTasks]             = useState([]);
  const [isLoadingFromDB, setIsLoadingFromDB]     = useState(true);
  const [budget, setBudget]           = useState(2000);
  const [budgetInput, setBudgetInput] = useState("2000");
  const [editingBudget, setEditingBudget] = useState(false);
  const [bucketBudgets, setBucketBudgets] = useState({});
  const [bucketPeriods, setBucketPeriods] = useState({});
  const [budgetModal, setBudgetModal] = useState(null); // { bucket, input, period }

  // Load tasks once the user is signed in and approved (so their token is active)
  useEffect(() => {
    if (!user || !isAllowed(user.email)) return;
    async function loadTasks() {
      setIsLoadingFromDB(true);
      let saved = await supaGetTasks();
      // Retry once if empty — handles PWA cold start timing issues
      if (!saved || saved.length === 0) {
        await new Promise(r => setTimeout(r, 1200));
        saved = await supaGetTasks();
      }
      if (saved && saved.length > 0) {
        setTasks(saved);
      } else {
        // First time for this account — seed with sample tasks
        setTasks(INIT_TASKS);
        await supaUpsert(INIT_TASKS);
      }
      setIsLoadingFromDB(false);
    }
    loadTasks();
  }, [user]);

  // Load per-bucket budgets once signed in and approved
  useEffect(() => {
    if (!user || !isAllowed(user.email)) return;
    async function loadBudgets() {
      const rows = await supaGetBudgets();
      const map = {}, pmap = {};
      (rows || []).forEach(r => {
        if (r.amount != null && r.amount !== "") map[r.bucket] = Number(r.amount);
        pmap[r.bucket] = r.period || "none";
      });
      setBucketBudgets(map);
      setBucketPeriods(pmap);
    }
    loadBudgets();
  }, [user]);
  const [activeBucket, setActiveBucket]   = useState("all");
  const [viewMode, setViewMode]       = useState("list");
  const [urgentOnly, setUrgentOnly]   = useState(false);
  const [showAdd, setShowAdd]         = useState(false);
  const [flagPrompt, setFlagPrompt]   = useState(null);
  const [inputMode, setInputMode]     = useState("manual");
  const [editTask, setEditTask]       = useState(null);
  const [deferModal, setDeferModal]   = useState(null);
  const [showImport, setShowImport]   = useState(false);
  const [showTimeAlloc, setShowTimeAlloc] = useState(false);
  const [selectMode, setSelectMode]     = useState(false);
  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [hideCompleted, setHideCompleted] = useState(false);
  const [showDrive, setShowDrive]     = useState(false);
  const [showImage, setShowImage]     = useState(false);
  const [showPaste, setShowPaste]     = useState(false);
  const [showBudgetPanel, setShowBudgetPanel] = useState(false);
  const [importSuccess, setImportSuccess]     = useState(null);
  const [newTask, setNewTask] = useState({ title:"",dueDate:"",cost:"",notes:"",source:"manual",bucket:"work" });
  const [suggestion, setSuggestion]   = useState(null);
  const [editSuggestion, setEditSuggestion] = useState(null);
  const suggTimer = useRef(null);

  const spent     = tasks.filter(t=>t.budgetStatus==="fits"&&t.cost).reduce((s,t)=>s+t.cost,0);
  const remaining = budget - spent;
  const budgetPct = Math.min((spent/budget)*100,100);

  // AI suggest on title change (manual entry)
  function handleTitleChange(val) {
    setNewTask(p=>({...p,title:val}));
    clearTimeout(suggTimer.current);
    if (val.length > 4) {
      suggTimer.current = setTimeout(() => {
        const suggested = suggestBucket(val);
        if (suggested && suggested !== newTask.bucket) setSuggestion(suggested);
        else setSuggestion(null);
      }, 600);
    } else { setSuggestion(null); }
  }

  function acceptSuggestion() { setNewTask(p=>({...p,bucket:suggestion})); setSuggestion(null); }
  function dismissSuggestion() { setSuggestion(null); }

  function handleEditTitleChange(val) {
    setEditTask(p=>({...p,title:val}));
    clearTimeout(suggTimer.current);
    if (val.length > 4) {
      suggTimer.current = setTimeout(() => {
        const suggested = suggestBucket(val);
        if (suggested && suggested !== editTask?.bucket) setEditSuggestion(suggested);
        else setEditSuggestion(null);
      }, 600);
    } else { setEditSuggestion(null); }
  }

  function saveBudget() {
    const v = parseFloat(budgetInput);
    if (!isNaN(v)&&v>0) setBudget(v);
    setEditingBudget(false); setShowBudgetPanel(false);
  }

  function openBudgetModal(bid) {
    const cur = bucketBudgets[bid];
    setBudgetModal({ bucket: bid, input: cur != null ? String(cur) : "500", period: bucketPeriods[bid] || "monthly" });
  }
  function saveBucketBudget() {
    if (!budgetModal) return;
    const bid = budgetModal.bucket;
    const v = parseFloat(budgetModal.input);
    const per = budgetModal.period || "none";
    if (!isNaN(v) && v > 0) {
      setBucketBudgets(p => ({ ...p, [bid]: v }));
      setBucketPeriods(p => ({ ...p, [bid]: per }));
      supaSaveBudget(bid, v, per);
    }
    setBudgetModal(null);
  }
  function clearBucketBudget() {
    if (!budgetModal) return;
    const bid = budgetModal.bucket;
    setBucketBudgets(p => { const n = { ...p }; delete n[bid]; return n; });
    setBucketPeriods(p => { const n = { ...p }; delete n[bid]; return n; });
    supaDeleteBudget(bid);
    setBudgetModal(null);
  }

  function getFiltered(bid) {
    let base = bid==="all" ? tasks : tasks.filter(t=>t.bucket===bid);
    if (hideCompleted) base = base.filter(t => t.status !== "completed");
    if (urgentOnly) base = base.filter(t => t.status !== "completed" && ["overdue","critical","soon"].includes(getUrgency(t.dueDate,t.status)));
    return [...base].sort((a,b) => {
      const aComp = a.status === "completed" ? 1 : 0;
      const bComp = b.status === "completed" ? 1 : 0;
      if (aComp !== bComp) return aComp - bComp;
      return a.priority - b.priority;
    });
  }

  function movePriority(id, dir, bid) {
    const sorted=getFiltered(bid), i=sorted.findIndex(t=>t.id===id), j=i+dir;
    if(j<0||j>=sorted.length) return;
    setTasks(prev=>prev.map(t=>{
      if(t.id===sorted[i].id) return {...t,priority:sorted[j].priority};
      if(t.id===sorted[j].id) return {...t,priority:sorted[i].priority};
      return t;
    }));
  }

  function updateDate(id,d) { setTasks(p=>p.map(t=>t.id===id?{...t,dueDate:d}:t)); }
  function openDefer(task) { setDeferModal({id:task.id,deferDate:task.deferDate||""}); }
  function saveDefer() {
    const dd = deferModal.deferDate||"TBD";
    setTasks(p=>p.map(t=>t.id===deferModal.id?{...t,status:"deferred",budgetStatus:"defer",deferDate:dd}:t));
    supaUpdate(deferModal.id, {status:"deferred",budgetStatus:"defer",deferDate:dd});
    setDeferModal(null);
  }
  function undefer(id) {
    setTasks(p=>p.map(t=>{
      if(t.id!==id) return t;
      const bs = t.cost?(t.cost<=remaining?"fits":"defer"):"flagged";
      supaUpdate(id,{status:"active",budgetStatus:bs,deferDate:null});
      return {...t,status:"active",budgetStatus:bs,deferDate:null};
    }));
  }

  function handleAdd() {
    if(!newTask.title) return;
    const cost = newTask.cost ? parseFloat(newTask.cost) : null;
    if(cost===null) { setFlagPrompt({task:newTask}); setShowAdd(false); return; }
    finalize(newTask, cost);
  }

  function finalize(task, cost) {
    const bs = cost===null?"flagged":cost<=remaining?"fits":"defer";
    const bt = tasks.filter(t=>t.bucket===task.bucket);
    const newTask2 = {
      id:Math.max(0,...tasks.map(t=>t.id))+1,
      title:task.title, bucket:task.bucket,
      priority:bt.length+1,
      dueDate:task.dueDate||"2026-12-31",
      cost, budgetStatus:bs,
      status:bs==="defer"?"deferred":"active",
      source:task.source, notes:task.notes,
    };
    setTasks(p=>[...p, newTask2]);
    supaUpsert([newTask2]);
    setNewTask({title:"",dueDate:"",cost:"",notes:"",source:"manual",bucket:"work"});
    setSuggestion(null);
    setShowAdd(false); setFlagPrompt(null);
  }

  function saveEdit() {
    const cost = editTask.cost!==""&&editTask.cost!==null ? parseFloat(editTask.cost) : null;
    const bs = cost===null?"flagged":cost<=remaining?"fits":"defer";
    const updated = {...editTask, cost, budgetStatus:bs};
    setTasks(p=>p.map(t=>t.id===editTask.id?updated:t));
    supaUpdate(editTask.id, {title:updated.title,bucket:updated.bucket,dueDate:updated.dueDate,cost,budgetStatus:bs,notes:updated.notes});
    setEditTask(null); setEditSuggestion(null);
  }

  function deleteTask(id) { setTasks(p=>p.filter(t=>t.id!==id)); supaDelete(id); setEditTask(null); setEditSuggestion(null); }

  function handleDragReorder(fromIdx, toIdx, currentTasks) {
    const arr = [...currentTasks];
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    // Reassign priorities based on new order
    const updated = arr.map((t, i) => ({ ...t, priority: i + 1 }));
    setTasks(prev => {
      const ids = new Set(updated.map(t => t.id));
      const others = prev.filter(t => !ids.has(t.id));
      return [...others, ...updated].sort((a,b) => a.priority - b.priority);
    });
    // Save updated priorities to Supabase
    updated.forEach(t => supaUpdate(t.id, { priority: t.priority }));
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(display.map(t => t.id)));
  }

  function deselectAll() { setSelectedIds(new Set()); }

  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()); }

  async function batchDelete() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setTasks(p => p.filter(t => !selectedIds.has(t.id)));
    ids.forEach(id => supaDelete(id));
    exitSelectMode();
  }

  function toggleComplete(id) {
    setTasks(p => p.map(t => {
      if (t.id !== id) return t;
      const done = t.status !== "completed";
      supaUpdate(id, { status: done ? "completed" : "active" });
      return { ...t, status: done ? "completed" : "active" };
    }));
  }

  function handleSmartImport(candidates) {
    const base = Math.max(0,...tasks.map(t=>t.id));
    const toAdd = candidates.map((c,i) => {
      const cost = c.cost ? parseFloat(c.cost) : null;
      const bs = cost===null?"flagged":cost<=remaining?"fits":"defer";
      const bt = tasks.filter(t=>t.bucket===(c.bucket||"work"));
      return { id:base+i+1, title:c.title, bucket:c.bucket||"work",
        priority:bt.length+i+1, dueDate:c.dueDate||"2026-12-31",
        cost, budgetStatus:bs, status:bs==="defer"?"deferred":"active",
        source:"screenshot", notes:c.notes||"" };
    });
    setTasks(p=>[...p,...toAdd]);
    supaUpsert(toAdd);
    setShowImage(false); setShowPaste(false);
    setImportSuccess(toAdd.length);
    setTimeout(()=>setImportSuccess(null),4000);
  }

  function handleDriveImport(candidates) {
    const base = Math.max(...tasks.map(t=>t.id));
    const toAdd = candidates.map((c,i)=>{
      const cost = c.cost ? parseFloat(c.cost) : null;
      const bs = cost===null?"flagged":cost<=remaining?"fits":"defer";
      const bt = tasks.filter(t=>t.bucket==="work");
      return { id:base+i+1, title:c.title, bucket:"work", priority:bt.length+i+1,
        dueDate:c.dueDate||"2026-12-31", cost, budgetStatus:bs,
        status:bs==="defer"?"deferred":"active", source:"google-doc", notes:c.notes||"" };
    });
    setTasks(p=>[...p,...toAdd]);
    supaUpsert(toAdd);
    setShowDrive(false);
    setImportSuccess(toAdd.length);
    setActiveBucket("work");
    setTimeout(()=>setImportSuccess(null),4000);
  }

  const display   = getFiltered(activeBucket);
  const curBucket = BUCKETS.find(b=>b.id===activeBucket);
  const accent    = curBucket?.color || PINK;
  const overdueCount = tasks.filter(t=>t.status!=="completed"&&t.status!=="deferred"&&getUrgency(t.dueDate,t.status)==="overdue").length;
  const dueSoonCount = tasks.filter(t=>t.status!=="completed"&&t.status!=="deferred"&&["critical","soon"].includes(getUrgency(t.dueDate,t.status))).length;
  function toggleUrgent() {
    setUrgentOnly(p => {
      const next = !p;
      if (next) { setActiveBucket("all"); setViewMode("list"); }
      return next;
    });
  }

  // Early returns AFTER all hooks
  if (!authReady) return <AuthLoading/>;
  if (!user) return <Login/>;
  if (!isAllowed(user.email)) return <NotAllowed email={user.email} onSignOut={handleSignOut}/>;
  if (isLoadingFromDB) return (
    <div style={{minHeight:"100vh",background:"#FBF7F2",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",gap:16}}>
      <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:28,
        background:"linear-gradient(135deg,#FF2D78,#FF6B00)",WebkitBackgroundClip:"text",
        WebkitTextFillColor:"transparent",backgroundClip:"text"}}>flourish</div>
      <div style={{fontSize:40,animation:"pulse 1.2s ease-in-out infinite"}}>🌸</div>
      <div style={{fontSize:13,color:"#9C8C76",fontWeight:500}}>Loading your tasks...</div>
    </div>
  );

  const inputSty = { width:"100%",background:"#FCF8F2",border:"1px solid #EBE2D4",borderRadius:10,
    padding:"10px 13px",color:"#1E1A2E",fontFamily:"Plus Jakarta Sans,sans-serif",fontSize:13,fontWeight:500,outline:"none" };

  return (
    <>
      <style>{`
        ${FONTS}
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;background:#FBF7F2;}
        .app{min-height:100vh;background:#FBF7F2;font-family:'Plus Jakarta Sans',sans-serif;color:#1E1A2E;}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
        @keyframes slideDown{from{transform:translateY(-10px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes gs{0%{background-position:0%}100%{background-position:200%}}
        .toast{position:fixed;top:76px;left:50%;transform:translateX(-50%);
          background:linear-gradient(135deg,${PINK},${ORANGE});color:#fff;
          padding:12px 24px;border-radius:40px;font-family:'Syne',sans-serif;
          font-weight:800;font-size:14px;z-index:200;box-shadow:0 8px 24px ${PINK}44;animation:slideDown 0.3s ease;}
        .hdr{background:#fff;border-bottom:1px solid #EBE2D4;padding:0 24px;display:flex;
          align-items:center;justify-content:space-between;height:60px;position:sticky;top:0;z-index:50;
          box-shadow:0 2px 12px #CFC2AC15;position:relative;}
        .hdr::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;
          background:linear-gradient(90deg,${PINK},${ORANGE},${YB},${CYAN},${PURPLE},${PINK});
          background-size:200%;animation:gs 5s linear infinite;}
        .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:22px;letter-spacing:-1px;
          background:linear-gradient(135deg,${PINK},${ORANGE});-webkit-background-clip:text;
          -webkit-text-fill-color:transparent;background-clip:text;line-height:1;}
        .logo-sub{font-size:8px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#BDB19A;}
        .hdr-stats{display:flex;gap:20px;align-items:center;}
        .hdr-stat{display:flex;flex-direction:column;align-items:flex-end;}
        .hdr-stat-label{color:#C6BAA6;font-size:8px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;}
        .hdr-stat-val{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;}
        .budget-tap{cursor:pointer;border-bottom:1.5px dashed ${PINK}88;}
        .desktop-layout{display:grid;grid-template-columns:256px 1fr;height:calc(100vh - 60px);}
        .sidebar{background:#F7F1E8;border-right:1px solid #EBE2D4;padding:20px 14px;overflow-y:auto;display:flex;flex-direction:column;gap:22px;}
        .sec-label{font-family:'Syne',sans-serif;font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#C6BAA6;margin-bottom:9px;}
        .bucket-nav{display:flex;flex-direction:column;gap:4px;}
        .bkt-btn{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid transparent;
          cursor:pointer;font-size:13px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;
          background:transparent;color:#9C8C76;transition:all 0.18s;text-align:left;width:100%;}
        .bkt-btn:hover{background:#FBF7F2;color:#6A5942;border-color:#EBE2D4;}
        .bkt-btn.active{border-color:var(--bc);background:var(--bbg);color:var(--bc);box-shadow:0 2px 10px var(--bc)22;}
        .bkt-icon{font-size:16px;width:20px;text-align:center;}
        .bkt-count{margin-left:auto;font-family:'Syne',sans-serif;font-weight:800;font-size:13px;}
        .bar-bg{height:7px;background:#EBE2D4;border-radius:4px;overflow:hidden;margin:7px 0;}
        .bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,${PINK},${ORANGE});transition:width 0.5s;}
        .bar-row{display:flex;justify-content:space-between;font-size:10px;color:#9C8C76;font-weight:600;}
        .imp-list{display:flex;flex-direction:column;gap:5px;}
        .imp-btn{display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:9px;border:1px solid #EBE2D4;
          background:#fff;cursor:pointer;font-size:12px;color:#8E7F66;font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;transition:all 0.18s;}
        .imp-btn:hover{border-color:${PINK}88;color:${PINK};background:#FFF0F5;}
        .imp-btn.drive{border-color:#0099CC44;color:${CYAN};background:#F0FAFF;}
        .imp-btn.drive:hover{border-color:${CYAN};background:#E0F5FF;}
        .urg-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;}
        .main-area{padding:24px 28px;overflow-y:auto;background:#FBF7F2;}
        .mobile-layout{display:none;flex-direction:column;height:calc(100vh - 60px);}
        .mob-bucket-strip{background:#fff;border-bottom:1px solid #FBF7F2;padding:10px 16px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;flex-shrink:0;}
        .mob-bucket-strip::-webkit-scrollbar{display:none;}
        .mob-bkt{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;border:1.5px solid #EBE2D4;
          background:#FCF8F2;cursor:pointer;font-size:12px;font-weight:700;font-family:'Plus Jakarta Sans',sans-serif;
          color:#9C8C76;white-space:nowrap;transition:all 0.18s;flex-shrink:0;}
        .mob-bkt.active{border-color:var(--bc);background:var(--bbg);color:var(--bc);}
        .mob-stats{background:#fff;border-bottom:1px solid #FBF7F2;padding:10px 16px;display:flex;flex-shrink:0;}
        .mob-stat{flex:1;display:flex;flex-direction:column;align-items:center;}
        .mob-stat+.mob-stat{border-left:1px solid #FBF7F2;}
        .mob-stat-label{font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#C6BAA6;}
        .mob-stat-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;margin-top:1px;}
        .mob-main{flex:1;overflow-y:auto;padding:14px 14px 100px;background:#FBF7F2;}
        .mob-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
        .mob-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#1E1A2E;}
        .mob-title span{color:var(--ac,${PINK});}
        .mob-actions{display:flex;gap:8px;}
        .mob-view-btn{background:#fff;border:1px solid #EBE2D4;color:#9C8C76;padding:7px 12px;border-radius:8px;font-size:11px;font-family:'Syne',sans-serif;font-weight:700;cursor:pointer;}
        .mob-view-btn.active{background:#FBF7F2;color:${PINK};border-color:${PINK}44;}
        .mob-nav{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #EBE2D4;
          display:none;justify-content:space-around;align-items:center;
          padding:8px 0 max(8px,env(safe-area-inset-bottom));z-index:60;box-shadow:0 -4px 20px #CABEA815;}
        .mob-nav-item{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;
          padding:4px 6px;border-radius:10px;transition:all 0.15s;min-width:40px;}
        .mob-nav-item.active{background:#FBF7F2;}
        .mob-nav-icon{font-size:18px;line-height:1;}
        .mob-nav-label{font-size:8px;font-weight:700;color:#7A6E58;letter-spacing:0.5px;text-transform:uppercase;}
        .mob-nav-item.active .mob-nav-label{color:${PINK};}
        .fab{position:fixed;bottom:max(76px,calc(60px + env(safe-area-inset-bottom)));right:18px;
          width:54px;height:54px;border-radius:27px;background:linear-gradient(135deg,${PINK},${ORANGE});
          border:none;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 6px 20px ${PINK}55;
          display:none;align-items:center;justify-content:center;z-index:60;transition:transform 0.15s;}
        .fab:hover{transform:scale(1.05);}
        .main-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px;}
        .main-title{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#1E1A2E;}
        .main-title span{color:var(--ac,${PINK});}
        .hdr-right{display:flex;gap:8px;align-items:center;}
        .view-toggle{display:flex;background:#fff;border:1px solid #EBE2D4;border-radius:9px;overflow:hidden;}
        .vt-btn{padding:7px 14px;font-size:11px;font-family:'Syne',sans-serif;font-weight:700;background:none;border:none;color:#B7AA92;cursor:pointer;transition:all 0.18s;}
        .vt-btn.active{background:#FBF7F2;color:${PINK};}
        .add-btn{background:linear-gradient(135deg,${PINK},${ORANGE});color:#fff;border:none;padding:9px 18px;
          border-radius:9px;font-family:'Syne',sans-serif;font-weight:800;font-size:12px;cursor:pointer;
          box-shadow:0 3px 14px ${PINK}44;transition:all 0.18s;}
        .add-btn:hover{transform:translateY(-1px);box-shadow:0 5px 20px ${PINK}55;}
        .legend{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;}
        .leg-item{display:flex;align-items:center;gap:4px;font-size:10px;color:#9C8C76;font-weight:600;}
        .leg-dot{width:7px;height:7px;border-radius:50%;}
        .task-list{display:flex;flex-direction:column;gap:9px;}
        .task-card{background:#fff;border:1px solid #EBE2D4;border-radius:13px;padding:13px 16px;
          display:grid;grid-template-columns:32px 1fr auto;gap:12px;align-items:start;
          transition:all 0.18s;box-shadow:0 2px 8px #CABEA810;}
        .task-card:hover{border-color:#CFC2AC;transform:translateY(-1px);box-shadow:0 5px 18px #CABEA820;}
        .pri-col{display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:2px;}
        .pri-num{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;line-height:1;}
        .arr-btn{background:none;border:none;color:#D3C8B4;cursor:pointer;font-size:10px;padding:1px;transition:color 0.15s;}
        .arr-btn:hover{color:${PINK};}
        .task-body{min-width:0;}
        .t-title-row{display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap;}
        .t-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#1E1A2E;}
        .t-title.def{color:#C6BAA6;text-decoration:line-through;}
        .bkt-pill{font-size:8px;font-weight:700;letter-spacing:1px;padding:2px 7px;border-radius:4px;border:1px solid;text-transform:uppercase;}
        .urg-badge{font-size:8px;font-weight:700;letter-spacing:1px;padding:2px 7px;border-radius:4px;border:1px solid;}
        .src-badge{font-size:11px;color:#C6BAA6;}
        .t-meta{display:flex;gap:8px;font-size:10px;color:#9C8C76;flex-wrap:wrap;align-items:center;font-weight:600;}
        .cost-badge{background:#F6F0E7;color:#6B6051;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;}
        .cost-badge.fits{color:#007A49;background:#E8F8F0;}
        .cost-badge.defer{color:#B34D00;background:#FFF3E8;}
        .cost-badge.over{color:#B34D00;background:#FFF3E8;}
        .cost-badge.tracked{color:#6B6051;background:#F6F0E7;}
        .cost-badge.flagged{color:#7D5E00;background:#FFF8E0;border:1px solid #D4A80044;}
        .t-notes{font-size:10px;color:#B4A88F;margin-top:4px;font-style:italic;}
        .act-col{display:flex;flex-direction:column;gap:4px;align-items:flex-end;}
        .act-btn{background:none;border:1px solid #EBE2D4;color:#9C8C76;padding:4px 9px;border-radius:6px;
          font-size:10px;cursor:pointer;white-space:nowrap;transition:all 0.15s;font-weight:600;}
        .act-btn:hover{border-color:${PINK}88;color:${PINK};background:#FFF0F5;}
        .act-btn.def-act{border-color:${ORANGE}55;color:${ORANGE};background:#FFF3E8;}
        .cmp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;}
        .cmp-col{background:#fff;border:1px solid #EBE2D4;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px #CABEA810;}
        .cmp-hdr{padding:11px 13px;display:flex;align-items:center;gap:7px;border-bottom:1px solid #FBF7F2;position:relative;}
        .cmp-hdr::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--bc);opacity:0.5;}
        .cmp-hdr-icon{font-size:14px;}
        .cmp-hdr-title{font-family:'Syne',sans-serif;font-weight:800;font-size:11px;}
        .cmp-hdr-count{margin-left:auto;font-size:10px;color:#C6BAA6;font-weight:700;}
        .cmp-list{padding:8px;display:flex;flex-direction:column;gap:7px;}
        .cmp-task{padding:9px 11px;border-radius:9px;border:1px solid;background:#FFFDF9;}
        .cmp-task-hdr{display:flex;gap:5px;margin-bottom:4px;}
        .cmp-num{font-family:'Syne',sans-serif;font-size:11px;font-weight:800;flex-shrink:0;}
        .cmp-ttitle{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;color:#332C20;line-height:1.3;}
        .cmp-ttitle.def{color:#C6BAA6;text-decoration:line-through;}
        .cmp-meta{font-size:9px;color:#B4A890;display:flex;gap:6px;flex-wrap:wrap;font-weight:600;}
        .mob-cmp-scroll{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;}
        .mob-cmp-scroll::-webkit-scrollbar{display:none;}
        .mob-cmp-col{min-width:200px;background:#fff;border:1px solid #EBE2D4;border-radius:14px;overflow:hidden;flex-shrink:0;}
        .overlay{position:fixed;inset:0;background:#3A2A1866;display:flex;align-items:flex-end;justify-content:center;z-index:100;backdrop-filter:blur(5px);}
        @media(min-width:640px){.overlay{align-items:center;}}
        .modal{background:#fff;border:1px solid #EBE2D4;border-radius:20px 20px 0 0;padding:28px 24px;
          width:100%;max-width:480px;box-shadow:0 -8px 40px #3A2A1818;max-height:92vh;overflow-y:auto;}
        @media(min-width:640px){.modal{border-radius:20px;padding:30px;}}
        .modal-title{font-family:'Syne',sans-serif;font-size:19px;font-weight:800;color:#1E1A2E;margin-bottom:20px;}
        .modal-title span{background:linear-gradient(135deg,${PINK},${ORANGE});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
        .modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;}
        .cancel-btn{background:none;border:1px solid #EBE2D4;color:#9C8C76;padding:10px 16px;border-radius:10px;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:600;}
        .cancel-btn:hover{border-color:#B4A88F;}
        .delete-btn{background:none;border:1px solid ${PINK}44;color:${PINK};padding:10px 16px;border-radius:10px;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:600;margin-right:auto;}
        .delete-btn:hover{background:#FFF0F5;}
        .flag-box{background:#FFFBF0;border:1px solid #D4A80044;border-radius:14px;padding:24px;text-align:center;}
        .flag-icon{font-size:32px;margin-bottom:10px;}
        .flag-title{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;color:#A07800;margin-bottom:8px;}
        .flag-desc{font-size:13px;color:#9C8C76;margin-bottom:18px;line-height:1.7;font-weight:500;}
        .flag-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
        .defer-box{text-align:center;}
        .defer-icon{font-size:30px;margin-bottom:10px;}
        .defer-title{font-family:'Syne',sans-serif;font-weight:800;font-size:17px;color:#1E1A2E;margin-bottom:6px;}
        .defer-sub{font-size:12px;color:#9C8C76;margin-bottom:20px;font-weight:500;}
        @media(max-width:768px){
          .desktop-layout{display:none!important;}
          .mobile-layout{display:flex!important;}
          .mob-nav{display:flex!important;}
          .fab{display:flex!important;}
          .hdr-stats{display:none;}
        }
        @media(min-width:769px){.mob-nav{display:none!important;}.fab{display:none!important;}}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#EBE2D4;border-radius:2px;}
      `}</style>

      <div className="app">
        {importSuccess&&<div className="toast">✨ {importSuccess} task{importSuccess!==1?"s":""} imported to Work!</div>}

        {/* HEADER */}
        <div className="hdr">
          <div><div className="logo">flourish</div><div className="logo-sub">your goals, blooming</div></div>
          <div className="hdr-stats">
            <div className="hdr-stat">
              <span className="hdr-stat-label">Tasks</span>
              <span className="hdr-stat-val" style={{color:CYAN}}>{tasks.length}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,paddingLeft:16,marginLeft:4,borderLeft:"1px solid #EBE2D4"}}>
              <span style={{fontSize:11,color:"#9C8C76",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</span>
              <button onClick={handleSignOut} style={{fontSize:11,fontWeight:700,color:"#5C5343",background:"#FBF7F2",border:"1px solid #EBE2D4",borderRadius:10,padding:"5px 12px",cursor:"pointer"}}>Sign out</button>
            </div>
          </div>
        </div>

        {/* DESKTOP */}
        <div className="desktop-layout">
          <div className="sidebar">
            <div>
              <div className="sec-label">My Buckets</div>
              <div className="bucket-nav">
                <button className={`bkt-btn ${activeBucket==="all"?"active":""}`}
                  style={{"--bc":"#786849","--bbg":"#FBF7F2"}} onClick={()=>setActiveBucket("all")}>
                  <span className="bkt-icon">✨</span><span>All Tasks</span>
                  <span className="bkt-count" style={{color:activeBucket==="all"?"#786849":"#C6BAA6"}}>{tasks.length}</span>
                </button>
                {BUCKETS.map(b=>{
                  const cap = bucketBudgets[b.id];
                  const committed = bucketCommitted(tasks, b.id, bucketPeriods[b.id]);
                  const pct = cap ? Math.min((committed/cap)*100,100) : 0;
                  const over = cap != null && committed > cap;
                  return (
                  <div key={b.id}>
                    <button className={`bkt-btn ${activeBucket===b.id?"active":""}`}
                      style={{"--bc":b.color,"--bbg":b.bg}} onClick={()=>setActiveBucket(b.id)}>
                      <span className="bkt-icon">{b.icon}</span><span>{b.label}</span>
                      <span className="bkt-count" style={{color:activeBucket===b.id?b.color:"#C6BAA6"}}>
                        {tasks.filter(t=>t.bucket===b.id).length}
                      </span>
                    </button>
                    {cap != null && (
                      <div style={{padding:"1px 12px 6px"}}>
                        <div style={{height:4,background:"#EBE2D4",borderRadius:3,overflow:"hidden",marginBottom:2}}>
                          <div style={{width:`${pct}%`,height:"100%",background:over?"#FC4F38":b.color}}/>
                        </div>
                        <div style={{fontSize:9,color:over?"#C0271A":"#5C5343",fontWeight:700,textAlign:"right"}}>{over?"⚠ ":""}${committed} / ${cap}</div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="sec-label">Import From</div>
              <div className="imp-list">
                {/* Google Drive import hidden during testing — folder is hardwired to owner's RWRLRR. Revisit later (folder picker). */}
                {false && (
                <button className="imp-btn drive" onClick={()=>setShowDrive(true)}>
                  <span>📄</span><span>Google Drive (RWRLRR)</span>
                </button>
                )}
                {[{id:"screenshot",label:"Screenshot / Image",icon:"📸",action:()=>setShowImage(true)},
                  {id:"paste",label:"Copy & Paste",icon:"📋",action:()=>setShowPaste(true)},
                ].map(m=>(
                  <button key={m.id} className="imp-btn" onClick={m.action}>
                    <span>{m.icon}</span><span>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="sec-label">Status Summary</div>
              {Object.entries(UC).map(([key,cfg])=>{
                const count=(activeBucket==="all"?tasks:tasks.filter(t=>t.bucket===activeBucket)).filter(t=>getUrgency(t.dueDate,t.status)===key).length;
                if(!count) return null;
                return <div key={key} className="urg-row">
                  <span style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:cfg.dot,display:"inline-block"}}/>
                    <span style={{color:"#9C8C76",fontSize:11,fontWeight:700}}>{cfg.label}</span>
                  </span>
                  <span style={{color:cfg.text,fontFamily:"Syne",fontWeight:800,fontSize:13}}>{count}</span>
                </div>;
              })}
            </div>
            <div>
              <div className="sec-label">Time Allocation</div>
              <TimeAllocChart tasks={tasks}/>
            </div>
          </div>

          <div className="main-area" style={{"--ac":accent}}>
            <div className="main-hdr">
              <div className="main-title">
                {activeBucket==="all"?<>All <span>Tasks</span></>:<>{curBucket?.icon} <span>{curBucket?.label}</span></>}
              </div>
              <div className="hdr-right">
                {!selectMode?(
                  <button className="act-btn" style={{border:`1px solid #EBE2D4`,color:"#9C8C76",background:"#fff",padding:"7px 14px",borderRadius:9,fontSize:11,fontFamily:"Syne,sans-serif",fontWeight:700,cursor:"pointer"}}
                    onClick={()=>{setSelectMode(true);setSelectedIds(new Set());}}>☑ Select</button>
                ):(
                  <button className="act-btn" style={{border:`1px solid ${PINK}44`,color:PINK,background:"#FFF0F5",padding:"7px 14px",borderRadius:9,fontSize:11,fontFamily:"Syne,sans-serif",fontWeight:700,cursor:"pointer"}}
                    onClick={exitSelectMode}>✕ Cancel</button>
                )}
                <div className="view-toggle">
                  <button className={`vt-btn ${viewMode==="list"?"active":""}`} onClick={()=>setViewMode("list")}>List</button>
                  <button className={`vt-btn ${viewMode==="compare"?"active":""}`} onClick={()=>setViewMode("compare")}>Compare</button>
                </div>
                <button className="add-btn" onClick={()=>{setNewTask(p=>({...p,bucket:activeBucket!=="all"?activeBucket:"work"}));setInputMode("manual");setShowAdd(true);}}>+ Add Task</button>
              </div>
            </div>
            {viewMode==="list"&&<AlertBanner overdueCount={overdueCount} dueSoonCount={dueSoonCount} urgentOnly={urgentOnly} onToggle={toggleUrgent}/>}
            {selectMode&&viewMode==="list"&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"8px 14px",background:"#FFF0F5",border:`1px solid ${PINK}33`,
                borderRadius:10,marginBottom:12}}>
                <span style={{fontSize:12,fontWeight:700,color:PINK}}>{selectedIds.size} selected</span>
                <div style={{display:"flex",gap:12}}>
                  <button onClick={selectAll} style={{background:"none",border:"none",color:PINK,fontSize:11,fontWeight:700,cursor:"pointer"}}>Select all ({display.length})</button>
                  <button onClick={deselectAll} style={{background:"none",border:"none",color:"#9C8C76",fontSize:11,fontWeight:600,cursor:"pointer"}}>Deselect all</button>
                </div>
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
              <div className="legend" style={{marginBottom:0}}>
                {Object.entries(UC).map(([k,c])=>(
                  <div key={k} className="leg-item"><div className="leg-dot" style={{background:c.dot}}/><span>{c.label}</span></div>
                ))}
              </div>
              <button onClick={()=>setHideCompleted(p=>!p)}
                style={{background:"none",border:"1px solid #EBE2D4",borderRadius:8,padding:"5px 12px",
                  fontSize:11,fontWeight:700,cursor:"pointer",color:hideCompleted?"#00A060":"#9C8C76",
                  fontFamily:"Syne,sans-serif",whiteSpace:"nowrap"}}>
                {hideCompleted?"Show Completed":"Hide Completed"}
              </button>
            </div>
            {activeBucket!=="all"&&viewMode==="list"&&(
              <BucketBudgetHeader bucket={curBucket} committed={bucketCommitted(tasks,activeBucket,bucketPeriods[activeBucket])} cap={bucketBudgets[activeBucket]} period={bucketPeriods[activeBucket]} onEdit={()=>openBudgetModal(activeBucket)}/>
            )}
            {viewMode==="list"
              ?<TaskList tasks={display} allTasks={tasks} bucketBudgets={bucketBudgets} bucketPeriods={bucketPeriods} activeBucket={activeBucket} onMove={movePriority} onDate={updateDate} onEdit={t=>{setEditTask({...t,cost:t.cost??""});setEditSuggestion(null);}} onDefer={openDefer} onUndefer={undefer} onDragReorder={handleDragReorder} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={toggleSelect} onComplete={toggleComplete}/>
              :<div className="cmp-grid">{BUCKETS.map(b=><CompareCol key={b.id} bucket={b} tasks={getFiltered(b.id)} allTasks={tasks} bucketBudgets={bucketBudgets} bucketPeriods={bucketPeriods}/>)}</div>
            }
            {selectMode&&selectedIds.size>0&&(
              <div style={{position:"sticky",bottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"12px 18px",background:"#fff",border:`1.5px solid ${PINK}44`,borderRadius:14,
                boxShadow:`0 4px 20px ${PINK}22`,marginTop:12}}>
                <span style={{fontSize:13,color:"#9C8C76",fontWeight:600}}>{selectedIds.size} task{selectedIds.size!==1?"s":""} selected</span>
                <button onClick={batchDelete} style={{background:PINK,color:"#fff",border:"none",
                  padding:"9px 20px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",
                  display:"flex",alignItems:"center",gap:6,fontFamily:"Syne,sans-serif"}}>
                  🗑 Delete {selectedIds.size}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* MOBILE */}
        <div className="mobile-layout" style={{"--ac":accent}}>
          <div className="mob-bucket-strip">
            <div className={`mob-bkt ${activeBucket==="all"?"active":""}`} style={{"--bc":"#786849","--bbg":"#FBF7F2"}} onClick={()=>setActiveBucket("all")}>
              <span>✨</span><span>All</span>
            </div>
            {BUCKETS.map(b=>{
              const cap = bucketBudgets[b.id];
              const committed = bucketCommitted(tasks, b.id, bucketPeriods[b.id]);
              const pct = cap ? Math.min((committed/cap)*100,100) : 0;
              const over = cap != null && committed > cap;
              return (
              <div key={b.id} className={`mob-bkt ${activeBucket===b.id?"active":""}`} style={{"--bc":b.color,"--bbg":b.bg,flexDirection:"column",alignItems:"stretch"}} onClick={()=>setActiveBucket(b.id)}>
                <div style={{display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
                  <span>{b.icon}</span><span>{b.label.split(" ")[0]}</span>
                  <span style={{fontFamily:"Syne",fontWeight:800,fontSize:11,marginLeft:2,color:activeBucket===b.id?b.color:"#C6BAA6"}}>
                    {tasks.filter(t=>t.bucket===b.id).length}
                  </span>
                </div>
                {cap != null && (
                  <div style={{marginTop:4}}>
                    <div style={{height:3,background:"#EBE2D4",borderRadius:2,overflow:"hidden",marginBottom:2}}>
                      <div style={{width:`${pct}%`,height:"100%",background:over?"#FC4F38":b.color}}/>
                    </div>
                    <div style={{fontSize:8,fontWeight:700,color:over?"#C0271A":"#5C5343",textAlign:"center",whiteSpace:"nowrap"}}>{over?"⚠":""}${committed}/${cap}</div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
          <div className="mob-main">
            <div className="mob-top">
              <div className="mob-title">
                {activeBucket==="all"?<>All <span>Tasks</span></>:<>{curBucket?.icon} <span>{curBucket?.label}</span></>}
              </div>
              <div className="mob-actions">
                {!selectMode?(
                  <button className="mob-view-btn" onClick={()=>{setSelectMode(true);setSelectedIds(new Set());}}>☑ Select</button>
                ):(
                  <button className="mob-view-btn active" onClick={exitSelectMode}>✕ Cancel</button>
                )}
                <button className={`mob-view-btn ${viewMode==="list"?"active":""}`} onClick={()=>setViewMode("list")}>List</button>
                <button className={`mob-view-btn ${viewMode==="compare"?"active":""}`} onClick={()=>setViewMode("compare")}>Compare</button>
              </div>
            </div>
            {viewMode==="list"&&<AlertBanner overdueCount={overdueCount} dueSoonCount={dueSoonCount} urgentOnly={urgentOnly} onToggle={toggleUrgent}/>}
            {selectMode&&viewMode==="list"&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"8px 12px",background:"#FFF0F5",border:`1px solid ${PINK}33`,
                borderRadius:10,marginBottom:10}}>
                <span style={{fontSize:11,fontWeight:700,color:PINK}}>{selectedIds.size} selected</span>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={selectAll} style={{background:"none",border:"none",color:PINK,fontSize:10,fontWeight:700,cursor:"pointer"}}>Select all</button>
                  <button onClick={deselectAll} style={{background:"none",border:"none",color:"#9C8C76",fontSize:10,fontWeight:600,cursor:"pointer"}}>Deselect all</button>
                </div>
              </div>
            )}
            {activeBucket!=="all"&&viewMode==="list"&&(
              <BucketBudgetHeader bucket={curBucket} committed={bucketCommitted(tasks,activeBucket,bucketPeriods[activeBucket])} cap={bucketBudgets[activeBucket]} period={bucketPeriods[activeBucket]} onEdit={()=>openBudgetModal(activeBucket)}/>
            )}
            {viewMode==="list"
              ?<TaskList tasks={display} allTasks={tasks} bucketBudgets={bucketBudgets} bucketPeriods={bucketPeriods} activeBucket={activeBucket} onMove={movePriority} onDate={updateDate} onEdit={t=>{setEditTask({...t,cost:t.cost??""});setEditSuggestion(null);}} onDefer={openDefer} onUndefer={undefer} onDragReorder={handleDragReorder} selectMode={selectMode} selectedIds={selectedIds} onToggleSelect={toggleSelect} onComplete={toggleComplete}/>
              :<div className="mob-cmp-scroll">{BUCKETS.map(b=><div key={b.id} className="mob-cmp-col cmp-col"><CompareCol bucket={b} tasks={getFiltered(b.id)} allTasks={tasks} bucketBudgets={bucketBudgets} bucketPeriods={bucketPeriods}/></div>)}</div>
            }
            {selectMode&&selectedIds.size>0&&(
              <div style={{position:"sticky",bottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"12px 16px",background:"#fff",border:`1.5px solid ${PINK}44`,borderRadius:14,
                boxShadow:`0 4px 20px ${PINK}22`,marginTop:10}}>
                <span style={{fontSize:12,color:"#9C8C76",fontWeight:600}}>{selectedIds.size} selected</span>
                <button onClick={batchDelete} style={{background:PINK,color:"#fff",border:"none",
                  padding:"9px 18px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"Syne,sans-serif"}}>
                  🗑 Delete {selectedIds.size}
                </button>
              </div>
            )}
          </div>
        </div>

        <button className="fab" onClick={()=>{setNewTask(p=>({...p,bucket:activeBucket!=="all"?activeBucket:"work"}));setInputMode("manual");setShowAdd(true);}}>+</button>

        <div className="mob-nav">
          <div className={`mob-nav-item ${activeBucket==="all"?"active":""}`} onClick={()=>setActiveBucket("all")}>
            <span className="mob-nav-icon">✨</span><span className="mob-nav-label">All</span>
          </div>
          {BUCKETS.map(b=>(
            <div key={b.id} className={`mob-nav-item ${activeBucket===b.id?"active":""}`} onClick={()=>setActiveBucket(b.id)}>
              <span className="mob-nav-icon">{b.icon}</span>
              <span className="mob-nav-label" style={{color:activeBucket===b.id?b.color:undefined}}>{b.label.split(" ")[0]}</span>
            </div>
          ))}
          <div className="mob-nav-item" onClick={()=>setShowImport(true)}>
            <span className="mob-nav-icon">⬆️</span><span className="mob-nav-label">Import</span>
          </div>
          <div className="mob-nav-item" onClick={()=>setShowTimeAlloc(true)}>
            <span className="mob-nav-icon">📊</span><span className="mob-nav-label" style={{color:"#D08A6E"}}>My Time</span>
          </div>
          <div className="mob-nav-item" onClick={handleSignOut}>
            <span className="mob-nav-icon">🚪</span><span className="mob-nav-label">Sign Out</span>
          </div>
        </div>

        {/* MODALS */}

        {showDrive&&<DriveImport existingTasks={tasks} remaining={remaining} onConfirm={handleDriveImport} onClose={()=>setShowDrive(false)}/>}
        {showImage&&<ImageImport existingTasks={tasks} onConfirm={handleSmartImport} onClose={()=>setShowImage(false)}/>}
        {showPaste&&<PasteImport existingTasks={tasks} onConfirm={handleSmartImport} onClose={()=>setShowPaste(false)}/>}
        {showTimeAlloc&&<TimeAllocModal tasks={tasks} onClose={()=>setShowTimeAlloc(false)}/>}

        {/* ADD TASK */}
        {showAdd&&!flagPrompt&&(
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowAdd(false)}>
            <div className="modal">
              <div className="modal-title">Add a <span>Task</span></div>
              <Field label="Task Title *">
                <input placeholder="What needs to get done?" value={newTask.title}
                  onChange={e=>handleTitleChange(e.target.value)} style={inputSty}/>
              </Field>
              <BucketSuggestion suggestion={suggestion} current={newTask.bucket} onAccept={acceptSuggestion} onDismiss={dismissSuggestion}/>
              <Field label="Bucket *">
                <select value={newTask.bucket} onChange={e=>{setNewTask(p=>({...p,bucket:e.target.value}));setSuggestion(null);}} style={inputSty}>
                  {BUCKETS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.label}</option>)}
                </select>
              </Field>
              <Field label="Source">
                <select value={inputMode} onChange={e=>setInputMode(e.target.value)} style={inputSty}>
                  <option value="manual">✏️ Manual Entry</option>
                  <option value="screenshot">📸 Screenshot / Image</option>
                  <option value="paste">📋 Copy & Paste</option>
                  <option value="google-doc">📄 Google Doc / Sheet</option>
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" value={newTask.dueDate} onChange={e=>setNewTask(p=>({...p,dueDate:e.target.value}))} style={inputSty}/>
              </Field>
              <Field label="Cost ($) — leave blank to be prompted">
                <input type="number" placeholder="e.g. 144" value={newTask.cost} onChange={e=>setNewTask(p=>({...p,cost:e.target.value}))} style={inputSty}/>
              </Field>
              <Field label="Notes">
                <input placeholder="Optional details" value={newTask.notes} onChange={e=>setNewTask(p=>({...p,notes:e.target.value}))} style={inputSty}/>
              </Field>
              <div className="modal-btns">
                <button className="cancel-btn" onClick={()=>{setShowAdd(false);setSuggestion(null);}}>Cancel</button>
                <button className="add-btn" onClick={handleAdd}>Add Task</button>
              </div>
            </div>
          </div>
        )}

        {/* EDIT TASK */}
        {editTask&&(
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&setEditTask(null)}>
            <div className="modal">
              <div className="modal-title">Edit <span>Task</span></div>
              <Field label="Task Title">
                <input value={editTask.title} onChange={e=>handleEditTitleChange(e.target.value)} style={inputSty}/>
              </Field>
              <BucketSuggestion suggestion={editSuggestion} current={editTask.bucket}
                onAccept={()=>{setEditTask(p=>({...p,bucket:editSuggestion}));setEditSuggestion(null);}}
                onDismiss={()=>setEditSuggestion(null)}/>
              <Field label="Bucket">
                <select value={editTask.bucket} onChange={e=>{setEditTask(p=>({...p,bucket:e.target.value}));setEditSuggestion(null);}} style={inputSty}>
                  {BUCKETS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.label}</option>)}
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" value={editTask.dueDate} onChange={e=>setEditTask(p=>({...p,dueDate:e.target.value}))} style={inputSty}/>
              </Field>
              <Field label="Cost ($)">
                <input type="number" value={editTask.cost??""} onChange={e=>setEditTask(p=>({...p,cost:e.target.value}))} style={inputSty}/>
              </Field>
              <Field label="Notes">
                <input value={editTask.notes} onChange={e=>setEditTask(p=>({...p,notes:e.target.value}))} style={inputSty}/>
              </Field>
              <div className="modal-btns">
                <button className="delete-btn" onClick={()=>deleteTask(editTask.id)}>Delete</button>
                <button className="cancel-btn" onClick={()=>{setEditTask(null);setEditSuggestion(null);}}>Cancel</button>
                <button className="add-btn" onClick={saveEdit}>Save Changes</button>
              </div>
            </div>
          </div>
        )}

        {/* DEFER */}
        {deferModal&&(
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&setDeferModal(null)}>
            <div className="modal">
              <div className="defer-box">
                <div className="defer-icon">🔁</div>
                <div className="defer-title">Defer This Task</div>
                <div className="defer-sub">Pick a date to revisit it.</div>
                <Field label="Revisit Date">
                  <input type="date" value={deferModal.deferDate} onChange={e=>setDeferModal(p=>({...p,deferDate:e.target.value}))} style={inputSty}/>
                </Field>
                <div className="modal-btns" style={{justifyContent:"center"}}>
                  <button className="cancel-btn" onClick={()=>setDeferModal(null)}>Cancel</button>
                  <button className="add-btn" onClick={saveDefer}>Defer Task</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MOBILE IMPORT */}
        {showImport&&(
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowImport(false)}>
            <div className="modal">
              <div className="modal-title">Import <span>Tasks</span></div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[
                  {id:"screenshot",label:"Screenshot / Image",icon:"📸",desc:"Photo of any note or list",action:()=>{setShowImport(false);setShowImage(true);}},
                  {id:"paste",label:"Copy & Paste",icon:"📋",desc:"Paste text from anywhere",action:()=>{setShowImport(false);setShowPaste(true);}},
                ].map(m=>(
                  <button key={m.id} onClick={m.action}
                    style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:12,
                      border:m.id==="drive"?"1px solid #0099CC44":"1px solid #EBE2D4",
                      background:m.id==="drive"?"#F0FAFF":"#FCF8F2",cursor:"pointer",textAlign:"left",width:"100%"}}>
                    <span style={{fontSize:24}}>{m.icon}</span>
                    <div>
                      <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:14,color:m.id==="drive"?CYAN:"#1E1A2E"}}>{m.label}</div>
                      <div style={{fontSize:11,color:"#9C8C76",marginTop:2,fontWeight:500}}>{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="modal-btns" style={{marginTop:16}}>
                <button className="cancel-btn" onClick={()=>setShowImport(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* MOBILE BUDGET */}
        {showBudgetPanel&&(
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowBudgetPanel(false)}>
            <div className="modal">
              <div className="modal-title">Update <span>Budget</span></div>
              <Field label="Total Budget ($)">
                <input type="number" value={budgetInput} autoFocus onChange={e=>setBudgetInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveBudget()} style={inputSty}/>
              </Field>
              <div style={{background:"#FCF8F2",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
                <div style={{fontSize:11,color:"#9C8C76",fontWeight:600,marginBottom:8}}>Current Breakdown</div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700,marginBottom:4}}>
                  <span>Committed</span><span style={{color:ORANGE}}>${spent}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700}}>
                  <span>Remaining</span><span style={{color:remaining>=0?"#00A060":PINK}}>${budget-spent}</span>
                </div>
              </div>
              <div className="modal-btns">
                <button className="cancel-btn" onClick={()=>setShowBudgetPanel(false)}>Cancel</button>
                <button className="add-btn" onClick={saveBudget}>Save Budget</button>
              </div>
            </div>
          </div>
        )}

        {budgetModal&&(()=>{
          const bk = BUCKETS.find(b=>b.id===budgetModal.bucket);
          const committed = bucketCommitted(tasks, budgetModal.bucket, budgetModal.period);
          const hasCurrent = bucketBudgets[budgetModal.bucket]!=null;
          return (
          <div className="overlay" onClick={e=>e.target===e.currentTarget&&setBudgetModal(null)}>
            <div className="modal">
              <div className="modal-title">{bk?.icon} <span>{bk?.label}</span> Budget</div>
              <Field label="Budget cap ($)">
                <input type="number" value={budgetModal.input} autoFocus onChange={e=>setBudgetModal(p=>({...p,input:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveBucketBudget()} style={inputSty}/>
              </Field>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:"1.5px",color:"#9C8C76",textTransform:"uppercase",marginBottom:6}}>Resets</div>
              <div style={{display:"flex",gap:6,marginBottom:14}}>
                {[{v:"none",l:"None"},{v:"daily",l:"Daily"},{v:"weekly",l:"Weekly"},{v:"monthly",l:"Monthly"}].map(o=>{
                  const sel = (budgetModal.period||"none")===o.v;
                  return <button key={o.v} onClick={()=>setBudgetModal(p=>({...p,period:o.v}))}
                    style={{flex:1,textAlign:"center",fontSize:11,fontWeight:sel?800:700,padding:"7px 4px",borderRadius:8,cursor:"pointer",
                      border:sel?`2px solid ${bk?.color||PINK}`:"1px solid #EBE2D4",
                      background:sel?(bk?.bg||"#FFF0F5"):"#fff",color:sel?(bk?.dark||PINK):"#9C8C76"}}>{o.l}</button>;
                })}
              </div>
              <div style={{background:"#FCF8F2",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700}}>
                  <span>Committed{budgetModal.period&&budgetModal.period!=="none"?` this ${budgetModal.period==="daily"?"day":budgetModal.period==="weekly"?"week":"month"}`:""}</span><span style={{color:ORANGE}}>${committed.toLocaleString()}</span>
                </div>
                <div style={{fontSize:11,color:"#9C8C76",marginTop:8}}>{budgetModal.period&&budgetModal.period!=="none"?"Only tasks dated in the current period count. It resets automatically.":"Fixed pot — every cost counts until you clear it."} Leave a bucket without a budget to just track costs.</div>
              </div>
              <div className="modal-btns">
                {hasCurrent
                  ? <button className="cancel-btn" onClick={clearBucketBudget}>Remove budget</button>
                  : <button className="cancel-btn" onClick={()=>setBudgetModal(null)}>Cancel</button>}
                <button className="add-btn" onClick={saveBucketBudget}>Save</button>
              </div>
            </div>
          </div>
          );
        })()}

        {/* MISSING COST */}
        {flagPrompt&&(
          <div className="overlay">
            <div className="modal">
              <div className="flag-box">
                <div className="flag-icon">⚑</div>
                <div className="flag-title">Missing Dollar Amount</div>
                <div className="flag-desc">
                  "<strong style={{color:"#1E1A2E"}}>{flagPrompt.task.title}</strong>" doesn't have a cost attached.<br/>
                  Does this task have a dollar amount?
                </div>
                <div className="flag-btns">
                  <button className="cancel-btn" onClick={()=>finalize(flagPrompt.task,null)}>No Cost</button>
                  <button className="add-btn" onClick={()=>{setShowAdd(true);setFlagPrompt(null);}}>Yes, Add Cost</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}


// ── Time Allocation Chart ──
function TimeAllocChart({ tasks, onClose }) {
  const total = tasks.length || 1;
  const bucketData = BUCKETS.map(b => ({
    ...b,
    count: tasks.filter(t => t.bucket === b.id).length,
    pct: Math.round((tasks.filter(t => t.bucket === b.id).length / total) * 100)
  })).filter(b => b.count > 0);

  // Build SVG pie slices
  function buildSlices() {
    let startAngle = -90;
    return bucketData.map(b => {
      const angle = (b.count / total) * 360;
      const endAngle = startAngle + angle;
      const r = 55, cx = 65, cy = 65;
      const start = polarToCart(cx, cy, r, startAngle);
      const end = polarToCart(cx, cy, r, endAngle);
      const largeArc = angle > 180 ? 1 : 0;
      const d = `M${cx},${cy} L${start.x},${start.y} A${r},${r} 0 ${largeArc},1 ${end.x},${end.y} Z`;
      startAngle = endAngle;
      return { ...b, d };
    });
  }

  function polarToCart(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const slices = buildSlices();

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
        <svg width="130" height="130" viewBox="0 0 130 130">
          {slices.map(s => <path key={s.id} d={s.d} fill={s.color}/>)}
          <circle cx="65" cy="65" r="32" fill="white"/>
          <text x="65" y="61" textAnchor="middle" fontSize="14" fontWeight="700" fill="#1E1A2E">{tasks.length}</text>
          <text x="65" y="74" textAnchor="middle" fontSize="9" fill="#9C8C76">tasks</text>
        </svg>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {bucketData.map(b => (
          <div key={b.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:b.color, flexShrink:0 }}/>
            <span style={{ fontSize:11, color:"#9C8C76", flex:1 }}>{b.label}</span>
            <div style={{ width:60, height:4, background:"#EBE2D4", borderRadius:2, overflow:"hidden" }}>
              <div style={{ width:`${b.pct}%`, height:"100%", background:b.color, borderRadius:2 }}/>
            </div>
            <span style={{ fontSize:11, fontWeight:700, color:b.color, minWidth:28, textAlign:"right" }}>{b.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Time Allocation Modal (mobile) ──
function TimeAllocModal({ tasks, onClose }) {
  const total = tasks.length || 1;
  const bucketData = BUCKETS.map(b => ({
    ...b,
    count: tasks.filter(t => t.bucket === b.id).length,
    pct: Math.round((tasks.filter(t => t.bucket === b.id).length / total) * 100)
  })).filter(b => b.count > 0);

  function buildSlices() {
    let startAngle = -90;
    return bucketData.map(b => {
      const angle = (b.count / total) * 360;
      const endAngle = startAngle + angle;
      const r = 40, cx = 45, cy = 45;
      const start = polarToCart(cx, cy, r, startAngle);
      const end = polarToCart(cx, cy, r, endAngle);
      const largeArc = angle > 180 ? 1 : 0;
      const d = `M${cx},${cy} L${start.x},${start.y} A${r},${r} 0 ${largeArc},1 ${end.x},${end.y} Z`;
      startAngle = endAngle;
      return { ...b, d };
    });
  }

  function polarToCart(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const slices = buildSlices();

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:480 }}>
        <div style={{ width:36, height:4, background:"#EBE2D4", borderRadius:2, margin:"0 auto 16px" }}/>
        <div className="modal-title">My <span>Time</span> Allocation</div>
        <div style={{ display:"flex", alignItems:"center", gap:20, marginBottom:20 }}>
          <svg width="90" height="90" viewBox="0 0 90 90">
            {slices.map(s => <path key={s.id} d={s.d} fill={s.color}/>)}
            <circle cx="45" cy="45" r="22" fill="white"/>
            <text x="45" y="42" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1E1A2E">{tasks.length}</text>
            <text x="45" y="53" textAnchor="middle" fontSize="8" fill="#9C8C76">tasks</text>
          </svg>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:8 }}>
            {bucketData.map(b => (
              <div key={b.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:8, height:8, borderRadius:2, background:b.color }}/>
                  <span style={{ fontSize:11, color:"#9C8C76" }}>{b.label.split(" ")[0]}</span>
                </div>
                <span style={{ fontSize:11, fontWeight:700, color:b.color }}>{b.pct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize:9, fontWeight:700, letterSpacing:"1.5px", textTransform:"uppercase", color:"#C6BAA6", marginBottom:10 }}>Task Breakdown</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {bucketData.map(b => (
            <div key={b.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:10, color:"#9C8C76", width:56 }}>{b.label.split(" ")[0]}</span>
              <div style={{ flex:1, height:6, background:"#EBE2D4", borderRadius:3, overflow:"hidden" }}>
                <div style={{ width:`${b.pct}%`, height:"100%", background:b.color, borderRadius:3 }}/>
              </div>
              <span style={{ fontSize:10, fontWeight:700, color:b.color, width:20, textAlign:"right" }}>{b.count}</span>
            </div>
          ))}
        </div>
        <div className="modal-btns" style={{ marginTop:20 }}>
          <button className="cancel-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}


// ── Drag to Reorder Hook ──
function useDragSort(items, onReorder) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const longPressTimer = useRef(null);
  const isDragging = useRef(false);

  function startDrag(index) {
    isDragging.current = true;
    setDragIndex(index);
    setOverIndex(index);
    if (navigator.vibrate) navigator.vibrate(40);
  }

  function handleMouseDown(index) {
    longPressTimer.current = setTimeout(() => startDrag(index), 300);
  }

  function handleMouseUp() {
    clearTimeout(longPressTimer.current);
    if (isDragging.current && dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      onReorder(dragIndex, overIndex);
    }
    isDragging.current = false;
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleMouseEnter(index) {
    if (isDragging.current) setOverIndex(index);
  }

  function handleTouchStart(index, e) {
    longPressTimer.current = setTimeout(() => {
      startDrag(index);
    }, 300);
  }

  function handleTouchMove(e) {
    if (!isDragging.current) {
      clearTimeout(longPressTimer.current);
      return;
    }
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el?.closest('[data-drag-index]');
    if (card) {
      const idx = parseInt(card.getAttribute('data-drag-index'));
      if (!isNaN(idx)) setOverIndex(idx);
    }
  }

  function handleTouchEnd() {
    clearTimeout(longPressTimer.current);
    if (isDragging.current && dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      onReorder(dragIndex, overIndex);
    }
    isDragging.current = false;
    setDragIndex(null);
    setOverIndex(null);
  }

  // Reordered display list
  const displayItems = useMemo(() => {
    if (dragIndex === null || overIndex === null) return items;
    const arr = [...items];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(overIndex, 0, moved);
    return arr;
  }, [items, dragIndex, overIndex]);

  return {
    displayItems,
    dragIndex,
    overIndex,
    isDraggingActive: isDragging.current,
    handlers: {
      handleMouseDown,
      handleMouseUp,
      handleMouseEnter,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
    }
  };
}

function AlertBanner({ overdueCount, dueSoonCount, urgentOnly, onToggle }) {
  if (!overdueCount && !dueSoonCount && !urgentOnly) return null;
  const parts = [];
  if (overdueCount) parts.push(`${overdueCount} overdue`);
  if (dueSoonCount) parts.push(`${dueSoonCount} due this week`);
  const hasOverdue = overdueCount > 0;
  const bg = hasOverdue ? "#FFEEE9" : "#FFF8E0";
  const bd = hasOverdue ? "#FC4F38" : "#D4A800";
  const tx = hasOverdue ? "#C0271A" : "#7D5E00";
  return (
    <div onClick={onToggle} style={{display:"flex",alignItems:"center",gap:10,
      background:urgentOnly?"#FBF7F2":bg,border:`1.5px solid ${urgentOnly?"#EBE2D4":bd}`,
      borderRadius:12,padding:"10px 14px",marginBottom:14,cursor:"pointer"}}>
      <span style={{fontSize:18}}>{urgentOnly?"✓":"⚠️"}</span>
      <div style={{flex:1,fontSize:13,fontWeight:700,color:urgentOnly?"#5C5343":tx}}>
        {urgentOnly ? "Showing urgent tasks only" : parts.join("  ·  ")}
      </div>
      <span style={{fontSize:12,fontWeight:700,whiteSpace:"nowrap",color:urgentOnly?"#9C8C76":tx}}>{urgentOnly?"✕ Show all":"View ›"}</span>
    </div>
  );
}

function BucketBudgetHeader({ bucket, committed, cap, period, onEdit }) {
  if (!bucket) return null;
  const has = cap != null && cap !== "";
  const pct = has ? Math.min((committed / cap) * 100, 100) : 0;
  const over = has && committed > cap;
  const perLabel = period && period !== "none" ? period.charAt(0).toUpperCase() + period.slice(1) : null;
  const box = over
    ? {background:"#FFEEE9",border:"1.5px solid #FC4F38",borderRadius:12,padding:14,marginBottom:14}
    : {background:"#fff",border:"1px solid #EBE2D4",borderRadius:12,padding:14,marginBottom:14};
  return (
    <div style={box}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:has?8:6,flexWrap:"wrap"}}>
        <span style={{fontSize:16}}>{bucket.icon}</span>
        <span style={{fontSize:16,fontWeight:700,color:"#1E1A2E"}}>{bucket.label}</span>
        {perLabel && <span style={{fontSize:9,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:"#9C8C76",border:"1px solid #EBE2D4",borderRadius:10,padding:"2px 7px"}}>{perLabel}</span>}
        {has
          ? <span onClick={onEdit} style={{marginLeft:"auto",fontSize:12,color:over?"#C0271A":"#5C5343",fontWeight:over?800:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>{over?"⚠ ":""}${committed.toLocaleString()} / ${Number(cap).toLocaleString()} <span style={{color:bucket.color}}>✎</span></span>
          : <span onClick={onEdit} style={{marginLeft:"auto",fontSize:11,color:bucket.dark,fontWeight:700,border:`1px solid ${bucket.color}55`,borderRadius:14,padding:"3px 10px",cursor:"pointer"}}>+ Add budget</span>}
      </div>
      {has ? (
        <>
          <div style={{height:8,background:over?"#F7D9D3":"#F1E9DE",borderRadius:4,overflow:"hidden",marginBottom:6}}>
            <div style={{width:`${pct}%`,height:"100%",background:over?"#FC4F38":bucket.color}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:over?"#C0271A":"#5C5343",fontWeight:over?800:700}}>
            <span>{over?`⚠ OVER by $${(committed-cap).toLocaleString()}`:`$${(cap-committed).toLocaleString()} left`}</span>
            <span>{Math.round((committed/cap)*100)}% used</span>
          </div>
        </>
      ) : (
        <div style={{fontSize:11,color:"#9C8C76",fontStyle:"italic"}}>No budget — tracking only{committed?` · $${committed.toLocaleString()} logged`:""}</div>
      )}
    </div>
  );
}

function TaskList({ tasks, allTasks, bucketBudgets, bucketPeriods, activeBucket, onMove, onDate, onEdit, onDefer, onUndefer, onDragReorder, selectMode, selectedIds, onToggleSelect, onComplete }) {
  const canDrag = activeBucket !== "all" && !selectMode;

  const { displayItems, dragIndex, overIndex, handlers } = useDragSort(
    tasks,
    (fromIdx, toIdx) => { if (onDragReorder) onDragReorder(fromIdx, toIdx, tasks); }
  );

  const itemsToRender = canDrag ? displayItems : tasks;

  return (
    <div
      className="task-list"
      onMouseUp={canDrag ? handlers.handleMouseUp : undefined}
      onTouchEnd={canDrag ? handlers.handleTouchEnd : undefined}
      onTouchMove={canDrag ? handlers.handleTouchMove : undefined}
      style={{userSelect:"none"}}
    >
      {itemsToRender.map((task, idx) => {
        const bucket = BUCKETS.find(b=>b.id===task.bucket);
        const urg = getUrgency(task.dueDate, task.status);
        const cfg = UC[urg];
        const isCompleted = task.status === "completed";
        const isBeingDragged = canDrag && dragIndex === idx;
        const isDropTarget = canDrag && overIndex === idx && dragIndex !== idx;
        return (
          <div
            key={task.id}
            data-drag-index={idx}
            className="task-card"
            style={{
              borderLeftWidth:3,
              opacity: isBeingDragged ? 0.5 : isCompleted ? 0.6 : 1,
              transform: isBeingDragged ? "scale(1.02)" : isDropTarget ? "translateY(-3px)" : "none",
              boxShadow: isBeingDragged ? `0 8px 24px ${cfg.border}44` : isDropTarget ? `0 0 0 2px ${cfg.border}` : undefined,
              transition: "transform 0.15s, box-shadow 0.15s, opacity 0.15s",
              cursor: selectMode ? "pointer" : canDrag ? "grab" : "default",
              background: selectMode && selectedIds?.has(task.id) ? "#FFF0F5" : isCompleted ? "#F8FFF8" : undefined,
              borderLeftColor: isCompleted ? "#00AA66" : cfg.border,
            }}
            onMouseDown={canDrag ? () => handlers.handleMouseDown(idx) : undefined}
            onMouseEnter={canDrag ? () => handlers.handleMouseEnter(idx) : undefined}
            onTouchStart={canDrag ? (e) => handlers.handleTouchStart(idx, e) : undefined}
            onClick={selectMode ? () => onToggleSelect(task.id) : undefined}
          >
            {selectMode ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:32,flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${selectedIds?.has(task.id)?PINK:"#EBE2D4"}`,
                  background:selectedIds?.has(task.id)?PINK:"#fff",
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {selectedIds?.has(task.id)&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
                </div>
              </div>
            ) : (
              <div className="pri-col">
              {canDrag ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"4px 2px",
                  color:"#C6BAA6",fontSize:14,cursor:"grab",userSelect:"none"}}>
                  <span>⠿</span>
                </div>
              ) : (
                <>
                  <button className="arr-btn" onClick={()=>onMove(task.id,-1,activeBucket)}>▲</button>
                  <div className="pri-num" style={{color:bucket?.color||PINK}}>{task.priority}</div>
                  <button className="arr-btn" onClick={()=>onMove(task.id,1,activeBucket)}>▼</button>
                </>
              )}
              {canDrag && <div className="pri-num" style={{color:bucket?.color||PINK,marginTop:2}}>{task.priority}</div>}
            </div>
            )}
            <div className="task-body">
              <div className="t-title-row">
                <span className={`t-title ${task.status==="deferred"?"def":""}`} style={{textDecoration:isCompleted?"line-through":"none",color:isCompleted?"#9C8C76":undefined}}>{task.title}</span>
                {activeBucket==="all"&&bucket&&(
                  <span className="bkt-pill" style={{borderColor:bucket.color+"55",color:bucket.dark,background:bucket.bg}}>
                    {bucket.icon} {bucket.label}
                  </span>
                )}
                <span className="urg-badge" style={{background:cfg.bg,borderColor:cfg.border,color:cfg.text}}>{cfg.label}</span>
                <span className="src-badge">{SRC[task.source]}</span>
              </div>
              <div className="t-meta">
                <InlineDate value={task.dueDate} onChange={d=>onDate(task.id,d)}/>
                {(() => {
                  const cs = taskBudgetState(task, allTasks||tasks, bucketBudgets||{}, bucketPeriods||{});
                  if (cs === "flagged") return <span className="cost-badge flagged">⚑ Cost not set</span>;
                  const label = cs==="fits"?"✓ Fits":cs==="over"?"⚠ Over":"· tracked";
                  return <span className={`cost-badge ${cs}`}>${Number(task.cost).toLocaleString()} {label}</span>;
                })()}
                {task.status==="deferred"&&task.deferDate&&<span style={{color:"#5C5343",fontWeight:700}}>🔁 {fmtDate(task.deferDate)}</span>}
              </div>
              {task.notes&&<div className="t-notes">{task.notes}</div>}
            </div>
            <div className="act-col">
              <button className="act-btn" onClick={()=>onComplete(task.id)}
                style={{borderColor:isCompleted?"#00AA6644":"#EBE2D4",color:isCompleted?"#00A060":"#9C8C76",
                  background:isCompleted?"#E8F8F0":"none"}}>
                {isCompleted?"↩ Undo":"✓ Done"}
              </button>
              {!isCompleted&&<button className="act-btn" onClick={()=>onEdit(task)}>Edit</button>}
              {!isCompleted&&(task.status==="deferred"
                ?<button className="act-btn def-act" onClick={()=>onUndefer(task.id)}>Undefer</button>
                :<button className="act-btn" onClick={()=>onDefer(task)}>Defer</button>
              )}
            </div>
          </div>
        );
      })}
      {canDrag && tasks.length > 1 && (
        <div style={{textAlign:"center",fontSize:10,color:"#C6BAA6",fontWeight:600,marginTop:6}}>
          Hold & drag to reorder
        </div>
      )}
    </div>
  );
}

function CompareCol({ bucket: b, tasks, allTasks, bucketBudgets, bucketPeriods }) {
  return (
    <div className="cmp-col">
      <div className="cmp-hdr" style={{"--bc":b.color,background:b.bg}}>
        <span className="cmp-hdr-icon">{b.icon}</span>
        <span className="cmp-hdr-title" style={{color:b.color}}>{b.label}</span>
        <span className="cmp-hdr-count">{tasks.length}</span>
      </div>
      <div className="cmp-list">
        {tasks.map(task=>{
          const urg=getUrgency(task.dueDate,task.status);
          const cfg=UC[urg];
          return (
            <div key={task.id} className="cmp-task" style={{borderColor:cfg.border+"44"}}>
              <div className="cmp-task-hdr">
                <span className="cmp-num" style={{color:b.color}}>#{task.priority}</span>
                <span className={`cmp-ttitle ${task.status==="deferred"?"def":""}`}>{task.title}</span>
              </div>
              <div className="cmp-meta">
                <span style={{color:cfg.text}}>● {cfg.label}</span>
                <span style={{color:"#5C5343",fontWeight:700}}>📅 {fmtDate(task.dueDate)}</span>
                {task.cost?<span style={{color:taskBudgetState(task,allTasks||tasks,bucketBudgets||{},bucketPeriods||{})==="over"?ORANGE:taskBudgetState(task,allTasks||tasks,bucketBudgets||{},bucketPeriods||{})==="fits"?"#00A060":"#6B6051"}}>${task.cost}</span>:<span style={{color:"#A07800"}}>⚑</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
