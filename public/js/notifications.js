(function () {
  'use strict';
  if (!window.fetch) return;

  var state = { config: null, notifications: [], open: false, subscription: null, syncing: false, initialized: false, seenIds: {}, audioContext: null, audioArmed: false, pollTimer: null };

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function toast(message) {
    if (window.ClassicTrip && typeof window.ClassicTrip.toast === 'function') window.ClassicTrip.toast(message);
    else {
      var el = document.getElementById('toast');
      if (!el) return;
      var text = el.querySelector('#toastText');
      if (text) text.textContent = message; else el.textContent = message;
      el.classList.add('show');
      window.clearTimeout(window.__ctNotifyToast);
      window.__ctNotifyToast = window.setTimeout(function () { el.classList.remove('show'); }, 2600);
    }
  }

  function dashboardRole() {
    var bootstrap = document.getElementById('dashboardWorkspaceBootstrap');
    if (!bootstrap) return '';
    try { return String((JSON.parse(bootstrap.textContent || '{}').shell || {}).currentRole || '').toLowerCase(); }
    catch (_) { return ''; }
  }

  function armNotificationSound() {
    if (state.audioArmed) return;
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      state.audioContext = state.audioContext || new AudioContext();
      var resume = state.audioContext.state === 'suspended' ? state.audioContext.resume() : Promise.resolve();
      Promise.resolve(resume).then(function () { state.audioArmed = true; }).catch(function () {});
    } catch (_) {}
  }

  function playBookingSound() {
    if (!state.audioArmed || !state.audioContext) return;
    try {
      var ctx = state.audioContext;
      var now = ctx.currentTime;
      [[880, 0, .11], [1174, .14, .13]].forEach(function (tone) {
        var oscillator = ctx.createOscillator();
        var gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone[0], now + tone[1]);
        gain.gain.setValueAtTime(0.0001, now + tone[1]);
        gain.gain.exponentialRampToValueAtTime(0.16, now + tone[1] + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + tone[1] + tone[2]);
        oscillator.connect(gain); gain.connect(ctx.destination);
        oscillator.start(now + tone[1]); oscillator.stop(now + tone[1] + tone[2] + 0.02);
      });
    } catch (_) {}
  }

  function alertForNewBookings(nextNotifications) {
    if (!state.initialized) return;
    var bookingRefs = {};
    (nextNotifications || []).forEach(function (note) {
      if (!note || state.seenIds[note.id] || note.readAt || !note.meta || note.meta.alertSound !== 'booking') return;
      var key = note.meta.bookingRef || note.referenceId || note.id;
      bookingRefs[key] = note;
    });
    var keys = Object.keys(bookingRefs);
    if (!keys.length) return;
    playBookingSound();
    var newest = bookingRefs[keys[0]];
    toast(keys.length > 1 ? keys.length + ' new bookings received.' : (newest.title || 'New booking received.'));
  }

  function api(path, options) {
    options = options || {};
    options.credentials = 'same-origin';
    options.headers = new Headers(options.headers || {});
    if (options.body && !options.headers.has('Content-Type')) options.headers.set('Content-Type', 'application/json');
    if (!/^(GET|HEAD|OPTIONS)$/i.test(options.method || 'GET') && !options.headers.has('x-csrf-token')) options.headers.set('x-csrf-token', csrfToken());
    return fetch(path, options).then(function (response) {
      if (response.status === 401 || response.status === 403) return null;
      return response.json().catch(function () { return null; }).then(function (data) {
        if (data && !data.ok && response.status >= 400) data.httpStatus = response.status;
        return data;
      });
    }).catch(function () { return null; });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function pushSupported() {
    return 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
  }

  function injectStyles() {
    if (document.getElementById('ctNotifyStyles')) return;
    var style = document.createElement('style');
    style.id = 'ctNotifyStyles';
    style.textContent = [
      '.ctNotifyDock{position:fixed;right:18px;bottom:78px;z-index:9998;font-family:Inter,Arial,sans-serif}',
      '.ctNotifyButton{position:relative;width:46px;height:46px;border:1px solid var(--line,rgba(255,255,255,.18));border-radius:50%;background:var(--card,#111827);color:var(--text,#fff);box-shadow:0 14px 34px rgba(0,0,0,.28);cursor:pointer;display:grid;place-items:center}',
      '.ctNotifyButton:focus-visible{outline:2px solid #4aa3ff;outline-offset:2px}',
      '.ctNotifyBadge{position:absolute;top:-5px;right:-5px;min-width:20px;height:20px;border-radius:999px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 5px}',
      '.ctNotifyPanel{position:absolute;right:0;bottom:58px;width:min(380px,calc(100vw - 24px));max-height:min(520px,70vh);overflow:hidden;border:1px solid var(--line,rgba(255,255,255,.14));border-radius:20px;background:var(--panel,#0b1220);color:var(--text,#f8fafc);box-shadow:0 20px 60px rgba(0,0,0,.38);display:none}',
      '.ctNotifyPanel.is-open{display:grid;grid-template-rows:auto auto minmax(0,1fr)}',
      '.ctNotifyHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.1))}',
      '.ctNotifyHead strong{font-size:14px}.ctNotifyHeadActions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}',
      '.ctNotifyAction{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:10px;background:var(--field,rgba(255,255,255,.06));color:inherit;font-weight:850;font-size:11px;padding:7px 9px;cursor:pointer}',
      '.ctNotifyAction.is-primary{background:#2fd17c;color:#06110c;border-color:transparent}',
      '.ctNotifyStatus{display:flex;align-items:center;gap:7px;padding:8px 14px;font-size:11px;font-weight:800;color:var(--muted,#cbd5e1);border-bottom:1px solid var(--line,rgba(255,255,255,.08))}',
      '.ctNotifyStatus i{font-size:8px}.ctNotifyStatus.is-on i{color:#22c55e}.ctNotifyStatus.is-off i{color:#f59e0b}.ctNotifyStatus.is-blocked i{color:#ef4444}',
      '.ctNotifyList{display:grid;overflow:auto}.ctNotifyItem{border:0;border-bottom:1px solid var(--line,rgba(255,255,255,.08));background:transparent;color:inherit;text-align:left;padding:12px 14px;cursor:pointer}',
      '.ctNotifyItem:hover{background:rgba(255,255,255,.05)}.ctNotifyItem strong{display:block;font-size:13px;margin-bottom:4px}.ctNotifyItem span{display:block;color:var(--muted,#cbd5e1);font-size:12px;line-height:1.4}.ctNotifyItem small{display:block;color:var(--muted2,#94a3b8);margin-top:6px}.ctNotifyItem.is-read{opacity:.62}.ctNotifyEmpty{padding:18px;color:var(--muted,#cbd5e1);font-size:13px}',
      '.notificationPageList{display:grid;gap:10px;margin-top:12px}.ctNotifyPageItem{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:13px 14px;border:1px solid var(--line,rgba(148,163,184,.18));border-radius:16px;background:var(--field,rgba(255,255,255,.04))}.ctNotifyPageItem.is-read{opacity:.72}.ctNotifyPageItem strong{display:block;font-size:13px;margin-bottom:4px}.ctNotifyPageItem p{margin:0;color:var(--muted,#cbd5e1);font-size:12px;line-height:1.5}.ctNotifyPageItem small{display:block;margin-top:7px;color:var(--muted2,#94a3b8);font-size:11px}.ctNotifyPageActions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.ctNotifyPageActions button,.ctNotifyPageActions a{min-height:34px;border:1px solid var(--line,rgba(148,163,184,.18));border-radius:11px;padding:7px 10px;background:var(--card,#111827);color:inherit;font:inherit;font-size:11px;font-weight:850;text-decoration:none;cursor:pointer}',
      '@media(max-width:680px){.ctNotifyDock{right:14px;bottom:150px}.ctNotifyPanel{position:fixed;left:12px;right:12px;bottom:205px;width:auto;max-height:55vh}.ctNotifyHead{align-items:flex-start}.ctNotifyHeadActions{max-width:215px}.ctNotifyPageItem{grid-template-columns:1fr}.ctNotifyPageActions{justify-content:flex-start}}'
    ].join('');
    document.head.appendChild(style);
  }

  function pushState() {
    if (!pushSupported()) return { key: 'unsupported', label: 'Push is not supported by this browser' };
    if (!state.config || !state.config.push || !state.config.push.enabled || !state.config.push.publicKey) return { key: 'off', label: 'Push is not configured on the server' };
    if (Notification.permission === 'denied') return { key: 'blocked', label: 'Push is blocked in browser settings' };
    if (Notification.permission === 'granted' && state.subscription) return { key: 'on', label: 'Push notifications are connected' };
    if (Notification.permission === 'granted') return { key: 'off', label: 'Push permission granted — reconnecting device' };
    return { key: 'off', label: 'Push notifications are available' };
  }

  function updatePushUi() {
    var status = document.querySelector('.ctNotifyStatus');
    var enable = document.querySelector('.ctNotifyEnable');
    var test = document.querySelector('.ctNotifyTest');
    var info = pushState();
    if (status) {
      status.className = 'ctNotifyStatus is-' + info.key;
      status.innerHTML = '<i class="fa-solid fa-circle"></i><span></span>';
      status.querySelector('span').textContent = info.label;
    }
    if (enable) {
      enable.style.display = pushSupported() && state.config && state.config.push && state.config.push.enabled && Notification.permission !== 'denied' && !state.subscription ? 'inline-flex' : 'none';
      enable.textContent = Notification.permission === 'granted' ? 'Reconnect push' : 'Enable push';
    }
    if (test) test.style.display = state.subscription ? 'inline-flex' : 'none';
    document.querySelectorAll('[data-ct-enable-push]').forEach(function (button) {
      button.disabled = !pushSupported() || !state.config || !state.config.push || !state.config.push.enabled || Notification.permission === 'denied';
      button.innerHTML = state.subscription ? '<i class="fa-solid fa-circle-check"></i> Push enabled' : '<i class="fa-solid fa-bell"></i> Enable push';
    });
    document.querySelectorAll('[data-ct-test-push]').forEach(function (button) { button.disabled = !state.subscription; });
  }

  function safeRelativeUrl(value) {
    var url = String(value || '').trim();
    return /^\/(?!\/)/.test(url) ? url : '';
  }

  function renderPageLists() {
    var containers = document.querySelectorAll('[data-ct-notification-page-list]');
    if (!containers.length) return;
    containers.forEach(function (container) {
      container.innerHTML = '';
      if (!state.notifications.length) {
        var empty = document.createElement('div');
        empty.className = 'ctNotifyEmpty';
        empty.textContent = 'No notifications yet. Booking, payment, refund, support, and account updates will appear here.';
        container.appendChild(empty);
        return;
      }
      state.notifications.slice(0, 50).forEach(function (note) {
        var item = document.createElement('article');
        item.className = 'ctNotifyPageItem' + (note.readAt ? ' is-read' : '');
        var content = document.createElement('div');
        var title = document.createElement('strong');
        title.textContent = note.title || 'Classic Trip update';
        var message = document.createElement('p');
        message.textContent = note.message || '';
        var meta = document.createElement('small');
        var stamp = note.createdAt ? new Date(note.createdAt).toLocaleString() : '';
        meta.textContent = [note.channel || 'in-app', note.readAt ? 'Read' : 'Unread', stamp].filter(Boolean).join(' · ');
        content.appendChild(title);
        content.appendChild(message);
        content.appendChild(meta);
        var actions = document.createElement('div');
        actions.className = 'ctNotifyPageActions';
        if (!note.readAt) {
          var read = document.createElement('button');
          read.type = 'button';
          read.dataset.ctNotificationRead = note.id || '';
          read.textContent = 'Mark read';
          actions.appendChild(read);
        }
        var href = safeRelativeUrl(note.meta && note.meta.url);
        if (href) {
          var open = document.createElement('a');
          open.href = href;
          open.textContent = 'Open';
          actions.appendChild(open);
        }
        item.appendChild(content);
        item.appendChild(actions);
        container.appendChild(item);
      });
    });
  }

  function render() {
    var dock = document.getElementById('ctNotifyDock');
    if (!dock) return;
    var badge = dock.querySelector('.ctNotifyBadge');
    var panel = dock.querySelector('.ctNotifyPanel');
    var list = dock.querySelector('.ctNotifyList');
    var unread = state.notifications.filter(function (note) { return !note.readAt; }).length;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.style.display = unread ? 'flex' : 'none';
    panel.classList.toggle('is-open', state.open);
    list.innerHTML = '';
    if (!state.notifications.length) {
      var empty = document.createElement('div');
      empty.className = 'ctNotifyEmpty';
      empty.textContent = 'No notifications yet.';
      list.appendChild(empty);
      updatePushUi();
      renderPageLists();
      return;
    }
    state.notifications.slice(0, 30).forEach(function (note) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'ctNotifyItem' + (note.readAt ? ' is-read' : '');
      item.dataset.id = note.id;
      item.innerHTML = '<strong></strong><span></span><small></small>';
      item.querySelector('strong').textContent = note.title || 'Classic Trip update';
      item.querySelector('span').textContent = note.message || '';
      item.querySelector('small').textContent = note.createdAt ? new Date(note.createdAt).toLocaleString() : (note.channel || 'in-app');
      list.appendChild(item);
    });
    updatePushUi();
    renderPageLists();
  }

  function ensureDock() {
    if (document.getElementById('ctNotifyDock')) return;
    injectStyles();
    var dock = document.createElement('div');
    dock.className = 'ctNotifyDock';
    dock.id = 'ctNotifyDock';
    dock.innerHTML = '<button type="button" class="ctNotifyButton" aria-label="Notifications" aria-expanded="false"><span class="ctNotifyBadge"></span><i class="fa-regular fa-bell" aria-hidden="true"></i></button><div class="ctNotifyPanel" role="dialog" aria-label="Notifications"><div class="ctNotifyHead"><strong>Notifications</strong><div class="ctNotifyHeadActions"><button type="button" class="ctNotifyAction ctNotifyEnable is-primary">Enable push</button><button type="button" class="ctNotifyAction ctNotifyTest">Test push</button><button type="button" class="ctNotifyAction ctNotifyReadAll">Read all</button></div></div><div class="ctNotifyStatus is-off"><i class="fa-solid fa-circle"></i><span>Checking push status…</span></div><div class="ctNotifyList"></div></div>';
    document.body.appendChild(dock);
    dock.querySelector('.ctNotifyButton').addEventListener('click', function () {
      state.open = !state.open;
      this.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      render();
    });
    dock.querySelector('.ctNotifyEnable').addEventListener('click', enablePush);
    dock.querySelector('.ctNotifyTest').addEventListener('click', testPush);
    dock.querySelector('.ctNotifyReadAll').addEventListener('click', markAllRead);
    dock.querySelector('.ctNotifyList').addEventListener('click', function (event) {
      var button = event.target.closest('.ctNotifyItem');
      if (!button || !button.dataset.id) return;
      api('/api/notifications/' + encodeURIComponent(button.dataset.id) + '/read', { method: 'POST', body: '{}' }).then(function () { return loadNotifications(); });
    });
  }

  function loadNotifications() {
    return api('/api/notifications?limit=50').then(function (data) {
      if (!data || !data.ok) return;
      var nextNotifications = data.notifications || [];
      alertForNewBookings(nextNotifications);
      state.notifications = nextNotifications;
      nextNotifications.forEach(function (note) { if (note && note.id) state.seenIds[note.id] = true; });
      state.initialized = true;
      ensureDock();
      render();
    });
  }

  function listenForPushBookingAlerts() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', function (event) {
      var data = event && event.data ? event.data : {};
      var meta = data.meta || {};
      var role = dashboardRole();
      if (data.type !== 'classic-trip-push' || meta.alertSound !== 'booking' || !['admin', 'company'].includes(role)) return;
      var key = meta.bookingRef || data.referenceId || '';
      if (key && state.seenIds['push:' + key]) return;
      if (key) state.seenIds['push:' + key] = true;
      playBookingSound();
      toast(data.title || (key ? 'New booking ' + key : 'New booking received.'));
      window.setTimeout(function () { loadNotifications(); }, 150);
    });
  }

  function startLiveBookingAlerts() {
    var role = dashboardRole();
    if (!['admin', 'company'].includes(role) || state.pollTimer) return;
    var poll = function () {
      if (document.visibilityState === 'visible') loadNotifications();
    };
    state.pollTimer = window.setInterval(poll, 10000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') poll();
    });
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(function (registration) { return registration.update().catch(function () {}).then(function () { return navigator.serviceWorker.ready; }); });
  }

  function persistSubscription(subscription) {
    if (!subscription) return Promise.resolve(null);
    return api('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) }).then(function (result) {
      if (result && result.ok) {
        state.subscription = subscription;
        if (state.config && state.config.push) state.config.push.activeSubscriptions = Math.max(1, Number(state.config.push.activeSubscriptions || 0));
      }
      updatePushUi();
      return result;
    });
  }

  function syncPushSubscription(options) {
    options = options || {};
    if (state.syncing || !pushSupported() || !state.config || !state.config.push || !state.config.push.enabled || !state.config.push.publicKey) return Promise.resolve(null);
    if (Notification.permission !== 'granted' && !options.requestPermission) return Promise.resolve(null);
    state.syncing = true;
    var permissionPromise = options.requestPermission ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    return permissionPromise.then(function (permission) {
      if (permission !== 'granted') return null;
      return registerWorker().then(function (registration) {
        return registration.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing;
          return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.config.push.publicKey) });
        });
      }).then(persistSubscription);
    }).catch(function (error) {
      toast(error && error.message ? error.message : 'Unable to enable push notifications.');
      return null;
    }).finally(function () {
      state.syncing = false;
      updatePushUi();
    });
  }

  function enablePush() {
    return syncPushSubscription({ requestPermission: true }).then(function (result) {
      if (result && result.ok) toast('Push notifications enabled on this device.');
      else if (Notification.permission === 'denied') toast('Push is blocked. Allow notifications in your browser/site settings.');
    });
  }

  function testPush() {
    if (!state.subscription) {
      toast('Enable push first.');
      return Promise.resolve();
    }
    return api('/api/notifications/test-push', { method: 'POST', body: '{}' }).then(function (result) {
      if (result && result.ok) toast('Test push sent. Check your device notification tray.');
      else toast((result && result.push && (result.push.reason || result.push.response)) ? String(result.push.reason || 'Push test failed') : 'Push test failed. Check VAPID keys and browser permission.');
    });
  }

  function markAllRead() {
    return api('/api/notifications/read-all', { method: 'POST', body: '{}' }).then(function (result) {
      if (!result || !result.ok) return;
      toast(result.updated ? 'All notifications marked as read.' : 'No unread notifications.');
      return loadNotifications();
    });
  }

  function bindPageActions() {
    document.addEventListener('click', function (event) {
      var enable = event.target.closest('[data-ct-enable-push]');
      if (enable) { event.preventDefault(); enablePush(); return; }
      var test = event.target.closest('[data-ct-test-push]');
      if (test) { event.preventDefault(); testPush(); return; }
      var readAll = event.target.closest('[data-ct-mark-all-read]');
      if (readAll) { event.preventDefault(); markAllRead(); return; }
      var markRead = event.target.closest('[data-ct-notification-read]');
      if (markRead) {
        event.preventDefault();
        api('/api/notifications/' + encodeURIComponent(markRead.dataset.ctNotificationRead || '') + '/read', { method: 'POST', body: '{}' })
          .then(function (result) { if (result && result.ok) return loadNotifications(); toast('Unable to mark notification as read.'); });
      }
    });
  }

  function init() {
    bindPageActions();
    document.addEventListener('pointerdown', armNotificationSound, { once: true, passive: true });
    document.addEventListener('keydown', armNotificationSound, { once: true });
    api('/api/notifications/config').then(function (data) {
      if (!data || !data.ok) return;
      state.config = data;
      ensureDock();
      return registerWorker().catch(function () { return null; }).then(function (registration) {
        if (!registration || !pushSupported()) {
          state.subscription = null;
          updatePushUi();
          return null;
        }
        return registration.pushManager.getSubscription().then(function (subscription) {
          state.subscription = subscription || null;
          // A previously granted browser permission is not enough. Re-save
          // the actual endpoint after login/redeploy so the server can target
          // the current user even if the database or device record changed.
          if (subscription && Notification.permission === 'granted') return persistSubscription(subscription);
          if (!subscription && Notification.permission === 'granted') return syncPushSubscription({ requestPermission: false });
          updatePushUi();
          return null;
        });
      }).then(loadNotifications).then(function () {
        listenForPushBookingAlerts();
        startLiveBookingAlerts();
      });
    });
  }

  window.ClassicTripNotifications = { enablePush: enablePush, testPush: testPush, markAllRead: markAllRead, refresh: loadNotifications };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
