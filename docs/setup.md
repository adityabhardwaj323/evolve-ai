# EvolveAI Setup & Local Development Guide

## Prerequisites
- Node.js v20+ (tested on v22)
- npm v10+

## 1. Installation
Clone the repository and install dependencies across workspaces:
```bash
npm install
```

## 2. Environment Setup
Copy the sample environment file:
```bash
cp .env.example .env
```
Ensure you have set random 32-character strings for `ENCRYPTION_SECRET` and `SESSION_SECRET`.

## 3. Running Locally
Run the web application:
```bash
npm run dev:web
```

Run the Cloudflare Workers API locally (requires local D1 SQLite emulation):
```bash
npm run dev:api
```

## 4. Verification
Run typechecks and builds across all workspaces:
```bash
npm run typecheck
npm run build
```
