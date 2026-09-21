// Best-effort local reminders for the last 4 hours of each day, every 30 min.
// Caveat: these rely on JS timers, so they only fire while the app/tab is
// open or backgrounded (not force-quit). True background push (works even
// with the app fully closed) requires a server — this is the client-only
// approximation of that.

const WINDOW_HOURS_BEFORE_END = 4;
const INTERVAL_MIN = 30;

function getTodaysCheckpoints() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const windowStart = new Date(midnight.getTime() - WINDOW_HOURS_BEFORE_END * 3600 * 1000);
  const checkpoints = [];
  let t = new Date(windowStart);
  while (t < midnight) {
    checkpoints.push(new Date(t));
    t = new Date(t.getTime() + INTERVAL_MIN * 60 * 1000);
  }
  return checkpoints.filter((cp) => cp.getTime() > now.getTime());
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermissionState() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

export async function requestPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

let scheduledTimers = [];

export function clearScheduledReminders() {
  scheduledTimers.forEach((id) => clearTimeout(id));
  scheduledTimers = [];
}

async function fireReminder(dayLabel) {
  const body = `Day ${dayLabel}: you still have tasks left today.`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      reg.showNotification("75 Hard", {
        body,
        icon: "./pwa-192.png",
        badge: "./pwa-192.png",
        tag: "75hard-reminder",
      });
      return;
    }
  } catch (e) {
    // fall through to plain Notification
  }
  try {
    new Notification("75 Hard", { body });
  } catch (e) {
    // notifications unavailable in this context
  }
}

// isCompleteFn is called at fire-time (not schedule-time) so a reminder
// silently no-ops once the day is actually finished.
export function scheduleReminders(isCompleteFn, dayLabel) {
  clearScheduledReminders();
  if (getPermissionState() !== "granted") return;
  const checkpoints = getTodaysCheckpoints();
  checkpoints.forEach((cp) => {
    const delay = cp.getTime() - Date.now();
    const id = setTimeout(() => {
      if (isCompleteFn()) return;
      fireReminder(dayLabel);
    }, delay);
    scheduledTimers.push(id);
  });
}