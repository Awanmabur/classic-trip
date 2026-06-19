(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function norm(value) {
    return String(value == null ? '' : value).toLowerCase().trim();
  }

  function lastMeta(row) {
    if (!Array.isArray(row)) return null;
    var last = row[row.length - 1];
    return last && typeof last === 'object' && !Array.isArray(last) ? last : null;
  }

  function rowCells(row) {
    var meta = lastMeta(row);
    return meta ? row.slice(0, -1) : row;
  }

  function usefulKey(key) {
    var clean = norm(String(key || '').split('.').pop());
    if (!clean) return false;
    if (['id', '_id', '__v', 'createdat', 'updatedat', 'deletedat', 'qrcodevalue', 'qrtoken', 'qrtokenhash', 'qrtokenpreview', 'token', 'hash', 'password', 'secret', 'metadata', 'meta', 'bookingitems', 'bookinglegs', 'ticketlegs'].indexOf(clean) !== -1) return false;
    return !/(^|\.)(id|_id|token|hash|password|secret|internal|metadata|meta)$/i.test(String(key || ''));
  }

  function usefulValue(value) {
    if (value == null || value === '') return false;
    if (Array.isArray(value) && !value.length) return false;
    return true;
  }

  function displayValue(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        if (item && typeof item === 'object') {
          return [item.fullName || item.name || item.passengerName, item.seatOrRoom || item.seatNumber || item.roomNumber || item.unitNumber || item.ticketNumber, item.phone || item.email, item.status || item.checkInStatus].filter(Boolean).join(' / ');
        }
        return item;
      }).filter(Boolean).join('; ');
    }
    if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
    return value;
  }

  function sanitizeGroups(groups) {
    var cleaned = {};
    Object.keys(groups || {}).forEach(function (groupName) {
      var group = groups[groupName] || {};
      var next = {};
      Object.keys(group).forEach(function (key) {
        var value = displayValue(group[key]);
        if (usefulKey(key) && usefulValue(value)) next[key] = value;
      });
      if (Object.keys(next).length) cleaned[groupName] = next;
    });
    return cleaned;
  }

  function collectMeta(data) {
    var index = [];
    function walk(value, keyPath) {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(function (item) {
          if (Array.isArray(item)) {
            var meta = lastMeta(item);
            var cells = rowCells(item);
            if (meta) {
              index.push({
                key: norm([meta.id, meta.label, meta.entity, cells[0], cells[1], keyPath].join(' ')),
                meta: meta,
                cells: cells,
                keyPath: keyPath
              });
            }
          }
          walk(item, keyPath);
        });
      } else if (typeof value === 'object') {
        Object.keys(value).forEach(function (key) { walk(value[key], keyPath ? keyPath + '.' + key : key); });
      }
    }
    walk(data || {}, 'dashboard');
    return index;
  }

  function findMeta(index, trigger) {
    var label = norm(trigger.getAttribute('data-label') || trigger.getAttribute('data-type') || trigger.textContent || '');
    var entity = norm(trigger.getAttribute('data-entity') || trigger.getAttribute('data-type') || '');
    var row = trigger.closest('tr');
    var rowText = norm(row ? row.textContent : '');
    var best = null;
    index.some(function (entry) {
      if ((label && entry.key.indexOf(label) !== -1) || (entity && entry.key.indexOf(entity) !== -1 && rowText && entry.key.indexOf(norm(entry.cells[0])) !== -1)) {
        best = entry;
        return true;
      }
      return false;
    });
    if (!best && rowText) {
      best = index.find(function (entry) { return entry.cells.some(function (cell) { return rowText.indexOf(norm(cell)) !== -1; }); });
    }
    return best;
  }

  function ensureModal() {
    var existing = document.getElementById('fullDetailsModal');
    if (existing) return existing;
    var style = document.createElement('style');
    style.textContent = '\n.ctEnhancerToolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:10px 0 14px}.ctEnhancerToolbar input,.ctEnhancerToolbar select{border:1px solid var(--line,rgba(255,255,255,.12));background:var(--input,rgba(255,255,255,.05));color:var(--text,#fff);border-radius:16px;padding:10px 12px;font-weight:850;font-size:12px;min-height:42px}.ctEnhancerToolbar input:focus,.ctEnhancerToolbar select:focus{border-color:rgba(79,140,255,.58);box-shadow:0 0 0 3px rgba(79,140,255,.12)!important}.ctEnhancerToolbar button{border:1px solid var(--line,rgba(255,255,255,.12));background:var(--soft,rgba(255,255,255,.06));color:var(--text,#fff);border-radius:16px;padding:10px 12px;font-weight:900;min-height:42px}.ctClickableRow{cursor:pointer}.ctClickableRow:hover{background:rgba(79,140,255,.08)}.ctDisabledAction{opacity:.48;cursor:not-allowed!important;filter:grayscale(.4)}.ctDetailsModal{position:fixed;inset:0;z-index:9999;display:none;background:rgba(0,0,0,.64);backdrop-filter:blur(8px);padding:22px;overflow:auto}.ctDetailsModal.is-open{display:grid;place-items:start center}.ctDetailsPanel{width:min(980px,96vw);max-height:92vh;overflow:auto;border:1px solid var(--line,rgba(255,255,255,.12));border-radius:26px;background:linear-gradient(180deg,var(--panel,#081126),var(--bg1,#050814));box-shadow:0 24px 80px rgba(0,0,0,.32);color:var(--text,#fff)}.ctDetailsHead{position:sticky;top:0;background:inherit;border-bottom:1px solid var(--line,rgba(255,255,255,.12));padding:16px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;z-index:2}.ctDetailsHead h3{margin:0;font-size:20px}.ctDetailsHead p{margin:4px 0 0;color:var(--muted,rgba(255,255,255,.62));font-weight:700}.ctDetailsBody{padding:16px;display:grid;gap:14px}.ctDetailGroup{border:1px solid var(--line2,rgba(255,255,255,.08));border-radius:20px;background:var(--table,rgba(255,255,255,.03));padding:14px}.ctDetailGroup h4{margin:0 0 10px;font-size:14px}.ctDetailGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.ctDetailItem{border:1px solid var(--line2,rgba(255,255,255,.07));border-radius:14px;padding:10px;background:rgba(255,255,255,.025)}.ctDetailItem span{display:block;color:var(--muted,rgba(255,255,255,.62));font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.ctDetailItem strong{display:block;margin-top:5px;word-break:break-word;font-size:13px}.ctCloseBtn{width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--line,rgba(255,255,255,.12));background:var(--soft,rgba(255,255,255,.06));color:inherit;border-radius:999px;font-weight:1000}.ctActionBar{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;border-top:1px solid var(--line2,rgba(255,255,255,.08));padding-top:12px}.ctActionBar button,.ctActionBar a{border:1px solid var(--line,rgba(255,255,255,.12));background:var(--soft,rgba(255,255,255,.06));color:inherit;border-radius:999px;padding:8px 11px;font-weight:900;font-size:12px}.ctActionBar .primary{background:linear-gradient(135deg,#4f8cff,#2f6bff);color:white}.ctHiddenRow{display:none!important}@media(max-width:680px){.ctDetailsModal{padding:10px}.ctEnhancerToolbar input,.ctEnhancerToolbar select,.ctEnhancerToolbar button{width:100%}}\n';
    document.head.appendChild(style);
    var modal = document.createElement('div');
    modal.id = 'fullDetailsModal';
    modal.className = 'ctDetailsModal';
    modal.innerHTML = '<div class="ctDetailsPanel"><div class="ctDetailsHead"><div><h3 id="ctDetailsTitle">Details</h3><p id="ctDetailsSub">Useful record preview</p></div><button type="button" class="ctCloseBtn" data-ct-close aria-label="Close">X</button></div><div class="ctDetailsBody" id="ctDetailsBody"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (event.target === modal || event.target.closest('[data-ct-close]')) modal.classList.remove('is-open');
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') modal.classList.remove('is-open'); });
    return modal;
  }

  function renderDetails(entry, fallbackTitle) {
    var meta = entry && entry.meta ? entry.meta : null;
    var details = meta && meta.details ? meta.details : null;
    var groups = details && details.groups ? details.groups : null;
    if (!groups) {
      var cells = entry && entry.cells ? entry.cells : [];
      groups = { 'Table row': {} };
      cells.forEach(function (cell, index) { groups['Table row']['Column ' + (index + 1)] = cell; });
      if (meta) Object.keys(meta).forEach(function (key) { if (key !== 'details' && usefulKey(key)) groups['Table row'][key] = meta[key]; });
    }
    groups = sanitizeGroups(groups);
    var title = (details && details.title) || (meta && (meta.label || meta.id || meta.entity)) || fallbackTitle || 'Record details';
    var body = Object.keys(groups).map(function (groupName) {
      var group = groups[groupName] || {};
      var items = Object.keys(group).map(function (key) {
        var value = group[key];
        value = displayValue(value);
        return '<div class="ctDetailItem"><span>' + esc(key) + '</span><strong>' + esc(value) + '</strong></div>';
      }).join('');
      return '<section class="ctDetailGroup"><h4>' + esc(groupName) + '</h4><div class="ctDetailGrid">' + items + '</div></section>';
    }).join('');
    if (!body) body = '<section class="ctDetailGroup"><h4>Preview</h4><div class="ctDetailGrid"><div class="ctDetailItem"><span>Status</span><strong>No useful fields available for this row.</strong></div></div></section>';
    body += '<div class="ctActionBar"><button type="button" data-ct-close>Close</button><button type="button" class="primary" data-ct-copy>Copy reference</button><button type="button" data-ct-export-one>Export JSON</button><button type="button" disabled class="ctDisabledAction">Edit / more actions</button></div>';
    return { title: title, body: body, json: JSON.stringify(details || meta || entry || {}, null, 2) };
  }

  function addTableTools() {
    Array.prototype.forEach.call(document.querySelectorAll('.tableWrap'), function (wrap, index) {
      if (wrap.dataset.enhanced === 'true') return;
      var table = wrap.querySelector('table');
      if (!table) return;
      wrap.dataset.enhanced = 'true';
      var toolbar = document.createElement('div');
      toolbar.className = 'ctEnhancerToolbar';
      toolbar.innerHTML = '<input type="search" placeholder="Search this table..." data-ct-table-search><select data-ct-table-status><option value="">All statuses</option><option value="active">Active/Paid/Confirmed</option><option value="pending">Pending/Hold/Review</option><option value="refund">Refund/Cancelled/Suspended</option></select><input type="date" data-ct-table-date title="Filter by visible date text"><button type="button" data-ct-export>Export CSV</button>';
      wrap.parentNode.insertBefore(toolbar, wrap);
      Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (row) {
        if (row.querySelector('[data-modal="view"]')) row.classList.add('ctClickableRow');
      });
      var apply = function () {
        var q = norm(toolbar.querySelector('[data-ct-table-search]').value);
        var status = norm(toolbar.querySelector('[data-ct-table-status]').value);
        var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
        rows.forEach(function (row) {
          var text = norm(row.textContent);
          var ok = !q || text.indexOf(q) !== -1;
          if (ok && status) {
            if (status === 'active') ok = /(active|paid|confirmed|verified|settled|running|published|checked)/.test(text);
            if (status === 'pending') ok = /(pending|hold|review|waiting|open|delayed)/.test(text);
            if (status === 'refund') ok = /(refund|cancel|suspend|reject|failed|no show)/.test(text);
          }
          row.classList.toggle('ctHiddenRow', !ok);
        });
      };
      toolbar.addEventListener('input', apply);
      toolbar.addEventListener('change', apply);
      toolbar.querySelector('[data-ct-export]').addEventListener('click', function () { exportTable(table, 'classic-trip-table-' + (index + 1) + '.csv'); });
    });
  }

  function exportTable(table, filename) {
    var lines = [];
    Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
      if (tr.classList.contains('ctHiddenRow')) return;
      var cells = Array.prototype.map.call(tr.querySelectorAll('th,td'), function (td) {
        return '"' + String(td.innerText || '').replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"';
      });
      if (cells.length) lines.push(cells.join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  }

  function disableDeadActions() {
    return false;
  }

  function initEnhancer() {
    var modal = ensureModal();
    var index = collectMeta(window.__CT_DASHBOARD_DATA__ || {});
    addTableTools();
    disableDeadActions();
    setTimeout(function () { addTableTools(); disableDeadActions(); }, 500);
    document.addEventListener('click', function (event) {
      var row = event.target.closest('tr.ctClickableRow');
      if (row && !event.target.closest('button,a,input,select,textarea,form')) {
        var viewButton = row.querySelector('[data-modal="view"]');
        if (viewButton) {
          event.preventDefault();
          var rowEntry = findMeta(index, viewButton);
          var rowRendered = renderDetails(rowEntry, viewButton.getAttribute('data-label') || viewButton.getAttribute('data-type'));
          modal.querySelector('#ctDetailsTitle').textContent = rowRendered.title;
          modal.querySelector('#ctDetailsSub').textContent = 'Useful grouped record preview.';
          modal.querySelector('#ctDetailsBody').innerHTML = rowRendered.body;
          modal.dataset.recordJson = rowRendered.json;
          modal.classList.add('is-open');
        }
        return;
      }
      var view = event.target.closest('[data-modal="view"]');
      if (!view) return;
      event.preventDefault();
      event.stopPropagation();
      var entry = findMeta(index, view);
      var rendered = renderDetails(entry, view.getAttribute('data-label') || view.getAttribute('data-type'));
      modal.querySelector('#ctDetailsTitle').textContent = rendered.title;
      modal.querySelector('#ctDetailsSub').textContent = 'Useful grouped record preview.';
      modal.querySelector('#ctDetailsBody').innerHTML = rendered.body;
      modal.dataset.recordJson = rendered.json;
      modal.classList.add('is-open');
    }, true);
    modal.addEventListener('click', function (event) {
      if (event.target.closest('[data-ct-copy]')) {
        var text = modal.querySelector('#ctDetailsTitle').textContent;
        navigator.clipboard && navigator.clipboard.writeText(text);
      }
      if (event.target.closest('[data-ct-export-one]')) {
        var blob = new Blob([modal.dataset.recordJson || '{}'], { type: 'application/json;charset=utf-8' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'classic-trip-record.json';
        document.body.appendChild(link);
        link.click();
        URL.revokeObjectURL(link.href);
        link.remove();
      }
    });
    document.addEventListener('submit', function (event) {
      var form = event.target && event.target.closest ? event.target.closest('form[data-dashboard-form]') : null;
      if (!form || form.getAttribute('action')) return;
    }, true);
  }

  ready(function () { setTimeout(initEnhancer, 120); });
}());
