import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { parse as parseToml } from "smol-toml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { createHighlighter } from "shiki";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const contentDir = path.join(root, "src", "content", "evidence");
const publishDir = path.join(root, "public");
const uiPath = path.join(root, "scripts", "writer-ui.html");
const host = "127.0.0.1";
const port = Number(process.env.BLOG_WRITER_PORT || 5211);
const typoraCandidates = [
  process.env.TYPORA_PATH,
  "F:\\Typora\\Typora\\Typora.exe",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Typora", "Typora.exe"),
  path.join(process.env.ProgramFiles || "", "Typora", "Typora.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Typora", "Typora.exe"),
  "Typora.exe",
  "typora"
].filter(Boolean) as string[];

type PostPayload = {
  sourcePath?: string;
  title?: string;
  date?: string;
  draft?: boolean;
  tags?: string[];
  categories?: string[];
  content?: string;
};

type PathPayload = {
  sourcePath?: string;
};

type UploadPayload = {
  name?: string;
  type?: string;
  data?: string;
};

type DeployPayload = {
  message?: string;
};

type BuildResult = {
  ok: true;
  dist: string;
  log: string;
};

type CommandResult = {
  code: number | null;
  output: string;
};

type DeployResult = {
  ok: true;
  url: string;
  message: string;
  beforeHead: string;
  afterHead: string;
  createdCommit: boolean;
  latestCommit: string;
  publishStatus: string;
  log: string;
};

type CommandError = Error & {
  output?: string;
};

const send = (res: http.ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};

const sendJson = (res: http.ServerResponse, value: unknown, status = 200) =>
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");

const contentTypeFor = (target: string) => {
  const ext = path.extname(target).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  return "application/octet-stream";
};

const staticAssetPath = (urlPath: string) => {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const target = path.resolve(root, "site-public", ...decoded.split("/"));
  const base = path.resolve(root, "site-public");
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("静态资源路径越界");
  return target;
};

const errorJson = (error: unknown) => {
  const commandError = error as CommandError;
  return {
    error: error instanceof Error ? error.message : String(error),
    log: typeof commandError.output === "string" ? commandError.output : undefined
  };
};

const readBody = (req: http.IncomingMessage, limit = 2_000_000) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const walk = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(target);
      return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [target] : [];
    })
  );
  return nested.flat();
};

const toArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
};

const normalizeLang = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "c++": "cpp",
    "cxx": "cpp",
    "cc": "cpp",
    "js": "javascript",
    "ts": "typescript",
    "shell": "bash",
    "ps": "powershell",
    "ps1": "powershell",
    "md": "markdown"
  };
  const lang = aliases[normalized] || normalized || "text";
  const loaded = new Set(["javascript", "typescript", "cpp", "c", "python", "bash", "powershell", "json", "markdown", "html", "css", "text"]);
  return loaded.has(lang) ? lang : "text";
};

let highlighterPromise: ReturnType<typeof createHighlighter> | undefined;

const getHighlighter = () => {
  highlighterPromise ??= createHighlighter({
    themes: [
      {
        name: "guai-ink",
        type: "light",
        colors: {
          "editor.background": "#efebe1",
          "editor.foreground": "#171717"
        },
        tokenColors: [
          { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#76716a", fontStyle: "italic" } },
          { scope: ["keyword", "storage", "storage.type", "storage.modifier"], settings: { foreground: "#171717", fontStyle: "bold" } },
          { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#3d3a35" } },
          { scope: ["string", "string.quoted", "string punctuation"], settings: { foreground: "#5a554e" } },
          { scope: ["entity.name.function", "support.function"], settings: { foreground: "#171717" } },
          { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#44413c" } },
          { scope: ["variable", "variable.other", "parameter"], settings: { foreground: "#2f2d29" } },
          { scope: ["meta.preprocessor", "keyword.control.directive", "punctuation.definition.directive"], settings: { foreground: "#5f5a52" } },
          { scope: ["punctuation", "operator"], settings: { foreground: "#6e6961" } }
        ]
      }
    ],
    langs: ["javascript", "typescript", "cpp", "c", "python", "bash", "powershell", "json", "markdown", "html", "css"]
  });
  return highlighterPromise;
};

const parsePost = (raw: string) => {
  if (raw.startsWith("+++")) {
    const match = raw.match(/^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/);
    if (!match) return { data: {}, content: raw };
    return { data: parseToml(match[1]) as Record<string, unknown>, content: raw.slice(match[0].length) };
  }
  const parsed = matter(raw);
  return { data: parsed.data as Record<string, unknown>, content: parsed.content };
};

const sourcePathFor = (file: string) => path.relative(root, file).replace(/\\/g, "/");

const slugify = (file: string): string => {
  const relative = path.relative(contentDir, file).replace(/\\/g, "/");
  const withoutExt = relative.replace(/\.md$/i, "");
  return withoutExt
    .split("/")
    .map((part) => encodeURIComponent(part.trim().toLowerCase().replace(/\s+/g, "-")))
    .join("/");
};

const normalizeDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return new Date().toISOString();
};

const summarize = async (file: string) => {
  const raw = await fs.readFile(file, "utf8");
  const stat = await fs.stat(file);
  const parsed = parsePost(raw);
  const title = String(parsed.data.title || path.basename(file, ".md"));
  return {
    sourcePath: sourcePathFor(file),
    previewPath: `/evidence/${slugify(file)}/`,
    title,
    date: normalizeDate(parsed.data.date),
    draft: Boolean(parsed.data.draft),
    tags: toArray(parsed.data.tags),
    categories: toArray(parsed.data.categories || parsed.data.category),
    content: parsed.content.trimStart(),
    mtimeMs: stat.mtimeMs
  };
};

const listPosts = async () => {
  const files = await walk(contentDir);
  const posts = await Promise.all(files.map(summarize));
  return posts.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
};

const targetFromSourcePath = (sourcePath: string) => {
  const normalized = sourcePath.replace(/\\/g, "/");
  if (!normalized.startsWith("src/content/evidence/") || !normalized.endsWith(".md")) {
    throw new Error("文章路径必须位于 src/content/evidence");
  }
  const target = path.resolve(root, normalized);
  const relative = path.relative(contentDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("文章路径越界");
  return target;
};

const safeFileName = (title: string) => {
  const cleaned = title.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").replace(/\s+/g, " ");
  return cleaned || `untitled-${new Date().toISOString().slice(0, 10)}`;
};

const uniqueTarget = async (title: string) => {
  const base = safeFileName(title);
  for (let index = 0; index < 100; index += 1) {
    const suffix = index ? `-${index + 1}` : "";
    const target = path.join(contentDir, `${base}${suffix}.md`);
    try {
      await fs.access(target);
    } catch {
      return target;
    }
  }
  throw new Error("无法生成唯一文件名");
};

const tomlString = (value: string) => JSON.stringify(value);
const tomlArray = (items: string[]) => `[${items.map(tomlString).join(", ")}]`;

const renderMarkdownFile = (post: Required<Omit<PostPayload, "sourcePath">>) => {
  const lines = [
    "+++",
    `date = ${tomlString(post.date)}`,
    `draft = ${post.draft ? "true" : "false"}`,
    `title = ${tomlString(post.title)}`
  ];
  if (post.tags.length) lines.push(`tags = ${tomlArray(post.tags)}`);
  if (post.categories.length) lines.push(`categories = ${tomlArray(post.categories)}`);
  lines.push("+++", "", post.content.trimStart());
  return `${lines.join("\n").trimEnd()}\n`;
};

const uploadsDir = path.join(root, "site-public", "assets", "content", "uploads");
const trashDir = path.join(root, ".cleanup-trash");

const extForMime: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg"
};

const saveUpload = async (payload: UploadPayload) => {
  const ext = extForMime[String(payload.type || "")];
  if (!ext) throw new Error("只支持 png / jpg / webp / gif / svg 图片");
  const base64 = String(payload.data || "").replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("图片内容为空");
  if (buffer.length > 15_000_000) throw new Error("图片超过 15MB");
  const stamp = new Date();
  const month = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}`;
  const baseName = String(payload.name || "image")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "image";
  const fileName = `${baseName}-${Date.now().toString(36)}${ext}`;
  const dir = path.join(uploadsDir, month);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { ok: true as const, url: `/assets/content/uploads/${month}/${fileName}`, bytes: buffer.length };
};

const deletePost = async (sourcePath: string) => {
  const target = targetFromSourcePath(sourcePath);
  await fs.access(target);
  await fs.mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(trashDir, `${stamp}-${path.basename(target)}`);
  await fs.rename(target, destination);
  return { ok: true as const, trashedTo: path.relative(root, destination).replace(/\\/g, "/") };
};

const savePost = async (payload: PostPayload) => {
  const title = String(payload.title || "").trim();
  if (!title) throw new Error("标题不能为空");
  const post = {
    title,
    date: payload.date || new Date().toISOString(),
    draft: Boolean(payload.draft),
    tags: toArray(payload.tags),
    categories: toArray(payload.categories),
    content: String(payload.content || "")
  };
  const target = payload.sourcePath ? targetFromSourcePath(payload.sourcePath) : await uniqueTarget(title);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, renderMarkdownFile(post), "utf8");
  return summarize(target);
};

const renderPreview = async (markdown: string) => {
  const highlighter = await getHighlighter();
  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(() => (node: any) => {
      const visit = (target: any) => {
        if (!target || typeof target !== "object") return;
        if (target.tagName === "pre" && Array.isArray(target.children)) {
          const code = target.children.find((child: any) => child.tagName === "code");
          const className = code?.properties?.className || [];
          const langClass = Array.isArray(className) ? className.find((item) => String(item).startsWith("language-")) : "";
          const lang = normalizeLang(String(langClass || "language-text").replace("language-", ""));
          const source = Array.isArray(code?.children) ? code.children.map((child: any) => child.value || "").join("") : "";
          const highlighted = highlighter.codeToHtml(source, { lang: lang || "text", theme: "guai-ink" });
          target.type = "raw";
          target.value = highlighted;
          delete target.tagName;
          delete target.properties;
          delete target.children;
          return;
        }
        if (Array.isArray(target.children)) target.children.forEach(visit);
      };
      visit(node);
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(rendered);
};

const spawnDetached = (command: string, args: string[]) => {
  const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => undefined);
  child.unref();
  return child;
};

const isExplicitPath = (candidate: string) =>
  candidate.includes(":") || candidate.includes("/") || candidate.includes("\\");

const commandExists = (command: string) => {
  const probe = process.platform === "win32"
    ? spawnSync("where", [command], { shell: true, stdio: "ignore" })
    : spawnSync("which", [command], { stdio: "ignore" });
  return probe.status === 0;
};

const resolveTyporaCommand = async () => {
  for (const candidate of typoraCandidates) {
    if (isExplicitPath(candidate)) {
      if (await pathExists(candidate)) return candidate;
      continue;
    }
    if (commandExists(candidate)) return candidate;
  }
  throw new Error("没有找到可用的 Typora。可以设置 TYPORA_PATH。");
};

const openTypora = async (sourcePath: string) => {
  const target = targetFromSourcePath(sourcePath);
  await fs.access(target);
  const command = await resolveTyporaCommand();
  spawnDetached(command, [target]);
  return { ok: true, command, sourcePath, file: target };
};

const pathExists = async (target: string) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const openBrowser = (target: string) => {
  const command: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  spawn(command[0], command[1], { detached: true, stdio: "ignore" }).unref();
};

const runCommand = (command: string, args: string[], shell = process.platform === "win32") =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell,
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });

const runCapturedCommand = (command: string, args: string[], shell = process.platform === "win32") =>
  new Promise<CommandResult>((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      shell,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("exit", (code) => {
      const result = { code, output: cleanCommandOutput(output) };
      if (code === 0) {
        resolve(result);
        return;
      }
      const error = new Error(`${command} ${args.join(" ")} failed with exit code ${code}`) as CommandError;
      error.output = result.output;
      reject(error);
    });
    child.on("error", (error) => {
      const commandError = error as CommandError;
      commandError.output = cleanCommandOutput(output);
      reject(commandError);
    });
  });

const cleanCommandOutput = (value: string) =>
  value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d{1,3})(?:;\d{1,3})*m/g, "")
    .trimEnd();

const gitOutput = (args: string[], cwd = publishDir) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
};

const publishHead = () => gitOutput(["rev-parse", "HEAD"]);
const latestPublishCommit = () => gitOutput(["log", "-1", "--pretty=format:%h %ad %s", "--date=iso"]);
const publishStatus = () => gitOutput(["status", "--short"]) || "clean";

let buildTask: Promise<BuildResult> | null = null;
let deployTask: Promise<DeployResult> | null = null;

const buildSite = () => {
  buildTask ??= runCapturedCommand("npm", ["run", "build"]).then((command) => ({
    ok: true as const,
    dist: "dist",
    log: command.output
  })).finally(() => {
    buildTask = null;
  });
  return buildTask;
};

const openPreview = async (targetPath = "/") => {
  const build = await buildSite();
  spawn("npm", ["run", "open", "--", targetPath], {
    cwd: root,
    detached: true,
    shell: process.platform === "win32",
    stdio: "ignore"
  }).unref();
  return { ...build, opened: true as const };
};

const deploySite = (message: string) => {
  const commitMessage = message.trim() || `发布博客 ${new Date().toISOString().slice(0, 10)}`;
  deployTask ??= (async () => {
    const beforeHead = publishHead();
    const command = await runCapturedCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "deploy.ps1"),
      "-msg",
      commitMessage
    ], false);
    const afterHead = publishHead();
    return {
      ok: true as const,
      url: "https://blog.mineguai.com/",
      message: commitMessage,
      beforeHead,
      afterHead,
      createdCommit: Boolean(beforeHead && afterHead && beforeHead !== afterHead),
      latestCommit: latestPublishCommit(),
      publishStatus: publishStatus(),
      log: command.output
    };
  })().finally(() => {
    deployTask = null;
  });
  return deployTask;
};

const route = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const current = new URL(req.url || "/", `http://${host}:${port}`);
  if (req.method === "GET" && current.pathname === "/") {
    send(res, 200, await fs.readFile(uiPath, "utf8"), "text/html; charset=utf-8");
    return;
  }
  if (req.method === "GET" && current.pathname === "/favicon.ico") {
    send(res, 200, await fs.readFile(path.join(root, "site-public", "favicon.ico")), "image/x-icon");
    return;
  }
  if (req.method === "GET" && current.pathname.startsWith("/assets/")) {
    const target = staticAssetPath(current.pathname);
    send(res, 200, await fs.readFile(target), contentTypeFor(target));
    return;
  }
  if (req.method === "GET" && current.pathname === "/api/posts") {
    sendJson(res, await listPosts());
    return;
  }
  if (req.method === "GET" && current.pathname === "/api/post") {
    const sourcePath = current.searchParams.get("path") || "";
    sendJson(res, await summarize(targetFromSourcePath(sourcePath)));
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/post") {
    const payload = JSON.parse(await readBody(req)) as PostPayload;
    sendJson(res, await savePost(payload));
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/render") {
    const payload = JSON.parse(await readBody(req)) as Pick<PostPayload, "content">;
    sendJson(res, { html: await renderPreview(String(payload.content || "")) });
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/upload-image") {
    const payload = JSON.parse(await readBody(req, 25_000_000)) as UploadPayload;
    sendJson(res, await saveUpload(payload));
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/delete") {
    const payload = JSON.parse(await readBody(req)) as PathPayload;
    if (!payload.sourcePath) throw new Error("没有要删除的文章");
    sendJson(res, await deletePost(payload.sourcePath));
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/open-typora") {
    const payload = JSON.parse(await readBody(req)) as PathPayload;
    if (!payload.sourcePath) throw new Error("还没有可打开的 Markdown 文件");
    sendJson(res, await openTypora(payload.sourcePath));
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/build") {
    sendJson(res, await buildSite());
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/deploy") {
    const payload = JSON.parse(await readBody(req) || "{}") as DeployPayload;
    sendJson(res, await deploySite(payload.message || ""));
    return;
  }
  if (req.method === "POST" && current.pathname === "/api/open-preview") {
    const payload = JSON.parse(await readBody(req) || "{}") as { previewPath?: string };
    sendJson(res, await openPreview(payload.previewPath || "/"));
    return;
  }
  sendJson(res, { error: "Not found" }, 404);
};

const writerUrl = `http://${host}:${port}/`;
const shouldOpenBrowser = process.env.BLOG_WRITER_NO_OPEN !== "1";

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => sendJson(res, errorJson(error), 500));
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.log(`写作台已经在运行: ${writerUrl}`);
    if (shouldOpenBrowser) {
      console.log("已打开现有写作台页面。");
      openBrowser(writerUrl);
    }
    return;
  }
  console.error(error);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`写作台已启动: ${writerUrl}`);
  console.log("保存会直接写入 src/content/evidence/*.md；结束写作可以按 Ctrl+C。");
  if (shouldOpenBrowser) openBrowser(writerUrl);
});
