// Vercel serverless entry. `npm run build` compiles the server to dist/ first;
// this function runs that Express app for every /api request and for /health.
import { app, ready } from "../dist/server/app.js";

export default async function handler(req, res) {
  await ready; // demo data is seeded once per cold start
  return app(req, res);
}
