import { useState, type FormEvent } from 'react';
import { useTenant } from '../contexts/TenantContext';

export function CreateTenantPage() {
  const { createTenant } = useTenant();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await createTenant(name);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Bem-vindo(a)</h1>
        <p className="muted">
          Crie sua organização financeira. Ela pode representar você mesmo(a) ou toda a
          família — todos os lançamentos, contas e categorias ficam associados a ela.
        </p>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Nome da organização
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Família Silva"
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? 'Criando...' : 'Criar'}
          </button>
        </form>
      </div>
    </div>
  );
}
