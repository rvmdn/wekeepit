/**
 * ReminderService - Background timer, Web Audio Synthesizer,
 * and Desktop Notifications for cards & daily activities.
 */
class ReminderService {
  constructor(onReminderTriggered, onUpdateCard) {
    this.onReminderTriggered = onReminderTriggered || (() => {});
    this.onUpdateCard = onUpdateCard || (() => {});
    this.timerId = null;
    this.audioCtx = null;
    this.activeAlerts = new Set();
    this.permissionGranted = false;
  }

  init() {
    this.requestNotificationPermission();
    this.startTicker();
  }

  requestNotificationPermission() {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        this.permissionGranted = true;
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          this.permissionGranted = (permission === 'granted');
        });
      }
    }
  }

  startTicker() {
    if (this.timerId) clearInterval(this.timerId);
    // Tick every 10 seconds
    this.timerId = setInterval(() => this.checkReminders(), 10000);
    // Initial check immediately
    setTimeout(() => this.checkReminders(), 1000);
  }

  stopTicker() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  setCards(cards) {
    this.cards = cards || [];
  }

  checkReminders() {
    if (!this.cards || !Array.isArray(this.cards)) return;
    const now = new Date();

    for (const card of this.cards) {
      if (!card.reminder || !card.reminder.datetime) continue;
      if (card.reminder.dismissed) continue;

      const dueTime = new Date(card.reminder.datetime);
      if (isNaN(dueTime.getTime())) continue;

      // Trigger if due time is in the past or within 10s of now, and hasn't been notified yet in this session
      const diffMs = now - dueTime;
      // If due within the last 2 hours and not yet actively buzzing
      if (diffMs >= 0 && diffMs < 2 * 3600 * 1000 && !this.activeAlerts.has(card.id)) {
        this.triggerAlert(card);
      }
    }
  }

  triggerAlert(card) {
    this.activeAlerts.add(card.id);
    this.playChime();

    // Native C# System Tray Notification
    if (window.chrome && window.chrome.webview) {
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          type: 'NATIVE_NOTIFY',
          title: `⏰ WeKeepIt: ${card.title || 'Catatan'}`,
          body: card.content ? card.content.slice(0, 100) : 'Waktunya menyelesaikan aktivitas!'
        }));
      } catch (e) {}
    }

    // System Desktop Notification (Browser/PWA mode)
    if (this.permissionGranted && 'Notification' in window) {
      try {
        const notif = new Notification(`⏰ WeKeepIt Reminder: ${card.title || 'Catatan'}`, {
          body: card.content ? card.content.slice(0, 100) : 'Waktunya menyelesaikan aktivitas!',
          icon: 'favicon.ico',
          tag: `wekeepit-${card.id}`
        });
        notif.onclick = () => {
          window.focus();
        };
      } catch (e) {
        console.warn('Desktop Notification error:', e);
      }
    }

    // Call UI hook for in-app alert banner
    this.onReminderTriggered(card);
  }

  /**
   * Pleasant dual-tone chime using Web Audio API (No audio file required!)
   */
  playChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      // Tone 1: E5 (659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      // Tone 2: A5 (880 Hz) after 150ms
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.15);
      gain2.gain.setValueAtTime(0.18, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.9);
    } catch (err) {
      console.warn('Audio synthesis note:', err);
    }
  }

  snooze(cardId, minutes = 10) {
    this.activeAlerts.delete(cardId);
    const card = (this.cards || []).find(c => c.id === cardId);
    if (card && card.reminder) {
      const newTime = new Date(Date.now() + minutes * 60000);
      card.reminder.datetime = newTime.toISOString().slice(0, 19);
      card.reminder.dismissed = false;
      this.onUpdateCard(card);
    }
  }

  dismiss(cardId) {
    this.activeAlerts.delete(cardId);
    const card = (this.cards || []).find(c => c.id === cardId);
    if (card && card.reminder) {
      if (card.reminder.repeat === 'daily') {
        // Schedule for tomorrow same time
        const current = new Date(card.reminder.datetime);
        current.setDate(current.getDate() + 1);
        card.reminder.datetime = current.toISOString().slice(0, 19);
        card.reminder.dismissed = false;
      } else {
        card.reminder.dismissed = true;
      }
      this.onUpdateCard(card);
    }
  }

  formatCountdown(dateTimeStr) {
    if (!dateTimeStr) return '';
    const target = new Date(dateTimeStr);
    const now = new Date();
    const diff = target - now;

    if (isNaN(diff)) return '';

    if (diff < 0) {
      const minsPast = Math.round(Math.abs(diff) / 60000);
      if (minsPast < 60) return `Terlewat ${minsPast}m lalu`;
      const hoursPast = Math.floor(minsPast / 60);
      if (hoursPast < 24) return `Terlewat ${hoursPast}j lalu`;
      return 'Sudah lewat';
    }

    const mins = Math.round(diff / 60000);
    if (mins < 60) return `Dalam ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Dalam ${hours}j ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `Dalam ${days} hari`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReminderService;
} else {
  window.ReminderService = ReminderService;
}
