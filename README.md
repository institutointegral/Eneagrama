# Controle Financeiro — SaaS Multi-Tenant

App de controle financeiro pessoal/familiar multi-tenant: modelo de dados no
Supabase (Postgres + RLS) e um app React. **Fase 1** entregou o CRUD manual de
contas, categorias, lançamentos, recorrências e metas. **Fase 2** adicionou
fluxo de caixa, dashboards/gráficos e a engine de cálculo de progresso de
metas. **Fase 3** (esta versão) adiciona vínculo de número WhatsApp por
tenant, um nível de superadmin da plataforma, e um rascunho do agente
WhatsApp em n8n — nenhuma tabela das fases anteriores foi alterada
estruturalmente (só colunas/tabelas novas, aditivas).

**Importante sobre o estado da Fase 3:** a parte de banco (migrations, RLS,
telas Settings/Admin) foi implementada e validada contra o projeto Supabase
real. A parte de infraestrutura externa (n8n na VPS, credencial UAZAPI/ZPro,
Redis, Gemini) **não pôde ser testada nem provisionada** nesta sessão — não
há acesso a essa infraestrutura. O workflow em `n8n/whatsapp-agent-workflow.json`
é um rascunho escrito a partir da especificação, não validado contra uma
instância real nem contra o padrão exato do "agente Hellen" citado como
referência. Ver a seção "Fase 3" abaixo para o que falta fechar.

**Fora de escopo até aqui:** billing/planos SaaS, convite de múltiplos
membros por tenant, analytics avançado de superadmin, OCR.

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

## Fase 2 — fluxo de caixa, dashboards e engine de metas

### Geração de recorrência sob demanda

A geração automática da Fase 1 continua valendo (trigger no insert/reativação
de uma `recurrence`, veja "Lógica de recorrência e projeção" acima). A Fase 2
adiciona `refresh_recurrence_projections(p_tenant_id)`
(`supabase/migrations/20260715000001_refresh_recurrence_projections.sql`): uma
function tenant-scoped, chamável pelo app (`authenticated`), com guard
`is_tenant_member(p_tenant_id)`, que percorre as recorrências ativas do tenant
chamando `generate_recurrence_transactions` (idempotente, Fase 1) em cada uma.
É o botão **"Atualizar Projeções"** na tela de Recorrências — a via manual
que substitui um cron nesta fase (`extend_all_recurrences`, da Fase 1,
continua reservada a `postgres`/`service_role`/pg_cron, não é chamável pelo
app). Validado no projeto real: duas chamadas seguidas não duplicam
lançamentos, e uma tentativa de um usuário acionar a atualização passando o
`tenant_id` de outro tenant é rejeitada.

### Nota técnica: cálculo da fatura do cartão de crédito

Implementado em `currentCardCycle` (`app/src/lib/cashFlow.ts`), client-side —
não há function Postgres para isso, é só leitura/cálculo sobre dados já
buscados:

- O ciclo atual fecha no dia `closing_day` do mês corrente se hoje ainda não
  passou desse dia, senão fecha no `closing_day` do mês seguinte (dias
  maiores que o tamanho do mês são ajustados para o último dia, ex.:
  `closing_day = 31` em fevereiro vira dia 28/29).
- O início do ciclo é o dia seguinte ao fechamento anterior.
- O vencimento assume o padrão mais comum: se `due_day <= closing_day`,
  vence no mês **seguinte** ao fechamento (ex.: fecha dia 28, vence dia 5);
  caso contrário, vence no mesmo mês do fechamento. Isso é uma simplificação
  — faturas com regras de vencimento diferentes da convenção comum
  precisariam de um campo explícito de "dias entre fechamento e vencimento"
  em vez de inferir a partir de `due_day` isolado; ver "Fora de escopo"
  abaixo.
- **"Fatura em aberto"** = soma das transações da conta cartão com `date`
  dentro da janela do ciclo (`computeOpenInvoice`), incluindo tanto
  `realized` quanto `projected` (uma parcela futura já datada dentro do
  ciclo conta para aquela fatura). Esse valor **não afeta o saldo de
  nenhuma outra conta** — a regra da Fase 1 continua valendo: o impacto no
  fluxo de caixa só acontece quando o pagamento da fatura é lançado como uma
  transação própria na conta que paga. A tela de Fluxo de Caixa mostra os
  dois números lado a lado (fatura em aberto vs. saldo em cascata) quando o
  escopo selecionado é uma conta de cartão específica.

### Nota técnica: progresso de metas de poupança

Implementado em `fetchGoalCurrentAmount` (`app/src/lib/goals.ts`):

- **Com `account_id` vinculado** (o caminho recomendado): progresso =
  `initial_balance` da conta + soma de receitas menos despesas `realized`
  daquela conta desde `goals.start_date`.
- **Sem conta vinculada**: a Fase 2 **não implementa** uma fonte alternativa
  de dados. A tabela `goals` da Fase 1 tem a constraint
  `goals_savings_no_category` (metas de poupança não podem ter
  `category_id`), e o enunciado desta fase pede para não alterar o schema
  estruturalmente — então não há como reaproveitar `category_id` como um
  "rótulo de aporte" sem uma migration de schema. A decisão tomada foi a
  mais simples possível dentro dessa restrição: a UI mostra
  "sem acompanhamento automático" e orienta o usuário a vincular uma conta.
  Para uma Fase 3, as alternativas mais diretas são (a) uma coluna
  `current_amount` numérica atualizável manualmente, ou (b) uma tabela
  separada de aportes (`goal_contributions`) — qualquer uma delas é uma
  migration aditiva, não uma alteração estrutural das tabelas existentes.

### Nota técnica: evolução mensal e possível dupla contagem

O gráfico de evolução mensal (receita vs. despesa) soma **todas** as
transações `realized` de todas as contas, inclusive cartão de crédito — é
uma visão de "comportamento de gasto", não de caixa (por isso não exclui
cartões, ao contrário do card de "saldo disponível" e do fluxo de caixa).
Ressalva para a Fase 3: como esta fase não automatiza a baixa de fatura do
cartão (ver acima), se o usuário lançar manualmente tanto a compra no cartão
quanto o pagamento da fatura como despesas separadas, a evolução mensal conta
o mesmo gasto duas vezes (uma no mês da compra, outra no mês do pagamento). A
Fase 1 já previa esse fluxo de pagamento como responsabilidade manual do
usuário; uma automação de baixa de fatura (linkando a transação de pagamento
às transações da fatura que ela quita, similar ao `settle_transaction` de
projetados) resolveria isso e é a recomendação para a Fase 3.

### Gráficos

Os 3 componentes (`app/src/components/charts/`) usam Recharts com a paleta
categórica e as cores de status validadas pelo skill de dataviz
(`scripts/validate_palette.js`, PASS em light e dark — ver
`chartColors.ts`). Gastos por categoria é uma **barra horizontal** (não
pizza): com várias categorias e nomes longos, barra com rótulo direto lê
melhor e evita depender só de cor para identificar a fatia, seguindo a
recomendação do skill para "parte-do-todo" com mais de 2-3 categorias.
Orçado-vs-realizado no Dashboard não usa gráfico de barras — é uma lista de
meters (barra de progresso), reaproveitando o mesmo componente visual das
metas, por ser uma "razão contra um limite" por categoria.

## Integração mais próxima do backend (RPCs, Realtime)

Uma rodada de revisão comparou a UI com as functions RPC disponíveis e fechou
estas lacunas:

- **Preview de próxima recorrência**: o formulário de recorrências chama
  `supabase.rpc('next_recurrence_date', { p_interval, p_reference_day,
  p_reference_month, p_from_date })` a cada mudança relevante e mostra a data
  retornada — nenhuma lógica de data é recalculada no frontend
  (`app/src/pages/RecurrencesPage.tsx`).
- **Edição de recorrência**: além de criar, agora dá pra editar uma
  recorrência existente. Tanto criar quanto editar chamam explicitamente
  `generate_recurrence_transactions(p_recurrence_id)` depois de salvar — a
  criação já é coberta pelo trigger da Fase 1, mas a chamada explícita cobre
  também a edição (que não passa pelo trigger de reativação) e é seguro
  chamar de novo por ser idempotente. Validado no projeto real: editar o
  valor de uma recorrência e chamar a function de novo não duplica as
  transações já geradas (permanece o mesmo total antes/depois).
- **Saldo atual e fatura em aberto nos cards de conta**: `AccountsPage` agora
  calcula o saldo atual (`initial_balance` + realizados) por conta, e para
  cartão de crédito mostra também a fatura em aberto do ciclo vigente,
  reaproveitando `currentCardCycle`/`computeOpenInvoice`
  (`app/src/lib/cashFlow.ts`, já usado na tela de Fluxo de Caixa).
- **Filtro de tipo em Lançamentos**: filtro por receita/despesa, junto dos
  filtros já existentes de conta/categoria/status/período.
- **Supabase Realtime em Lançamentos e Dashboard**: as duas telas assinam
  mudanças (`insert`/`update`/`delete`) na tabela `transactions` via
  `postgres_changes`, filtradas por `tenant_id`, e recarregam automaticamente
  — sem precisar dar refresh manual depois de lançar algo em outra aba/dispositivo.
  Isso exigiu habilitar a replicação Realtime para `transactions`
  (`alter publication supabase_realtime add table public.transactions`,
  migration `20260716000001_enable_realtime_transactions.sql`) — RLS
  continua se aplicando por assinante, então isso só adiciona notificação de
  mudança para linhas que aquele usuário já poderia ler, não amplia acesso.
- **Seletor de tenant sempre visível**: o cabeçalho agora sempre mostra um
  `<select>` com o tenant ativo (desabilitado quando só existe um), deixando
  a estrutura visivelmente pronta para múltiplos tenants por usuário mesmo
  que a tela de convite de membros ainda não exista (fora de escopo).

## Fase 3 — WhatsApp central, vínculo de número e superadmin

### O que foi implementado e validado

Migrations `20260717000001_tenant_whatsapp_links.sql` e
`20260717000002_platform_admin.sql`, aplicadas e testadas contra o projeto
Supabase real (dois usuários/tenants simulados via RLS, igual às fases
anteriores):

- `tenant_whatsapp_links` (status `pending`/`active`/`revoked`) + três
  functions `SECURITY DEFINER`, no mesmo padrão de `create_tenant`/
  `settle_transaction` das fases anteriores:
  - `create_whatsapp_verification_code(p_tenant_id)` — chamada pelo app
    (Settings > Conectar WhatsApp), gera código de 6 dígitos com expiração
    de 15 min. Só um membro do tenant pode gerar.
  - `verify_whatsapp_link(p_code, p_phone_number)` — chamada pelo n8n
    (role `anon`, já que quem manda a mensagem não é um usuário Supabase
    autenticado). Ativa o vínculo, revoga o vínculo `active` anterior do
    mesmo tenant (troca de número) e qualquer outro vínculo que já
    reivindicasse esse número. Testado: gerar código → ativar → gerar novo
    código → ativar com número diferente → confirma que o número antigo
    fica `revoked` e só o novo está `active`.
  - `resolve_tenant_by_whatsapp(p_phone_number)` — chamada pelo n8n em toda
    mensagem recebida para descobrir o `tenant_id`. **O workflow nunca deve
    confiar em um `tenant_id` vindo do conteúdo da mensagem ou do modelo —
    sempre o valor retornado por esta function.**
  - RLS: membros do tenant só leem os próprios vínculos
    (`is_tenant_member`); não há policy de insert/update direto — toda
    mudança de estado passa pelas functions acima.
- `platform_admins` (separada de `tenant_users` — um superadmin não é
  membro de tenant nenhum) + `is_platform_admin()` + coluna nova
  `tenants.is_active` (aditiva, default `true`) + policies extras de
  `select`/`update` para admin em `tenants`, `tenant_users`, `accounts`,
  `categories`, `recurrences`, `transactions`, `goals` e
  `tenant_whatsapp_links` (Postgres faz OR entre policies permissivas da
  mesma tabela, então isso só **adiciona** visibilidade para admins, nunca
  restringe o que um membro comum já via). Três RPCs de conveniência,
  todas checando `is_platform_admin()` internamente também (não dependem só
  da RLS): `admin_list_tenants()` (nome, ativo/inativo, contagem de
  membros/contas/lançamentos, status e número do WhatsApp — tudo agregado
  numa query só, pensado para não fazer N+1 na tela `/admin`),
  `admin_tenant_users(p_tenant_id)` (faz join com `auth.users` para trazer
  e-mail — schema `auth` não é exposto via PostgREST, por isso precisa de
  uma function em vez de RLS direta) e `admin_set_tenant_active(p_tenant_id,
  p_is_active)`. Testado: usuário comum chamando `admin_list_tenants()`
  recebe erro `not authorized`; depois de inserido em `platform_admins`, o
  mesmo usuário lista tenants (incluindo status do WhatsApp) e consegue
  desativar um tenant via `admin_set_tenant_active`.
- **App**: tela **Configurações > Conectar WhatsApp**
  (`app/src/pages/SettingsPage.tsx`) — mostra o número ativo (mascarado),
  gera código com contador regressivo de expiração, permite gerar novo
  código a qualquer momento para trocar de número. Área **`/admin`**
  (`app/src/pages/AdminPage.tsx`), protegida por um `RequirePlatformAdmin`
  em `App.tsx` que checa `is_platform_admin()` via RPC (`usePlatformAdmin`
  hook) — lista tenants com busca por nome, cards de saúde (tenants
  ativos, WhatsApp conectado, totais da plataforma), ativar/desativar por
  tenant, e expandir para ver os usuários de um tenant. Um tenant desativado
  (`tenants.is_active = false`) passa a ver um aviso de bloqueio em vez do
  conteúdo normal do app (`Layout.tsx`), sem impedir logout.

### O que é rascunho, não testado (falta acesso à infraestrutura)

`n8n/whatsapp-agent-workflow.json` é um workflow n8n escrito a partir da
especificação da Fase 3, **nunca importado nem executado** numa instância
n8n real — esta sessão não tem acesso à VPS `srv1314296`, à credencial
UAZAPI/ZPro, ao Redis, nem ao workflow do "agente Hellen" citado como
referência de padrão de debounce. O arquivo tem uma Sticky Note e notas por
node deixando isso explícito. Estrutura do rascunho:

1. Webhook UAZAPI → normaliza a mensagem (texto/áudio/imagem/documento) —
   o formato exato do payload precisa ser conferido contra a instância real.
2. Debounce via Redis: empilha a mensagem num buffer por remetente, marca o
   timestamp da última mensagem, espera alguns segundos, e só segue se
   nenhuma mensagem mais nova chegou nesse meio tempo (senão a execução mais
   nova é quem processa o buffer combinado) — **este é o ponto que mais
   precisa ser comparado com o padrão real do agente Hellen antes de usar
   em produção**, o rascunho assume uma implementação razoável mas genérica.
3. Roteamento: chama `resolve_tenant_by_whatsapp`; sem tenant resolvido e
   mensagem parece um código de 6 dígitos → chama `verify_whatsapp_link`;
   sem tenant e não é código → responde pedindo para conectar no app; com
   tenant resolvido → seque para o Gemini.
4. Gemini com function calling (`criar_lancamento`, `editar_lancamento`,
   `excluir_lancamento`, `confirmar_baixa_projetado` → chama
   `settle_transaction`, `consultar_saldo`, `consultar_projetados_pendentes`,
   `pedir_confirmacao`) — o rascunho documenta o roteamento por função num
   node Switch, mas **os branches de escrita (insert/update/delete em
   `transactions` via REST) foram omitidos** por serem repetições do mesmo
   padrão HTTP Request já mostrado no node `verify_whatsapp_link`; preencher
   um por função antes de ativar.
5. Estado de confirmação pendente (`pending_action`) fica no Redis por
   tenant; em caso de ambiguidade o agente deve sempre chamar
   `pedir_confirmacao` em vez de gravar direto.

### Credenciais (nunca hardcoded)

Toda credencial fica gerenciada no n8n (Settings > Credentials), referenciada
no workflow só pelo nome/ID — nada de token/URL embutido no JSON nem no app:

- **UAZAPI/ZPro** (`REPLACE_WITH_UAZAPI_CREDENTIAL_ID` no workflow): base
  URL + token da instância central.
- **Supabase anon** (`REPLACE_WITH_SUPABASE_ANON_CREDENTIAL_ID`): URL do
  projeto + `apikey`/`Authorization` com a chave `anon`/`publishable` (a
  mesma usada pelo app — nunca a `service_role`, já que todo acesso do n8n
  passa pelas functions `SECURITY DEFINER` acima, não por bypass de RLS).
- **Redis** (`REPLACE_WITH_REDIS_CREDENTIAL_ID`): host/porta/senha da
  instância de buffer.
- **Gemini** (`REPLACE_WITH_GEMINI_CREDENTIAL_ID`): API key do Google
  Gemini.

### Rotação da instância/número central

Como o número WhatsApp central é único para toda a plataforma (diferente do
vínculo por tenant, que já tem sua própria troca via código), trocar a
instância UAZAPI/ZPro ou o número físico por trás dela é uma operação de
infraestrutura, feita inteiramente dentro do n8n, sem precisar tocar no
schema ou no app:

1. Provisionar a nova instância no painel UAZAPI/ZPro e conectar o novo
   número (escaneando o QR code).
2. No n8n, editar a credencial existente ("UAZAPI instância central") com a
   nova base URL/token, **em vez de** criar uma credencial nova — assim
   todos os nodes que já a referenciam (`REPLACE_WITH_UAZAPI_CREDENTIAL_ID`)
   continuam funcionando sem precisar editar o workflow.
3. Atualizar `VITE_WHATSAPP_CENTRAL_NUMBER` no `.env` do app (só o texto
   exibido em Configurações > Conectar WhatsApp, informativo — não afeta o
   roteamento, que depende só de `tenant_whatsapp_links.phone_number`).
4. Os vínculos já `active` de cada tenant continuam válidos — a troca de
   instância central não invalida vínculos existentes, já que
   `verify_whatsapp_link`/`resolve_tenant_by_whatsapp` trabalham só com o
   número do remetente, não com qual instância UAZAPI recebeu a mensagem.
5. Testar enviando um código de verificação de um tenant de teste para o
   número novo antes de anunciar a troca aos usuários.

### Promovendo o primeiro superadmin

Não existe tela pública de auto-promoção a superadmin, de propósito. Depois
de aplicar a migration `20260717000002_platform_admin.sql`, promova o
primeiro superadmin rodando isto direto no SQL Editor do Supabase (ou via
`execute_sql`), substituindo pelo e-mail real:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'seu-email@exemplo.com';
```

A pessoa precisa já ter feito cadastro no app (linha existente em
`auth.users`) antes desse passo. Depois disso, ao logar, o link "Admin"
aparece em Mais e a rota `/admin` fica acessível para essa conta.

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

- **Fechar o rascunho do n8n**: importar `n8n/whatsapp-agent-workflow.json`
  numa instância real, criar as credenciais (UAZAPI/Supabase/Redis/Gemini),
  comparar o debounce com o padrão real do agente Hellen, preencher os
  branches de escrita por função (`criar_lancamento` etc.) e testar
  ponta-a-ponta com mensagens reais — ver "Fase 3" acima.
- OCR de comprovantes/faturas (o agente já recebe imagem/documento no
  rascunho, mas a extração de dados do arquivo em si não foi implementada).
- Billing/planos SaaS.
- Convite de múltiplos membros por tenant (schema já suporta via
  `tenant_users.role`, só falta a tela).
- Analytics avançado de superadmin (a área `/admin` desta fase é intencionalmente básica: listagem, busca, ativar/desativar).
- Cron automático de recorrência (hoje é geração na criação da regra +
  botão manual "Atualizar Projeções" — ver Fase 2).
- Automação de baixa de fatura de cartão (ver nota técnica da Fase 2 sobre
  possível dupla contagem na evolução mensal).
- Acompanhamento de metas de poupança sem conta vinculada (ver nota técnica
  da Fase 2).
