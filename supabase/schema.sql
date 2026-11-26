-- Gestão de projetos, independente do SGC.
-- Rode este arquivo inteiro no SQL Editor do projeto
-- https://ozbmqyehblqznnbmzgib.supabase.co
-- Só quem entrou na conta lê ou grava. A chave anon sozinha não abre as tabelas.

create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  usuario text not null unique,
  criado_em timestamptz not null default now()
);

create table if not exists public.projetos (
  id bigint generated always as identity primary key,
  nome text not null check (char_length(nome) <= 160),
  descricao text,
  responsavel text,
  responsavel_usuario text,
  prazo date,
  data_cadastro date,
  data_inicio date,
  status text not null default 'A FAZER',
  prioridade_alta boolean not null default false,
  atrasado boolean not null default false,
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  criado_por text,
  atualizado_em timestamptz,
  constraint projetos_status_ck check (status in ('A FAZER', 'EM ANDAMENTO', 'CONCLUIDO', 'PAUSADO', 'CANCELADO'))
);

create index if not exists projetos_status_idx on public.projetos (status, ordem, id);

create table if not exists public.projeto_acoes (
  id bigint generated always as identity primary key,
  projeto_id bigint not null references public.projetos (id) on delete cascade,
  texto text not null check (char_length(texto) <= 300),
  nivel smallint not null default 1 check (nivel between 1 and 3),
  feito boolean not null default false,
  prioridade_alta boolean not null default false,
  atrasado boolean not null default false,
  ordem integer not null default 0
);

create index if not exists projeto_acoes_idx on public.projeto_acoes (projeto_id, ordem, id);

create table if not exists public.projeto_equipe (
  id bigint generated always as identity primary key,
  projeto_id bigint not null references public.projetos (id) on delete cascade,
  nome text not null check (char_length(nome) <= 120),
  usuario text,
  ordem integer not null default 0
);

create index if not exists projeto_equipe_idx on public.projeto_equipe (projeto_id, ordem, id);

create table if not exists public.projeto_registros (
  id bigint generated always as identity primary key,
  projeto_id bigint not null references public.projetos (id) on delete cascade,
  data date not null,
  etapa text not null check (etapa in ('pesquisa', 'faca', 'modelagem', 'arte', 'ajuste', 'grafica', 'outro')),
  rotulo text,
  titulo text not null check (char_length(titulo) <= 120),
  texto text,
  cor text,
  ordem integer not null default 0
);

create index if not exists projeto_registros_idx on public.projeto_registros (projeto_id, data, ordem, id);

create table if not exists public.projeto_entregaveis (
  id bigint generated always as identity primary key,
  projeto_id bigint not null references public.projetos (id) on delete cascade,
  tipo text not null check (tipo in ('PDF', 'IMAGEM', 'LINK')),
  nome_arquivo text not null,
  mime text not null,
  tamanho integer not null default 0,
  url text,
  caminho text,
  criado_em timestamptz not null default now(),
  criado_por text
);

create index if not exists projeto_entregaveis_idx on public.projeto_entregaveis (projeto_id, id);

create table if not exists public.projeto_comentarios (
  id bigint generated always as identity primary key,
  projeto_id bigint not null references public.projetos (id) on delete cascade,
  texto text not null check (char_length(texto) <= 1000),
  criado_em timestamptz not null default now(),
  criado_por text,
  usuario text
);

create index if not exists projeto_comentarios_idx on public.projeto_comentarios (projeto_id, criado_em, id);

create table if not exists public.projeto_modelos (
  id bigint generated always as identity primary key,
  projeto_id bigint unique references public.projetos (id) on delete cascade,
  nome text not null check (char_length(nome) <= 160),
  itens jsonb not null,
  criado_em timestamptz not null default now(),
  criado_por text
);

create table if not exists public.avisos (
  id bigint generated always as identity primary key,
  destinatario text not null,
  projeto_id bigint references public.projetos (id) on delete cascade,
  mensagem text not null,
  detalhe text,
  lido boolean not null default false,
  criado_em timestamptz not null default now()
);

create index if not exists avisos_dest_idx on public.avisos (destinatario, lido, criado_em desc);

create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_base text;
  v_usuario text;
  n integer := 0;
begin
  v_nome := nullif(trim(coalesce(new.raw_user_meta_data->>'nome', '')), '');
  if v_nome is null then
    v_nome := split_part(coalesce(new.email, 'usuario'), '@', 1);
  end if;
  v_base := lower(regexp_replace(
    coalesce(nullif(trim(new.raw_user_meta_data->>'usuario'), ''), split_part(coalesce(new.email, 'usuario'), '@', 1)),
    '[^a-z0-9._-]', '', 'g'
  ));
  if v_base is null or v_base = '' then
    v_base := 'usuario';
  end if;
  v_usuario := left(v_base, 80);
  while exists (select 1 from public.perfis where usuario = v_usuario) loop
    n := n + 1;
    v_usuario := left(v_base, 70) || n::text;
  end loop;
  insert into public.perfis (id, nome, usuario)
  values (new.id, left(v_nome, 100), left(v_usuario, 100))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists criar_perfil_ao_cadastrar on auth.users;
create trigger criar_perfil_ao_cadastrar
  after insert on auth.users
  for each row execute function public.criar_perfil();

create or replace function public.salvar_projeto(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_eu text;
  v_eu_nome text;
  v_id bigint;
  v_nome text;
  v_desc text;
  v_resp text;
  v_resp_usuario text;
  v_resp_antigo text := '';
  v_status text;
  v_pri boolean;
  v_cadastro date;
  v_inicio date;
  v_fim date;
  v_ordem integer;
  v_antiga text[] := array[]::text[];
  v_detalhe text;
  v_rotulo text;
  v_itens jsonb;
  v_modelo boolean;
  v_qtd integer;
  item jsonb;
  v_login text;
  v_pessoa_nome text;
  v_pessoa_login text;
  v_eq_nome text;
  v_n integer := 0;
  v_reg_data date;
  v_reg_etapa text;
  v_reg_titulo text;
  v_reg_rotulo text;
  v_reg_texto text;
  v_reg_cor text;
begin
  if v_uid is null then
    raise exception 'Faça login.';
  end if;
  select usuario, nome into v_eu, v_eu_nome from public.perfis where id = v_uid;
  if v_eu is null then
    raise exception 'Perfil não encontrado.';
  end if;

  v_nome := left(trim(coalesce(payload->>'nome', '')), 160);
  if v_nome = '' then
    raise exception 'Informe o nome do projeto.';
  end if;
  v_status := upper(trim(coalesce(payload->>'status', 'A FAZER')));
  if v_status = 'CONCLUÍDO' or v_status = 'FEITO' then v_status := 'CONCLUIDO'; end if;
  if v_status = 'FAZENDO' or v_status = 'ANDAMENTO' then v_status := 'EM ANDAMENTO'; end if;
  if v_status = 'AFAZER' or v_status = 'TODO' then v_status := 'A FAZER'; end if;
  if v_status = 'PAUSA' or v_status = 'PAUSADA' then v_status := 'PAUSADO'; end if;
  if v_status = 'CANCELADA' or v_status = 'CANCELAR' then v_status := 'CANCELADO'; end if;
  if v_status not in ('A FAZER', 'EM ANDAMENTO', 'CONCLUIDO', 'PAUSADO', 'CANCELADO') then
    raise exception 'Status inválido.';
  end if;

  if coalesce(payload->>'cadastro', '') <> '' and payload->>'cadastro' !~ '^\d{4}-\d{2}-\d{2}' then
    raise exception 'Data de cadastro inválida.';
  end if;
  if coalesce(payload->>'inicio', '') <> '' and payload->>'inicio' !~ '^\d{4}-\d{2}-\d{2}' then
    raise exception 'Data de início inválida.';
  end if;
  if coalesce(payload->>'fim', '') <> '' and payload->>'fim' !~ '^\d{4}-\d{2}-\d{2}' then
    raise exception 'Data de fim inválida.';
  end if;
  v_cadastro := nullif(left(coalesce(payload->>'cadastro', ''), 10), '')::date;
  v_inicio := nullif(left(coalesce(payload->>'inicio', ''), 10), '')::date;
  v_fim := nullif(left(coalesce(payload->>'fim', ''), 10), '')::date;
  if v_inicio is not null and v_fim is not null and v_inicio > v_fim then
    raise exception 'A data de início é maior que a de fim.';
  end if;

  if jsonb_typeof(payload->'acoes') = 'array' and jsonb_array_length(payload->'acoes') > 40 then
    raise exception 'No máximo 40 ações por projeto.';
  end if;
  if jsonb_typeof(payload->'equipe') = 'array' and jsonb_array_length(payload->'equipe') > 20 then
    raise exception 'No máximo 20 pessoas na equipe de apoio.';
  end if;
  if jsonb_typeof(payload->'registros') = 'array' and jsonb_array_length(payload->'registros') > 80 then
    raise exception 'No máximo 80 registros por projeto.';
  end if;

  v_desc := nullif(left(trim(coalesce(payload->>'descricao', '')), 1000), '');
  v_resp := nullif(left(trim(coalesce(payload->>'responsavel', '')), 100), '');
  v_resp_usuario := nullif(left(trim(coalesce(payload->>'responsavelUsuario', '')), 100), '');
  if v_resp_usuario is not null then
    select usuario, nome into v_pessoa_login, v_pessoa_nome
    from public.perfis where lower(usuario) = lower(v_resp_usuario) limit 1;
    if v_pessoa_login is null then
      v_resp_usuario := null;
    else
      v_resp_usuario := v_pessoa_login;
      if v_resp is null then v_resp := left(v_pessoa_nome, 100); end if;
    end if;
  end if;
  v_pri := coalesce((payload->>'prioridadeAlta')::boolean, false);

  if coalesce(payload->>'id', '') ~ '^[0-9]+$' then
    v_id := (payload->>'id')::bigint;
  end if;

  create temporary table if not exists pg_aviso_tmp (
    usuario text primary key,
    mensagem text not null
  ) on commit drop;
  delete from pg_aviso_tmp;

  if v_id is null then
    select coalesce(max(ordem), -1) + 1 into v_ordem from public.projetos where status = v_status;
    insert into public.projetos (
      nome, descricao, responsavel, responsavel_usuario, prazo, data_cadastro, data_inicio,
      status, prioridade_alta, ordem, criado_por
    ) values (
      v_nome, v_desc, v_resp, v_resp_usuario, v_fim, coalesce(v_cadastro, current_date), v_inicio,
      v_status, v_pri, v_ordem, v_eu
    ) returning id into v_id;
  else
    select coalesce(responsavel_usuario, '') into v_resp_antigo
    from public.projetos where id = v_id;
    if not found then
      raise exception 'Projeto não encontrado.';
    end if;
    select coalesce(array_agg(lower(usuario)), array[]::text[]) into v_antiga
    from public.projeto_equipe
    where projeto_id = v_id and coalesce(usuario, '') <> '';

    update public.projetos set
      nome = v_nome,
      descricao = v_desc,
      responsavel = v_resp,
      responsavel_usuario = v_resp_usuario,
      prazo = v_fim,
      data_cadastro = v_cadastro,
      data_inicio = v_inicio,
      status = v_status,
      prioridade_alta = v_pri,
      atualizado_em = now()
    where id = v_id;

    delete from public.projeto_acoes where projeto_id = v_id;
    delete from public.projeto_equipe where projeto_id = v_id;
    delete from public.projeto_registros where projeto_id = v_id;
  end if;

  v_n := 0;
  if jsonb_typeof(payload->'acoes') = 'array' then
    for item in select value from jsonb_array_elements(payload->'acoes') loop
      if length(trim(coalesce(item->>'texto', ''))) = 0 then continue; end if;
      insert into public.projeto_acoes (projeto_id, texto, nivel, feito, prioridade_alta, atrasado, ordem)
      values (
        v_id,
        left(trim(item->>'texto'), 300),
        least(3, greatest(1, coalesce((item->>'nivel')::int, 1))),
        coalesce((item->>'feito')::boolean, false),
        coalesce((item->>'prioridadeAlta')::boolean, false),
        coalesce((item->>'atrasado')::boolean, false),
        v_n
      );
      v_n := v_n + 1;
    end loop;
  end if;

  v_n := 0;
  if jsonb_typeof(payload->'equipe') = 'array' then
    for item in select value from jsonb_array_elements(payload->'equipe') loop
      v_eq_nome := left(trim(coalesce(item->>'nome', '')), 120);
      v_login := nullif(left(trim(coalesce(item->>'usuario', '')), 100), '');
      if v_eq_nome = '' and v_login is null then continue; end if;
      v_pessoa_login := null;
      v_pessoa_nome := null;
      if v_login is not null then
        select usuario, nome into v_pessoa_login, v_pessoa_nome
        from public.perfis where lower(usuario) = lower(v_login) limit 1;
      end if;
      if v_pessoa_login is null then
        v_login := null;
        if v_eq_nome = '' then continue; end if;
      else
        v_login := v_pessoa_login;
        if v_eq_nome = '' then v_eq_nome := left(v_pessoa_nome, 120); end if;
      end if;
      if v_login is not null and exists (
        select 1 from public.projeto_equipe where projeto_id = v_id and lower(usuario) = lower(v_login)
      ) then
        continue;
      end if;
      if v_n >= 20 then
        raise exception 'No máximo 20 pessoas na equipe de apoio.';
      end if;
      insert into public.projeto_equipe (projeto_id, nome, usuario, ordem)
      values (v_id, v_eq_nome, v_login, v_n);
      v_n := v_n + 1;
    end loop;
  end if;

  v_n := 0;
  if jsonb_typeof(payload->'registros') = 'array' then
    for item in select value from jsonb_array_elements(payload->'registros') loop
      v_reg_titulo := left(trim(coalesce(item->>'titulo', '')), 120);
      v_reg_etapa := trim(coalesce(item->>'etapa', ''));
      v_reg_texto := nullif(left(trim(coalesce(item->>'texto', '')), 500), '');
      v_reg_rotulo := nullif(left(trim(coalesce(item->>'rotulo', '')), 80), '');
      if coalesce(item->>'data', '') !~ '^\d{4}-\d{2}-\d{2}' then
        if v_reg_titulo = '' and v_reg_texto is null then continue; end if;
        raise exception 'Informe a data do registro.';
      end if;
      if v_reg_titulo = '' then
        raise exception 'Informe o título do registro.';
      end if;
      if v_reg_etapa not in ('pesquisa', 'faca', 'modelagem', 'arte', 'ajuste', 'grafica', 'outro') then
        raise exception 'Etapa do registro inválida.';
      end if;
      if v_reg_etapa = 'outro' and v_reg_rotulo is null then
        raise exception 'Informe o nome da etapa.';
      end if;
      v_reg_data := left(item->>'data', 10)::date;
      v_reg_cor := null;
      if v_reg_etapa = 'outro' and coalesce(item->>'cor', '') ~ '^#[0-9a-fA-F]{6}$' then
        v_reg_cor := lower(item->>'cor');
      end if;
      if v_reg_etapa <> 'outro' then
        v_reg_rotulo := null;
      end if;
      insert into public.projeto_registros (projeto_id, data, etapa, rotulo, titulo, texto, cor, ordem)
      values (v_id, v_reg_data, v_reg_etapa, v_reg_rotulo, v_reg_titulo, v_reg_texto, v_reg_cor, v_n);
      v_n := v_n + 1;
    end loop;
  end if;

  if payload ? 'modelo' then
    v_modelo := coalesce((payload->>'modelo')::boolean, false);
    if v_modelo then
      select count(*) into v_qtd from public.projeto_modelos where projeto_id is distinct from v_id;
      if v_qtd >= 20 and not exists (select 1 from public.projeto_modelos where projeto_id = v_id) then
        raise exception 'No máximo 20 modelos.';
      end if;
      select jsonb_build_object(
        'nome', v_nome,
        'descricao', coalesce(v_desc, ''),
        'responsavel', coalesce(v_resp, ''),
        'responsavelUsuario', coalesce(v_resp_usuario, ''),
        'prioridadeAlta', v_pri,
        'status', v_status,
        'equipe', coalesce((
          select jsonb_agg(jsonb_build_object('nome', nome, 'usuario', coalesce(usuario, '')) order by ordem)
          from public.projeto_equipe where projeto_id = v_id
        ), '[]'::jsonb),
        'acoes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'texto', texto, 'nivel', nivel, 'prioridadeAlta', prioridade_alta, 'atrasado', atrasado
          ) order by ordem)
          from public.projeto_acoes where projeto_id = v_id
        ), '[]'::jsonb)
      ) into v_itens;
      insert into public.projeto_modelos (projeto_id, nome, itens, criado_por)
      values (v_id, v_nome, v_itens, v_eu)
      on conflict (projeto_id) do update
        set nome = excluded.nome, itens = excluded.itens, criado_por = excluded.criado_por;
    else
      delete from public.projeto_modelos where projeto_id = v_id;
    end if;
  end if;

  v_rotulo := case v_status
    when 'A FAZER' then 'A fazer'
    when 'EM ANDAMENTO' then 'Em andamento'
    when 'CONCLUIDO' then 'Concluído'
    when 'PAUSADO' then 'Pausado'
    when 'CANCELADO' then 'Cancelado'
    else v_status
  end;
  v_detalhe := left('Por ' || v_eu_nome || '. Status: ' || v_rotulo || '.', 500);

  if coalesce(v_resp_usuario, '') <> '' and lower(v_resp_usuario) <> lower(v_resp_antigo) then
    insert into pg_aviso_tmp (usuario, mensagem)
    values (v_resp_usuario, left('Você é o responsável do projeto ' || v_nome || '.', 500))
    on conflict (usuario) do update set mensagem = excluded.mensagem;
  end if;

  insert into pg_aviso_tmp (usuario, mensagem)
  select e.usuario, left('Você entrou na equipe de apoio do projeto ' || v_nome || '.', 500)
  from public.projeto_equipe e
  where e.projeto_id = v_id
    and coalesce(e.usuario, '') <> ''
    and not (lower(e.usuario) = any (v_antiga))
  on conflict (usuario) do nothing;

  insert into pg_aviso_tmp (usuario, mensagem)
  select e.usuario, left('O projeto ' || v_nome || ' foi atualizado.', 500)
  from public.projeto_equipe e
  where e.projeto_id = v_id
    and coalesce(e.usuario, '') <> ''
    and lower(e.usuario) = any (v_antiga)
  on conflict (usuario) do nothing;

  if coalesce(v_resp_usuario, '') <> '' and lower(v_resp_usuario) = lower(v_resp_antigo) then
    insert into pg_aviso_tmp (usuario, mensagem)
    values (v_resp_usuario, left('O projeto ' || v_nome || ' foi atualizado.', 500))
    on conflict (usuario) do nothing;
  end if;

  insert into public.avisos (destinatario, projeto_id, mensagem, detalhe)
  select usuario, v_id, mensagem, v_detalhe
  from pg_aviso_tmp
  where mensagem <> '' and lower(usuario) <> lower(v_eu);

  return v_id;
end;
$$;

revoke all on function public.salvar_projeto(jsonb) from public;
grant execute on function public.salvar_projeto(jsonb) to authenticated;

alter table public.perfis enable row level security;
alter table public.projetos enable row level security;
alter table public.projeto_acoes enable row level security;
alter table public.projeto_equipe enable row level security;
alter table public.projeto_registros enable row level security;
alter table public.projeto_entregaveis enable row level security;
alter table public.projeto_comentarios enable row level security;
alter table public.projeto_modelos enable row level security;
alter table public.avisos enable row level security;

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (true);
drop policy if exists perfis_atualizar on public.perfis;
create policy perfis_atualizar on public.perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists projetos_membros on public.projetos;
create policy projetos_membros on public.projetos for all to authenticated using (true) with check (true);
drop policy if exists acoes_membros on public.projeto_acoes;
create policy acoes_membros on public.projeto_acoes for all to authenticated using (true) with check (true);
drop policy if exists equipe_membros on public.projeto_equipe;
create policy equipe_membros on public.projeto_equipe for all to authenticated using (true) with check (true);
drop policy if exists registros_membros on public.projeto_registros;
create policy registros_membros on public.projeto_registros for all to authenticated using (true) with check (true);
drop policy if exists entregaveis_membros on public.projeto_entregaveis;
create policy entregaveis_membros on public.projeto_entregaveis for all to authenticated using (true) with check (true);
drop policy if exists modelos_membros on public.projeto_modelos;
create policy modelos_membros on public.projeto_modelos for all to authenticated using (true) with check (true);

drop policy if exists comentarios_ler on public.projeto_comentarios;
create policy comentarios_ler on public.projeto_comentarios for select to authenticated using (true);
drop policy if exists comentarios_gravar on public.projeto_comentarios;
create policy comentarios_gravar on public.projeto_comentarios for insert to authenticated with check (true);
drop policy if exists comentarios_apagar on public.projeto_comentarios;
create policy comentarios_apagar on public.projeto_comentarios for delete to authenticated
  using (
    lower(coalesce(usuario, '')) = (select lower(usuario) from public.perfis where id = auth.uid())
    or lower(coalesce(criado_por, '')) = (select lower(nome) from public.perfis where id = auth.uid())
    or lower(coalesce(criado_por, '')) = (select lower(usuario) from public.perfis where id = auth.uid())
  );

drop policy if exists avisos_ler on public.avisos;
create policy avisos_ler on public.avisos for select to authenticated
  using (lower(destinatario) = (select lower(usuario) from public.perfis where id = auth.uid()));
drop policy if exists avisos_atualizar on public.avisos;
create policy avisos_atualizar on public.avisos for update to authenticated
  using (lower(destinatario) = (select lower(usuario) from public.perfis where id = auth.uid()))
  with check (lower(destinatario) = (select lower(usuario) from public.perfis where id = auth.uid()));
drop policy if exists avisos_gravar on public.avisos;
create policy avisos_gravar on public.avisos for insert to authenticated with check (true);

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.perfis, public.projetos, public.projeto_acoes, public.projeto_equipe,
  public.projeto_registros, public.projeto_entregaveis, public.projeto_comentarios,
  public.projeto_modelos, public.avisos
to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on
  public.perfis, public.projetos, public.projeto_acoes, public.projeto_equipe,
  public.projeto_registros, public.projeto_entregaveis, public.projeto_comentarios,
  public.projeto_modelos, public.avisos
from anon;

insert into storage.buckets (id, name, public, file_size_limit)
values ('entregaveis', 'entregaveis', false, 3145728)
on conflict (id) do update set public = false, file_size_limit = 3145728;

drop policy if exists entregaveis_ler on storage.objects;
create policy entregaveis_ler on storage.objects for select to authenticated
  using (bucket_id = 'entregaveis');
drop policy if exists entregaveis_gravar on storage.objects;
create policy entregaveis_gravar on storage.objects for insert to authenticated
  with check (bucket_id = 'entregaveis');
drop policy if exists entregaveis_atualizar on storage.objects;
create policy entregaveis_atualizar on storage.objects for update to authenticated
  using (bucket_id = 'entregaveis') with check (bucket_id = 'entregaveis');
drop policy if exists entregaveis_apagar on storage.objects;
create policy entregaveis_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'entregaveis');

create or replace function public.limite_comentarios()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.projeto_comentarios where projeto_id = new.projeto_id) >= 200 then
    raise exception 'No máximo 200 comentários.';
  end if;
  return new;
end;
$$;

drop trigger if exists limite_comentarios on public.projeto_comentarios;
create trigger limite_comentarios
  before insert on public.projeto_comentarios
  for each row execute function public.limite_comentarios();

do $$
begin
  alter publication supabase_realtime add table public.avisos;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
