-- Desfaz só o que supabase/schema.sql criou.
-- Rode no SQL Editor do MESMO projeto em que o schema foi executado.
-- Não apaga usuários de Authentication nem outras tabelas.

drop trigger if exists criar_perfil_ao_cadastrar on auth.users;

do $$
begin
  alter publication supabase_realtime drop table public.avisos;
exception
  when undefined_object then null;
  when undefined_table then null;
end $$;

drop policy if exists entregaveis_ler on storage.objects;
drop policy if exists entregaveis_gravar on storage.objects;
drop policy if exists entregaveis_atualizar on storage.objects;
drop policy if exists entregaveis_apagar on storage.objects;

-- O bucket entregaveis não sai por SQL. Apague em Armazenamento, no menu do projeto.

drop table if exists public.projeto_tags cascade;
drop table if exists public.tags cascade;
drop table if exists public.projeto_convites cascade;
drop table if exists public.avisos cascade;
drop table if exists public.projeto_modelos cascade;
drop table if exists public.projeto_comentarios cascade;
drop table if exists public.projeto_entregaveis cascade;
drop table if exists public.projeto_registros cascade;
drop table if exists public.projeto_equipe cascade;
drop table if exists public.projeto_acoes cascade;
drop table if exists public.projetos cascade;
drop table if exists public.perfis cascade;

drop function if exists public.painel_assinaturas();
drop function if exists public.sou_gestor();
drop table if exists public.gestores;
drop function if exists public.revogar_convite(bigint);
drop function if exists public.aceitar_convites_pendentes();
drop function if exists public.aceitar_convite(text);
drop function if exists public.convidar_projeto(bigint, text);
drop function if exists public.ver_convite(text);
drop function if exists public.membro_do_projeto(bigint);
drop function if exists public.salvar_projeto(jsonb);
drop function if exists public.limite_comentarios();
drop function if exists public.criar_perfil();
