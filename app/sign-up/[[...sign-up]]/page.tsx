import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-8 p-4">
      <div className="text-center">
        <div className="text-5xl mb-3">⚾</div>
        <h1 className="text-3xl font-bold text-white tracking-tight">On the Bump</h1>
        <p className="text-slate-400 mt-1 text-sm">Create your free coach account</p>
      </div>
      <p className="text-slate-500 text-xs text-center max-w-sm px-4 leading-relaxed">
        🔒 We do not sell or trade your data. Each coach can only access the
        data they've personally collected — no one else can see your pitches,
        batters, or scouting history.
      </p>
      <SignUp
        appearance={{
          variables: {
            colorPrimary: '#1d4ed8',
            colorBackground: '#1e293b',
            borderRadius: '0.5rem',
          },
          elements: {
            card: 'shadow-2xl border border-slate-700',
            headerTitle: 'text-slate-100',
            headerSubtitle: 'text-slate-400',
            formButtonPrimary: 'bg-blue-700 hover:bg-blue-600',
            footerActionLink: 'text-blue-400 hover:text-blue-300',
          },
        }}
      />
    </div>
  );
}
