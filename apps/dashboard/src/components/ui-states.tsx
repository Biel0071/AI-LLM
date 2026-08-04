import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 w-full">
      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
      <p className="text-slate-400 text-sm">Loading data...</p>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl backdrop-blur-md flex flex-col items-center text-center w-full max-w-md mx-auto my-8"
    >
      <AlertCircle className="w-10 h-10 text-red-400 mb-4" />
      <h3 className="text-lg font-medium text-slate-200 mb-2">Something went wrong</h3>
      <p className="text-slate-400 text-sm mb-6">{error}</p>
      {retry && (
        <button 
          onClick={retry}
          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition-colors border border-red-500/30"
        >
          Try Again
        </button>
      )}
    </motion.div>
  );
}
