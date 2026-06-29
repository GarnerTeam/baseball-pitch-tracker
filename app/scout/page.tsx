import { Suspense } from 'react';
import { ScoutClient } from './scout-client';

export const metadata = { title: 'Scout View' };

export default function ScoutPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-slate-950 flex items-center justify-center"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>}>
      <ScoutClient />
    </Suspense>
  );
}
