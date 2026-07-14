# Controle Financeiro — Fase 1: Fundação (SaaS Multi-Tenant)

Fase 1 de um app de controle financeiro pessoal/familiar multi-tenant: modelo de
dados no Supabase (Postgres + RLS) e um app React que cobre o CRUD manual de
contas, categorias, lançamentos, recorrências e metas.

**Fora de escopo nesta fase:** WhatsApp, IA/Gemini, OCR, gráficos/dashboards
avançados, billing e onboarding self-service automatizado. Essas fases futuras
se apoiam neste schema.

## Status: validado em projeto Supabase real

As 10 migrations foram aplicadas em um projeto Supabase real (`eneagrama-financeiro`,
região `sa-east-1`, ref `rviuyizhcbgiofkbauwk`), não apenas testadas localmente.
Validação feita diretamente no Postgres hospedado, simulando dois usuários
autenticados reais via RLS (sessões `authenticated` + `request.jwt.claim.sub`):

- `create_tenant`, contas (incluindo cartão de crédito), categorias (36 padrão
  do sistema seedadas), lançamentos à vista e parcelados, metas — todos
  funcionando.
- Recorrência mensal gerou 13 lançamentos projetados no horizonte de 12 meses.
- `settle_transaction` baixou um projetado corretamente: o original permanece
  `projected` com `settled_by` preenchido, e o novo `realized` tem
  `linked_transaction_id` apontando de volta, sem duplicar o valor.
- Isolamento entre tenants confirmado: um segundo usuário não enxerga
  tenants/contas/transações do primeiro (`select`), e uma tentativa de
  `insert` direta no tenant alheio (com o UUID exato) foi rejeitada pela RLS.
- Uma vulnerabilidade real encontrada pelos advisors de segurança do Supabase
  foi corrigida e revalidada: `generate_recurrence_transactions` (SECURITY
  DEFINER) aceitava qualquer `recurrence_id` sem checar se o chamador
  pertencia àquele tenant — um usuário autenticado podia forçar geração de
  lançamentos em outro tenant chamando a RPC diretamente. Corrigido com um
  guard `is_tenant_member` interno (migration
  `20260714000010_security_and_performance_hardening.sql`) e revalidado: a
  mesma chamada maliciosa agora é um no-op.
- Todos os dados de teste (tenants, usuários fake) foram removidos ao final;
  o projeto ficou só com as 36 categorias padrão do sistema.

O app React ainda não foi exercitado ponta-a-ponta num navegador contra esse
projeto: o sandbox onde esta sessão roda bloqueia por política de rede a
conexão de saída até `*.supabase.co` a partir do runtime do navegador/app
(um teste local com Playwright confirmou isso — o proxy da sandbox rejeitou
a conexão com 403). Isso é uma restrição do ambiente de desenvolvimento, não
do código: rodando `npm run dev` em uma máquina sem essa política de rede, o
app se conecta normalmente ao projeto real (`app/.env` já aponta para ele).

## Estrutura do repositório

```
supabase/migrations/   Migrations SQL (schema, RLS, funções, seed de categorias)
app/                    App React + TypeScript + Vite
```

## Setup

### Banco de dados (Supabase)

1. Crie um projeto no Supabase.
2. Aplique as migrations em `supabase/migrations/` na ordem (nome dos arquivos
   já é cronológico). Via Supabase CLI:
   ```
   supabase link --project-ref <seu-project-ref>
   supabase db push
   ```
   Ou aplique cada arquivo manualmente no SQL Editor do Supabase, na ordem.
3. (Opcional, recomendado) Habilite a extensão `pg_cron` em
   Database > Extensions — veja "Rolagem da janela de recorrências" abaixo.

### App React

```
cd app
cp .env.example .env   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

O app foi construído mobile-first (uso principal é celular), mas funciona em
qualquer largura de tela.

## Modelo de dados

- `tenants` / `tenant_users`: multi-tenancy. Um tenant é uma "organização
  financeira" (pessoa ou família). `tenant_users.role` é `owner` ou `member`.
- `accounts`: contas (corrente, poupança, carteira, cartão de crédito,
  investimento). Cartão de crédito tem `closing_day`, `due_day`,
  `credit_limit`.
- `categories`: categorias/subcategorias (self-reference via
  `parent_category_id`). `tenant_id = null` marca uma categoria padrão do
  sistema, visível (somente leitura) para todos os tenants; categorias
  próprias têm `tenant_id` preenchido.
- `recurrences`: regras de recorrência (semanal/mensal/anual) que geram
  lançamentos projetados automaticamente.
- `transactions`: lançamentos (realizados ou projetados, à vista ou
  parcelados).
- `goals`: metas de orçamento (por categoria) ou de poupança (opcionalmente
  vinculada a uma conta).

Todas as tabelas de dados financeiros têm `tenant_id` e RLS habilitado. As
policies usam duas funções `SECURITY DEFINER`:

- `is_tenant_member(tenant_id)` — o usuário autenticado pertence ao tenant?
- `is_tenant_owner(tenant_id)` — o usuário autenticado é owner do tenant?

Essas funções bypassam RLS ao consultar `tenant_users` internamente (por
serem `SECURITY DEFINER` de propriedade do owner das tabelas), o que evita
recursão infinita quando a própria tabela `tenant_users` usa
`is_tenant_member` em sua policy de `select`.

Um tenant nunca é criado "solto": a função `create_tenant(p_name)` cria o
tenant e a primeira `tenant_users` (role `owner`) atomicamente. É a única via
suportada de criação de tenant a partir do cliente.

## Lógica de recorrência e projeção

Toda vez que uma recorrência é criada (ou reativada), um trigger
(`recurrences_generate_trigger`) chama
`generate_recurrence_transactions(recurrence_id)`, que:

1. Calcula o horizonte de geração: hoje + 12 meses, ou `end_date` da
   recorrência, o que vier primeiro.
2. Descobre a última ocorrência já gerada para aquela recorrência (`max(date)`
   em `transactions` filtrando por `recurrence_id`), ou usa `start_date` se
   nenhuma existir ainda.
3. Usa `next_recurrence_date(...)` para calcular a próxima data que respeita
   a regra (`reference_day`/`reference_month` conforme o intervalo — dia do
   mês para mensal/anual, dia da semana ISO 0–6 para semanal; meses curtos são
   ajustados automaticamente, ex.: dia 31 em fevereiro vira dia 28/29).
4. Insere um lançamento com `status = 'projected'` para cada ocorrência até o
   horizonte, encadeando a próxima data a cada iteração.

A função é idempotente/incremental: rodar de novo só gera o que falta a
partir da última ocorrência existente, nunca duplica.

### Rolagem da janela de recorrências

Gerar 12 meses uma única vez, na criação, não é suficiente — conforme o tempo
passa, a janela de 12 meses "andando para frente" precisa de novos lotes.
`extend_all_recurrences()` percorre todas as recorrências ativas e chama
`generate_recurrence_transactions` de novo em cada uma (aproveitando o
comportamento incremental acima).

A abordagem recomendada é agendar essa função mensalmente via `pg_cron` (a
migration `20260714000008_functions_triggers.sql` já tenta registrar esse
`cron.schedule` automaticamente se a extensão estiver habilitada no projeto).
Se `pg_cron` não estiver disponível no seu ambiente, chame
`select public.extend_all_recurrences();` a partir de um job externo (cron do
seu servidor, GitHub Action agendada, Supabase Edge Function + Scheduled
Trigger, etc.) com a mesma cadência mensal.

## Realizado vs. projetado, e a baixa de um projetado

- Todo lançamento nasce `realized` (manual, à vista, já aconteceu) ou
  `projected` (parcela futura, ocorrência futura de recorrência).
- Fluxos de caixa somam os dois status separadamente ou em conjunto — ver
  `app/src/pages/TransactionsPage.tsx`, que mostra o total realizado e o
  projetado lado a lado para o período filtrado.

Quando o usuário confirma que um lançamento projetado foi pago/recebido, o
app chama a função `settle_transaction(p_projected_id, p_realized_date?,
p_realized_amount?)`, que:

1. Insere uma **nova linha** com `status = 'realized'`, copiando os dados do
   projetado, com `linked_transaction_id` apontando de volta para o
   lançamento projetado original (permitindo customizar data/valor reais, ex.
   parcela paga com juros).
2. Atualiza o lançamento projetado original, preenchendo `settled_by` com o
   id da nova linha realizada.

**O projetado nunca é apagado nem duplicado em dobro**: ele continua
existindo (preservando o histórico da recorrência/parcelamento), mas
`settled_by` sinaliza que já foi baixado. Isso mantém as somas de fluxo de
caixa corretas nas duas pontas:

- Somar `status = 'realized'` conta a baixa exatamente uma vez (a linha nova).
- Somar `status = 'projected' and settled_by is null` dá exatamente o que
  ainda está pendente (exclui o que já foi baixado).

## Cartão de crédito

Cartão de crédito é uma `account` como qualquer outra (`type = 'credit_card'`,
com `closing_day`/`due_day`/`credit_limit`). Lançamentos com
`account_id` apontando para um cartão **não afetam o saldo de nenhuma outra
conta** — o saldo da conta corrente só é debitado quando o pagamento da
fatura é lançado como uma transação própria (uma despesa/transferência na
conta que paga a fatura). Esta fase não automatiza esse lançamento de
pagamento; é responsabilidade do usuário criá-lo manualmente (fases futuras
podem automatizar via WhatsApp/IA).

## Parcelamento

Um lançamento parcelado (`form = 'installment'`) gera N linhas em
`transactions` compartilhando `installment_group_id`, cada uma com
`installment_number` (1..N) e `installment_total` (N), e `date` incrementada
mês a mês a partir da data informada. A UI (`TransactionsPage`) permite
marcar a primeira parcela como já realizada (as demais nascem `projected`), ou
todas como projetadas.

## Segurança / RLS

Toda tabela sensível (`accounts`, `categories` custom, `recurrences`,
`transactions`, `goals`, `tenant_users`) só é visível/editável por membros do
tenant, verificado via `is_tenant_member(tenant_id)`. `categories` com
`tenant_id is null` (categorias padrão do sistema) são legíveis por todos,
mas só podem ser criadas/editadas/apagadas por um tenant quando `tenant_id`
aponta para ele mesmo — categorias do sistema são somente leitura.

As migrations foram validadas rodando-as em um Postgres local (schema `auth`
com stub de `auth.users`/`auth.uid()`), incluindo teste funcional de: criação
de tenant, geração de recorrências (mensal com clamping em meses curtos,
semanal, anual), baixa de projetado via `settle_transaction`, criação de
parcelas, e isolamento de RLS entre dois tenants distintos (um usuário não
consegue ler nem inserir dados no tenant do outro).

## Próximas fases (não incluídas aqui)

- Integração WhatsApp (entrada de lançamentos via mensagem).
- IA/Gemini para categorização automática e OCR de comprovantes/faturas.
- Dashboards e gráficos (a base de `goals`/`transactions` já suporta os
  cálculos; falta a camada visual).
- Billing/planos SaaS e onboarding self-service multi-tenant automatizado.
