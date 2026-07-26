/**
 * Progressive enhancements applied to the rendered article DOM.
 * Everything here runs after hydration and only touches nodes inside
 * the dangerouslySetInnerHTML container, which React never reconciles.
 */
export function initContentEnhancements() {
  const manuscript = document.querySelector<HTMLElement>(".manuscript");
  if (!manuscript) return;
  enhanceCodeBlocks(manuscript);
  initLightbox(manuscript);
}

function enhanceCodeBlocks(scope: HTMLElement) {
  scope.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
    if (pre.closest(".code-block")) return;

    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.replaceWith(wrap);
    wrap.append(pre);

    const lang = (pre.dataset.lang || "").trim();
    if (lang && lang !== "text") {
      const badge = document.createElement("span");
      badge.className = "code-block__lang";
      badge.textContent = lang;
      badge.setAttribute("aria-hidden", "true");
      wrap.append(badge);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-block__copy";
    button.textContent = "复制";
    button.setAttribute("aria-label", "复制代码");

    let timer: number | undefined;
    button.addEventListener("click", async () => {
      const source = pre.querySelector("code")?.innerText ?? pre.innerText;
      try {
        await navigator.clipboard.writeText(source);
        button.textContent = "已复制 ✓";
        button.classList.add("is-copied");
      } catch {
        button.textContent = "复制失败";
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        button.textContent = "复制";
        button.classList.remove("is-copied");
      }, 1600);
    });
    wrap.append(button);
  });
}

function initLightbox(scope: HTMLElement) {
  const images = Array.from(scope.querySelectorAll<HTMLImageElement>("img")).filter(
    (img) => !img.closest("a")
  );
  if (!images.length || typeof HTMLDialogElement === "undefined") return;

  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "查看大图");
  const zoomed = document.createElement("img");
  dialog.append(zoomed);
  dialog.addEventListener("click", () => dialog.close());
  document.body.append(dialog);

  images.forEach((img) => {
    img.classList.add("is-zoomable");
    img.addEventListener("click", () => {
      zoomed.src = img.currentSrc || img.src;
      zoomed.alt = img.alt || "";
      dialog.showModal();
    });
  });
}
