'use client';

interface NotificationToastProps {
  notification: { message: string; type: 'walk' | 'strikeout' | 'info' | 'error' } | null;
}

const BG: Record<string, string> = {
  walk: 'bg-green-600', strikeout: 'bg-red-700', info: 'bg-slate-700', error: 'bg-amber-700',
};

export function NotificationToast({ notification }: NotificationToastProps) {
  if (!notification) return null;
  return (
    <div className="fixed top-4 left-0 right-0 z-50 flex justify-center pointer-events-none px-4">
      <div className={`${BG[notification.type] ?? 'bg-slate-700'} text-white px-5 py-3 rounded-2xl shadow-2xl font-semibold text-base`}>
        {notification.message}
      </div>
    </div>
  );
}