(function () {
  'use strict';

  function cookieToken() {
    var match = String(document.cookie || '').match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (error) { return match[1]; }
  }

  function metaToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? String(meta.getAttribute('content') || '') : '';
  }

  // The cookie is refreshed by the server on every rendered request and therefore
  // reflects the active session after login/session regeneration. The meta token is
  // retained as a fallback for browsers where the cookie is temporarily unavailable.
  function token() {
    return cookieToken() || metaToken();
  }

  function ensureFormToken(form) {
    if (!form || String(form.method || '').toLowerCase() !== 'post') return;
    var value = token();
    if (!value) return;

    var input = form.querySelector('input[name="_csrf"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      form.appendChild(input);
    }
    // Always refresh existing hidden fields. Dynamic dashboard forms can remain open
    // while another tab logs in or renews the session, making their embedded value stale.
    input.value = value;
  }

  document.addEventListener('submit', function (event) {
    ensureFormToken(event.target);
  }, true);

  // `formdata` fires after the browser has constructed the payload. Setting the field
  // here guarantees multipart/native submissions contain the current token even when
  // another script created or modified FormData immediately before submission.
  document.addEventListener('formdata', function (event) {
    var value = token();
    if (value && event.formData) event.formData.set('_csrf', value);
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form[method="post"], form:not([method])').forEach(ensureFormToken);
  });

  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      init = init || {};
      var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
      if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
        var value = token();
        var headers = new Headers(init.headers || (input && input.headers) || {});
        if (value && !headers.has('x-csrf-token')) headers.set('x-csrf-token', value);
        init.headers = headers;
      }
      return nativeFetch(input, init);
    };
  }

  window.ClassicTripCsrf = Object.freeze({ token: token, ensureFormToken: ensureFormToken });
})();
