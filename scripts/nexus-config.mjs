#!/usr/bin/env node
// nexus-config : exporte, vérifie et applique la configuration de Nexus Repository Manager 3 (API REST).
// Aucune dépendance : Node 18 ou plus.
//
// En pratique, passer par scripts/nexus-config.sh : il demande les mots de passe sans les afficher et enchaîne les étapes.
//
//   node scripts/nexus-config.mjs audit  [--out fichier]   LECTURE SEULE, en une fois : export (etat-actuel.json), check
//                                                          avec sondes du reverse proxy, puis simulation de apply --update
//   node scripts/nexus-config.mjs export [--out fichier]   lit un Nexus et écrit son état au format du fichier de config
//   node scripts/nexus-config.mjs check  [--public URL]    compare un Nexus au fichier de config (LECTURE SEULE)
//   node scripts/nexus-config.mjs apply  [--update] [--dry-run]
//                                                          crée ce qui manque ; avec --update corrige aussi les écarts
//
// Options : --url URL (ou NEXUS_URL)   --config fichier (défaut config/nexus-config.json)
//           --public [URL] : sondes HTTP anonymes et certificat TLS via le reverse proxy (adresse du contrat, ou URL donnée)
// Adresse de Nexus : --url, sinon NEXUS_URL, sinon (lecture seule et --dry-run uniquement) contract.publicUrl du fichier
// de config. Un apply RÉEL exige l'adresse explicite : garde-fou contre une application involontaire sur la production.
// Environnement : NEXUS_ADMIN_USER (admin), NEXUS_ADMIN_PASSWORD, et la variable `passwordEnv` de chaque utilisateur.
//
// Règles : check et audit ne modifient rien ; apply ne touche jamais à un élément existant sans --update ; le contrat de
// Nexus avec le reverse proxy (adresse publique, sondes) est dans la section "contract" du fichier de config.
// Le contrat de licence (CLUF) n'est jamais accepté par cet outil.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tls from "node:tls";

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--update") o.update = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--public") o.public = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else if (["--url", "--config", "--out"].includes(a)) o[a.slice(2)] = argv[++i];
    else if (a.startsWith("--")) throw new Error(`option inconnue : ${a}`);
    else o._.push(a);
  }
  return o;
}

function usage() {
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = src.findIndex((l) => !l.startsWith("//"));
  return src.slice(0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n");
}

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`Erreur : ${e.message}`); process.exit(2); }
const cmd = opts._[0];
if (opts.help || !["export", "check", "apply", "audit"].includes(cmd)) {
  console.log(usage());
  process.exit(opts.help ? 0 : 2);
}

const CONFIG_PATH = opts.config ?? fileURLToPath(new URL("../config/nexus-config.json", import.meta.url));
const READ_ONLY = cmd !== "apply" || !!opts.dryRun;
let NEXUS_URL = opts.url ?? process.env.NEXUS_URL ?? "";
if (!NEXUS_URL && READ_ONLY && existsSync(CONFIG_PATH)) {
  try { NEXUS_URL = JSON.parse(readFileSync(CONFIG_PATH, "utf8")).contract?.publicUrl ?? ""; } catch { /* config illisible : erreur plus bas */ }
}
NEXUS_URL = NEXUS_URL.replace(/\/$/, "");
const ADMIN_USER = process.env.NEXUS_ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.NEXUS_ADMIN_PASSWORD ?? "";
if (!NEXUS_URL) {
  console.error(READ_ONLY
    ? "Erreur : adresse de Nexus manquante (--url, NEXUS_URL, ou contract.publicUrl dans le fichier de config)."
    : "Erreur : pour appliquer, l'adresse de Nexus doit être donnée explicitement (--url ou NEXUS_URL) : garde-fou contre une application involontaire sur la production.");
  process.exit(2);
}
if (!ADMIN_PASSWORD) { console.error("Erreur : NEXUS_ADMIN_PASSWORD manquant."); process.exit(2); }

// ---------------------------------------------------------------- API
const BASE = `${NEXUS_URL}/service/rest/v1`;
const AUTH = "Basic " + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString("base64");

async function api(method, path, body, { allow404 = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (res.status === 404 && allow404) return null;
  if (!res.ok) {
    const detail = data == null ? "" : " : " + (typeof data === "string" ? data : JSON.stringify(data)).slice(0, 300);
    throw new Error(`${method} ${path} -> HTTP ${res.status}${detail}`);
  }
  return data;
}

// Écriture : affichée sans être envoyée en --dry-run.
async function write(method, path, body) {
  if (opts.dryRun) { console.log(`      [dry-run] ${method} ${path}`); return null; }
  return api(method, path, body);
}

// ---------------------------------------------------------------- compte rendu
let problems = 0;
const ok = (m) => console.log(`  [OK]      ${m}`);
const gap = (m) => { problems++; console.log(`  [ÉCART]   ${m}`); };
const absent = (m) => { problems++; console.log(`  [ABSENT]  ${m}`); };
const extra = (m) => console.log(`  [EN PLUS] ${m}`);
const did = (m) => console.log(`  [FAIT]    ${m}`);
const title = (m) => console.log(`\n${m}`);

// ---------------------------------------------------------------- formats et normalisation
const canonFormat = (f) => (f === "maven2" ? "maven" : f);
const FORMATS = { maven: { priv: "maven2" }, nuget: { priv: "nuget" }, docker: { priv: "docker" } };

const lc = (v) => (typeof v === "string" ? v.toLowerCase() : v);
function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify((a ?? []).map(lc)) === JSON.stringify((b ?? []).map(lc));
  if (typeof a === "string" && typeof b === "string") return lc(a.replace(/\/$/, "")) === lc(b.replace(/\/$/, ""));
  return (a ?? null) === (b ?? null);
}

// État réel (réponse de l'API) -> même forme que le fichier de config.
function normalize(a) {
  const m = {
    name: a.name, format: canonFormat(a.format), type: a.type, online: a.online,
    blobStore: a.storage?.blobStoreName, strictContentTypeValidation: a.storage?.strictContentTypeValidation,
  };
  if (a.storage?.writePolicy) m.writePolicy = String(a.storage.writePolicy).toLowerCase();
  if (a.maven) { m.versionPolicy = a.maven.versionPolicy; m.layoutPolicy = a.maven.layoutPolicy; }
  if (a.proxy) m.remoteUrl = a.proxy.remoteUrl;
  if (a.group) m.members = a.group.memberNames;
  if (a.docker) {
    m.pathRouting = !!a.docker.pathEnabled;
    m.anonymousPull = !a.docker.forceBasicAuth;
    m.httpPort = a.docker.httpPort ?? null;
  }
  return m;
}

const COMPARED = ["blobStore", "online", "strictContentTypeValidation", "writePolicy", "versionPolicy", "layoutPolicy",
  "remoteUrl", "members", "pathRouting", "anonymousPull", "httpPort"];

function diffRepo(want, got) {
  const out = [];
  for (const k of COMPARED) {
    if (!(k in want)) continue;
    if (!same(want[k], got[k])) out.push({ key: k, want: want[k], got: got[k] ?? null });
  }
  // Docker par chemin sans port explicite : aucun connecteur de port ne doit rester.
  if (want.format === "docker" && want.pathRouting && !("httpPort" in want) && got.httpPort != null) {
    out.push({ key: "httpPort", want: null, got: got.httpPort });
  }
  return out;
}

// Fichier de config -> corps de création de l'API.
function buildBody(r) {
  const blob = r.blobStore ?? r.name;
  const body = { name: r.name, online: r.online ?? true };
  const strict = r.strictContentTypeValidation ?? true;
  if (r.type === "group") {
    body.storage = { blobStoreName: blob, strictContentTypeValidation: strict };
    body.group = { memberNames: r.members };
  } else {
    body.storage = { blobStoreName: blob, strictContentTypeValidation: strict, writePolicy: r.writePolicy ?? "allow" };
  }
  if (r.type === "proxy") {
    body.proxy = {
      remoteUrl: r.remoteUrl,
      contentMaxAge: r.contentMaxAge ?? (r.format === "maven" && (r.versionPolicy ?? "RELEASE") === "RELEASE" ? -1 : 1440),
      metadataMaxAge: r.metadataMaxAge ?? 1440,
    };
    body.negativeCache = { enabled: true, timeToLive: 1440 };
    body.httpClient = { blocked: false, autoBlock: true };
  }
  if (r.format === "maven" && r.type !== "group") {
    body.maven = {
      versionPolicy: r.versionPolicy ?? "RELEASE",
      layoutPolicy: r.layoutPolicy ?? (r.type === "proxy" ? "PERMISSIVE" : "STRICT"),
      contentDisposition: "ATTACHMENT",
    };
  }
  if (r.format === "nuget" && r.type === "proxy") body.nugetProxy = { queryCacheItemMaxAge: 3600, nugetVersion: "V3" };
  if (r.format === "docker") {
    body.docker = { v1Enabled: false, forceBasicAuth: !(r.anonymousPull ?? false), pathEnabled: !!r.pathRouting };
    if (r.httpPort != null) body.docker.httpPort = r.httpPort;
    if (r.type === "proxy") body.dockerProxy = { indexType: /docker\.io/.test(r.remoteUrl ?? "") ? "HUB" : "REGISTRY" };
  }
  return body;
}

// Mise à jour ciblée : seuls les champs en écart sont modifiés, tout le reste du dépôt (espace de stockage,
// règles de nettoyage, authentification du proxy...) est conservé tel quel.
function patchFor(diffs) {
  const patch = {};
  const set = (path, value) => {
    let o = patch;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path.at(-1)] = value;
  };
  for (const { key, want } of diffs) {
    if (key === "blobStore") set(["storage", "blobStoreName"], want);
    else if (key === "online") set(["online"], want);
    else if (key === "strictContentTypeValidation") set(["storage", "strictContentTypeValidation"], want);
    else if (key === "writePolicy") set(["storage", "writePolicy"], want);
    else if (key === "versionPolicy") set(["maven", "versionPolicy"], want);
    else if (key === "layoutPolicy") set(["maven", "layoutPolicy"], want);
    else if (key === "remoteUrl") set(["proxy", "remoteUrl"], want);
    else if (key === "members") set(["group", "memberNames"], want);
    else if (key === "pathRouting") set(["docker", "pathEnabled"], want);
    else if (key === "anonymousPull") set(["docker", "forceBasicAuth"], !want);
    else if (key === "httpPort") set(["docker", "httpPort"], want);
  }
  return patch;
}

function deepMerge(base, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

// ---------------------------------------------------------------- privilèges
const ACTIONS = "browse|read|edit|add|delete|\\*";
const PRIV_RE = new RegExp(`^nx-repository-view-([a-z0-9*]+)-(.+)-(${ACTIONS})$`);

function privilegeNames(role, repoFormat) {
  const names = new Set(role.otherPrivileges ?? []);
  for (const g of role.privileges ?? []) {
    const repos = g.repositories === "*" ? ["*"] : g.repositories;
    for (const repo of repos) {
      const fmt = repo === "*" ? "*" : FORMATS[repoFormat(repo)]?.priv;
      if (!fmt) throw new Error(`rôle ${role.id} : dépôt inconnu « ${repo} »`);
      for (const act of g.actions) names.add(`nx-repository-view-${fmt}-${repo}-${act}`);
    }
  }
  return [...names].sort();
}

// Inverse (pour export) : liste de privilèges -> groupes {repositories, actions}.
function groupPrivileges(privs) {
  const byRepo = new Map();
  const other = [];
  for (const p of privs) {
    const m = PRIV_RE.exec(p);
    if (!m) { other.push(p); continue; }
    const key = m[2];
    if (!byRepo.has(key)) byRepo.set(key, new Set());
    byRepo.get(key).add(m[3]);
  }
  const byActions = new Map();
  for (const [repo, acts] of byRepo) {
    const k = [...acts].sort().join(",");
    if (!byActions.has(k)) byActions.set(k, []);
    byActions.get(k).push(repo);
  }
  const groups = [...byActions].map(([k, repos]) => ({
    repositories: repos.length === 1 && repos[0] === "*" ? "*" : repos.sort(),
    actions: k.split(","),
  }));
  return { groups, other: other.sort() };
}

// ---------------------------------------------------------------- lecture de l'état réel
async function readLive() {
  const live = { repos: {}, blobStores: new Set() };
  for (const s of await api("GET", "/repositories")) {
    const fmt = canonFormat(s.format);
    if (!FORMATS[fmt]) { live.repos[s.name] = { unsupported: true, name: s.name, format: s.format, type: s.type }; continue; }
    const raw = await api("GET", `/repositories/${fmt}/${s.type}/${s.name}`);
    live.repos[s.name] = { raw, model: normalize(raw) };
  }
  for (const b of await api("GET", "/blobstores")) live.blobStores.add(b.name);
  live.realms = await api("GET", "/security/realms/active");
  live.anonymous = await api("GET", "/security/anonymous");
  const users = await api("GET", "/security/users");
  live.users = Object.fromEntries(users.filter((u) => u.source === "default").map((u) => [u.userId, u]));
  live.roles = Object.fromEntries((await api("GET", "/security/roles")).map((r) => [r.id, r]));
  live.eula = await api("GET", "/system/eula", undefined, { allow404: true });
  return live;
}

// ---------------------------------------------------------------- fichier de config
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error(`fichier de config introuvable : ${CONFIG_PATH}`);
  const c = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const names = new Set();
  for (const r of c.repositories ?? []) {
    if (names.has(r.name)) throw new Error(`dépôt en double : ${r.name}`);
    names.add(r.name);
    if (!FORMATS[r.format]) throw new Error(`${r.name} : format non géré « ${r.format} » (maven, nuget, docker)`);
    if (!["hosted", "proxy", "group"].includes(r.type)) throw new Error(`${r.name} : type invalide « ${r.type} »`);
    if (r.type === "proxy" && !r.remoteUrl) throw new Error(`${r.name} : remoteUrl manquant`);
    if (r.type === "group" && !r.members?.length) throw new Error(`${r.name} : members manquant`);
  }
  for (const r of c.repositories ?? []) for (const m of r.members ?? []) {
    if (!names.has(m)) throw new Error(`${r.name} : membre inconnu « ${m} »`);
  }
  return c;
}

const repoFormatOf = (cfg) => (name) => cfg.repositories.find((r) => r.name === name)?.format;
const envPassword = (u) => (u.passwordEnv ? process.env[u.passwordEnv] : undefined);

// ---------------------------------------------------------------- sondes publiques (reverse proxy)
function tlsDaysLeft(host, port) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername: host, timeout: 10000 }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000));
    });
    s.on("error", reject);
    s.on("timeout", () => { s.destroy(); reject(new Error("délai dépassé")); });
  });
}

async function probes(cfg) {
  // Les sondes envoient des requêtes HTTP anonymes : seulement si --public est demandé, jamais par défaut.
  if (!opts.public) {
    title("Reverse proxy");
    console.log("  (sondes ignorées : ajouter --public pour tester l'adresse du contrat, ou --public URL pour une autre)");
    return;
  }
  const base = (opts.public === true ? cfg.contract?.publicUrl ?? "" : opts.public).replace(/\/$/, "");
  title(`Reverse proxy (${base || "aucune adresse publique"})`);
  if (!base) { console.log("  (ignoré : pas d'adresse publique, voir contract.publicUrl)"); return; }
  const u = new URL(base);
  if (u.protocol === "https:") {
    try {
      const days = await tlsDaysLeft(u.hostname, Number(u.port || 443));
      if (days < 14) gap(`certificat TLS : expire dans ${days} jour(s)`); else ok(`certificat TLS valide encore ${days} jour(s)`);
    } catch (e) { gap(`certificat TLS : ${e.message}`); }
  }
  for (const p of cfg.contract?.probes ?? []) {
    const label = p.description ?? p.path;
    try {
      const res = await fetch(base + p.path, { redirect: "manual", signal: AbortSignal.timeout(20000) });
      await res.arrayBuffer();
      if (p.expect.includes(res.status)) ok(`${label} (HTTP ${res.status})`);
      else gap(`${label} : HTTP ${res.status}, attendu ${p.expect.join(" ou ")}`);
    } catch (e) { gap(`${label} : ${e.cause?.code ?? e.message}`); }
  }
}

// ---------------------------------------------------------------- check
async function check() {
  const cfg = loadConfig();
  const live = await readLive();
  const fmtOf = repoFormatOf(cfg);

  title(`Nexus ${NEXUS_URL}`);
  if (live.eula) (live.eula.accepted ? ok("CLUF accepté") : gap("CLUF non accepté (à faire par l'utilisateur dans l'interface)"));

  title("Dépôts");
  for (const r of cfg.repositories) {
    const l = live.repos[r.name];
    if (!l) { absent(`${r.name} (${r.format} ${r.type})`); continue; }
    if (l.unsupported) { gap(`${r.name} : format non géré par l'outil (${l.format})`); continue; }
    if (l.model.format !== r.format || l.model.type !== r.type) {
      gap(`${r.name} : ${l.model.format} ${l.model.type} au lieu de ${r.format} ${r.type}`); continue;
    }
    const d = diffRepo(r, l.model);
    if (!d.length) ok(`${r.name} (${r.format} ${r.type})`);
    else gap(`${r.name} : ${d.map((x) => `${x.key} = ${JSON.stringify(x.got)}, attendu ${JSON.stringify(x.want)}`).join(" ; ")}`);
  }
  for (const name of Object.keys(live.repos)) if (!cfg.repositories.some((r) => r.name === name)) extra(`${name} (absent du fichier de config)`);

  title("Sécurité");
  if (cfg.realms) {
    const w = [...cfg.realms].sort(), g = [...live.realms].sort();
    if (same(w, g)) ok(`realms actifs : ${g.join(", ")}`); else gap(`realms actifs : ${g.join(", ")} ; attendu ${w.join(", ")}`);
  }
  for (const role of cfg.roles ?? []) {
    const l = live.roles[role.id];
    const want = privilegeNames(role, fmtOf);
    if (!l) { absent(`rôle ${role.id}`); continue; }
    const got = [...(l.privileges ?? [])].sort();
    const missing = want.filter((p) => !got.includes(p)), more = got.filter((p) => !want.includes(p));
    if (!missing.length && !more.length) ok(`rôle ${role.id} (${got.length} privilèges)`);
    else gap(`rôle ${role.id} : ${missing.length ? "manque " + missing.join(", ") : ""}${missing.length && more.length ? " ; " : ""}${more.length ? "en trop " + more.join(", ") : ""}`);
  }
  if (cfg.anonymous) {
    const a = live.anonymous;
    const au = live.users[cfg.anonymous.userId ?? "anonymous"] ?? (await api("GET", "/security/users?userId=anonymous"))?.find?.((u) => u.userId === "anonymous");
    const roles = au?.roles ?? [];
    if (!!a.enabled !== !!cfg.anonymous.enabled) gap(`accès anonyme : ${a.enabled ? "activé" : "désactivé"}, attendu ${cfg.anonymous.enabled ? "activé" : "désactivé"}`);
    else ok(`accès anonyme ${a.enabled ? "activé" : "désactivé"}`);
    if (cfg.anonymous.enabled) {
      if (same([...roles].sort(), [...(cfg.anonymous.roles ?? [])].sort())) ok(`utilisateur anonymous : rôles ${roles.join(", ")}`);
      else gap(`utilisateur anonymous : rôles ${roles.join(", ") || "(aucun)"}, attendu ${(cfg.anonymous.roles ?? []).join(", ")}`);
    }
  }
  for (const u of cfg.users ?? []) {
    const l = live.users[u.userId];
    if (!l) { absent(`utilisateur ${u.userId}`); continue; }
    if (same([...l.roles].sort(), [...u.roles].sort()) && l.status === "active") ok(`utilisateur ${u.userId} (rôles ${l.roles.join(", ")})`);
    else gap(`utilisateur ${u.userId} : rôles ${l.roles.join(", ") || "(aucun)"}, statut ${l.status} ; attendu ${u.roles.join(", ")}, active`);
  }

  await probes(cfg);

  console.log(`\n${problems === 0 ? "Conforme au fichier de config." : `${problems} écart(s) ou élément(s) absent(s).`}`);
  return problems === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- apply
async function apply() {
  const cfg = loadConfig();
  const live = await readLive();
  const fmtOf = repoFormatOf(cfg);
  const upd = !!opts.update;
  let created = 0, updated = 0, left = 0;

  title(`Nexus ${NEXUS_URL}${opts.dryRun ? "  (simulation : rien n'est modifié)" : ""}${upd ? "  (--update : les écarts sont corrigés)" : ""}`);
  if (live.eula && !live.eula.accepted) console.log("  ! CLUF non accepté : Nexus refusera les requêtes Docker tant que l'utilisateur ne l'a pas accepté.");

  title("Dépôts");
  const order = [...cfg.repositories].sort((a, b) => (a.type === "group") - (b.type === "group"));
  for (const r of order) {
    const l = live.repos[r.name];
    if (!l) {
      const blob = r.blobStore ?? r.name;
      if (!live.blobStores.has(blob)) {
        did(`espace de stockage ${blob}`);
        await write("POST", "/blobstores/file", { name: blob, path: blob });
        live.blobStores.add(blob);
      }
      did(`création de ${r.name} (${r.format} ${r.type})`);
      await write("POST", `/repositories/${r.format}/${r.type}`, buildBody(r));
      created++;
      continue;
    }
    if (l.unsupported) { gap(`${r.name} : format non géré, ignoré`); continue; }
    const d = diffRepo(r, l.model);
    if (!d.length) { ok(`${r.name}`); continue; }
    const text = d.map((x) => `${x.key}: ${JSON.stringify(x.got)} -> ${JSON.stringify(x.want)}`).join(" ; ");
    if (!upd) { console.log(`  [ÉCART]   ${r.name} non modifié (${text}) : relancer avec --update`); left++; continue; }
    if (d.some((x) => x.key === "pathRouting" && x.want === true)) {
      console.log(`  !         ${r.name} passe en routage par chemin : les clients doivent utiliser <hôte>/${r.name}/<image>`);
    }
    const current = { ...l.raw };
    for (const k of ["url", "attributes", "format", "type"]) delete current[k];
    did(`mise à jour de ${r.name} (${text})`);
    await write("PUT", `/repositories/${r.format}/${r.type}/${r.name}`, deepMerge(current, patchFor(d)));
    updated++;
  }

  title("Sécurité");
  if (cfg.realms) {
    if (same([...cfg.realms].sort(), [...live.realms].sort())) ok("realms actifs");
    else if (upd) { did(`realms actifs : ${cfg.realms.join(", ")}`); await write("PUT", "/security/realms/active", cfg.realms); updated++; }
    else { console.log(`  [ÉCART]   realms actifs (${live.realms.join(", ")}) non modifiés : relancer avec --update`); left++; }
  }
  for (const role of cfg.roles ?? []) {
    const privs = privilegeNames(role, fmtOf);
    const body = { id: role.id, name: role.name ?? role.id, description: role.description ?? "", privileges: privs, roles: role.roles ?? [] };
    const l = live.roles[role.id];
    if (!l) { did(`création du rôle ${role.id}`); await write("POST", "/security/roles", body); created++; continue; }
    const got = [...(l.privileges ?? [])].sort();
    if (same(got, privs)) { ok(`rôle ${role.id}`); continue; }
    if (upd) { did(`mise à jour du rôle ${role.id}`); await write("PUT", `/security/roles/${role.id}`, body); updated++; }
    else { console.log(`  [ÉCART]   rôle ${role.id} non modifié : relancer avec --update`); left++; }
  }
  if (cfg.anonymous) {
    const a = live.anonymous;
    const au = live.users[cfg.anonymous.userId ?? "anonymous"] ?? (await api("GET", "/security/users?userId=anonymous"))?.find?.((u) => u.userId === "anonymous");
    const wantRoles = cfg.anonymous.roles ?? [];
    const enabledOk = !!a.enabled === !!cfg.anonymous.enabled;
    const rolesOk = !cfg.anonymous.enabled || same([...(au?.roles ?? [])].sort(), [...wantRoles].sort());
    if (enabledOk && rolesOk) ok("accès anonyme");
    else if (upd) {
      if (!enabledOk) { did(`accès anonyme : ${cfg.anonymous.enabled ? "activé" : "désactivé"}`); await write("PUT", "/security/anonymous", { enabled: !!cfg.anonymous.enabled, userId: "anonymous", realmName: a.realmName ?? "NexusAuthorizingRealm" }); updated++; }
      if (!rolesOk) {
        did(`utilisateur anonymous : rôles ${wantRoles.join(", ")}`);
        await write("PUT", "/security/users/anonymous", { userId: "anonymous", firstName: au?.firstName ?? "Anonymous", lastName: au?.lastName ?? "User", emailAddress: au?.emailAddress ?? "anonymous@example.org", source: "default", status: "active", roles: wantRoles });
        updated++;
      }
    } else { console.log("  [ÉCART]   accès anonyme non modifié : relancer avec --update (change les droits des clients anonymes)"); left++; }
  }
  for (const u of cfg.users ?? []) {
    const l = live.users[u.userId];
    if (!l) {
      const pw = envPassword(u);
      if (!pw && !opts.dryRun) throw new Error(`utilisateur ${u.userId} : variable ${u.passwordEnv ?? "passwordEnv"} absente de l'environnement`);
      did(`création de l'utilisateur ${u.userId}`);
      await write("POST", "/security/users", { userId: u.userId, firstName: u.firstName ?? u.userId, lastName: u.lastName ?? "", emailAddress: u.email ?? `${u.userId}@example.org`, password: pw, status: "active", roles: u.roles });
      created++;
    } else if (same([...l.roles].sort(), [...u.roles].sort())) ok(`utilisateur ${u.userId}`);
    else if (upd) {
      did(`utilisateur ${u.userId} : rôles ${u.roles.join(", ")}`);
      await write("PUT", `/security/users/${u.userId}`, { userId: l.userId, firstName: l.firstName, lastName: l.lastName, emailAddress: l.emailAddress, source: "default", status: l.status, roles: u.roles });
      updated++;
    } else { console.log(`  [ÉCART]   utilisateur ${u.userId} non modifié : relancer avec --update`); left++; }
  }

  console.log(`\nTerminé : ${created} créé(s), ${updated} mis à jour, ${left} écart(s) laissé(s) tel(s) quel(s).`);
  return 0;
}

// ---------------------------------------------------------------- audit (lecture seule)
async function audit() {
  title("1/3  Photographie de Nexus (export)");
  opts.out = opts.out ?? "etat-actuel.json";
  await exportConfig();

  title("2/3  Comparaison au fichier de config et sondes du reverse proxy (check)");
  // Sondes sur l'adresse publique du contrat, sauf si on audite un autre Nexus (le test d'un Nexus local ne doit pas
  // envoyer de requêtes à la production) : dans ce cas, --public URL les dirige explicitement.
  if (opts.public === undefined) {
    const contractUrl = (loadConfig().contract?.publicUrl ?? "").replace(/\/$/, "");
    opts.public = contractUrl && contractUrl.toLowerCase() === NEXUS_URL.toLowerCase() ? true : undefined;
  }
  problems = 0;
  const code = await check();

  title("3/3  Ce que ferait « apply --update » (simulation, rien n'est modifié)");
  opts.dryRun = true;
  opts.update = true;
  await apply();

  console.log("\nAudit terminé : rien n'a été modifié sur Nexus.");
  return code;
}

// ---------------------------------------------------------------- export
async function exportConfig() {
  const live = await readLive();
  const previous = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};

  const repositories = Object.values(live.repos).filter((r) => r.model).map(({ model: m }) => {
    const out = { name: m.name, format: m.format, type: m.type };
    if (m.blobStore && m.blobStore !== m.name) out.blobStore = m.blobStore;
    if (m.online === false) out.online = false;
    if (m.strictContentTypeValidation === false) out.strictContentTypeValidation = false;
    if (m.type === "hosted" && m.writePolicy) out.writePolicy = m.writePolicy;
    for (const k of ["versionPolicy", "layoutPolicy", "remoteUrl", "members"]) if (m[k] !== undefined) out[k] = m[k];
    if (m.format === "docker") {
      out.pathRouting = m.pathRouting; out.anonymousPull = m.anonymousPull;
      if (m.httpPort != null) out.httpPort = m.httpPort;
    }
    return out;
  }).sort((a, b) => a.name.localeCompare(b.name));
  for (const r of Object.values(live.repos)) if (r.unsupported) console.error(`Attention : ${r.name} (${r.format}) ignoré, format non géré.`);

  const roles = Object.values(live.roles).filter((r) => !r.readOnly).map((r) => {
    const { groups, other } = groupPrivileges(r.privileges ?? []);
    const out = { id: r.id };
    if (r.description) out.description = r.description;
    out.privileges = groups;
    if (other.length) out.otherPrivileges = other;
    if (r.roles?.length) out.roles = r.roles;
    return out;
  });

  const users = Object.values(live.users).filter((u) => !["admin", "anonymous"].includes(u.userId)).map((u) => ({
    userId: u.userId, firstName: u.firstName, lastName: u.lastName, email: u.emailAddress, roles: u.roles,
    passwordEnv: `NEXUS_${u.userId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PASSWORD`,
  }));

  const anon = live.users.anonymous ?? (await api("GET", "/security/users?userId=anonymous"))?.find?.((u) => u.userId === "anonymous");
  const result = {
    contract: previous.contract ?? { publicUrl: NEXUS_URL, probes: [] },
    realms: live.realms,
    anonymous: { enabled: !!live.anonymous.enabled, roles: anon?.roles ?? [] },
    repositories, roles, users,
  };
  const json = JSON.stringify(result, null, 2) + "\n";
  if (opts.out) { writeFileSync(opts.out, json); console.error(`Configuration exportée : ${opts.out} (${repositories.length} dépôts, ${roles.length} rôles, ${users.length} utilisateurs)`); }
  else process.stdout.write(json);
  console.error("Aucun mot de passe exporté : chaque utilisateur est lié à une variable d'environnement (passwordEnv).");
}

try {
  let code = 0;
  if (cmd === "check") code = await check();
  else if (cmd === "apply") code = await apply();
  else if (cmd === "audit") code = await audit();
  else await exportConfig();
  process.exit(code);
} catch (e) {
  console.error(`Erreur : ${e.message}`);
  process.exit(2);
}
