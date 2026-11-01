<script>
  import { locate } from "./locate";
  import { said, save } from "./save";

  let on = $state(false);
  let note = $state("");
  let hovered = $state(null);
  let editing = $state(null);
  let pen = $state({ x: 0, y: 0 });
  let kept = "";

  const post = async (path, body) => {
    const reply = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body });
    return { status: reply.status, body: await reply.text() };
  };

  const unmark = (element) => {
    element.style.outline = "";
    if (element.getAttribute("style") === "") element.removeAttribute("style");
  };

  const mark = (next) => {
    if (hovered !== null && hovered !== next) unmark(hovered);
    if (next !== null) next.style.outline = "1px dashed #4c8dff";
    hovered = next;
  };

  const track = (event) => {
    if (!on || editing !== null) return;
    const origin = event.target;
    if (!(origin instanceof Element) || origin.closest("[data-sveltedit]") !== null) return;
    const found = locate(origin);
    if (found === undefined) {
      mark(null);
      return;
    }
    const element = found.element;
    const box = element.getBoundingClientRect();
    pen = { x: box.right - 26, y: box.top + 4 };
    mark(element);
  };

  const begin = () => {
    if (hovered === null) return;
    editing = hovered;
    kept = editing.innerHTML;
    editing.style.outline = "2px solid #4c8dff";
    editing.setAttribute("contenteditable", "true");
    editing.focus();
    note = "";
  };

  const end = () => {
    if (editing === null) return;
    editing.removeAttribute("contenteditable");
    unmark(editing);
    editing = null;
    mark(null);
  };

  const cancel = () => {
    if (editing === null) return;
    editing.innerHTML = kept;
    end();
  };

  const erase = async () => {
    if (hovered === null || editing !== null) return;
    const found = locate(hovered);
    if (found === undefined) return;
    const tag = hovered.tagName.toLowerCase();
    if (!window.confirm(`Delete this <${tag}> and its text from the source?`)) return;
    const claim = { ...found.loc, tag, html: null };
    const result = await save(claim, post);
    if (result.ok) {
      note = "Deleted";
      mark(null);
    } else {
      note = said(result.error);
    }
  };

  const store = async () => {
    if (editing === null) return;
    const found = locate(editing);
    if (found === undefined) {
      note = "This element carries no source location.";
      return;
    }
    const claim = { ...found.loc, tag: editing.tagName.toLowerCase(), html: editing.innerHTML };
    const result = await save(claim, post);
    if (result.ok) {
      note = "Saved";
      end();
    } else {
      note = said(result.error);
    }
  };

  const styled = (event, command) => {
    event.preventDefault();
    document.execCommand(command);
  };

  const toggle = () => {
    cancel();
    mark(null);
    on = !on;
    note = on ? "Hover text, press the pen, edit, save." : "";
  };

  const escape = (event) => {
    if (event.key === "Escape") cancel();
  };

  $effect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.addEventListener("mousemove", track);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousemove", track);
      window.removeEventListener("keydown", escape);
    };
  });
</script>

{#if import.meta.env.DEV}
  <div data-sveltedit class="bar">
    <strong>sveltedit</strong>
    <button type="button" onclick={toggle}>{on ? "Editing: on" : "Editing: off"}</button>
    {#if editing !== null}
      <button type="button" onmousedown={(event) => styled(event, "bold")}>B</button>
      <button type="button" onmousedown={(event) => styled(event, "italic")}>I</button>
      <button type="button" onmousedown={(event) => styled(event, "underline")}>U</button>
      <button type="button" onclick={store}>Save</button>
      <button type="button" onclick={cancel}>Cancel</button>
    {/if}
    <span class="note">{note}</span>
  </div>
  {#if on && hovered !== null && editing === null}
    <button type="button" data-sveltedit class="pen" style="left: {pen.x}px; top: {pen.y}px" onclick={begin} aria-label="Edit this text">
      ✎
    </button>
    <button
      type="button"
      data-sveltedit
      class="pen bin"
      style="left: {pen.x - 26}px; top: {pen.y}px"
      onclick={erase}
      aria-label="Delete this element"
    >
      ✕
    </button>
  {/if}
{/if}

<style>
  .bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: #111;
    color: #eee;
    font: 12px/1.4 system-ui, sans-serif;
    border-bottom: 1px solid #333;
  }
  .note {
    color: #aaa;
  }
  .bar button {
    font: inherit;
    color: inherit;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .bin {
    background: #e5484d;
  }
  .pen {
    position: fixed;
    z-index: 2147483646;
    width: 22px;
    height: 22px;
    padding: 0;
    background: #4c8dff;
    color: #fff;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    line-height: 22px;
  }
</style>
