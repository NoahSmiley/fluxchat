import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.js";
import { validateUsername, validatePassword } from "@/types/shared.js";

export function RegisterPage() {
  const { register, error } = useAuthStore();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const usernameErr = validateUsername(username);
    if (usernameErr) { setValidationError(usernameErr); return; }

    const passwordErr = validatePassword(password);
    if (passwordErr) { setValidationError(passwordErr); return; }

    setValidationError(null);
    setSubmitting(true);
    try {
      await register(email, password, username);
    } catch {
      // error is set in store
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Create an Account</h1>
        <p className="auth-subtitle">Join Flux</p>

        <form onSubmit={handleSubmit}>
          {(error || validationError) && (
            <div className="auth-error">{validationError ?? error}</div>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Creating account..." : "Register"}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
