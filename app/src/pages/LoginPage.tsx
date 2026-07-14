import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      setSubmitting(false);
      if (error) {
        setError(error);
        return;
      }
      navigate('/', { replace: true });
    } else {
      const { error } = await signUp(email, password);
      setSubmitting(false);
      if (error) {
        setError(error);
        return;
      }
      setInfo('Cadastro realizado. Verifique seu e-mail para confirmar a conta, se exigido, e faça login.');
      setMode('signin');
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Controle Financeiro</h1>
        <p className="muted">{mode === 'signin' ? 'Entre na sua conta' : 'Crie sua conta'}</p>

        <form onSubmit={handleSubmit} className="form">
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
          {info && <p className="info-text">{info}</p>}

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Aguarde...' : mode === 'signin' ? 'Entrar' : 'Cadastrar'}
          </button>
        </form>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'signin' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entre'}
        </button>
      </div>
    </div>
  );
}
