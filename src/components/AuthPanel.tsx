import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth-context";

export default function AuthPanel() {
  const { user, isLoading, signInWithEmail, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setErrorMessage("Vul een geldig e-mailadres in.");
      setStatusMessage(null);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await signInWithEmail(normalizedEmail);
      setStatusMessage(
        "Inloglink verstuurd. Open je e-mail en klik op de link om in te loggen in deze app.",
      );
      setEmail("");
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error ? error.message : "Inloggen via e-mail is mislukt. Probeer opnieuw.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await signOut();
      setStatusMessage("Je bent uitgelogd.");
    } catch (error) {
      console.error(error);
      setErrorMessage(error instanceof Error ? error.message : "Uitloggen is mislukt.");
    }
  }

  return (
    <section className="auth-panel-card" aria-label="Login en account">
      <h2>Account</h2>
      {isLoading ? (
        <p className="auth-panel-card__status">Account laden...</p>
      ) : user ? (
        <>
          <p className="auth-panel-card__status">
            Ingelogd als <strong>{user.email ?? "onbekende gebruiker"}</strong>
          </p>
          <p className="auth-panel-card__links">
            <Link href="/">Planner</Link> · <Link href="/meetings">Mijn meetings</Link>
          </p>
          <button type="button" onClick={handleSignOut}>
            Uitloggen
          </button>
        </>
      ) : (
        <form className="auth-panel-card__form" onSubmit={handleSubmit}>
          <label htmlFor="auth-email-input">E-mail</label>
          <input
            id="auth-email-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            placeholder="bijv. naam@bedrijf.nl"
            autoComplete="email"
          />
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Versturen..." : "Login via e-mail"}
          </button>
        </form>
      )}

      {statusMessage && <p className="auth-panel-card__status">{statusMessage}</p>}
      {errorMessage && <p className="auth-panel-card__error">{errorMessage}</p>}
    </section>
  );
}
