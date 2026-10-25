// Run the LEX AI app on a port (local, Docker). Vercel uses api/index.js instead.

import { app, ready } from "./app.js";
import { INSTANCE } from "./queries.js";

await ready;
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`LEX AI API on http://localhost:${PORT} (${INSTANCE})`));
