# Gestão de projetos

Site independente do SGC. O quadro, a lista, a cronologia, os modelos, os comentários e os entregáveis ficam aqui. O banco é só o Supabase `https://ozbmqyehblqznnbmzgib.supabase.co`. Nada deste site usa o Azure.

O kanban que já está no SGC não foi alterado.

## Primeira vez

1. No Supabase, abra o SQL Editor e rode o arquivo `supabase/schema.sql` inteiro.
2. Em Project Settings → API, copie a chave **anon public**.
3. Cole essa chave em `config.js`, no campo `anonKey`. Não use a chave `service_role`.
4. Em Authentication → Providers → Email, desligue **Confirm email** se a equipe deve entrar assim que criar a conta. Se deixar ligado, cada pessoa confirma o e-mail antes de entrar.
5. Na pasta deste site, suba um servidor local e abra o endereço que ele mostrar:

```
npx --yes serve .
```

Criar a conta pede nome, e-mail e senha. Quem entra vê todos os projetos da equipe. O sino avisa o responsável e a equipe de apoio, menos quem fez a alteração.

Fotos e PDFs de até 3 MB vão para o armazenamento `entregaveis`. PDF maior continua como link.

## O que não trazer do SGC

Não copie `.env.local`, a connection string do Azure, nem a chave `service_role`. Esta pasta já é o projeto novo: pode movê-la para outro lugar e abrir só ela.
