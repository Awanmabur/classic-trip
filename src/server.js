const { boot } = require("./app");
const { PORT } = require("./config/env");

boot()
  .then((app) => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`🚀 Classic Trip running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", err);
    process.exit(1);
  });
