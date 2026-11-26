(function () {
  const cfg = window.GESTAO_CONFIG || {};
  let sb = null;

  function mostrar(id, texto) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !texto;
    el.textContent = texto || "";
  }

  function faltaChave() {
    const card = document.getElementById("formLogin");
    if (!card) return;
    card.innerHTML = `
      <h1>Gestão de projetos</h1>
      <p id="loginErro">Falta a chave anon do Supabase. Abra config.js e cole a chave pública (Project Settings → API → anon public) do projeto ozbmqyehblqznnbmzgib. A chave service_role não entra aqui. Depois rode supabase/schema.sql no SQL Editor.</p>
    `;
  }

  async function esperarLogin() {
    const form = document.getElementById("formLogin");
    const criar = document.getElementById("btnCriarConta");
    return new Promise((resolve) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        mostrar("loginErro", "");
        const email = document.getElementById("loginEmail").value.trim();
        const senha = document.getElementById("loginSenha").value;
        const res = await sb.auth.signInWithPassword({ email, password: senha });
        if (res.error) {
          mostrar("loginErro", res.error.message === "Invalid login credentials"
            ? "E-mail ou senha não conferem."
            : res.error.message);
          return;
        }
        resolve(true);
      });
      criar.addEventListener("click", async () => {
        mostrar("loginErro", "");
        const email = document.getElementById("loginEmail").value.trim();
        const senha = document.getElementById("loginSenha").value;
        const nome = document.getElementById("loginNome").value.trim();
        if (!email || senha.length < 6) {
          mostrar("loginErro", "Informe o e-mail e uma senha com pelo menos 6 caracteres.");
          return;
        }
        const res = await sb.auth.signUp({
          email,
          password: senha,
          options: { data: { nome: nome || email.split("@")[0] } },
        });
        if (res.error) {
          mostrar("loginErro", res.error.message);
          return;
        }
        if (!res.data.session) {
          mostrar("loginErro", "Conta criada. Confirme o e-mail para entrar. No Supabase, em Authentication → Email, dá para desligar a confirmação se a equipe entra na hora.");
          return;
        }
        resolve(true);
      });
    });
  }

  function tempo(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  async function desenharAvisos() {
    const painel = document.getElementById("painelAvisos");
    const conta = document.getElementById("sinoConta");
    if (!painel || !sb) return;
    const res = await sb.from("avisos")
      .select("id, projeto_id, mensagem, detalhe, lido, criado_em")
      .order("criado_em", { ascending: false })
      .limit(30);
    const lista = res.data || [];
    const novos = lista.filter((a) => !a.lido).length;
    if (conta) {
      conta.hidden = novos === 0;
      conta.textContent = novos > 9 ? "9+" : String(novos);
    }
    if (!lista.length) {
      painel.innerHTML = `<p class="aviso-vazio">Nenhum aviso.</p>`;
      return;
    }
    painel.innerHTML = lista.map((a) => `
      <button type="button" class="aviso${a.lido ? "" : " novo"}" data-aviso="${a.id}" data-projeto="${a.projeto_id || ""}">
        <strong>${escapar(a.mensagem)}</strong>
        ${a.detalhe ? `<span>${escapar(a.detalhe)}</span>` : ""}
        <time>${escapar(tempo(a.criado_em))}</time>
      </button>
    `).join("");
  }

  function escapar(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function iniciarSino() {
    const botao = document.getElementById("btnSino");
    const painel = document.getElementById("painelAvisos");
    botao.addEventListener("click", () => {
      painel.hidden = !painel.hidden;
      if (!painel.hidden) desenharAvisos();
    });
    painel.addEventListener("click", async (e) => {
      const aviso = e.target.closest("[data-aviso]");
      if (!aviso) return;
      const id = Number(aviso.dataset.aviso);
      await sb.from("avisos").update({ lido: true }).eq("id", id);
      painel.hidden = true;
      desenharAvisos();
      const projetoId = Number(aviso.dataset.projeto);
      if (projetoId && window.GestaoAbrirProjeto) window.GestaoAbrirProjeto(projetoId);
    });
    document.addEventListener("gestao-avisos", () => desenharAvisos());
    document.addEventListener("click", (e) => {
      if (e.target.closest("#btnSino") || e.target.closest("#painelAvisos")) return;
      painel.hidden = true;
    });
    sb.channel("avisos-gestao")
      .on("postgres_changes", { event: "*", schema: "public", table: "avisos" }, () => desenharAvisos())
      .subscribe();
    desenharAvisos();
  }

  async function preparar() {
    if (!cfg.url || !cfg.anonKey) {
      faltaChave();
      return false;
    }
    if (!window.supabase || !window.supabase.createClient) {
      mostrar("loginErro", "Não carregou a biblioteca do Supabase. Abra o site por um servidor local, não pelo arquivo direto.");
      return false;
    }
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    window.GestaoDB.usar(sb);
    let sessao = await sb.auth.getSession();
    if (!sessao.data.session) {
      const entrou = await esperarLogin();
      if (!entrou) return false;
    }
    let perfil = null;
    for (let i = 0; i < 5; i += 1) {
      perfil = await window.GestaoDB.carregarEu();
      if (perfil) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!perfil) {
      mostrar("loginErro", "A conta entrou, mas o perfil não existe. Rode supabase/schema.sql no SQL Editor do Supabase e entre de novo.");
      return false;
    }
    document.getElementById("telaLogin").hidden = true;
    document.getElementById("app").hidden = false;
    document.getElementById("topoNome").textContent = perfil.nome;
    document.getElementById("btnSair").addEventListener("click", async () => {
      await sb.auth.signOut();
      location.reload();
    });
    iniciarSino();
    return true;
  }

  window.GestaoSessao = { pronta: preparar() };
})();
