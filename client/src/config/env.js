// Centralized client config. Vite exposes only VITE_-prefixed vars on
// import.meta.env. See client/.env.example.
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  // The Creatomate "Use template" flow is unfinished, so it's hidden in builds by
  // default (e.g. production). It's on automatically on the Vite dev server, or in
  // any build that sets VITE_ENABLE_TEMPLATES=true (e.g. a testing build).
  templatesEnabled: import.meta.env.VITE_ENABLE_TEMPLATES === 'true' || import.meta.env.DEV,
  // The Wise Assistant ("Rovi") help overlay. Always on in dev; in any other build
  // (e.g. production) it shows only when VITE_SHOW_ASSISTANT=true.
  showAssistant: import.meta.env.VITE_SHOW_ASSISTANT === 'true' || import.meta.env.DEV,
};

export default env;
