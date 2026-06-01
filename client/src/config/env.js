// Centralized client config. Vite exposes only VITE_-prefixed vars on
// import.meta.env. See client/.env.example.
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
};

export default env;
