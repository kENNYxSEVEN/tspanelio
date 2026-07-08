# Contributing to TSPanelio

This document contains development notes for working on TSPanelio locally.

For installation and usage, see [README.md](README.md).

## Requirements

- Node.js
- npm
- Access to a TeamSpeak server with ServerQuery enabled for full manual testing

Use the Node.js version expected by the project or CI when it is defined.

## Install dependencies

```bash
npm install
```

## Development commands

Run the full development environment:

```bash
npm run dev
```

Run only the UI development server:

```bash
npm run dev:ui
```

Run only the server development command:

```bash
npm run dev:server
```

## Build commands

Build everything required for a release build:

```bash
npm run build
```

Build only the UI:

```bash
npm run build:ui
```

Build only the server:

```bash
npm run build:server
```

Run the explicit release build alias:

```bash
npm run build:release
```

Package single executable files:

```bash
npm run package:executables
```

This writes:

```text
release/tspanelio-linux-x64-v1.0.X
release/tspanelio-macos-x64-v1.0.X
release/tspanelio-win-x64-v1.0.X.exe
```

## Project structure

```text
packages/
  ui/       React/Vite frontend
  server/   Node.js backend and Socket.IO server
```

The npm workspace package scope is `@tspanelio`.


## Attribution

TSPanelio is a modernized fork of the MIT-licensed TS3 Manager project by joni1802.

- The backend is based on the original TS3 Manager project by joni1802.
- The frontend has been completely rewritten from Vue to React, with the UI redesigned for TSPanelio.

Keep original license notices intact when changing files that originated from the fork.
