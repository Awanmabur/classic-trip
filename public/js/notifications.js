(function () {
  if (!window.fetch || !('serviceWorker' in navigator)) return;

  var state = { config: null, notifications: [], open: false };

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function api(path, options) {
    options = options || {};
    options.credentials = 'same-origin';
    options.headers = new Headers(options.headers || {});
    if (options.body && !options.headers.has('Content-Type')) options.headers.set('Content-Type', 'application/json');
    if (!/^(GET|HEAD|OPTIONS)$/i.test(options.method || 'GET') && !options.headers.has('x-csrf-token')) options.headers.set('x-csrf-token', csrfToken());
    return fetch(path, options).then(function (response) {
      if (response.status === 401 || response.status === 403) return null;
      return response.json().catch(function () { return null; });
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function injectStyles() {
    if (document.getElementById('ctNotifyStyles')) return;
    var style = document.createElement('style');
    style.id = 'ctNotifyStyles';
    style.textContent = '.ctNotifyDock{position:fixed;right:18px;bottom:18px;z-index:9999;font-family:Inter,Arial,sans-serif}.ctNotifyButton{width:46px;height:46px;border:1px solid rgba(255,255,255,.18);border-radius:50%;background:#111827;color:#fff;box-shadow:0 14px 34px rgba(0,0,0,.3);cursor:pointer;display:grid;place-items:center}.ctNotifyButton:focus{outline:2px solid #4aa3ff;outline-offset:2px}.ctNotifyBadge{position:absolute;top:-5px;right:-5px;min-width:20px;height:20px;border-radius:999px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center;padding:0 5px}.ctNotifyPanel{position:absolute;right:0;bottom:58px;width:min(360px,calc(100vw - 32px));max-height:460px;overflow:auto;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:#0b1220;color:#f8fafc;box-shadow:0 20px 60px rgba(0,0,0,.4);display:none}.ctNotifyPanel.is-open{display:block}.ctNotifyHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.1)}.ctNotifyHead strong{font-size:14px}.ctNotifyEnable{border:0;border-radius:6px;background:#2fd17c;color:#06110c;font-weight:800;padding:7px 9px;cursor:pointer}.ctNotifyList{display:grid}.ctNotifyItem{border:0;border-bottom:1px solid rgba(255,255,255,.08);background:transparent;color:inherit;text-align:left;padding:12px 14px;cursor:pointer}.ctNotifyItem:hover{background:rgba(255,255,255,.05)}.ctNotifyItem strong{display:block;font-size:13px;margin-bottom:4px}.ctNotifyItem span{display:block;color:#cbd5e1;font-size:12px;line-height:1.4}.ctNotifyItem small{display:block;color:#94a3b8;margin-top:6px}.ctNotifyItem.is-read{opacity:.62}.ctNotifyEmpty{padding:16px;color:#cbd5e1;font-size:13px}';
    document.head.appendChild(style);
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
      return;
    }
    state.notifications.slice(0, 20).forEach(function (note) {
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
  }

  function ensureDock() {
    if (document.getElementById('ctNotifyDock')) return;
    injectStyles();
    var dock = document.createElement('div');
    dock.className = 'ctNotifyDock';
    dock.id = 'ctNotifyDock';
    dock.innerHTML = '<button type="button" class="ctNotifyButton" aria-label="Notifications"><span class="ctNotifyBadge"></span><i class="fa-regular fa-bell" aria-hidden="true"></i></button><div class="ctNotifyPanel" role="dialog" aria-label="Notifications"><div class="ctNotifyHead"><strong>Notifications</strong><button type="button" class="ctNotifyEnable">Enable push</button></div><div class="ctNotifyList"></div></div>';
    document.body.appendChild(dock);
    dock.querySelector('.ctNotifyButton').addEventListener('click', function () { state.open = !state.open; render(); });
    dock.querySelector('.ctNotifyEnable').addEventListener('click', enablePush);
    dock.querySelector('.ctNotifyList').addEventListener('click', function (event) {
      var button = event.target.closest('.ctNotifyItem');
      if (!button || !button.dataset.id) return;
      api('/api/notifications/' + encodeURIComponent(button.dataset.id) + '/read', { method: 'POST', body: '{}' }).then(loadNotifications);
    });
  }

  function updatePushButton() {
    var button = document.querySelector('.ctNotifyEnable');
    if (!button) return;
    var supported = 'PushManager' in window && 'Notification' in window;
    var enabled = state.config && state.config.push && state.config.push.enabled;
    button.style.display = supported && enabled && Notification.permission !== 'granted' ? 'inline-flex' : 'none';
  }

  function loadNotifications() {
    return api('/api/notifications?limit=30').then(function (data) {
      if (!data || !data.ok) return;
      state.notifications = data.notifications || [];
      ensureDock();
      updatePushButton();
      render();
    });
  }

  function enablePush() {
    if (!state.config || !state.config.push || !state.config.push.enabled || !state.config.push.publicKey) return;
    if (!('Notification' in window) || !('PushManager' in window)) return;
    Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') return;
      return navigator.serviceWorker.ready.then(function (registration) {
        return registration.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing;
          return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.config.push.publicKey) });
        });
      }).then(function (subscription) {
        return api('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
      }).then(function () {
        updatePushButton();
        if (window.ClassicTrip && window.ClassicTrip.toast) window.ClassicTrip.toast('Push notifications enabled');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    api('/api/notifications/config').then(function (data) {
      if (!data || !data.ok) return;
      state.config = data;
      navigator.serviceWorker.register('/sw.js').catch(function () {});
      return loadNotifications();
    });
  });
})();

