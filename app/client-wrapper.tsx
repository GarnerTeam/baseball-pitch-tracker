'use client';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/components/error-boundary';

const App = dynamic(() => import('./app-client'), { ssr: false });

export default function ClientWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
