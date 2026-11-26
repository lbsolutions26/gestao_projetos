(function (root) {
  const SELECT_PROJETO = `
    id, nome, descricao, responsavel, responsavel_usuario, prazo, data_cadastro, data_inicio,
    status, prioridade_alta, atrasado, ordem, criado_em, criado_por,
    acoes:projeto_acoes(id, texto, nivel, feito, prioridade_alta, atrasado, ordem),
    registros:projeto_registros(id, data, etapa, rotulo, titulo, texto, cor, ordem),
    equipe:projeto_equipe(id, nome, usuario, ordem),
    entregaveis:projeto_entregaveis(id, tipo, nome_arquivo, mime, tamanho, url, caminho, criado_em, criado_por),
    comentarios:projeto_comentarios(id, texto, criado_em, criado_por, usuario),
    modelo:projeto_modelos(id)
  `;
  const ROTULO = {
    "A FAZER": "A fazer",
    "EM ANDAMENTO": "Em andamento",
    CONCLUIDO: "Concluído",
    PAUSADO: "Pausado",
    CANCELADO: "Cancelado",
  };
  const eu = { id: null, nome: "", usuario: "" };
  let sb = null;

  function usar(cliente) {
    sb = cliente;
  }

  function falha(error) {
    const bruto = String((error && (error.message || error.details)) || "");
    if (/No máximo 20 modelos/i.test(bruto)) return new Error("No máximo 20 modelos.");
    if (/No máximo 200 comentários/i.test(bruto)) return new Error("No máximo 200 comentários.");
    if (/schema cache|could not find the function|relation .* does not exist|does not exist/i.test(bruto)) {
      return new Error("O banco ainda não tem as tabelas. Rode supabase/schema.sql no SQL Editor do Supabase.");
    }
    if (/Invalid API key|JWT/i.test(bruto)) {
      return new Error("A chave do Supabase não foi aceita. Confira a chave anon em config.js.");
    }
    if (/row-level security|permission denied/i.test(bruto)) {
      return new Error("Sem permissão para esta ação.");
    }
    const msg = bruto.replace(/^.*ERROR:\s*/i, "").split("\n")[0].trim();
    return new Error(msg || "Não foi possível concluir.");
  }

  function exigir(res) {
    if (res.error) throw falha(res.error);
    return res;
  }

  function porOrdem(a, b) {
    return (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);
  }

  function dataDia(valor) {
    if (!valor) return "";
    return String(valor).slice(0, 10);
  }

  function mapAcao(r) {
    return {
      id: r.id,
      texto: r.texto || "",
      nivel: Number(r.nivel) || 1,
      feito: !!r.feito,
      prioridadeAlta: !!r.prioridade_alta,
      atrasado: !!r.atrasado,
      ordem: Number(r.ordem) || 0,
    };
  }

  function mapRegistro(r) {
    return {
      id: r.id,
      data: dataDia(r.data),
      etapa: r.etapa,
      rotulo: r.rotulo || "",
      titulo: r.titulo || "",
      texto: r.texto || "",
      cor: r.cor || "",
      ordem: Number(r.ordem) || 0,
    };
  }

  function mapEquipe(r) {
    return { nome: r.nome || "", usuario: r.usuario || "" };
  }

  function mapEntregavel(r) {
    return {
      id: r.id,
      tipo: r.tipo,
      nome: r.nome_arquivo || "",
      mime: r.mime || "",
      tamanho: Number(r.tamanho) || 0,
      url: r.url || "",
      caminho: r.caminho || "",
      criadoEm: r.criado_em || null,
      criadoPor: r.criado_por || "",
    };
  }

  function mapComentario(r) {
    return {
      id: r.id,
      texto: r.texto || "",
      criadoEm: r.criado_em || null,
      autor: r.criado_por || "",
      usuario: r.usuario || "",
    };
  }

  function mapProjeto(row) {
    const modelo = row.modelo;
    const temModelo = Array.isArray(modelo) ? modelo.length > 0 : !!(modelo && modelo.id);
    const comentarios = (row.comentarios || []).map(mapComentario).sort((a, b) => {
      const da = a.criadoEm || "";
      const db = b.criadoEm || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    return {
      id: row.id,
      nome: row.nome,
      descricao: row.descricao || "",
      responsavel: row.responsavel || "",
      responsavelUsuario: row.responsavel_usuario || "",
      equipe: (row.equipe || []).slice().sort(porOrdem).map(mapEquipe),
      cadastro: dataDia(row.data_cadastro) || dataDia(row.criado_em),
      inicio: dataDia(row.data_inicio),
      fim: dataDia(row.prazo),
      prazo: dataDia(row.prazo),
      status: row.status,
      prioridadeAlta: !!row.prioridade_alta,
      atrasado: !!row.atrasado,
      ordem: Number(row.ordem) || 0,
      criadoEm: row.criado_em,
      criadoPor: row.criado_por || "",
      acoes: (row.acoes || []).slice().sort(porOrdem).map(mapAcao),
      registros: (row.registros || []).slice().sort((a, b) => {
        const da = dataDia(a.data);
        const db = dataDia(b.data);
        if (da < db) return -1;
        if (da > db) return 1;
        return porOrdem(a, b);
      }).map(mapRegistro),
      entregaveis: (row.entregaveis || []).slice().sort(porOrdem).map(mapEntregavel),
      comentarios,
      tags: Array.isArray(row.tags) ? row.tags : [],
      modelo: temModelo,
    };
  }

  async function lerTags() {
    if (!sb) return { tags: [], ligacoes: [] };
    const tags = await sb.from("tags").select("id, nome, cor").order("nome");
    const ligacoes = await sb.from("projeto_tags").select("projeto_id, tag_id");
    return {
      tags: tags.error ? [] : (tags.data || []),
      ligacoes: ligacoes.error ? [] : (ligacoes.data || []),
    };
  }

  function aplicarTags(lista, catalogo) {
    const porId = new Map((catalogo.tags || []).map((t) => [Number(t.id), {
      id: Number(t.id),
      nome: t.nome || "",
      cor: t.cor || "#5c6bc0",
    }]));
    const porProjeto = new Map();
    for (const liga of catalogo.ligacoes || []) {
      const tag = porId.get(Number(liga.tag_id));
      if (!tag) continue;
      const pid = Number(liga.projeto_id);
      if (!porProjeto.has(pid)) porProjeto.set(pid, []);
      porProjeto.get(pid).push(tag);
    }
    return (lista || []).map((p) => ({ ...p, tags: porProjeto.get(Number(p.id)) || [] }));
  }

  function mapTemplate(row) {
    const bruto = row.itens;
    const nome = row.nome || "";
    if (Array.isArray(bruto)) {
      return {
        id: row.id, nome, projetoId: row.projeto_id, legado: true,
        descricao: "", responsavel: "", responsavelUsuario: "",
        prioridadeAlta: false, status: "A FAZER", equipe: [], acoes: bruto,
      };
    }
    const snap = bruto && typeof bruto === "object" ? bruto : {};
    return {
      id: row.id,
      nome,
      projetoId: row.projeto_id,
      legado: false,
      descricao: snap.descricao || "",
      responsavel: snap.responsavel || "",
      responsavelUsuario: snap.responsavelUsuario || "",
      prioridadeAlta: !!snap.prioridadeAlta,
      status: snap.status || "A FAZER",
      equipe: Array.isArray(snap.equipe) ? snap.equipe : [],
      acoes: Array.isArray(snap.acoes) ? snap.acoes : [],
    };
  }

  function avisarTela() {
    document.dispatchEvent(new Event("gestao-avisos"));
  }

  async function listarProjetos() {
    const res = await sb.from("projetos").select(SELECT_PROJETO).order("ordem", { ascending: true });
    exigir(res);
    const catalogo = await lerTags();
    return aplicarTags((res.data || []).map(mapProjeto), catalogo);
  }

  async function buscarProjeto(id) {
    const res = await sb.from("projetos").select(SELECT_PROJETO).eq("id", id).maybeSingle();
    exigir(res);
    if (!res.data) throw new Error("Projeto não encontrado.");
    const catalogo = await lerTags();
    return aplicarTags([mapProjeto(res.data)], catalogo)[0];
  }

  async function listarTags() {
    const catalogo = await lerTags();
    return catalogo.tags.map((t) => ({ id: Number(t.id), nome: t.nome || "", cor: t.cor || "#5c6bc0" }));
  }

  async function criarTag(nome, cor) {
    if (!eu.id) throw new Error("Entre de novo para criar a tag.");
    const res = await sb.from("tags").insert({
      dono: eu.id,
      nome: String(nome || "").trim().slice(0, 40),
      cor: cor || "#5c6bc0",
    }).select("id, nome, cor").single();
    exigir(res);
    return { id: Number(res.data.id), nome: res.data.nome, cor: res.data.cor || "#5c6bc0" };
  }

  async function marcarTag(projetoId, tagId) {
    const res = await sb.from("projeto_tags").insert({ projeto_id: Number(projetoId), tag_id: Number(tagId) });
    if (res.error && !/duplicate|already exists|23505/i.test(String(res.error.message || res.error.code || ""))) exigir(res);
  }

  async function removerTag(projetoId, tagId) {
    const res = await sb.from("projeto_tags").delete().eq("projeto_id", Number(projetoId)).eq("tag_id", Number(tagId));
    exigir(res);
  }

  async function apagarTag(tagId) {
    const res = await sb.from("tags").delete().eq("id", Number(tagId));
    exigir(res);
  }

  async function listarTemplates() {
    const res = await sb.from("projeto_modelos").select("id, nome, projeto_id, itens").order("nome");
    exigir(res);
    return (res.data || []).map(mapTemplate);
  }

  async function listarUsuarios() {
    const res = await sb.from("perfis").select("usuario, nome").order("nome");
    exigir(res);
    return res.data || [];
  }

  async function comentariosDe(projetoId) {
    const res = await sb.from("projeto_comentarios")
      .select("id, texto, criado_em, criado_por, usuario")
      .eq("projeto_id", projetoId)
      .order("criado_em", { ascending: true })
      .order("id", { ascending: true });
    exigir(res);
    return (res.data || []).map(mapComentario);
  }

  async function entregaveisDe(projetoId) {
    const res = await sb.from("projeto_entregaveis")
      .select("id, tipo, nome_arquivo, mime, tamanho, url, caminho, criado_em, criado_por")
      .eq("projeto_id", projetoId)
      .order("id");
    exigir(res);
    return (res.data || []).map(mapEntregavel);
  }

  async function avisarEquipe(projetoId, mensagem, detalhe) {
    try {
      const res = await sb.from("projetos")
        .select("responsavel_usuario, equipe:projeto_equipe(usuario)")
        .eq("id", projetoId)
        .maybeSingle();
      if (res.error || !res.data) return;
      const vistos = new Set();
      const euLogin = String(eu.usuario || "").trim().toLowerCase();
      const dest = [];
      const add = (login) => {
        const nome = String(login || "").trim();
        const chave = nome.toLowerCase();
        if (!chave || chave === euLogin || vistos.has(chave)) return;
        vistos.add(chave);
        dest.push(nome);
      };
      for (const pessoa of res.data.equipe || []) add(pessoa.usuario);
      add(res.data.responsavel_usuario);
      if (!dest.length) return;
      const aviso = await sb.from("avisos").insert(dest.map((destinatario) => ({
        destinatario,
        projeto_id: Number(projetoId),
        mensagem: String(mensagem || "").slice(0, 500),
        detalhe: String(detalhe || "").slice(0, 500),
      })));
      if (!aviso.error) avisarTela();
    } catch (_) { /* o aviso não desfaz a ação */ }
  }

  async function salvar(body) {
    const res = await sb.rpc("salvar_projeto", { payload: body });
    exigir(res);
    const projeto = await buscarProjeto(res.data);
    const templates = await listarTemplates();
    avisarTela();
    return { success: true, projeto, templates };
  }

  async function mover(body) {
    const itens = Array.isArray(body.itens) ? body.itens : [];
    if (!itens.length) throw new Error("Informe os projetos para mover.");
    let n = 0;
    for (const item of itens) {
      const id = Number(item.id);
      const status = String(item.status || "");
      const ordem = Number(item.ordem);
      if (!id || !ROTULO[status] || !Number.isFinite(ordem)) continue;
      const antes = await sb.from("projetos").select("nome, status").eq("id", id).maybeSingle();
      exigir(antes);
      if (!antes.data) continue;
      const upd = await sb.from("projetos").update({
        status,
        ordem: Math.max(0, Math.round(ordem)),
        atualizado_em: new Date().toISOString(),
      }).eq("id", id);
      exigir(upd);
      n += 1;
      if (antes.data.status !== status) {
        await avisarEquipe(id, `O projeto ${antes.data.nome} foi para ${ROTULO[status]}.`);
      }
    }
    if (!n) throw new Error("Nenhum projeto válido para mover.");
    return { success: true, atualizados: n };
  }

  async function marcar(body) {
    const id = Number(body.id);
    if (!id) throw new Error("Ação obrigatória.");
    const feito = body.feito === true || body.feito === 1 || body.feito === "1";
    const atual = await sb.from("projeto_acoes")
      .select("id, texto, projeto_id, projetos(nome)")
      .eq("id", id)
      .maybeSingle();
    exigir(atual);
    if (!atual.data) throw new Error("Ação não encontrada.");
    const upd = await sb.from("projeto_acoes").update({ feito }).eq("id", id);
    exigir(upd);
    const nome = (atual.data.projetos && atual.data.projetos.nome) || "projeto";
    const txt = String(atual.data.texto || "").slice(0, 180);
    const msg = feito
      ? `No projeto ${nome}, a ação "${txt}" foi concluída.`
      : `No projeto ${nome}, a ação "${txt}" foi reaberta.`;
    await avisarEquipe(atual.data.projeto_id, msg);
    return { success: true, id, projetoId: atual.data.projeto_id, feito };
  }

  async function comentar(body) {
    const id = Number(body.id);
    const texto = String(body.texto || "").trim().slice(0, 1000);
    if (!id) throw new Error("Salve o projeto antes de comentar.");
    if (!texto) throw new Error("Escreva o comentário.");
    const projeto = await sb.from("projetos").select("id, nome").eq("id", id).maybeSingle();
    exigir(projeto);
    if (!projeto.data) throw new Error("Projeto não encontrado.");
    const ins = await sb.from("projeto_comentarios").insert({
      projeto_id: id,
      texto,
      criado_por: eu.nome || eu.usuario,
      usuario: eu.usuario,
    });
    exigir(ins);
    await avisarEquipe(
      id,
      `Novo comentário no projeto ${projeto.data.nome}.`,
      `Por ${eu.nome || eu.usuario}. ${texto.slice(0, 180)}`,
    );
    return { success: true, comentarios: await comentariosDe(id) };
  }

  async function excluirComentario(body) {
    const id = Number(body.id);
    const comentarioId = Number(body.comentarioId);
    if (!id || !comentarioId) throw new Error("Informe o comentário.");
    const atual = await sb.from("projeto_comentarios")
      .select("id, criado_por, usuario")
      .eq("projeto_id", id)
      .eq("id", comentarioId)
      .maybeSingle();
    exigir(atual);
    if (!atual.data) throw new Error("Comentário não encontrado.");
    const dono = String(atual.data.usuario || "").trim().toLowerCase();
    const nome = String(atual.data.criado_por || "").trim().toLowerCase();
    const login = String(eu.usuario || "").trim().toLowerCase();
    const euNome = String(eu.nome || "").trim().toLowerCase();
    const pode = dono === login || nome === euNome || nome === login;
    if (!pode) throw new Error("Só quem escreveu pode apagar o comentário.");
    const del = await sb.from("projeto_comentarios").delete().eq("projeto_id", id).eq("id", comentarioId);
    exigir(del);
    return { success: true, comentarios: await comentariosDe(id) };
  }

  function bytesDeDataUrl(data) {
    if (!data || typeof data !== "string") throw new Error("Arquivo vazio.");
    const virgula = data.indexOf(",");
    const raw = data.startsWith("data:") && virgula >= 0 ? data.slice(virgula + 1) : data;
    const limpo = raw.replace(/\s/g, "");
    if (!limpo) throw new Error("Arquivo vazio.");
    let bin;
    try { bin = atob(limpo); } catch (_) { throw new Error("Arquivo inválido."); }
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
    if (!buf.length) throw new Error("Arquivo vazio.");
    if (buf.length > 3 * 1024 * 1024) throw new Error("Anexo maior que 3 MB. Reduza o arquivo antes de enviar.");
    return buf;
  }

  function detectarArquivo(buf) {
    if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return { tipo: "PDF", mime: "application/pdf" };
    }
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return { tipo: "IMAGEM", mime: "image/jpeg" };
    }
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { tipo: "IMAGEM", mime: "image/png" };
    }
    if (buf.length >= 6 && String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === "GIF8") {
      return { tipo: "IMAGEM", mime: "image/gif" };
    }
    if (
      buf.length >= 12
      && String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === "RIFF"
      && String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) === "WEBP"
    ) {
      return { tipo: "IMAGEM", mime: "image/webp" };
    }
    return null;
  }

  function nomeArquivo(nome, mime) {
    const base = String(nome || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .replace(/[^\w.\- ()\u00C0-\u024F]+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 80);
    if (base) return base;
    const ext = mime === "application/pdf" ? "pdf"
      : mime === "image/png" ? "png"
        : mime === "image/gif" ? "gif"
          : mime === "image/webp" ? "webp"
            : "jpg";
    return `entregavel.${ext}`;
  }

  async function gravarEntregavel(body) {
    const id = Number(body.id);
    if (!id) throw new Error("Salve o projeto antes de anexar.");
    const buf = bytesDeDataUrl(body.data);
    const arq = detectarArquivo(buf);
    if (!arq) throw new Error("Envie um PDF ou uma imagem JPG, PNG, GIF ou WEBP.");
    const nome = nomeArquivo(body.nome, arq.mime);
    const atuais = await entregaveisDe(id);
    const pdfs = atuais.filter((item) => item.tipo === "PDF").length;
    const imagens = atuais.filter((item) => item.tipo === "IMAGEM").length;
    if (pdfs + imagens >= 12) throw new Error("Este projeto já tem 12 entregáveis.");
    if (arq.tipo === "PDF" && pdfs >= 5) throw new Error("Este projeto já tem 5 PDFs.");
    if (arq.tipo === "IMAGEM" && imagens >= 10) throw new Error("Este projeto já tem 10 fotos.");
    const caminho = `${id}/${Date.now()}-${nome}`;
    const up = await sb.storage.from("entregaveis").upload(caminho, buf, {
      contentType: arq.mime,
      upsert: false,
    });
    if (up.error) throw falha(up.error);
    const ins = await sb.from("projeto_entregaveis").insert({
      projeto_id: id,
      tipo: arq.tipo,
      nome_arquivo: nome,
      mime: arq.mime,
      tamanho: buf.length,
      caminho,
      criado_por: eu.nome || eu.usuario,
    });
    if (ins.error) {
      await sb.storage.from("entregaveis").remove([caminho]);
      throw falha(ins.error);
    }
    const projeto = await sb.from("projetos").select("nome").eq("id", id).maybeSingle();
    const titulo = (projeto.data && projeto.data.nome) || "projeto";
    await avisarEquipe(id, `O projeto ${titulo} recebeu o arquivo ${nome}.`);
    return { success: true, entregaveis: await entregaveisDe(id) };
  }

  function normalizarLink(valor) {
    const bruto = String(valor || "").trim();
    if (!bruto) throw new Error("Cole o link do PDF.");
    if (bruto.length > 2000) throw new Error("O link passa de 2000 caracteres.");
    let u;
    try { u = new URL(bruto); } catch (_) { throw new Error("Link inválido."); }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new Error("O link precisa começar com http ou https.");
    }
    let base = "";
    try { base = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || ""); }
    catch (_) { base = u.pathname.split("/").filter(Boolean).pop() || ""; }
    const nome = (/\.pdf$/i.test(base) ? base : (u.hostname || "PDF")).slice(0, 200);
    return { url: u.toString(), nome };
  }

  async function gravarLink(body) {
    const id = Number(body.id);
    if (!id) throw new Error("Salve o projeto antes de anexar.");
    const link = normalizarLink(body.url);
    const atuais = await entregaveisDe(id);
    if (atuais.filter((item) => item.tipo === "LINK").length >= 10) {
      throw new Error("Este projeto já tem 10 links.");
    }
    const ins = await sb.from("projeto_entregaveis").insert({
      projeto_id: id,
      tipo: "LINK",
      nome_arquivo: link.nome,
      mime: "text/uri-list",
      tamanho: 0,
      url: link.url,
      criado_por: eu.nome || eu.usuario,
    });
    exigir(ins);
    const projeto = await sb.from("projetos").select("nome").eq("id", id).maybeSingle();
    const titulo = (projeto.data && projeto.data.nome) || "projeto";
    await avisarEquipe(id, `O projeto ${titulo} recebeu um link: ${link.nome}.`);
    return { success: true, entregaveis: await entregaveisDe(id) };
  }

  async function excluirEntregavel(body) {
    const id = Number(body.id);
    const entregavelId = Number(body.entregavelId);
    if (!id || !entregavelId) throw new Error("Informe o entregável.");
    const atual = await sb.from("projeto_entregaveis")
      .select("id, caminho")
      .eq("projeto_id", id)
      .eq("id", entregavelId)
      .maybeSingle();
    exigir(atual);
    if (!atual.data) throw new Error("Entregável não encontrado.");
    if (atual.data.caminho) {
      await sb.storage.from("entregaveis").remove([atual.data.caminho]);
    }
    const del = await sb.from("projeto_entregaveis").delete().eq("projeto_id", id).eq("id", entregavelId);
    exigir(del);
    return { success: true, entregaveis: await entregaveisDe(id) };
  }

  async function excluirProjeto(idBruto) {
    const id = Number(idBruto);
    if (!id) throw new Error("Projeto obrigatório.");
    const arquivos = await entregaveisDe(id);
    const caminhos = arquivos.map((item) => item.caminho).filter(Boolean);
    if (caminhos.length) await sb.storage.from("entregaveis").remove(caminhos);
    const del = await sb.from("projetos").delete().eq("id", id);
    exigir(del);
    return { success: true, templates: await listarTemplates() };
  }

  async function baixarEntregavel(item) {
    if (!item || !item.caminho) throw new Error("Não foi possível abrir o entregável.");
    const res = await sb.storage.from("entregaveis").download(item.caminho);
    if (res.error || !res.data) throw new Error("Não foi possível abrir o entregável.");
    return res.data;
  }

  function normalizarEtapas(bruto) {
    const lista = Array.isArray(bruto) ? bruto : [];
    const vistas = new Set();
    const saida = [];
    for (const item of lista) {
      const nome = String((item && item.nome) || "").trim().slice(0, 80);
      const id = String((item && item.id) || "").replace(/[^a-z0-9]/gi, "").slice(0, 20);
      const cor = String((item && item.cor) || "").toLowerCase();
      const chave = nome.toLowerCase();
      if (!nome || !id || vistas.has(chave)) continue;
      vistas.add(chave);
      saida.push({ id, nome, cor: /^#[0-9a-f]{6}$/.test(cor) ? cor : "#607d8b" });
      if (saida.length >= 24) break;
    }
    return saida;
  }

  async function carregarEtapas() {
    if (!sb || !eu.id) return [];
    const res = await sb.from("perfis").select("etapas").eq("id", eu.id).maybeSingle();
    if (res.error) return [];
    return normalizarEtapas(res.data && res.data.etapas);
  }

  async function salvarEtapas(lista) {
    if (!sb || !eu.id) throw new Error("Entre de novo para gravar a etapa.");
    const etapas = normalizarEtapas(lista);
    const res = await sb.from("perfis").update({ etapas }).eq("id", eu.id);
    if (res.error) {
      const bruto = String(res.error.message || "");
      if (/etapas|schema cache|column/i.test(bruto)) {
        throw new Error("Falta a coluna das etapas. No SQL Editor, rode: alter table public.perfis add column if not exists etapas jsonb not null default '[]'::jsonb;");
      }
      throw falha(res.error);
    }
    return etapas;
  }

  async function carregarEu() {
    const sessao = await sb.auth.getUser();
    const user = sessao.data && sessao.data.user;
    if (!user) return null;
    const res = await sb.from("perfis").select("id, nome, usuario").eq("id", user.id).maybeSingle();
    if (res.error || !res.data) return null;
    eu.id = res.data.id;
    eu.nome = res.data.nome || "";
    eu.usuario = res.data.usuario || "";
    return { id: eu.id, nome: eu.nome, usuario: eu.usuario };
  }

  async function listarConvites(projetoId) {
    const res = await sb.from("projeto_convites")
      .select("id, email, token, aceito_em")
      .eq("projeto_id", Number(projetoId))
      .order("criado_em", { ascending: true });
    exigir(res);
    return (res.data || []).map((c) => ({
      id: c.id,
      email: c.email,
      token: c.token,
      cadastrado: !!c.aceito_em,
    }));
  }

  async function convidar(projetoId, email) {
    const res = await sb.rpc("convidar_projeto", { p_id: Number(projetoId), p_email: email });
    exigir(res);
    return res.data || {};
  }

  async function revogarConvite(id) {
    const res = await sb.rpc("revogar_convite", { p_convite: Number(id) });
    exigir(res);
  }

  async function verConvite(token) {
    const res = await sb.rpc("ver_convite", { p_token: token });
    if (res.error || !res.data) return null;
    return res.data;
  }

  async function aceitarConvite(token) {
    const res = await sb.rpc("aceitar_convite", { p_token: token });
    exigir(res);
    return res.data || {};
  }

  async function aceitarPendentes() {
    const res = await sb.rpc("aceitar_convites_pendentes");
    if (res.error) return [];
    return res.data || [];
  }

  async function chamar(method, acao, opts) {
    const body = (opts && opts.body) || {};
    const query = (opts && opts.query) || {};
    if (method === "GET" && acao === "listar") return { projetos: await listarProjetos() };
    if (method === "GET" && acao === "templates") return { templates: await listarTemplates() };
    if (method === "GET" && acao === "usuarios") return { usuarios: await listarUsuarios() };
    if (method === "POST" && acao === "salvar") return salvar(body);
    if (method === "POST" && acao === "mover") return mover(body);
    if (method === "POST" && acao === "marcar") return marcar(body);
    if (method === "POST" && acao === "comentar") return comentar(body);
    if (method === "POST" && acao === "excluirComentario") return excluirComentario(body);
    if (method === "POST" && acao === "entregavel") return gravarEntregavel(body);
    if (method === "POST" && acao === "entregavelLink") return gravarLink(body);
    if (method === "POST" && acao === "excluirEntregavel") return excluirEntregavel(body);
    if (method === "DELETE" && acao === "projeto") return excluirProjeto(query.id || body.id);
    throw new Error("Ação não disponível.");
  }

  root.GestaoDB = {
    usar,
    eu,
    chamar,
    baixarEntregavel,
    carregarEu,
    carregarEtapas,
    salvarEtapas,
    listarTags,
    criarTag,
    marcarTag,
    removerTag,
    apagarTag,
    listarConvites,
    convidar,
    revogarConvite,
    verConvite,
    aceitarConvite,
    aceitarPendentes,
  };
})(window);
