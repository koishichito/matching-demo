export const runtime = "edge";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-100">
      <div className="max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold text-white">Offline mode</h1>
        <p className="text-sm text-slate-300">
          You are currently offline. Once the network is back, the demo will resume automatically.
        </p>
      </div>
    </div>
  );
}
