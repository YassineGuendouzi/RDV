import { useState, useEffect, useMemo } from "react";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const HOURS = Array.from({ length: 14 }, (_, i) => 7 + i); // 7h → 20h

const C = {
  admin:   { bg: "#7c3aed", grad: "#6d28d9", light: "#ede9fe", text: "#5b21b6", label: "Admin" },
  teacher: { bg: "#0f766e", grad: "#0d9488", light: "#ccfbf1", text: "#0d9488", label: "Professeur" },
  student: { bg: "#1d4ed8", grad: "#2563eb", light: "#dbeafe", text: "#1e40af", label: "Élève" },
};

function simpleHash(s) {
  return btoa(unescape(encodeURIComponent(s + "||rev2024||")));
}

const ADMIN_SEED = {
  id: "__admin__",
  firstName: "Admin",
  lastName: "",
  email: "admin@planrevision.app",
  password: simpleHash("Admin2024!"),
  role: "admin",
  createdAt: new Date().toISOString(),
};

// ─────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────
async function sGet(key, def = null) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : def;
  } catch { return def; }
}
async function sSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

// ─────────────────────────────────────────────
// ALGORITHM  – find all common slots (≥1h)
// ─────────────────────────────────────────────
function computeSlots(users, avail) {
  const members = users.filter(u => u.role !== "admin");
  const slots = [];

  for (const day of DAYS) {
    // Map hour → who's free
    const hMap = {};
    for (const h of HOURS) {
      hMap[h] = members.filter(u => (avail[u.id]?.[day] || []).includes(h));
    }

    let i = 0;
    while (i < HOURS.length) {
      const h = HOURS[i];
      if (!hMap[h].length) { i++; continue; }

      // Extend block while intersection stays non-empty
      let j = i + 1;
      let common = [...hMap[h]];
      while (j < HOURS.length && HOURS[j] === HOURS[j - 1] + 1) {
        const inter = common.filter(u => hMap[HOURS[j]].find(x => x.id === u.id));
        if (!inter.length) break;
        common = inter;
        j++;
      }

      const duration = j - i;
      // Next occurrence of this weekday
      const today = new Date();
      const targetDow = (DAYS.indexOf(day) + 1) % 7; // Mon=1…Sun=0
      let diff = (targetDow - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      const date = new Date(today);
      date.setDate(today.getDate() + diff);

      slots.push({
        id: `${day}-${HOURS[i]}`,
        day, start: HOURS[i], end: HOURS[j - 1] + 1,
        duration, date,
        available: hMap[HOURS[i]],  // people free at start
        core: common,               // people free entire block
        score: hMap[HOURS[i]].length * 100 + duration * 10,
      });
      i = j;
    }
  }
  return slots.sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────
// CALENDAR HELPERS
// ─────────────────────────────────────────────
function calFmt(d) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}
function googleLink(slot) {
  const s = new Date(slot.date); s.setHours(slot.start, 0, 0, 0);
  const e = new Date(slot.date); e.setHours(slot.end,   0, 0, 0);
  const names = slot.available.map(u => `${u.firstName} ${u.lastName}`).join(", ");
  const p = new URLSearchParams({
    action: "TEMPLATE", text: "📚 Session de révision",
    dates: `${calFmt(s)}/${calFmt(e)}`,
    details: `Session de révision\nParticipants : ${names}`,
    location: "À définir",
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
function downloadICS(slot) {
  const s = new Date(slot.date); s.setHours(slot.start, 0, 0, 0);
  const e = new Date(slot.date); e.setHours(slot.end,   0, 0, 0);
  const names = slot.available.map(u => `${u.firstName} ${u.lastName}`).join(", ");
  const ics = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//PlanRevision//FR",
    "BEGIN:VEVENT",
    `DTSTART:${calFmt(s)}`,`DTEND:${calFmt(e)}`,
    "SUMMARY:📚 Session de révision",
    `DESCRIPTION:Participants : ${names}`,
    "LOCATION:À définir","STATUS:CONFIRMED",
    "END:VEVENT","END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "session-revision.ics"; a.click();
}
function mailtoLink(slot, allUsers) {
  const emails = allUsers
    .filter(u => u.role !== "admin" && slot.available.find(a => a.id === u.id))
    .map(u => u.email).filter(Boolean).join(",");
  const names = slot.available.map(u => `${u.firstName} ${u.lastName}`).join(", ");
  const dateStr = slot.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const sub = `📚 Session de révision – ${slot.day} ${slot.start}h-${slot.end}h`;
  const body = `Bonjour,\n\nUne session de révision a été planifiée :\n\n📅 ${dateStr}\n🕐 ${slot.start}h00 → ${slot.end}h00 (${slot.duration}h)\n👥 ${names}\n\nÀ très bientôt !`;
  return `mailto:${emails}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}`;
}

// ─────────────────────────────────────────────
// TINY UI COMPONENTS
// ─────────────────────────────────────────────
function Avatar({ name = "", role = "student", size = 36 }) {
  const c = C[role] || C.student;
  const ini = (name.trim().split(" ").map(w => w[0]).join("").toUpperCase() || "?").slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(135deg, ${c.bg}, ${c.grad})`,
      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: size * 0.36, letterSpacing: .5,
    }}>{ini}</div>
  );
}

function Tag({ role }) {
  const c = C[role] || C.student;
  return (
    <span style={{
      background: c.light, color: c.text, fontSize: 11, fontWeight: 700,
      padding: "2px 9px", borderRadius: 99, letterSpacing: .4,
    }}>{c.label}</span>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: .5, textTransform: "uppercase" }}>{label}</label>}
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "10px 14px", borderRadius: 10, border: "2px solid #e2e8f0",
  fontSize: 14, fontFamily: "inherit", outline: "none", background: "#f8fafc",
  transition: "border-color .15s", width: "100%", boxSizing: "border-box",
};

function Inp({ label, ...p }) {
  return (
    <Field label={label}>
      <input {...p} style={{ ...inputStyle, ...(p.style || {}) }}
        onFocus={e => e.target.style.borderColor = "#f59e0b"}
        onBlur={e => e.target.style.borderColor = "#e2e8f0"} />
    </Field>
  );
}

function Sel({ label, options, ...p }) {
  return (
    <Field label={label}>
      <select {...p} style={{ ...inputStyle, cursor: "pointer" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

const BTN = {
  primary: { background: "#f59e0b", color: "#1a1a1a", boxShadow: "0 2px 10px rgba(245,158,11,.35)" },
  dark:    { background: "#1e3a5f", color: "#fff" },
  danger:  { background: "#fee2e2", color: "#dc2626" },
  ghost:   { background: "rgba(255,255,255,.08)", color: "#94a3b8" },
  light:   { background: "#f1f5f9", color: "#374151" },
  green:   { background: "#d1fae5", color: "#065f46" },
  blue:    { background: "#dbeafe", color: "#1e40af" },
};

function Btn({ v = "primary", children, sx, ...p }) {
  return (
    <button {...p} style={{
      padding: "9px 18px", borderRadius: 10, border: "none", cursor: "pointer",
      fontWeight: 700, fontSize: 13, fontFamily: "inherit", transition: "opacity .15s",
      display: "inline-flex", alignItems: "center", gap: 6,
      ...BTN[v], ...sx,
    }}
    onMouseOver={e => e.currentTarget.style.opacity = ".85"}
    onMouseOut={e => e.currentTarget.style.opacity = "1"}>{children}</button>
  );
}

function Notif({ n }) {
  if (!n) return null;
  const err = n.type === "error";
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 9999,
      background: err ? "#fef2f2" : "#f0fdf4",
      border: `1px solid ${err ? "#fca5a5" : "#86efac"}`,
      color: err ? "#dc2626" : "#16a34a",
      padding: "11px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13,
      boxShadow: "0 8px 32px rgba(0,0,0,.15)", animation: "fadeIn .2s",
      fontFamily: "inherit",
    }}>
      {err ? "⚠️" : "✅"} {n.msg}
    </div>
  );
}

// ─────────────────────────────────────────────
// AUTH SHELL
// ─────────────────────────────────────────────
function AuthShell({ title, subtitle, children }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 55%, #0f172a 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            fontFamily: "'Crimson Pro', Georgia, serif",
            fontSize: 38, fontWeight: 700, color: "#f8fafc", letterSpacing: -1,
          }}>📚 RCH (Révision Coran Hem)</div>
          <div style={{ color: "#f8fafc", fontSize: 20, fontWeight: 700, marginTop: 6, fontFamily: "'Crimson Pro', serif" }}>{title}</div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>{subtitle}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 20, padding: "28px 28px", boxShadow: "0 24px 64px rgba(0,0,0,.35)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// AVAILABILITY GRID
// ─────────────────────────────────────────────
function AvailGrid({ user, avail, onToggle, readOnly = false }) {
  const c = C[user.role] || C.student;
  const isA = (d, h) => (avail[user.id]?.[d] || []).includes(h);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Avatar name={`${user.firstName} ${user.lastName}`} role={user.role} size={46} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: "#1e293b" }}>{user.firstName} {user.lastName}</div>
          <Tag role={user.role} />
        </div>
        {!readOnly && (
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
            Cliquez pour indiquer vos disponibilités
          </div>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ padding: "5px 10px", fontSize: 11, color: "#64748b", textAlign: "left", fontWeight: 700 }}>Heure</th>
              {DAYS.map(d => (
                <th key={d} style={{ padding: "5px 5px", fontSize: 11, color: "#64748b", fontWeight: 700, textAlign: "center", minWidth: 40 }}>
                  {d.slice(0, 3).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((h, ri) => (
              <tr key={h} style={{ background: ri % 2 ? "#fafafa" : "#fff" }}>
                <td style={{ padding: "3px 10px", fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  {h}h – {h + 1}h
                </td>
                {DAYS.map(d => {
                  const on = isA(d, h);
                  return (
                    <td key={d} style={{ padding: "3px", textAlign: "center" }}>
                      <button
                        disabled={readOnly}
                        onClick={() => onToggle(user.id, d, h)}
                        title={`${d} ${h}h-${h + 1}h`}
                        style={{
                          width: 34, height: 26, borderRadius: 6, border: "none",
                          cursor: readOnly ? "default" : "pointer",
                          background: on ? c.bg : "#e2e8f0",
                          opacity: on ? 1 : readOnly ? 0.35 : 0.6,
                          transition: "all .1s",
                          transform: on ? "scale(1.07)" : "scale(1)",
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: c.bg, display: "inline-block" }} />Disponible
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: "#e2e8f0", display: "inline-block" }} />Indisponible
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SLOT CARD
// ─────────────────────────────────────────────
function SlotCard({ slot, rank, allUsers, isAdmin }) {
  const top = rank === 0;
  const dateStr = slot.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const total = allUsers.filter(u => u.role !== "admin").length;

  return (
    <div style={{
      background: top ? "linear-gradient(135deg, #065f46, #0f766e)" : "#fff",
      color: top ? "#fff" : "#1e293b",
      borderRadius: 18, padding: "20px 24px", marginBottom: 12,
      boxShadow: top ? "0 10px 40px rgba(6,95,70,.3)" : "0 2px 14px rgba(0,0,0,.06)",
      position: "relative", overflow: "hidden",
    }}>
      {top && <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,.06)" }} />}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Rank */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: top ? "rgba(255,255,255,.18)" : "#f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: 14, color: top ? "#fff" : "#64748b",
        }}>#{rank + 1}</div>

        {/* Info */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontFamily: "'Crimson Pro', serif", fontSize: 22, fontWeight: 700 }}>{slot.day}</span>
            <span style={{ fontSize: 18, fontWeight: 700, opacity: .85 }}>{slot.start}h → {slot.end}h</span>
            <span style={{
              padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: top ? "rgba(255,255,255,.2)" : "#f0fdf4",
              color: top ? "#fff" : "#15803d",
            }}>{slot.duration}h</span>
          </div>
          <div style={{ fontSize: 12, opacity: .65, marginBottom: 12 }}>{dateStr}</div>

          {/* People chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {slot.available.map(u => (
              <div key={u.id} style={{
                display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                padding: "3px 10px", borderRadius: 20,
                background: top ? "rgba(255,255,255,.15)" : C[u.role].light,
                color: top ? "#fff" : C[u.role].text,
              }}>
                <Avatar name={`${u.firstName} ${u.lastName}`} role={u.role} size={18} />
                {u.firstName} {u.lastName}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={googleLink(slot)} target="_blank" rel="noreferrer" style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "7px 14px", borderRadius: 9, fontSize: 12, fontWeight: 700, textDecoration: "none",
              background: top ? "rgba(255,255,255,.2)" : BTN.blue.background,
              color: top ? "#fff" : BTN.blue.color,
            }}>📅 Google Agenda</a>

            <button onClick={() => downloadICS(slot)} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "7px 14px", borderRadius: 9, fontSize: 12, fontWeight: 700,
              border: "none", cursor: "pointer", fontFamily: "inherit",
              background: top ? "rgba(255,255,255,.2)" : BTN.light.background,
              color: top ? "#fff" : BTN.light.color,
            }}>🍎 Apple / iCal (.ics)</button>

            {isAdmin && (
              <a href={mailtoLink(slot, allUsers)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "7px 14px", borderRadius: 9, fontSize: 12, fontWeight: 700, textDecoration: "none",
                background: top ? "rgba(255,255,255,.2)" : BTN.green.background,
                color: top ? "#fff" : BTN.green.color,
              }}>📧 Notifier les participants</a>
            )}
          </div>
        </div>

        {/* Score badge */}
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800 }}>{slot.available.length}</div>
          <div style={{ fontSize: 11, opacity: .6 }}>/ {total}</div>
          <div style={{ fontSize: 11, opacity: .6 }}>présents</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TOPBAR
// ─────────────────────────────────────────────
function TopBar({ user, view, adminTab, setView, setAdminTab, onLogout }) {
  const isAdmin = user.role === "admin";
  const nav = isAdmin
    ? [["users","👥","Utilisateurs"], ["availability","📅","Disponibilités"], ["slots","🔍","Créneaux"]]
    : [["dashboard","🏠","Accueil"], ["availability","📅","Mes dispos"], ["slots","🔍","Créneaux"]];

  const active = isAdmin ? adminTab : view;
  const setActive = isAdmin
    ? v => { setView("admin"); setAdminTab(v); }
    : v => setView(v);

  return (
    <div style={{
      background: "linear-gradient(90deg, #0f172a, #1e3a5f)",
      display: "flex", alignItems: "center", height: 58, padding: "0 20px", gap: 8,
      boxShadow: "0 2px 12px rgba(0,0,0,.3)",
    }}>
      <div style={{
        fontFamily: "'Crimson Pro', serif", fontSize: 21, fontWeight: 700, color: "#f8fafc",
        marginRight: 12, whiteSpace: "nowrap",
      }}>📚 PlanRévision</div>

      <div style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {nav.map(([key, icon, label]) => (
          <button key={key} onClick={() => setActive(key)} style={{
            padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontWeight: 600, fontSize: 12, transition: "all .15s",
            background: active === key ? "rgba(245,158,11,.2)" : "transparent",
            color: active === key ? "#f59e0b" : "#94a3b8",
          }}>{icon} {label}</button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={`${user.firstName} ${user.lastName}`} role={user.role} size={30} />
        <span style={{ fontSize: 12, color: "#94a3b8", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user.firstName || user.email}
        </span>
        <button onClick={onLogout} style={{
          background: "rgba(255,255,255,.08)", border: "none", color: "#94a3b8",
          padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 600,
        }}>⏏ Quitter</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// USER MODAL (add / edit)
// ─────────────────────────────────────────────
function UserModal({ data, onSave, onClose }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", role: "student", ...data });
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const isEdit = !!data.id;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        <h3 style={{ margin: "0 0 22px", fontFamily: "'Crimson Pro', serif", fontSize: 22, color: "#1e293b" }}>
          {isEdit ? "Modifier l'utilisateur" : "Ajouter un utilisateur"}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Inp label="Prénom *" value={form.firstName} onChange={set("firstName")} placeholder="Marie" />
            <Inp label="Nom *"    value={form.lastName}  onChange={set("lastName")}  placeholder="Dupont" />
          </div>
          <Inp label="Email *" type="email" value={form.email} onChange={set("email")} placeholder="marie@ecole.fr" />
          {!isEdit
            ? <Inp label="Mot de passe *" type="password" value={form.password} onChange={set("password")} placeholder="Min. 6 caractères" />
            : <Inp label="Nouveau mot de passe (laisser vide pour conserver)" type="password" value={form.password} onChange={set("password")} placeholder="••••••••" />
          }
          <Sel label="Statut *" value={form.role} onChange={set("role")}
            options={[{ value: "student", label: "🎓 Élève" }, { value: "teacher", label: "🏫 Professeur" }]} />
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <Btn v="light" onClick={onClose} sx={{ flex: 1, justifyContent: "center" }}>Annuler</Btn>
            <Btn onClick={() => onSave(form)} sx={{ flex: 2, justifyContent: "center" }}>
              {isEdit ? "Enregistrer" : "Ajouter"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [ready,    setReady]    = useState(false);
  const [users,    setUsers]    = useState([]);
  const [avail,    setAvail]    = useState({});
  const [me,       setMe]       = useState(null);   // logged in user
  const [view,     setView]     = useState("login");
  const [adminTab, setAdminTab] = useState("users");
  const [toast,    setToast]    = useState(null);
  const [modal,    setModal]    = useState(null);   // null | {} | user obj
  const [selUser,  setSelUser]  = useState(null);   // admin: selected user for avail grid

  // Login form
  const [lf, setLf] = useState({ email: "", password: "" });
  // Register form
  const [rf, setRf] = useState({ firstName: "", lastName: "", email: "", password: "", role: "student" });

  useEffect(() => { boot(); }, []);

  async function boot() {
    let stored = await sGet("users", null);
    if (!stored) {
      stored = [ADMIN_SEED];
      await sSet("users", stored);
    } else if (!stored.find(u => u.id === ADMIN_SEED.id)) {
      stored = [ADMIN_SEED, ...stored];
      await sSet("users", stored);
    }
    setUsers(stored);
    setAvail(await sGet("avail", {}));
    setReady(true);
  }

  function notify(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }

  async function saveUsers(u) { setUsers(u); await sSet("users", u); }
  async function saveAvail(a) { setAvail(a);  await sSet("avail", a);  }

  // ── AUTH ──────────────────────────
  function doLogin() {
    if (!lf.email || !lf.password) return notify("Remplissez tous les champs", "error");
    const u = users.find(x => x.email === lf.email && x.password === simpleHash(lf.password));
    if (!u) return notify("Email ou mot de passe incorrect", "error");
    setMe(u);
    setLf({ email: "", password: "" });
    if (u.role === "admin") { setView("admin"); setAdminTab("users"); }
    else { setView("dashboard"); setSelUser(u.id); }
  }

  async function doRegister() {
    const { firstName, lastName, email, password, role } = rf;
    if (!firstName || !lastName || !email || !password) return notify("Tous les champs sont requis", "error");
    if (password.length < 6) return notify("Mot de passe trop court (min. 6)", "error");
    if (users.find(u => u.email === email)) return notify("Cet email est déjà utilisé", "error");
    const newU = { id: `u-${Date.now()}`, firstName, lastName, email, password: simpleHash(password), role, createdAt: new Date().toISOString() };
    await saveUsers([...users, newU]);
    notify("Compte créé ! Vous pouvez vous connecter.");
    setView("login");
    setRf({ firstName: "", lastName: "", email: "", password: "", role: "student" });
  }

  function doLogout() { setMe(null); setView("login"); setSelUser(null); }

  // ── ADMIN: USER MANAGEMENT ─────────
  async function saveModal(form) {
    if (!form.firstName || !form.lastName || !form.email) return notify("Champs requis manquants", "error");
    if (!form.id && !form.password) return notify("Mot de passe requis", "error");
    if (form.email !== (users.find(u => u.id === form.id)?.email) && users.find(u => u.email === form.email)) {
      return notify("Email déjà utilisé", "error");
    }
    if (form.id) {
      const updated = users.map(u => u.id === form.id ? {
        ...u, firstName: form.firstName, lastName: form.lastName,
        email: form.email, role: form.role,
        ...(form.password ? { password: simpleHash(form.password) } : {}),
      } : u);
      await saveUsers(updated);
      notify("Utilisateur modifié");
    } else {
      const newU = { id: `u-${Date.now()}`, firstName: form.firstName, lastName: form.lastName, email: form.email, password: simpleHash(form.password), role: form.role, createdAt: new Date().toISOString() };
      await saveUsers([...users, newU]);
      notify("Utilisateur ajouté !");
    }
    setModal(null);
  }

  async function deleteUser(id) {
    if (id === ADMIN_SEED.id) return notify("Impossible de supprimer l'admin", "error");
    await saveUsers(users.filter(u => u.id !== id));
    const a2 = { ...avail }; delete a2[id]; await saveAvail(a2);
    if (selUser === id) setSelUser(null);
    notify("Utilisateur supprimé");
  }

  // ── AVAILABILITY ───────────────────
  function toggleSlot(uid, day, hour) {
    const hours = new Set(avail[uid]?.[day] || []);
    if (hours.has(hour)) hours.delete(hour); else hours.add(hour);
    saveAvail({ ...avail, [uid]: { ...(avail[uid] || {}), [day]: [...hours] } });
  }

  const slots = useMemo(() => computeSlots(users, avail), [users, avail]);
  const members = users.filter(u => u.role !== "admin");

  // ─────────────────────────────────
  if (!ready) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#94a3b8", fontSize: 15, fontFamily: "sans-serif" }}>Chargement…</div>
    </div>
  );

  const isAdmin = me?.role === "admin";
  const PAGE = isAdmin ? adminTab : view;

  // ─────────────────────────────────
  // LOGIN
  if (view === "login") return (
    <AuthShell title="Connexion" subtitle="Accédez à votre espace de révision">
      <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Inp label="Email" type="email" placeholder="votre@email.com" value={lf.email} onChange={e => setLf(p => ({ ...p, email: e.target.value }))} />
        <Inp label="Mot de passe" type="password" placeholder="••••••••" value={lf.password}
          onChange={e => setLf(p => ({ ...p, password: e.target.value }))}
          onKeyDown={e => e.key === "Enter" && doLogin()} />
        <Btn onClick={doLogin} sx={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 15, marginTop: 4 }}>Se connecter</Btn>
        <div style={{ textAlign: "center", fontSize: 13, color: "#64748b" }}>
          Pas encore de compte ?{" "}
          <button onClick={() => setView("register")} style={{ background: "none", border: "none", color: "#f59e0b", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            Créer un compte
          </button>
        </div>
      </div>
      <Notif n={toast} />
    </AuthShell>
  );

  // REGISTER
  if (view === "register") return (
    <AuthShell title="Créer un compte" subtitle="Rejoignez l'espace révision">
      <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Inp label="Prénom *" value={rf.firstName} onChange={e => setRf(p => ({ ...p, firstName: e.target.value }))} placeholder="Marie" />
          <Inp label="Nom *"    value={rf.lastName}  onChange={e => setRf(p => ({ ...p, lastName:  e.target.value }))} placeholder="Dupont" />
        </div>
        <Inp label="Email *" type="email" value={rf.email} onChange={e => setRf(p => ({ ...p, email: e.target.value }))} placeholder="marie@ecole.fr" />
        <Inp label="Mot de passe *" type="password" value={rf.password} onChange={e => setRf(p => ({ ...p, password: e.target.value }))} placeholder="Min. 6 caractères" />
        <Sel label="Statut *" value={rf.role} onChange={e => setRf(p => ({ ...p, role: e.target.value }))}
          options={[{ value: "student", label: "🎓 Élève" }, { value: "teacher", label: "🏫 Professeur" }]} />
        <Btn onClick={doRegister} sx={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 15, marginTop: 4 }}>Créer mon compte</Btn>
        <div style={{ textAlign: "center", fontSize: 13, color: "#64748b" }}>
          Déjà un compte ?{" "}
          <button onClick={() => setView("login")} style={{ background: "none", border: "none", color: "#f59e0b", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
            Se connecter
          </button>
        </div>
      </div>
      <Notif n={toast} />
    </AuthShell>
  );

  // ─────────────────────────────────
  // MAIN AUTHENTICATED LAYOUT
  const card = { background: "#fff", borderRadius: 16, padding: "24px 26px", marginBottom: 16, boxShadow: "0 2px 16px rgba(0,0,0,.06)" };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}} *{box-sizing:border-box}`}</style>

      <TopBar user={me} view={view} adminTab={adminTab} setView={v => { setView(v); if(v !== "admin") setSelUser(me?.role !== "admin" ? me?.id : null); }} setAdminTab={setAdminTab} onLogout={doLogout} />

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 14px" }}>

        {/* ══ ADMIN: USERS ══ */}
        {isAdmin && PAGE === "users" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 22 }}>
              <h2 style={{ margin: 0, fontFamily: "'Crimson Pro',serif", fontSize: 30, color: "#1e293b", flex: 1 }}>Gestion des utilisateurs</h2>
              <Btn onClick={() => setModal({})}>+ Ajouter un utilisateur</Btn>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
              {[
                ["Total inscrits", members.length, "#1e3a5f"],
                ["Élèves", members.filter(u => u.role === "student").length, C.student.bg],
                ["Professeurs", members.filter(u => u.role === "teacher").length, C.teacher.bg],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", borderLeft: `4px solid ${color}`, boxShadow: "0 1px 8px rgba(0,0,0,.05)" }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* List */}
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              {members.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
                  Aucun utilisateur. Cliquez sur "+ Ajouter" pour commencer.
                </div>
              ) : members.map((u, i) => (
                <div key={u.id} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 22px",
                  borderBottom: i < members.length - 1 ? "1px solid #f1f5f9" : "none",
                }}>
                  <Avatar name={`${u.firstName} ${u.lastName}`} role={u.role} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 15 }}>{u.firstName} {u.lastName}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
                  </div>
                  <Tag role={u.role} />
                  <div style={{ fontSize: 11, color: "#cbd5e1", whiteSpace: "nowrap" }}>
                    {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn v="light" sx={{ padding: "6px 12px" }} onClick={() => setModal({ ...u, password: "" })}>✏️</Btn>
                    <Btn v="danger" sx={{ padding: "6px 12px" }} onClick={() => deleteUser(u.id)}>🗑️</Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ AVAILABILITY (admin sees all / user sees own) ══ */}
        {PAGE === "availability" && (
          <div>
            <h2 style={{ margin: "0 0 20px", fontFamily: "'Crimson Pro',serif", fontSize: 30, color: "#1e293b" }}>
              {isAdmin ? "Toutes les disponibilités" : "Mes disponibilités"}
            </h2>

            {/* Person picker */}
            {isAdmin && (
              <div style={{ ...card, padding: "16px 20px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", letterSpacing: .5, textTransform: "uppercase", marginBottom: 12 }}>
                  Sélectionner un participant
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {members.map(u => {
                    const hasAvail = avail[u.id] && Object.values(avail[u.id]).some(a => a.length > 0);
                    const active = selUser === u.id;
                    return (
                      <button key={u.id} onClick={() => setSelUser(active ? null : u.id)} style={{
                        display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 10,
                        cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 13,
                        border: `2px solid ${active ? C[u.role].bg : "#e2e8f0"}`,
                        background: active ? C[u.role].light : "#f8fafc", transition: "all .15s",
                      }}>
                        <Avatar name={`${u.firstName} ${u.lastName}`} role={u.role} size={24} />
                        {u.firstName} {u.lastName}
                        {hasAvail && <span style={{ color: "#10b981", fontSize: 12 }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Grid */}
            {(() => {
              const uid = isAdmin ? selUser : me?.id;
              const person = uid ? users.find(u => u.id === uid) : null;
              if (!person && isAdmin) return (
                <div style={{ ...card, textAlign: "center", color: "#94a3b8", padding: "40px 20px" }}>
                  Sélectionnez un participant pour voir et modifier ses disponibilités
                </div>
              );
              if (!person) return null;
              return (
                <div style={{ ...card, borderTop: `4px solid ${C[person.role].bg}` }}>
                  <AvailGrid user={person} avail={avail} onToggle={toggleSlot} />
                </div>
              );
            })()}

            {/* Progress bar (admin) */}
            {isAdmin && (
              <div style={{ ...card, padding: "16px 20px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: .5, marginBottom: 10 }}>
                  Avancement : {members.filter(u => avail[u.id] && Object.values(avail[u.id]).some(a => a.length > 0)).length}/{members.length} ont renseigné leurs dispos
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {members.map(u => {
                    const done = avail[u.id] && Object.values(avail[u.id]).some(a => a.length > 0);
                    return (
                      <div key={u.id} style={{
                        display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                        padding: "4px 10px", borderRadius: 20,
                        background: done ? "#f0fdf4" : "#fff7ed",
                        color: done ? "#15803d" : "#c2410c",
                        border: `1px solid ${done ? "#86efac" : "#fed7aa"}`,
                      }}>
                        {done ? "✓" : "○"} {u.firstName} {u.lastName}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ SLOTS ══ */}
        {PAGE === "slots" && (
          <div>
            <h2 style={{ margin: "0 0 6px", fontFamily: "'Crimson Pro',serif", fontSize: 30, color: "#1e293b" }}>
              Créneaux de révision
            </h2>
            <p style={{ color: "#64748b", margin: "0 0 20px", fontSize: 14 }}>
              {slots.length} créneau{slots.length !== 1 ? "x" : ""} trouvé{slots.length !== 1 ? "s" : ""} · durée variable · triés par nombre de participants
            </p>

            {slots.length === 0 ? (
              <div style={{ ...card, textAlign: "center", padding: "50px 30px" }}>
                <div style={{ fontSize: 48, marginBottom: 14 }}>😕</div>
                <h3 style={{ color: "#1e293b", margin: "0 0 8px" }}>Aucun créneau commun pour l'instant</h3>
                <p style={{ color: "#64748b", margin: "0 0 20px" }}>
                  Les participants doivent d'abord renseigner leurs disponibilités.
                </p>
                {isAdmin && <Btn onClick={() => setAdminTab("availability")}>📅 Gérer les disponibilités</Btn>}
                {!isAdmin && <Btn onClick={() => setView("availability")}>📅 Saisir mes disponibilités</Btn>}
              </div>
            ) : slots.map((s, i) => (
              <SlotCard key={s.id} slot={s} rank={i} allUsers={users} isAdmin={isAdmin} />
            ))}
          </div>
        )}

        {/* ══ USER DASHBOARD ══ */}
        {!isAdmin && PAGE === "dashboard" && (
          <div>
            <div style={{ marginBottom: 26 }}>
              <h2 style={{ margin: "0 0 4px", fontFamily: "'Crimson Pro',serif", fontSize: 34, color: "#1e293b" }}>
                Bonjour, {me.firstName} ! 👋
              </h2>
              <p style={{ color: "#64748b", margin: 0 }}>Gérez vos disponibilités et consultez les créneaux de révision proposés.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
              {[
                {
                  emoji: "📅", label: "Mes disponibilités",
                  val: Object.values(avail[me.id] || {}).reduce((s, a) => s + a.length, 0) + "h",
                  sub: "de créneaux renseignés", color: C.student.bg, action: () => setView("availability"),
                },
                {
                  emoji: "🔍", label: "Créneaux où je suis",
                  val: slots.filter(s => s.available.find(u => u.id === me.id)).length,
                  sub: "sessions possibles", color: C.teacher.bg, action: () => setView("slots"),
                },
                {
                  emoji: "👥", label: "Participants inscrits",
                  val: members.length,
                  sub: "au total", color: "#7c3aed", action: null,
                },
              ].map(({ emoji, label, val, sub, color, action }) => (
                <div key={label} onClick={action || undefined} style={{
                  background: "#fff", borderRadius: 16, padding: "18px 20px",
                  borderLeft: `4px solid ${color}`, boxShadow: "0 2px 10px rgba(0,0,0,.06)",
                  cursor: action ? "pointer" : "default", transition: "transform .15s",
                }} onMouseOver={e => action && (e.currentTarget.style.transform = "translateY(-2px)")}
                   onMouseOut={e => (e.currentTarget.style.transform = "none")}>
                  <div style={{ fontSize: 26, marginBottom: 4 }}>{emoji}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 14 }}>{label}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* My best slots */}
            {slots.filter(s => s.available.find(u => u.id === me.id)).length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginBottom: 12 }}>
                  🌟 Créneaux où vous êtes disponible :
                </div>
                {slots.filter(s => s.available.find(u => u.id === me.id)).slice(0, 3).map((s, i) => (
                  <SlotCard key={s.id} slot={s} rank={i} allUsers={users} isAdmin={false} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && <UserModal data={modal} onSave={saveModal} onClose={() => setModal(null)} />}

      <Notif n={toast} />
    </div>
  );
}