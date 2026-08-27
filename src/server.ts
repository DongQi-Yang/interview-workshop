import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 5173);
createApp().listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
});
