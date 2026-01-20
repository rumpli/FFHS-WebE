/**
 * postcss.config.js
 *
 * PostCSS configuration used by the Vite build for the frontend. This file
 * enables TailwindCSS processing and automatic vendor prefixing via
 * `autoprefixer`.
 *
 * Notes:
 * - Tailwind's PostCSS plugin must run before `autoprefixer` so utility
 *   classes are generated prior to prefixing.
 * - This configuration is intentionally small and should be safe for both
 *   development and production builds handled by Vite.
 */

export default {
    plugins: {
        // Tailwind's PostCSS plugin (generates utility CSS from our templates)
        "@tailwindcss/postcss": {},
        // Add vendor prefixes for broader browser support
        autoprefixer: {}
    }
};
