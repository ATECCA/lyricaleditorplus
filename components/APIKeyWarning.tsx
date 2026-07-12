import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface APIKeyWarningProps {
  isVisible: boolean;
  onDismiss: () => void;
}

export function APIKeyWarning({ isVisible, onDismiss }: APIKeyWarningProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-50 dark:bg-red-900/20 border-b-2 border-red-500 animate-in slide-in-from-top">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-start gap-3">
        <AlertCircle size={20} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-red-900 dark:text-red-200 text-sm">
            Google Gemini API Key Not Configured
          </h3>
          <p className="text-red-800 dark:text-red-300 text-xs mt-1">
            AI features (transcription, generation, assistant) are disabled. 
            <span className="block mt-1">
              Get a free API key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-red-900 dark:hover:text-red-100">Google AI Studio</a>, 
              then add it to your <code className="bg-red-900/30 dark:bg-red-800/50 px-1 rounded text-xs">.env</code> file:
            </span>
            <code className="block bg-red-900/30 dark:bg-red-800/50 px-2 py-1 rounded text-xs mt-1 font-mono">GEMINI_API_KEY=your_key_here</code>
            <span className="block mt-1">Restart the dev server after adding the key.</span>
            </p>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded transition flex-shrink-0"
          title="Dismiss"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}