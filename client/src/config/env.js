// Centralized client config. Vite exposes only VITE_-prefixed vars on
// import.meta.env. See client/.env.example.
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  // The Creatomate "Generate with Template" flow (input video + in-video text/image).
  // Enabled everywhere, including production; set VITE_ENABLE_TEMPLATES=false to hide it.
  templatesEnabled: import.meta.env.VITE_ENABLE_TEMPLATES !== 'false',
  // The Wise Assistant ("Rovi") help overlay. Always on in dev; in any other build
  // (e.g. production) it shows only when VITE_SHOW_ASSISTANT=true.
  showAssistant: import.meta.env.VITE_SHOW_ASSISTANT === 'true' || import.meta.env.DEV,
};

export default env;
