-- Phase 1: seed default system categories (tenant_id = null), available to every
-- tenant. Users can still create their own custom categories/subcategories on top
-- of this default tree (see categories.tenant_id).

do $$
declare
  v_parent_id uuid;
begin
  -- Renda (income)
  insert into public.categories (tenant_id, name, type) values (null, 'Renda', 'income')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Salário', 'income', v_parent_id),
    (null, 'Freelance', 'income', v_parent_id),
    (null, 'Investimentos', 'income', v_parent_id),
    (null, 'Outras Receitas', 'income', v_parent_id);

  -- Alimentação
  insert into public.categories (tenant_id, name, type) values (null, 'Alimentação', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Mercado', 'expense', v_parent_id),
    (null, 'Restaurante', 'expense', v_parent_id);

  -- Moradia
  insert into public.categories (tenant_id, name, type) values (null, 'Moradia', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Aluguel', 'expense', v_parent_id),
    (null, 'Condomínio', 'expense', v_parent_id),
    (null, 'Energia', 'expense', v_parent_id),
    (null, 'Água', 'expense', v_parent_id),
    (null, 'Internet', 'expense', v_parent_id);

  -- Transporte
  insert into public.categories (tenant_id, name, type) values (null, 'Transporte', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Combustível', 'expense', v_parent_id),
    (null, 'App de Transporte', 'expense', v_parent_id),
    (null, 'Transporte Público', 'expense', v_parent_id),
    (null, 'Manutenção', 'expense', v_parent_id);

  -- Saúde
  insert into public.categories (tenant_id, name, type) values (null, 'Saúde', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Plano de Saúde', 'expense', v_parent_id),
    (null, 'Farmácia', 'expense', v_parent_id),
    (null, 'Consultas', 'expense', v_parent_id);

  -- Educação
  insert into public.categories (tenant_id, name, type) values (null, 'Educação', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Mensalidade', 'expense', v_parent_id),
    (null, 'Cursos', 'expense', v_parent_id),
    (null, 'Material', 'expense', v_parent_id);

  -- Lazer
  insert into public.categories (tenant_id, name, type) values (null, 'Lazer', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Streaming', 'expense', v_parent_id),
    (null, 'Viagens', 'expense', v_parent_id),
    (null, 'Hobbies', 'expense', v_parent_id);

  -- Compras
  insert into public.categories (tenant_id, name, type) values (null, 'Compras', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Vestuário', 'expense', v_parent_id),
    (null, 'Eletrônicos', 'expense', v_parent_id);

  -- Outros
  insert into public.categories (tenant_id, name, type) values (null, 'Outros', 'expense')
    returning id into v_parent_id;
  insert into public.categories (tenant_id, name, type, parent_category_id) values
    (null, 'Diversos', 'expense', v_parent_id);
end $$;
