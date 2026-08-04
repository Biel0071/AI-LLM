import React from 'react';
import { motion } from 'framer-motion';
import { LoadingState } from '../components/ui-states';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Database, Box } from 'lucide-react';

export function Models() {
  const { data, isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: api.getModels,
  });

  if (isLoading) return <LoadingState />;

  const models = data?.models || [
    { id: 1, name: "GPT-4", provider: "OpenAI", contextWindow: "128k", status: "Active" },
    { id: 2, name: "Claude 3 Opus", provider: "Anthropic", contextWindow: "200k", status: "Active" },
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Models</h1>
          <p className="text-slate-400 mt-2">Manage available AI models.</p>
        </div>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden p-6">
        <ul className="space-y-4">
          {models.map((model: any) => (
            <motion.li 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={model.id} 
              className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors rounded-xl border border-white/10"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Box className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-slate-200 font-medium">{model.name}</h3>
                  <p className="text-slate-400 text-sm">{model.provider} • {model.contextWindow}</p>
                </div>
              </div>
              <span className="text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full text-xs font-medium border border-emerald-500/20">{model.status}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
