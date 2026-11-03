<script>
  import { locate } from "./locate.js";
  import { said, save } from "./save.js";

  let on = $state(false);
  let note = $state("");
  let hovered = $state(null);
  let editing = $state(null);
  let pen = $state({ x: 0, y: 0 });
  let kept = "";
  // paragraphs created with Enter during this edit, in document order
  let added = [];

  const post = async (path, body) => {
    const reply = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body });
    return { status: reply.status, body: await reply.text() };
  };

  const unmark = (element) => {
    element.removeAttribute("data-sveltedit-mark");
  };

  const mark = (next) => {
    if (hovered !== null && hovered !== next) unmark(hovered);
    if (next !== null) next.setAttribute("data-sveltedit-mark", "hover");
    hovered = next;
  };

  // for each mouse movement
  const track = (event) => {
    // if editing is off or we are currently editing an element, do nothing
    if (!on || editing !== null) return;

    // get the element under the cursor
    const origin = event.target;

    // if the origin is not an element or is inside a sveltedit-controlled area, do nothing
    if (!(origin instanceof Element) || origin.closest("[data-sveltedit]") !== null) return;
    
    // locate the element
    const found = locate(origin);
    if (found === undefined) {
      mark(null);
      return;
    }

    // since we  found it place the pen and the bounding box
    const element = found.element;
    const box = element.getBoundingClientRect();
    pen = { x: box.right - 26, y: box.top + 4 };
    mark(element);
  };

  // when user clicks the pen to begin editing
  const begin = () => {
    if (hovered === null) return;
    editing = hovered;
    kept = editing.innerHTML;
    editing.setAttribute("data-sveltedit-mark", "edit");
    // allow editing
    editing.setAttribute("contenteditable", "true");
    editing.focus();
    note = "";
  };

  const end = () => {
    if (editing === null) return;
    // stop editing
    for (const host of [editing, ...added]) {
      host.removeAttribute("contenteditable");
      unmark(host);
    }
    added = [];
    editing = null;
    mark(null);
  };

  const cancel = () => {
    if (editing === null) return;
    for (const host of added) host.remove();
    editing.innerHTML = kept;
    end();
  };

  // split the paragraph at the caret into a new element of the same kind
  const split = (host) => {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const tail = document.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(host, host.childNodes.length);
    const next = document.createElement(host.tagName);
    for (const { name, value } of host.attributes) if (name !== "id") next.setAttribute(name, value);
    next.append(tail.extractContents());
    if (next.childNodes.length === 0) next.append(document.createElement("br"));
    if (host.childNodes.length === 0) host.append(document.createElement("br"));
    host.after(next);
    added.splice(host === editing ? 0 : added.indexOf(host) + 1, 0, next);
    next.focus();
    selection.collapse(next, 0);
  };

  const erase = async () => {
    if (hovered === null || editing !== null) return;
    const found = locate(hovered);
    if (found === undefined) return;
    const tag = hovered.tagName.toLowerCase();
    if (!window.confirm(`Delete this <${tag}> and its text from the source?`)) return;
    const result = await save({ ...found.loc, tag, html: null }, post);
    if (result.ok) {
      note = "Deleted";
      mark(null);
    } else {
      note = said(result.error);
    }
  };

  // store the edited content
  const store = async () => {
    if (editing === null) return;
    const target = editing;
    const loc = target.__svelte_meta?.loc;
    if (loc === undefined) {
      note = "This element carries no source location.";
      return;
    }
    const [html, ...more] = [target, ...added].map((host) => (host.innerHTML === "<br>" ? "" : host.innerHTML));
    const claim = { ...loc, tag: target.tagName.toLowerCase(), html, more };
    // send the claim to the vite server
    const result = await save(claim, post);
    if (result.ok) {
      note = "Saved";
      if (editing === target) end();
    } else {
      note = said(result.error);
    }
  };

  const bold = (event) => {
    event.preventDefault();
    document.execCommand("bold");
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

  const input = (event) => {
    if (editing === null) return;
    const host = [editing, ...added].find((element) => element.contains(event.target));
    if (host === undefined) return;
    if (event.inputType === "insertParagraph") {
      event.preventDefault();
      split(host);
      return;
    }
    if (event.inputType !== "insertFromPaste") return;
    event.preventDefault();
    document.execCommand("insertText", false, event.dataTransfer?.getData("text/plain") ?? "");
  };

  // this is the core functionality
  $effect(() => {
    // we only run this in dev mode
    if (!import.meta.env.DEV) return undefined;

    // track mouse movement to ensure we place the rectangle and pen correctly
    window.addEventListener("mousemove", track);
    // this is used to handle the Escape key for cancelling edits
    window.addEventListener("keydown", escape);
    window.addEventListener("beforeinput", input);
    return () => {
      window.removeEventListener("mousemove", track);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("beforeinput", input);
    };
  });
</script>

{#if import.meta.env.DEV}
  <div data-sveltedit class="bar">
    <strong>sveltedit</strong>
    <button type="button" onclick={toggle}>{on ? "Editing: on" : "Editing: off"}</button>
    {#if editing !== null}
      <button type="button" onmousedown={bold}>B</button>
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
  :global([data-sveltedit-mark="hover"]) {
    outline: 1px dashed #4c8dff !important;
  }
  :global([data-sveltedit-mark="edit"]) {
    outline: 2px solid #4c8dff !important;
  }
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
