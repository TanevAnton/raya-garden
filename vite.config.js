import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // The wedding configurator posts to /api/wedding-enquiry.php, which the
    // dev server can't execute. Run PHP alongside it to work on the form
    // end-to-end:  php -S 127.0.0.1:8088 -t public
    // (with the RAYA_SMTP_* variables set, or a raya-mailer-config.php one
    // directory above the repo). Without it, /api simply 502s in dev; the
    // built site is served by Apache, which runs the file itself.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8088",
        changeOrigin: true,
      },
    },
  },
});
