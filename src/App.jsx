import { useState, useEffect, useRef, useCallback } from "react";
import { Check, X, Camera, RotateCcw, Droplets, Dumbbell, UtensilsCrossed, BookOpen, ChevronLeft, Download, Share } from "lucide-react";
import { storage } from "./storage";

const TASKS = [
  { key: "workout1", label: "Workout 1 — 45 min", icon: Dumbbell },
  { key: "workout2", label: "Workout 2 — 45 min, outdoors", icon: Dumbbell },
  { key: "diet", label: "Diet — zero cheats, zero alcohol", icon: UtensilsCrossed },
  { key: "water", label: "1 gallon of water", icon: Droplets },
  { key: "reading", label: "10 pages, non-fiction", icon: BookOpen },
];

const TOTAL_DAYS = 75;
const emptyDay = () => ({ workout1: false, workout2: false, diet: false, water: false, reading: false, photo: false });

function isIos() {
  return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 480;
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isDayComplete(day) {
  if (!day) return false;
  return TASKS.every((t) => day[t.key]) && day.photo;
}

export default function App() {
  const [days, setDays] = useState(() => {
    const arr = {};
    for (let i = 1; i <= TOTAL_DAYS; i++) arr[i] = emptyDay();
    return arr;
  });
  const [photos, setPhotos] = useState({});
  const [startDate, setStartDate] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const state = await storage.getState();
      if (state) {
        setDays((prev) => ({ ...prev, ...state.days }));
        setStartDate(state.startDate || null);
      }
      const p = await storage.getPhotos();
      if (p) setPhotos(p);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      if (!isStandalone()) setShowInstallBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if (isIos() && !isStandalone()) {
      const dismissed = window.localStorage.getItem("ios-install-dismissed");
      if (!dismissed) setShowInstallBanner(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismissBanner = () => {
    setShowInstallBanner(false);
    if (isIos()) window.localStorage.setItem("ios-install-dismissed", "1");
  };

  const runInstall = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      setShowInstallBanner(false);
    }
  };

  const persistState = useCallback(async (nextDays, nextStart) => {
    await storage.setState({ days: nextDays, startDate: nextStart });
  }, []);

  const persistPhotos = useCallback(async (nextPhotos) => {
    const ok = await storage.setPhotos(nextPhotos);
    if (!ok) {
      setToast("Photo storage is full on this device");
      setTimeout(() => setToast(""), 2500);
    }
  }, []);

  useEffect(() => {
    if (!startDate && loaded) {
      const today = new Date().toISOString().slice(0, 10);
      setStartDate(today);
      persistState(days, today);
    }
  }, [loaded, startDate, days, persistState]);

  let streak = 0;
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    if (isDayComplete(days[i])) streak++;
    else break;
  }
  let firstBrokenDay = null;
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    if (!isDayComplete(days[i])) {
      firstBrokenDay = i;
      break;
    }
  }
  const activeDay = firstBrokenDay || TOTAL_DAYS;

  const toggleTask = (dayNum, key) => {
    setDays((prev) => {
      const next = { ...prev, [dayNum]: { ...prev[dayNum], [key]: !prev[dayNum][key] } };
      persistState(next, startDate);
      return next;
    });
  };

  const handlePhotoPick = () => fileInputRef.current?.click();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedDay) return;
    try {
      const dataUrl = await compressImage(file);
      const nextPhotos = { ...photos, [selectedDay]: dataUrl };
      setPhotos(nextPhotos);
      await persistPhotos(nextPhotos);
      setDays((prev) => {
        const next = { ...prev, [selectedDay]: { ...prev[selectedDay], photo: true } };
        persistState(next, startDate);
        return next;
      });
    } catch (err) {
      setToast("Couldn't process that photo");
      setTimeout(() => setToast(""), 2000);
    }
    e.target.value = "";
  };

  const removePhoto = () => {
    const nextPhotos = { ...photos };
    delete nextPhotos[selectedDay];
    setPhotos(nextPhotos);
    persistPhotos(nextPhotos);
    setDays((prev) => {
      const next = { ...prev, [selectedDay]: { ...prev[selectedDay], photo: false } };
      persistState(next, startDate);
      return next;
    });
  };

  const doReset = async () => {
    const fresh = {};
    for (let i = 1; i <= TOTAL_DAYS; i++) fresh[i] = emptyDay();
    setDays(fresh);
    setPhotos({});
    const today = new Date().toISOString().slice(0, 10);
    setStartDate(today);
    await persistState(fresh, today);
    await persistPhotos({});
    setConfirmReset(false);
    setSelectedDay(null);
  };

  if (!loaded) {
    return (
      <div style={{ ...styles.app, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT.mono, letterSpacing: 2 }}>LOADING…</div>
      </div>
    );
  }

  if (selectedDay) {
    const day = days[selectedDay];
    const complete = isDayComplete(day);
    return (
      <div style={styles.app}>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
        <div style={styles.detailHeader}>
          <button onClick={() => setSelectedDay(null)} style={styles.backBtn}>
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>ALL DAYS</span>
          </button>
          <div style={{ fontFamily: FONT.mono, color: COLORS.muted, fontSize: 12, letterSpacing: 1 }}>
            {String(selectedDay).padStart(2, "0")} / {TOTAL_DAYS}
          </div>
        </div>

        <div style={styles.detailBody}>
          <h1 style={styles.dayTitle}>DAY {selectedDay}</h1>
          <div
            style={{
              ...styles.statusPill,
              background: complete ? COLORS.accent : "transparent",
              color: complete ? "#16171A" : COLORS.muted,
              borderColor: complete ? COLORS.accent : COLORS.line,
            }}
          >
            {complete ? "LOCKED IN" : "IN PROGRESS"}
          </div>

          <div style={styles.taskList}>
            {TASKS.map((t) => {
              const Icon = t.icon;
              const checked = day[t.key];
              return (
                <button key={t.key} onClick={() => toggleTask(selectedDay, t.key)} style={styles.taskRow}>
                  <div
                    style={{
                      ...styles.taskCheck,
                      background: checked ? COLORS.accent : "transparent",
                      borderColor: checked ? COLORS.accent : COLORS.line,
                    }}
                  >
                    {checked && <Check size={14} color="#16171A" strokeWidth={3} />}
                  </div>
                  <Icon size={18} color={checked ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
                  <span style={{ ...styles.taskLabel, color: checked ? COLORS.text : COLORS.muted }}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={styles.photoSection}>
            <div style={styles.photoLabel}>PROGRESS PHOTO</div>
            {photos[selectedDay] ? (
              <div style={styles.photoWrap}>
                <img src={photos[selectedDay]} alt={`Day ${selectedDay}`} style={styles.photoImg} />
                <button onClick={removePhoto} style={styles.photoRemove}>
                  <X size={16} color={COLORS.text} />
                </button>
              </div>
            ) : (
              <button onClick={handlePhotoPick} style={styles.photoAdd}>
                <Camera size={22} color={COLORS.muted} strokeWidth={1.75} />
                <span style={{ color: COLORS.muted, fontSize: 13 }}>Add photo</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />

      {showInstallBanner && (
        <div style={styles.installBanner}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isIos() ? <Share size={16} color={COLORS.accent2} /> : <Download size={16} color={COLORS.accent2} />}
            <span style={{ fontSize: 12.5, color: COLORS.text }}>
              {isIos()
                ? "Tap Share, then \u201cAdd to Home Screen\u201d to install"
                : "Install this app for offline access"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!isIos() && (
              <button onClick={runInstall} style={styles.installBtn}>INSTALL</button>
            )}
            <button onClick={dismissBanner} style={styles.installDismiss}>
              <X size={14} color={COLORS.muted} />
            </button>
          </div>
        </div>
      )}

      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>NO EXCUSES · NO SUBSTITUTIONS</div>
          <h1 style={styles.title}>75 HARD</h1>
        </div>
        <div style={styles.streakBox}>
          <div style={styles.streakNum}>{String(streak).padStart(2, "0")}</div>
          <div style={styles.streakLabel}>STREAK</div>
        </div>
      </div>

      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${(streak / TOTAL_DAYS) * 100}%` }} />
      </div>
      <div style={styles.progressText}>
        {streak} of {TOTAL_DAYS} days complete
      </div>

      <div style={styles.grid}>
        {Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1).map((n) => {
          const day = days[n];
          const complete = isDayComplete(day);
          const isActive = n === activeDay;
          const anyProgress = TASKS.some((t) => day[t.key]) || day.photo;
          return (
            <button
              key={n}
              onClick={() => setSelectedDay(n)}
              style={{
                ...styles.cell,
                background: complete ? COLORS.accent : "transparent",
                borderColor: isActive ? COLORS.accent2 : anyProgress ? COLORS.muted : COLORS.line,
                borderWidth: isActive ? 2 : 1,
                color: complete ? "#16171A" : isActive ? COLORS.accent2 : COLORS.muted,
              }}
            >
              {complete ? <Check size={14} strokeWidth={3} /> : n}
            </button>
          );
        })}
      </div>

      <div style={styles.footer}>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} style={styles.resetBtn}>
            <RotateCcw size={14} strokeWidth={2} />
            <span>RESTART CHALLENGE</span>
          </button>
        ) : (
          <div style={styles.confirmBox}>
            <span style={{ color: COLORS.text, fontSize: 13 }}>Wipe all progress and start over at Day 1?</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={doReset} style={styles.confirmYes}>YES, RESET</button>
              <button onClick={() => setConfirmReset(false)} style={styles.confirmNo}>CANCEL</button>
            </div>
          </div>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const COLORS = {
  bg: "#16171A",
  panel: "#1F2024",
  line: "#35373D",
  text: "#ECEAE4",
  muted: "#82848B",
  accent: "#FF5A1F",
  accent2: "#F2B705",
};

const FONT = {
  display: "'Oswald', 'Arial Narrow', sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
};

const styles = {
  app: {
    minHeight: "100vh",
    background: COLORS.bg,
    fontFamily: FONT.body,
    display: "flex",
    flexDirection: "column",
    padding: "calc(env(safe-area-inset-top, 0px) + 20px) 18px calc(env(safe-area-inset-bottom, 0px) + 24px)",
    boxSizing: "border-box",
  },
  installBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: COLORS.panel,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    padding: "10px 12px",
    marginBottom: 16,
  },
  installBtn: {
    background: COLORS.accent2,
    border: "none",
    borderRadius: 4,
    color: "#16171A",
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: 600,
    padding: "6px 10px",
    cursor: "pointer",
  },
  installDismiss: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 4,
    display: "flex",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 18,
  },
  eyebrow: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 2,
    color: COLORS.accent,
    marginBottom: 4,
  },
  title: {
    fontFamily: FONT.display,
    fontSize: 40,
    fontWeight: 700,
    letterSpacing: 1,
    color: COLORS.text,
    margin: 0,
  },
  streakBox: {
    textAlign: "right",
    border: `1px solid ${COLORS.line}`,
    padding: "6px 14px",
    borderRadius: 4,
  },
  streakNum: {
    fontFamily: FONT.display,
    fontSize: 28,
    fontWeight: 700,
    color: COLORS.accent2,
    lineHeight: 1,
  },
  streakLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: COLORS.muted,
    marginTop: 2,
  },
  progressBar: {
    height: 4,
    background: COLORS.panel,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 8,
  },
  progressFill: {
    height: "100%",
    background: COLORS.accent,
    transition: "width 0.3s ease",
  },
  progressText: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 6,
    marginBottom: 20,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 8,
    flex: 1,
  },
  cell: {
    aspectRatio: "1",
    borderRadius: 4,
    border: "1px solid",
    background: "transparent",
    fontFamily: FONT.mono,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  footer: {
    marginTop: 24,
  },
  resetBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "12px",
    background: "transparent",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 4,
    color: COLORS.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    cursor: "pointer",
  },
  confirmBox: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    background: COLORS.panel,
    borderRadius: 4,
    border: `1px solid ${COLORS.accent}`,
  },
  confirmYes: {
    flex: 1,
    padding: "10px",
    background: COLORS.accent,
    border: "none",
    borderRadius: 4,
    color: "#16171A",
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: 600,
    cursor: "pointer",
  },
  confirmNo: {
    flex: 1,
    padding: "10px",
    background: "transparent",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 4,
    color: COLORS.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1,
    cursor: "pointer",
  },
  toast: {
    position: "fixed",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    background: COLORS.panel,
    border: `1px solid ${COLORS.accent}`,
    color: COLORS.text,
    padding: "10px 18px",
    borderRadius: 4,
    fontSize: 13,
    fontFamily: FONT.body,
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  backBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "none",
    color: COLORS.muted,
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1,
    cursor: "pointer",
    padding: 0,
  },
  detailBody: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  dayTitle: {
    fontFamily: FONT.display,
    fontSize: 36,
    fontWeight: 700,
    color: COLORS.text,
    margin: 0,
    letterSpacing: 1,
  },
  statusPill: {
    alignSelf: "flex-start",
    padding: "5px 12px",
    borderRadius: 20,
    border: "1px solid",
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: -12,
  },
  taskList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  taskRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 12px",
    background: COLORS.panel,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
  },
  taskCheck: {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: "1.5px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  taskLabel: {
    fontSize: 14,
    fontFamily: FONT.body,
    fontWeight: 500,
  },
  photoSection: {
    marginTop: 4,
  },
  photoLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLORS.muted,
    marginBottom: 10,
  },
  photoWrap: {
    position: "relative",
    width: "100%",
    maxWidth: 240,
    borderRadius: 6,
    overflow: "hidden",
    border: `1px solid ${COLORS.line}`,
  },
  photoImg: {
    width: "100%",
    display: "block",
  },
  photoRemove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "rgba(22,23,26,0.75)",
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  photoAdd: {
    width: "100%",
    maxWidth: 240,
    aspectRatio: "1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: COLORS.panel,
    border: `1.5px dashed ${COLORS.line}`,
    borderRadius: 6,
    cursor: "pointer",
  },
};
