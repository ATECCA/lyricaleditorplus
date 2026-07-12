/**
 * Validates if the Google Gemini API key is configured
 * @returns true if API key is set and non-empty, false otherwise
 */
export function isAPIKeyConfigured(): boolean {
  // Check if VITE_GEMINI_API_KEY is available in the environment
  // Note: Environment variables in Vite must be prefixed with VITE_
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  
  if (!apiKey || apiKey.trim() === '') {
    return false;
  }
  
  return true;
}

/**
 * Gets the API key from environment
 * @returns The API key or empty string if not configured
 */
export function getAPIKey(): string {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  return apiKey?.trim() || '';
}