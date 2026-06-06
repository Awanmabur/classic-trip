(function () {
  function token() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function ensureFormToken(form) {
    if (!form || String(form.method || '').toLowerCase() !== 'post') return;
    if (form.querySelector('input[name="_csrf"]')) return;
    var value = token();
    if (!value) return;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_csrf';
    input.value = value;
    form.appendChild(input);
  }

  document.addEventListener('submit', function (event) {
    ensureFormToken(event.target);
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form[method="post"], form:not([method])').forEach(ensureFormToken);
  });

  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      init = init || {};
      var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
      if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
        var headers = new Headers(init.headers || (input && input.headers) || {});
        if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', token());
        init.headers = headers;
      }
      return nativeFetch(input, init);
    };
  }
})();
