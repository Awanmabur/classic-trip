function resolveMarkup(items, req, res) {
  return (items || [])
    .map((item) => (typeof item === "function" ? item(req, res) : item))
    .filter(Boolean)
    .join("");
}

function renderView(viewName, { head = [], bodyEnd = [], locals = {} } = {}) {
  return (req, res, next) => {
    try {
      const resolvedLocals = typeof locals === "function" ? locals(req, res) : locals;
      res.render(viewName, {
        ...(resolvedLocals || {}),
        headInjection: resolveMarkup(head, req, res),
        bodyEndInjection: resolveMarkup(bodyEnd, req, res)
      });
    } catch (err) {
      next(err);
    }
  };
}

function dashboardTemplate(viewName, role, { head = [], bodyEnd = [], locals = {} } = {}) {
  return renderView(viewName, {
    head: [
      "<style>html[data-live-dashboard='loading'] body{visibility:hidden}</style>",
      `<script>document.documentElement.dataset.liveDashboard='loading';window.__DASHBOARD_TEMPLATE_ROLE__=${JSON.stringify(role)};</script>`,
      ...head
    ],
    bodyEnd: [
      '<script defer src="/public/js/live-shell.js"></script>',
      '<script defer src="/public/js/live-dashboards.js"></script>',
      ...bodyEnd
    ],
    locals
  });
}

module.exports = {
  dashboardTemplate,
  renderView
};
