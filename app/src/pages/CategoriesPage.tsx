import { useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../contexts/TenantContext';
import { useCategories } from '../hooks/useCategories';
import type { Category, CategoryType } from '../lib/database.types';
import { Modal } from '../components/Modal';

interface FormState {
  name: string;
  type: CategoryType;
  parent_category_id: string;
}

const EMPTY_FORM: FormState = { name: '', type: 'expense', parent_category_id: '' };

export function CategoriesPage() {
  const { activeTenant } = useTenant();
  const { categories, loading, refresh } = useCategories();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const topLevel = useMemo(
    () => categories.filter((c) => c.parent_category_id === null),
    [categories]
  );
  const childrenOf = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (c.parent_category_id) {
        const list = map.get(c.parent_category_id) ?? [];
        list.push(c);
        map.set(c.parent_category_id, list);
      }
    }
    return map;
  }, [categories]);

  const parentOptions = topLevel.filter((c) => c.type === form.type);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeTenant) return;
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.from('categories').insert({
      tenant_id: activeTenant.id,
      name: form.name,
      type: form.type,
      parent_category_id: form.parent_category_id || null,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setShowForm(false);
    setForm(EMPTY_FORM);
    refresh();
  }

  async function handleDelete(category: Category) {
    if (!confirm(`Excluir a categoria "${category.name}"?`)) return;
    const { error } = await supabase.from('categories').delete().eq('id', category.id);
    if (error) {
      alert(error.message);
      return;
    }
    refresh();
  }

  function renderGroup(type: CategoryType, label: string) {
    const items = topLevel.filter((c) => c.type === type);
    return (
      <div>
        <div className="section-title">{label}</div>
        <div className="list">
          {items.map((parent) => (
            <div key={parent.id} className="card">
              <div className="card-row">
                <div className="card-title">
                  {parent.name}
                  {parent.tenant_id === null && <span className="badge">Padrão</span>}
                </div>
                {parent.tenant_id !== null && (
                  <button type="button" className="danger-button" onClick={() => handleDelete(parent)}>
                    Excluir
                  </button>
                )}
              </div>
              {(childrenOf.get(parent.id) ?? []).map((child) => (
                <div key={child.id} className="card-row" style={{ marginTop: 6, paddingLeft: 12 }}>
                  <span className="card-subtitle">↳ {child.name}</span>
                  {child.tenant_id !== null && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => handleDelete(child)}
                    >
                      Excluir
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Categorias</h1>
      </div>

      {loading ? (
        <p className="muted">Carregando...</p>
      ) : (
        <>
          {renderGroup('income', 'Receitas')}
          {renderGroup('expense', 'Despesas')}
        </>
      )}

      <button
        type="button"
        className="fab"
        onClick={() => {
          setForm(EMPTY_FORM);
          setError(null);
          setShowForm(true);
        }}
        aria-label="Nova categoria"
      >
        +
      </button>

      {showForm && (
        <Modal title="Nova categoria" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Nome
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label>
              Tipo
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as CategoryType, parent_category_id: '' })
                }
              >
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
              </select>
            </label>
            <label>
              Categoria pai (opcional, para criar subcategoria)
              <select
                value={form.parent_category_id}
                onChange={(e) => setForm({ ...form, parent_category_id: e.target.value })}
              >
                <option value="">Nenhuma (categoria principal)</option>
                {parentOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
