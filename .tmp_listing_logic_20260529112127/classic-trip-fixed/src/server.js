const { boot } = require("./app");
const { PORT } = require("./config/env");

boot()
  .then((app) => {
    app.listen(PORT, () => {
      console.log(`Classic Trip running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
