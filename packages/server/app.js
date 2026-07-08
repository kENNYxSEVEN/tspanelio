// Read .env file
require("dotenv").config();

const config = require("./config");
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();
const socket = require("./socket");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const routes = require("./routes");

// Enable cross-origin resource sharing for the frontend in development
const corsOptions = {
  origin: process.env.NODE_ENV === "development" ? true : false,
  credentials: true,
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
  // Defense against XSS. Exclude googleapis for Service Worker script.
  res.setHeader(
    "Content-Security-Policy",
    "script-src 'self' https://storage.googleapis.com",
  );

  return next();
});

app.use(cookieParser());

const uiDistPath = [
  process.env.TSPANELIO_PUBLIC_DIR,
  path.join(__dirname, "public"),
  ...(process.pkg
    ? []
    : [
        path.join(__dirname, "..", ["u", "i"].join(""), "dist"),
        path.join(process.cwd(), "packages/ui/dist"),
      ]),
].find((candidate) => candidate && fs.existsSync(path.join(candidate, "index.html")));

if (uiDistPath) {
  app.use(express.static(uiDistPath));
}

app.use("/api", routes.api);

app.get("/*", (req, res) => {
  if (!uiDistPath) {
    return res.status(404).send("TSPanelio UI build was not found.");
  }

  // path must be absolute or specify root to res.sendFile
  res.sendFile(path.join(uiDistPath, "index.html"));
});

const server = app.listen(config.port, () => {
  console.log(`Server listening on http://127.0.0.1:${config.port}`);
});

socket.init(server, corsOptions);
