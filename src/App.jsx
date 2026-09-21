import { useState, useEffect, useRef, useCallback } from "react";
import {
  Check, X, Camera, RotateCcw, Droplets, Dumbbell, UtensilsCrossed, BookOpen,
  ChevronLeft, Download, Share, History as HistoryIcon, Trophy, Lock,
  Bell, BellOff, Images, Minus, Plus,
} from "lucide-react";
import { storage } from "./storage";
import { todayStr, dateForDay, elapsedDay, formatDisplayDate } from "./dateUtils";
import {
  notificationsSupported, getPermissionState, requestPermission,
  scheduleReminders, clearScheduledReminders,
} from "./notifications";

const TOTAL_DAYS = 75;
const HARD_WATER_GOAL_ML = 3785; // 1 gallon
const SOFT_WATER_GOAL_ML = 3000; // 3 liters
const ML_PER_OZ = 29.5735;
const WATER_MAX_ML = 6000;
const NOTIF_PREF_KEY = "notif-pref-enabled";

const HARD_WATER_BUTTONS = [
  { icon: Minus, label: "8oz", deltaMl: -237 },
  { icon: Plus, label: "8oz", deltaMl: 237 },
  { icon: Plus, label: "16oz", deltaMl: 473 },
  { icon: Plus, label: "32oz", deltaMl: 946 },
];
const SOFT_WATER_BUTTONS = [
  { icon: Minus, label: "250ml", deltaMl: -250 },
  { icon: Plus, label: "250ml", deltaMl: 250 },
  { icon: Plus, label: "500ml", deltaMl: 500 },
  { icon: Plus, label: "1L", deltaMl: 1000 },
];

const emptyDay = () => ({
  workout1: false,
  workout2: false,
  diet: false,
  dietCheat: false,
  waterMl: 0,
  reading: false,
  photo: false,
  weight: null,
});

function normalizeDay(raw) {
  if (!raw) return emptyDay();
  let waterMl;
  if (typeof raw.waterMl === "number") waterMl = raw.waterMl;
  else if (typeof raw.waterOz === "number") waterMl = Math.round(raw.waterOz * ML_PER_OZ);
  else waterMl = raw.water ? HARD_WATER_GOAL_ML : 0;
  return {
    workout1: !!raw.workout1,
    workout2: !!raw.workout2,
    diet: !!raw.diet,
    dietCheat: !!raw.dietCheat,
    reading: !!raw.reading,
    photo: !!raw.photo,
    weight: typeof raw.weight === "number" ? raw.weight : null,
    waterMl,
  };
}

function makeFreshDays() {
  const arr = {};
  for (let i = 1; i <= TOTAL_DAYS; i++) arr[i] = emptyDay();
  return arr;
}

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

function weekOf(dayNum) {
  return Math.ceil(dayNum / 7);
}

function cheatsUsedInWeek(days, dayNum) {
  const week = weekOf(dayNum);
  const start = (week - 1) * 7 + 1;
  const end = Math.min(week * 7, TOTAL_DAYS);
  let count = 0;
  for (let i = start; i <= end; i++) if (days[i]?.dietCheat) count++;
  return count;
}

// Hard: diet must simply be logged as on-plan every day, no cheats.
// Soft: on-plan is always fine; a cheat day is only fine if it's the
// sole cheat logged in that 7-day block.
function isDietOk(days, dayNum, mode) {
  const day = days[dayNum];
  if (!day) return false;
  if (mode !== "soft") return !!day.diet;
  if (!day.diet) return false;
  if (!day.dietCheat) return true;
  return cheatsUsedInWeek(days, dayNum) === 1;
}

function isDayComplete(days, dayNum, mode) {
  const day = days[dayNum];
  if (!day) return false;
  const waterGoal = mode === "soft" ? SOFT_WATER_GOAL_ML : HARD_WATER_GOAL_ML;
  const waterOk = (day.waterMl || 0) >= waterGoal;
  const dietOk = isDietOk(days, dayNum, mode);
  if (mode === "soft") {
    return day.workout1 && day.reading && dietOk && waterOk && day.photo;
  }
  return day.workout1 && day.workout2 && dietOk && waterOk && day.photo;
}

function consecutiveStreak(days, mode) {
  let streak = 0;
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    if (isDayComplete(days, i, mode)) streak++;
    else break;
  }
  return streak;
}

function backwardStreak(days, uptoDay, mode) {
  let count = 0;
  for (let i = Math.min(uptoDay, TOTAL_DAYS); i >= 1; i--) {
    if (isDayComplete(days, i, mode)) count++;
    else break;
  }
  return count;
}

function totalCompletedCount(days, mode) {
  let count = 0;
  for (let i = 1; i <= TOTAL_DAYS; i++) if (isDayComplete(days, i, mode)) count++;
  return count;
}

// Finds the first logged weight and the most recent logged weight (up to
// the active day) to show a simple trend. Returns null until there are at
// least two distinct days logged.
function getWeightTrend(days, activeDay) {
  let firstDay = null;
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    if (typeof days[i]?.weight === "number") {
      firstDay = i;
      break;
    }
  }
  if (firstDay === null) return null;
  let latestDay = null;
  for (let i = Math.min(activeDay, TOTAL_DAYS); i >= 1; i--) {
    if (typeof days[i]?.weight === "number") {
      latestDay = i;
      break;
    }
  }
  if (latestDay === null || latestDay === firstDay) return null;
  const first = days[firstDay].weight;
  const latest = days[latestDay].weight;
  return { firstDay, latestDay, first, latest, diff: Math.round((latest - first) * 10) / 10 };
}

export default function App() {
  const [days, setDays] = useState(makeFreshDays);
  const [photos, setPhotos] = useState({});
  const [startDate, setStartDate] = useState(null);
  const [mode, setMode] = useState(null); // "hard" | "soft" | null (not chosen yet)
  const [history, setHistory] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [view, setView] = useState("main"); // main | history | historyDetail | historyCompare | compare
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState("");
  const [resetNotice, setResetNotice] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const fileInputRef = useRef(null);
  const daysRef = useRef(days);
  const activeDayRef = useRef(1);
  const modeRef = useRef(mode);

  const showToast = (msg, ms = 2500) => {
    setToast(msg);
    setTimeout(() => setToast(""), ms);
  };

  const persistState = useCallback(async (nextDays, nextStart, nextMode) => {
    await storage.setState({ days: nextDays, startDate: nextStart, mode: nextMode });
  }, []);

  const persistPhotos = useCallback(async (nextPhotos) => {
    const ok = await storage.setPhotos(nextPhotos);
    if (!ok) showToast("Photo storage is full on this device");
  }, []);

  const persistHistory = useCallback(async (nextHistory) => {
    const ok = await storage.setHistory(nextHistory);
    if (!ok) showToast("Couldn't save history — storage is full");
  }, []);

  // Archive current attempt into history, then reset the board. If
  // endDayOverride is omitted, the attempt is treated as having run the
  // full 75-day span (used for natural period-end, success or not).
  const archiveAndReset = useCallback(
    async (currentDays, currentPhotos, currentStart, currentHistory, currentMode, { completed, endDayOverride }) => {
      const streakReached = consecutiveStreak(currentDays, currentMode);
      const totalDone = totalCompletedCount(currentDays, currentMode);
      const endDate = endDayOverride
        ? dateForDay(currentStart, endDayOverride)
        : dateForDay(currentStart, TOTAL_DAYS);
      const entry = {
        id: Date.now(),
        attemptNumber: currentHistory.length + 1,
        startDate: currentStart,
        endDate,
        daysCompleted: currentMode === "soft" ? totalDone : streakReached,
        completed: !!completed,
        mode: currentMode,
        days: currentDays,
        photos: currentPhotos,
      };
      const nextHistory = [...currentHistory, entry];
      const freshDays = makeFreshDays();
      const today = todayStr();

      setHistory(nextHistory);
      setDays(freshDays);
      setPhotos({});
      setStartDate(today);

      await persistHistory(nextHistory);
      await persistState(freshDays, today, currentMode);
      await persistPhotos({});

      return { nextHistory, freshDays, today };
    },
    [persistHistory, persistState, persistPhotos]
  );

  useEffect(() => {
    (async () => {
      const state = await storage.getState();
      let loadedDays = makeFreshDays();
      let loadedStart = null;
      let loadedMode = null;
      let wasFreshInstall = false;

      if (state) {
        if (state.days) {
          const merged = {};
          for (let i = 1; i <= TOTAL_DAYS; i++) merged[i] = normalizeDay(state.days[i]);
          loadedDays = merged;
        }
        loadedStart = state.startDate || null;
        loadedMode = state.mode || null;
      }

      const p = (await storage.getPhotos()) || {};
      const h = (await storage.getHistory()) || [];

      if (!loadedStart) {
        loadedStart = todayStr();
        wasFreshInstall = true;
      }

      if (!loadedMode) {
        if (wasFreshInstall) {
          // True first run — defer everything to the mode picker screen.
          setDays(loadedDays);
          setPhotos(p);
          setStartDate(loadedStart);
          setHistory(h);
          setMode(null);
          setLoaded(true);
          return;
        }
        // Existing attempt from before mode selection existed — default to Hard.
        loadedMode = "hard";
      }

      await persistState(loadedDays, loadedStart, loadedMode);

      // Hard mode only: check whether a past day was left incomplete.
      let failedDay = null;
      if (loadedMode === "hard") {
        const elapsed = elapsedDay(loadedStart);
        for (let i = 1; i <= Math.min(elapsed - 1, TOTAL_DAYS); i++) {
          if (!isDayComplete(loadedDays, i, loadedMode)) {
            failedDay = i;
            break;
          }
        }
      }

      if (failedDay) {
        await archiveAndReset(loadedDays, p, loadedStart, h, loadedMode, { completed: false, endDayOverride: failedDay });
        setMode(loadedMode);
        setResetNotice(`Day ${failedDay} wasn't finished — that attempt (${failedDay - 1} days) was archived. Starting over at Day 1.`);
      } else {
        setDays(loadedDays);
        setPhotos(p);
        setStartDate(loadedStart);
        setHistory(h);
        setMode(loadedMode);
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const notifPref = window.localStorage.getItem(NOTIF_PREF_KEY);
    if (notifPref === "1" && getPermissionState() === "granted") setNotifEnabled(true);
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

  const totalDone = totalCompletedCount(days, mode);
  const elapsed = startDate ? elapsedDay(startDate) : 1;
  const activeDay = Math.min(Math.max(elapsed, 1), TOTAL_DAYS);
  const displayStreak = mode === "soft" ? backwardStreak(days, activeDay, mode) : consecutiveStreak(days, mode);
  const periodEnded = elapsed > TOTAL_DAYS;
  const success = mode === "soft" ? totalDone === TOTAL_DAYS : displayStreak === TOTAL_DAYS;
  const weightTrend = getWeightTrend(days, activeDay);

  useEffect(() => {
    daysRef.current = days;
  }, [days]);
  useEffect(() => {
    activeDayRef.current = activeDay;
  }, [activeDay]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Keep local reminders scheduled for the rest of today whenever enabled,
  // and reschedule when the app comes back into view (timers don't survive
  // the tab being fully suspended).
  useEffect(() => {
    if (!loaded) return;
    const doSchedule = () => {
      if (notifEnabled && getPermissionState() === "granted") {
        scheduleReminders(
          () => isDayComplete(daysRef.current, activeDayRef.current, modeRef.current),
          activeDayRef.current
        );
      }
    };
    doSchedule();
    const onVis = () => {
      if (document.visibilityState === "visible") doSchedule();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loaded, notifEnabled, activeDay]);

  const toggleNotifications = async () => {
    if (!notificationsSupported()) {
      showToast("Notifications aren't supported in this browser");
      return;
    }
    if (notifEnabled) {
      clearScheduledReminders();
      setNotifEnabled(false);
      window.localStorage.setItem(NOTIF_PREF_KEY, "0");
      showToast("Reminders turned off");
      return;
    }
    const perm = await requestPermission();
    if (perm === "granted") {
      setNotifEnabled(true);
      window.localStorage.setItem(NOTIF_PREF_KEY, "1");
      showToast("Reminders on — last 4 hours of each day, every 30 min");
    } else if (perm === "denied") {
      showToast("Notifications are blocked — enable them in your browser/app settings");
    }
  };

  const chooseMode = async (m) => {
    const today = todayStr();
    const fresh = makeFreshDays();
    setMode(m);
    setDays(fresh);
    setStartDate(today);
    await persistState(fresh, today, m);
  };

  const cycleMode = async () => {
    const next = mode === "hard" ? "soft" : "hard";
    setMode(next);
    await persistState(days, startDate, next);
    showToast(
      next === "hard"
        ? "Switched to Hard — 2 workouts, zero cheats, 1 gallon, and a missed day resets you"
        : "Switched to Soft — 1 workout, 3L water, 1 cheat meal/week, no resets"
    );
  };

  const toggleTask = (dayNum, key) => {
    setDays((prev) => {
      const next = { ...prev, [dayNum]: { ...prev[dayNum], [key]: !prev[dayNum][key] } };
      persistState(next, startDate, mode);
      return next;
    });
  };

  const setDiet = (dayNum, choice) => {
    setDays((prev) => {
      const cur = prev[dayNum];
      let nextDiet = cur.diet;
      let nextCheat = cur.dietCheat;
      if (choice === "plan") {
        if (cur.diet && !cur.dietCheat) {
          nextDiet = false;
          nextCheat = false;
        } else {
          nextDiet = true;
          nextCheat = false;
        }
      } else if (choice === "cheat") {
        if (cur.dietCheat) {
          nextDiet = false;
          nextCheat = false;
        } else {
          nextDiet = true;
          nextCheat = true;
        }
      }
      const next = { ...prev, [dayNum]: { ...cur, diet: nextDiet, dietCheat: nextCheat } };
      persistState(next, startDate, mode);
      return next;
    });
  };

  const adjustWater = (dayNum, deltaMl) => {
    setDays((prev) => {
      const cur = prev[dayNum].waterMl || 0;
      const nextVal = Math.max(0, Math.min(WATER_MAX_ML, cur + deltaMl));
      const next = { ...prev, [dayNum]: { ...prev[dayNum], waterMl: nextVal } };
      persistState(next, startDate, mode);
      return next;
    });
  };

  const setWeight = (dayNum, rawValue) => {
    const trimmed = rawValue.trim();
    const parsed = trimmed === "" ? null : parseFloat(trimmed);
    const clean = parsed !== null && !Number.isNaN(parsed) ? Math.round(parsed * 10) / 10 : null;
    setDays((prev) => {
      const next = { ...prev, [dayNum]: { ...prev[dayNum], weight: clean } };
      persistState(next, startDate, mode);
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
        persistState(next, startDate, mode);
        return next;
      });
    } catch (err) {
      showToast("Couldn't process that photo");
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
      persistState(next, startDate, mode);
      return next;
    });
  };

  const startNewAttempt = async () => {
    await archiveAndReset(days, photos, startDate, history, mode, { completed: success });
  };

  if (!loaded) {
    return (
      <div style={{ ...styles.app, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.muted, fontFamily: FONT.mono, letterSpacing: 2 }}>LOADING…</div>
      </div>
    );
  }

  // ---------- Mode picker (first run only) ----------
  if (mode === null) {
    return (
      <div style={styles.app}>
        <div style={styles.eyebrow}>CHOOSE YOUR CHALLENGE</div>
        <h1 style={styles.title}>75 HARD</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 28, flex: 1, justifyContent: "center" }}>
          <button onClick={() => chooseMode("hard")} style={styles.modeCard}>
            <div style={styles.modeCardTitle}>HARD</div>
            <div style={styles.modeCardDesc}>
              2 workouts a day (one outdoors), zero cheats, 1 gallon of water, 10 pages, a photo. Miss one task
              and the board resets to Day 1. No exceptions.
            </div>
          </button>
          <button onClick={() => chooseMode("soft")} style={styles.modeCard}>
            <div style={styles.modeCardTitle}>SOFT</div>
            <div style={styles.modeCardDesc}>
              1 workout a day, 3 liters of water, one cheat meal allowed per week, 10 pages, a photo. Missed
              days just stay incomplete — nothing ever resets.
            </div>
          </button>
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLORS.muted, letterSpacing: 1, marginTop: 12 }}>
          YOU CAN SWITCH MODES LATER FROM THE MAIN SCREEN
        </div>
      </div>
    );
  }

  // ---------- History list ----------
  if (view === "history") {
    return (
      <div style={styles.app}>
        <div style={styles.detailHeader}>
          <button onClick={() => setView("main")} style={styles.backBtn}>
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>BACK</span>
          </button>
          <div style={{ fontFamily: FONT.mono, color: COLORS.muted, fontSize: 12, letterSpacing: 1 }}>
            PAST ATTEMPTS
          </div>
        </div>
        {history.length === 0 ? (
          <div style={{ color: COLORS.muted, fontFamily: FONT.body, fontSize: 14, marginTop: 20 }}>
            No past attempts yet. Your first run is the one in progress.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...history].reverse().map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setSelectedAttempt(a);
                  setView("historyDetail");
                }}
                style={styles.historyCard}
              >
                <div>
                  <div style={styles.historyCardTitle}>
                    ATTEMPT #{a.attemptNumber}
                    <span style={styles.historyModeTag}>{(a.mode || "hard").toUpperCase()}</span>
                    {a.completed && <Trophy size={14} color={COLORS.accent2} style={{ marginLeft: 6, verticalAlign: "-2px" }} />}
                  </div>
                  <div style={styles.historyCardDates}>
                    {formatDisplayDate(a.startDate)} – {formatDisplayDate(a.endDate)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...styles.historyCardDays, color: a.completed ? COLORS.accent2 : COLORS.text }}>
                    {a.daysCompleted}/{TOTAL_DAYS}
                  </div>
                  <div style={styles.historyCardLabel}>{a.completed ? "COMPLETE" : "DAYS"}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- History detail (photo grid) ----------
  if (view === "historyDetail" && selectedAttempt) {
    const a = selectedAttempt;
    const dayNums = Object.keys(a.photos || {}).map(Number).sort((x, y) => x - y);
    return (
      <div style={styles.app}>
        <div style={styles.detailHeader}>
          <button onClick={() => setView("history")} style={styles.backBtn}>
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>ALL ATTEMPTS</span>
          </button>
          {dayNums.length >= 2 && (
            <button onClick={() => setView("historyCompare")} style={styles.compareTextBtn}>
              <Images size={14} strokeWidth={1.75} />
              <span>COMPARE</span>
            </button>
          )}
        </div>
        <h1 style={styles.dayTitle}>ATTEMPT #{a.attemptNumber}</h1>
        <div style={{ color: COLORS.muted, fontFamily: FONT.mono, fontSize: 12, marginTop: 6, marginBottom: 20 }}>
          {formatDisplayDate(a.startDate)} – {formatDisplayDate(a.endDate)} · {a.daysCompleted}/{TOTAL_DAYS} days
        </div>
        {dayNums.length === 0 ? (
          <div style={{ color: COLORS.muted, fontSize: 13 }}>No photos saved for this attempt.</div>
        ) : (
          <div style={styles.photoGrid}>
            {dayNums.map((n) => (
              <div key={n} style={styles.photoGridItem}>
                <img src={a.photos[n]} alt={`Day ${n}`} style={styles.photoGridImg} />
                <div style={styles.photoGridLabel}>D{n}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- History compare ----------
  if (view === "historyCompare" && selectedAttempt) {
    const a = selectedAttempt;
    const dayNums = Object.keys(a.photos || {}).map(Number).sort((x, y) => x - y);
    const firstDay = dayNums[0];
    const lastDay = dayNums[dayNums.length - 1];
    return (
      <div style={styles.app}>
        <div style={styles.detailHeader}>
          <button onClick={() => setView("historyDetail")} style={styles.backBtn}>
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>ATTEMPT #{a.attemptNumber}</span>
          </button>
        </div>
        <h1 style={styles.dayTitle}>COMPARE</h1>
        <div style={styles.compareRow}>
          <div style={styles.compareCol}>
            <img src={a.photos[firstDay]} alt={`Day ${firstDay}`} style={styles.comparePhoto} />
            <div style={styles.compareLabel}>DAY {firstDay}</div>
          </div>
          <div style={styles.compareCol}>
            <img src={a.photos[lastDay]} alt={`Day ${lastDay}`} style={styles.comparePhoto} />
            <div style={styles.compareLabel}>DAY {lastDay}</div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Current attempt compare ----------
  if (view === "compare") {
    const day1Photo = photos[1];
    let latestDay = null;
    for (let i = Math.min(activeDay, TOTAL_DAYS); i >= 1; i--) {
      if (photos[i]) {
        latestDay = i;
        break;
      }
    }
    const otherDay = latestDay && latestDay !== 1 ? latestDay : null;
    return (
      <div style={styles.app}>
        <div style={styles.detailHeader}>
          <button onClick={() => setView("main")} style={styles.backBtn}>
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>BACK</span>
          </button>
        </div>
        <h1 style={styles.dayTitle}>COMPARE</h1>
        <div style={styles.compareRow}>
          <div style={styles.compareCol}>
            {day1Photo ? (
              <img src={day1Photo} alt="Day 1" style={styles.comparePhoto} />
            ) : (
              <div style={styles.comparePlaceholder}>No Day 1 photo yet</div>
            )}
            <div style={styles.compareLabel}>DAY 1</div>
          </div>
          <div style={styles.compareCol}>
            {otherDay ? (
              <>
                <img src={photos[otherDay]} alt={`Day ${otherDay}`} style={styles.comparePhoto} />
                <div style={styles.compareLabel}>DAY {otherDay}</div>
              </>
            ) : (
              <div style={styles.comparePlaceholder}>Add more day photos to compare</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Day detail ----------
  if (selectedDay) {
    const day = days[selectedDay];
    const complete = isDayComplete(days, selectedDay, mode);
    const dateLabel = startDate ? formatDisplayDate(dateForDay(startDate, selectedDay)) : "";
    const waterGoalMl = mode === "soft" ? SOFT_WATER_GOAL_ML : HARD_WATER_GOAL_ML;
    const waterMl = day.waterMl || 0;
    const waterPct = Math.min(100, Math.round((waterMl / waterGoalMl) * 100));
    const waterDone = waterMl >= waterGoalMl;
    const waterButtons = mode === "soft" ? SOFT_WATER_BUTTONS : HARD_WATER_BUTTONS;
    const waterDisplay =
      mode === "soft"
        ? `${(waterMl / 1000).toFixed(1)} / 3.0 L`
        : `${Math.round(waterMl / ML_PER_OZ)} / 128 oz`;
    const cheatsThisWeek = cheatsUsedInWeek(days, selectedDay);
    const dietOk = isDietOk(days, selectedDay, mode);

    return (
      <div style={styles.app}>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
        <div style={styles.detailHeader}>
          <button onClick={() => setSelectedDay(null)} style={styles.backBtn}>
            <ChevronLeft size={18} strokeWidth={2.5} />
            <span>ALL DAYS</span>
          </button>
          <div style={{ fontFamily: FONT.mono, color: COLORS.muted, fontSize: 12, letterSpacing: 1 }}>
            {String(selectedDay).padStart(2, "0")} / {TOTAL_DAYS} · {dateLabel}
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
            {/* Workout(s) */}
            <button onClick={() => toggleTask(selectedDay, "workout1")} style={styles.taskRow}>
              <div
                style={{
                  ...styles.taskCheck,
                  background: day.workout1 ? COLORS.accent : "transparent",
                  borderColor: day.workout1 ? COLORS.accent : COLORS.line,
                }}
              >
                {day.workout1 && <Check size={14} color="#16171A" strokeWidth={3} />}
              </div>
              <Dumbbell size={18} color={day.workout1 ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
              <span style={{ ...styles.taskLabel, color: day.workout1 ? COLORS.text : COLORS.muted }}>
                {mode === "soft" ? "Workout — 45 min" : "Workout 1 — 45 min"}
              </span>
            </button>

            {mode === "hard" && (
              <button onClick={() => toggleTask(selectedDay, "workout2")} style={styles.taskRow}>
                <div
                  style={{
                    ...styles.taskCheck,
                    background: day.workout2 ? COLORS.accent : "transparent",
                    borderColor: day.workout2 ? COLORS.accent : COLORS.line,
                  }}
                >
                  {day.workout2 && <Check size={14} color="#16171A" strokeWidth={3} />}
                </div>
                <Dumbbell size={18} color={day.workout2 ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
                <span style={{ ...styles.taskLabel, color: day.workout2 ? COLORS.text : COLORS.muted }}>
                  Workout 2 — 45 min, outdoors
                </span>
              </button>
            )}

            {/* Diet */}
            {mode === "hard" ? (
              <button onClick={() => toggleTask(selectedDay, "diet")} style={styles.taskRow}>
                <div
                  style={{
                    ...styles.taskCheck,
                    background: day.diet ? COLORS.accent : "transparent",
                    borderColor: day.diet ? COLORS.accent : COLORS.line,
                  }}
                >
                  {day.diet && <Check size={14} color="#16171A" strokeWidth={3} />}
                </div>
                <UtensilsCrossed size={18} color={day.diet ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
                <span style={{ ...styles.taskLabel, color: day.diet ? COLORS.text : COLORS.muted }}>
                  Diet — zero cheats, zero alcohol
                </span>
              </button>
            ) : (
              <div style={styles.waterCard}>
                <div style={styles.waterHeader}>
                  <UtensilsCrossed size={18} color={dietOk ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
                  <span style={{ ...styles.taskLabel, color: dietOk ? COLORS.text : COLORS.muted, flex: 1 }}>Diet</span>
                  <span style={{ ...styles.waterValue, color: cheatsThisWeek > 1 ? COLORS.accent : COLORS.muted }}>
                    {cheatsThisWeek}/1 cheat this week
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setDiet(selectedDay, "plan")}
                    style={{
                      ...styles.dietChoiceBtn,
                      background: day.diet && !day.dietCheat ? COLORS.accent : "transparent",
                      borderColor: day.diet && !day.dietCheat ? COLORS.accent : COLORS.line,
                      color: day.diet && !day.dietCheat ? "#16171A" : COLORS.text,
                    }}
                  >
                    ON PLAN
                  </button>
                  <button
                    onClick={() => setDiet(selectedDay, "cheat")}
                    style={{
                      ...styles.dietChoiceBtn,
                      background: day.dietCheat ? COLORS.accent2 : "transparent",
                      borderColor: day.dietCheat ? COLORS.accent2 : COLORS.line,
                      color: day.dietCheat ? "#16171A" : COLORS.text,
                    }}
                  >
                    CHEAT MEAL
                  </button>
                </div>
              </div>
            )}

            {/* Water */}
            <div style={styles.waterCard}>
              <div style={styles.waterHeader}>
                <Droplets size={18} color={waterDone ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
                <span style={{ ...styles.taskLabel, color: waterDone ? COLORS.text : COLORS.muted, flex: 1 }}>Water</span>
                <span style={styles.waterValue}>{waterDisplay}</span>
              </div>
              <div style={styles.waterBarTrack}>
                <div style={{ ...styles.waterBarFill, width: `${waterPct}%`, background: waterDone ? COLORS.accent : COLORS.accent2 }} />
              </div>
              <div style={styles.waterButtons}>
                {waterButtons.map((b, idx) => {
                  const Icon = b.icon;
                  return (
                    <button key={idx} onClick={() => adjustWater(selectedDay, b.deltaMl)} style={styles.waterBtn}>
                      <Icon size={12} strokeWidth={2.5} />
                      <span>{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reading */}
            <button onClick={() => toggleTask(selectedDay, "reading")} style={styles.taskRow}>
              <div
                style={{
                  ...styles.taskCheck,
                  background: day.reading ? COLORS.accent : "transparent",
                  borderColor: day.reading ? COLORS.accent : COLORS.line,
                }}
              >
                {day.reading && <Check size={14} color="#16171A" strokeWidth={3} />}
              </div>
              <BookOpen size={18} color={day.reading ? COLORS.text : COLORS.muted} strokeWidth={1.75} />
              <span style={{ ...styles.taskLabel, color: day.reading ? COLORS.text : COLORS.muted }}>
                {mode === "soft" ? "10 pages, any book" : "10 pages, non-fiction"}
              </span>
            </button>
          </div>

          <div style={styles.weightSection}>
            <div style={styles.photoLabel}>BODY WEIGHT (OPTIONAL)</div>
            <div style={styles.weightRow}>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="—"
                value={day.weight === null || day.weight === undefined ? "" : day.weight}
                onChange={(e) => setWeight(selectedDay, e.target.value)}
                style={styles.weightInput}
              />
              <span style={styles.weightUnit}>lb</span>
            </div>
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

  // ---------- Main grid ----------
  return (
    <div style={styles.app}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />

      {resetNotice && (
        <div style={styles.resetBanner}>
          <span style={{ fontSize: 12.5, color: COLORS.text, lineHeight: 1.4 }}>{resetNotice}</span>
          <button onClick={() => setResetNotice(null)} style={styles.installDismiss}>
            <X size={14} color={COLORS.muted} />
          </button>
        </div>
      )}

      {periodEnded && (
        <div style={{ ...styles.completeBanner, borderColor: success ? COLORS.accent2 : COLORS.line }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {success && <Trophy size={18} color={COLORS.accent2} />}
            <span style={{ fontSize: 13, color: COLORS.text, fontWeight: 600 }}>
              {success
                ? `75 ${mode === "soft" ? "Soft" : "Hard"} complete. All 75 days locked in.`
                : `Challenge period ended — ${totalDone}/75 days completed.`}
            </span>
          </div>
          <button onClick={startNewAttempt} style={styles.installBtn}>NEW ATTEMPT</button>
        </div>
      )}

      {showInstallBanner && (
        <div style={styles.installBanner}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isIos() ? <Share size={16} color={COLORS.accent2} /> : <Download size={16} color={COLORS.accent2} />}
            <span style={{ fontSize: 12.5, color: COLORS.text }}>
              {isIos() ? "Tap Share, then \u201cAdd to Home Screen\u201d to install" : "Install this app for offline access"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!isIos() && <button onClick={runInstall} style={styles.installBtn}>INSTALL</button>}
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
          <div style={styles.streakNum}>{String(displayStreak).padStart(2, "0")}</div>
          <div style={styles.streakLabel}>STREAK</div>
        </div>
      </div>

      <div style={styles.toolbar}>
        <button onClick={cycleMode} style={styles.modePill}>
          {mode.toUpperCase()}
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setView("compare")} style={styles.toolbarIconBtn}>
          <Images size={16} color={COLORS.muted} strokeWidth={1.75} />
        </button>
        <button onClick={toggleNotifications} style={styles.toolbarIconBtn}>
          {notifEnabled ? <Bell size={16} color={COLORS.accent2} strokeWidth={1.75} /> : <BellOff size={16} color={COLORS.muted} strokeWidth={1.75} />}
        </button>
        <button onClick={() => setView("history")} style={styles.toolbarIconBtn}>
          <HistoryIcon size={16} color={COLORS.muted} strokeWidth={1.75} />
        </button>
      </div>

      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${(displayStreak / TOTAL_DAYS) * 100}%` }} />
      </div>
      <div style={styles.progressText}>
        {mode === "soft" ? `${totalDone} of ${TOTAL_DAYS} total · ${displayStreak}-day streak` : `${displayStreak} of ${TOTAL_DAYS} days complete`} · Day {activeDay} today
      </div>
      {weightTrend && (
        <div style={styles.weightTrendText}>
          {weightTrend.latest} lb ({weightTrend.diff > 0 ? "+" : ""}
          {weightTrend.diff} lb since Day {weightTrend.firstDay})
        </div>
      )}

      <div style={styles.grid}>
        {Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1).map((n) => {
          const day = days[n];
          const complete = isDayComplete(days, n, mode);
          const isActive = n === activeDay && !periodEnded;
          const isFuture = n > activeDay;
          const anyProgress =
            day.workout1 || (mode === "hard" && day.workout2) || day.diet || (day.waterMl || 0) > 0 || day.reading || day.photo;
          return (
            <button
              key={n}
              onClick={() => !isFuture && setSelectedDay(n)}
              disabled={isFuture}
              style={{
                ...styles.cell,
                background: complete ? COLORS.accent : "transparent",
                borderColor: isActive ? COLORS.accent2 : anyProgress ? COLORS.muted : COLORS.line,
                borderWidth: isActive ? 2 : 1,
                color: complete ? "#16171A" : isActive ? COLORS.accent2 : COLORS.muted,
                opacity: isFuture ? 0.35 : 1,
                cursor: isFuture ? "default" : "pointer",
              }}
            >
              {complete ? <Check size={14} strokeWidth={3} /> : isFuture ? <Lock size={11} strokeWidth={2} /> : n}
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
            <span style={{ color: COLORS.text, fontSize: 13 }}>
              Wipe current progress and start over at Day 1? This attempt will be saved to history.
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  await archiveAndReset(days, photos, startDate, history, mode, { completed: false, endDayOverride: activeDay });
                  setConfirmReset(false);
                }}
                style={styles.confirmYes}
              >
                YES, RESET
              </button>
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
  resetBanner: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    background: COLORS.panel,
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 6,
    padding: "10px 12px",
    marginBottom: 16,
  },
  completeBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: COLORS.panel,
    border: "1px solid",
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
    whiteSpace: "nowrap",
  },
  installDismiss: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  modePill: {
    background: "transparent",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 20,
    padding: "6px 12px",
    color: COLORS.accent2,
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  toolbarIconBtn: {
    background: "transparent",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 4,
    padding: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
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
  weightTrendText: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: COLORS.accent2,
    marginTop: -14,
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
    maxWidth: "85%",
    textAlign: "center",
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
  compareTextBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: `1px solid ${COLORS.line}`,
    borderRadius: 4,
    padding: "5px 10px",
    color: COLORS.muted,
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1,
    cursor: "pointer",
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
  waterCard: {
    padding: "14px 12px",
    background: COLORS.panel,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  waterHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  waterValue: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: COLORS.muted,
  },
  waterBarTrack: {
    height: 6,
    background: COLORS.bg,
    borderRadius: 3,
    overflow: "hidden",
  },
  waterBarFill: {
    height: "100%",
    transition: "width 0.2s ease",
  },
  waterButtons: {
    display: "flex",
    gap: 6,
  },
  waterBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    padding: "8px 4px",
    background: COLORS.bg,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 4,
    color: COLORS.text,
    fontFamily: FONT.mono,
    fontSize: 10,
    cursor: "pointer",
  },
  dietChoiceBtn: {
    flex: 1,
    padding: "10px 4px",
    border: "1.5px solid",
    borderRadius: 4,
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: 600,
    cursor: "pointer",
  },
  weightSection: {
    marginTop: 4,
  },
  weightRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: COLORS.panel,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    padding: "10px 14px",
  },
  weightInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: COLORS.text,
    fontFamily: FONT.display,
    fontSize: 22,
    fontWeight: 600,
  },
  weightUnit: {
    fontFamily: FONT.mono,
    fontSize: 12,
    color: COLORS.muted,
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
  historyCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 14px",
    background: COLORS.panel,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
  },
  historyCardTitle: {
    fontFamily: FONT.mono,
    fontSize: 12,
    letterSpacing: 1,
    color: COLORS.text,
  },
  historyModeTag: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: COLORS.muted,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 3,
    padding: "1px 5px",
    marginLeft: 8,
  },
  historyCardDates: {
    fontFamily: FONT.body,
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 4,
  },
  historyCardDays: {
    fontFamily: FONT.display,
    fontSize: 20,
    fontWeight: 700,
  },
  historyCardLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: COLORS.muted,
    marginTop: 2,
  },
  photoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 8,
  },
  photoGridItem: {
    position: "relative",
    borderRadius: 6,
    overflow: "hidden",
    border: `1px solid ${COLORS.line}`,
  },
  photoGridImg: {
    width: "100%",
    aspectRatio: "1",
    objectFit: "cover",
    display: "block",
  },
  photoGridLabel: {
    position: "absolute",
    bottom: 4,
    right: 4,
    background: "rgba(22,23,26,0.75)",
    color: COLORS.text,
    fontFamily: FONT.mono,
    fontSize: 9,
    padding: "2px 5px",
    borderRadius: 3,
  },
  compareRow: {
    display: "flex",
    gap: 12,
  },
  compareCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  comparePhoto: {
    width: "100%",
    aspectRatio: "3/4",
    objectFit: "cover",
    borderRadius: 6,
    border: `1px solid ${COLORS.line}`,
  },
  comparePlaceholder: {
    width: "100%",
    aspectRatio: "3/4",
    borderRadius: 6,
    border: `1.5px dashed ${COLORS.line}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: COLORS.muted,
    fontSize: 12,
    padding: 12,
  },
  compareLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLORS.muted,
  },
  modeCard: {
    padding: 18,
    background: COLORS.panel,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 8,
    textAlign: "left",
    cursor: "pointer",
  },
  modeCardTitle: {
    fontFamily: FONT.display,
    fontSize: 22,
    fontWeight: 700,
    color: COLORS.accent2,
    letterSpacing: 1,
    marginBottom: 6,
  },
  modeCardDesc: {
    fontFamily: FONT.body,
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 1.5,
  },
};