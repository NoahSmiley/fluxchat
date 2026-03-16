import { useAuthStore } from "@/stores/auth.js";

function FluxLogo() {
  return (
    <svg width="56" height="56" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" rx="180" ry="180" fill="#111111" />
      <g transform="translate(512,512) scale(7.5)" fill="#ffffff" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round">
        <path d="M0 -24a24 24 0 1 0 0 48a24 24 0 1 0 0-48zm0 10a14 14 0 1 1 0 28a14 14 0 1 1 0-28z" fillRule="evenodd" stroke="none" />
        <line x1="18" y1="-18" x2="30" y2="-30" strokeWidth="3.5" fill="none" />
        <polygon points="24,-32 32,-32 32,-24" stroke="none" />
        <line x1="-18" y1="18" x2="-30" y2="30" strokeWidth="3.5" fill="none" />
        <polygon points="-32,24 -32,32 -24,32" stroke="none" />
      </g>
    </svg>
  );
}

export function LoginPage() {
  const { error, ssoPolling, startSSO, cancelSSO } = useAuthStore();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <FluxLogo />
        </div>
        <h1>Welcome to Flux</h1>
        <p className="auth-subtitle">Sign in to continue</p>

        {error && <div className="auth-error">{error}</div>}

        {ssoPolling ? (
          <div className="auth-polling">
            <div className="loading-spinner" />
            <p className="auth-polling-text">
              Complete sign-in in your browser, then return here.
            </p>
            <button className="auth-btn-cancel" onClick={cancelSSO}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="auth-btn-sign-in" onClick={startSSO}>
            Sign in with Athion
          </button>
        )}
      </div>
    </div>
  );
}
