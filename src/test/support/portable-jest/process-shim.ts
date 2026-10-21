/**
 * Injected into the WebView Jest bundle only (scoped to the bundle, not a page global). The app's
 * webpack build inlines its static process.env reads; Jest runs with NODE_ENV=test. This gives the
 * bundled shared modules and test files the same view on a phone.
 */
export const process = { env: { NODE_ENV: 'test' } as Record<string, string | undefined> };
