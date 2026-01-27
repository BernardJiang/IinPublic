# Deployment Guide for IinPublic

IinPublic is a **Client-Side Only** decentralized application. It behaves like a static site.

## Option 1: Vercel / Netlify (Recommended)

1.  Connect your GitHub repository.
2.  Set the **Root Directory** to `apps/web`.
3.  Set the **Build Command** to `npm run build` (or `tsc -b && vite build`).
4.  Set the **Output Directory** to `dist`.
5.  **Environment Variables**: None required for the basic version (uses default Gun peers).

## Option 2: GitHub Pages

1.  In `apps/web/vite.config.ts`, set `base: '/repo-name/'` if not at the root.
2.  Run `npm run build`.
3.  Commit the `dist` folder or use a GH Actions workflow to build and deploy.

## Notes on Gun.js Peers
By default, the app connects to community Gun relays. For production, you may want to run your own relay peer to ensure availability, although the app works P2P (WebRTC) when users are online.
