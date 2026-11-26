import { useState, type FormEvent } from 'react';
import { KeyRound, X } from 'lucide-react';

const STORAGE_KEYS = ['gemini_api_key', 'GEMINI_API_KEY', 'apiKey'];

const hasStoredKey = () =>
  typeof window !== 'undefined' && STORAGE_KEYS.some((key) => localStorage.getItem(key));

export default function ApiKeySettings() {
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(hasStoredKey);

  const saveKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) return;

    localStorage.setItem('gemini_api_key', key);
    STORAGE_KEYS.slice(1).forEach((storageKey) => localStorage.removeItem(storageKey));
    setApiKey('');
    setHasKey(true);
    setIsOpen(false);
  };

  const removeKey = () => {
    STORAGE_KEYS.forEach((storageKey) => localStorage.removeItem(storageKey));
    setApiKey('');
    setHasKey(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`p-2.5 rounded-xl transition ${hasKey ? 'text-green-600 dark:text-green-400 hover:bg-neutral-100 dark:hover:bg-neutral-800' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
        title="Gemini API key settings"
        aria-label="Gemini API key settings"
      >
        <KeyRound size={18} />
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-key-title"
            className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="api-key-title" className="text-lg font-bold">Gemini API key</h2>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              Your key is stored in this browser and sent directly to Google. Do not enter it on a shared device.
            </p>
            {hasKey && <p className="mb-3 text-xs text-green-700 dark:text-green-400">A key is saved in this browser.</p>}
            <form onSubmit={saveKey}>
              <label htmlFor="gemini-api-key" className="mb-1 block text-sm font-medium">{hasKey ? 'Replace key' : 'API key'}</label>
              <input
                id="gemini-api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Paste your Gemini API key"
                className="mb-4 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500"
              />
              <div className="flex flex-wrap justify-end gap-2">
                {hasKey && (
                  <button type="button" onClick={removeKey} className="mr-auto rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                    Remove key
                  </button>
                )}
                <button type="button" onClick={() => setIsOpen(false)} className="rounded-lg px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  Cancel
                </button>
                <button type="submit" disabled={!apiKey.trim()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  Save key
                </button>
              </div>
            </form>
            <p className="mt-4 text-xs text-neutral-500">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-primary-600 hover:underline dark:text-primary-400">
                Get an API key from Google AI Studio
              </a>
            </p>
          </section>
        </div>
      )}
    </>
  );
}
