// One-off: copy env settings into app_settings (insert-if-missing only),
// without restarting the poller. Run with: npm run settings:seed
import { initSettings } from "./settings.js";
import { pool } from "./db.js";

initSettings()
  .then(async () => {
    const { rows } = await pool.query("select key from app_settings order by key");
    console.log(`app_settings now holds: ${rows.map((r: { key: string }) => r.key).join(", ")}`);
    await pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
