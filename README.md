# sveltedit

Allows you to edit .svelte files much more easily without ever touching code. Turn on editing in the bar, hover over any text, and press the pen to edit it or the bin to delete it. This library is meant to be as lightweight as possible and rely on very little external dependencies for security reasons.

Use this only as a devDependency to avoid packaging it in your prod builds!

## Packages

| Package          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `sveltedit`      | The editor bar.                                                   |
| `sveltedit-vite` | The dev-server middleware that writes edits into `.svelte` files. |

## Install

```bash
npm install -D sveltedit sveltedit-vite
```

Add the plugin to `vite.config.ts`:

```ts
import { sveltedit } from "sveltedit-vite";

export default defineConfig({
  plugins: [sveltekit(), sveltedit()],
});
```

Render the bar once, for example in `+layout.svelte`:

```svelte
<script>
  import { Sveltedit } from "sveltedit";
</script>

<Sveltedit />
```

In SvelteKit, turn off server rendering in dev, for example in `src/routes/+layout.ts`:

```ts
import { dev } from "$app/environment";

export const ssr = !dev;
```

When Svelte 5 hydrates a server-rendered page, an element after a child component can get the
location of the next element. Then a save changes the wrong element. Client rendering gives correct
locations.

The bar renders only when `import.meta.env.DEV` is true, and the middleware runs only in the dev
server (`apply: "serve"`). A production build contains neither.

## Use

- Press **Editing: off** in the bar to turn editing on.
- Hover over text. Press the pen to edit the text, or the bin to delete the element.
- Select text and press **B** to make it bold. Bold is the only style.
- Enter does nothing. Press Shift+Enter for a line break.
- Paste puts in plain text only.
- Press **Save** to write the change. Press **Cancel** or Escape to restore the text.

## How it works

In dev mode, Svelte 5 records the source location of each element on the element itself
(`__svelte_meta.loc`). The bar sends this location and the new HTML of the element (`innerHTML`) to
`POST /__sveltedit` on the Vite dev server. The middleware finds the element at that line and column
in the `.svelte` file. It replaces all that is between the opening tag and the closing tag with the
new HTML, and writes the file. A delete removes the element from its opening tag to its closing
tag.

## Safety

- The middleware exists only in the dev server. It writes only inside the Vite project root, and
  only to `.svelte` files. It follows symbolic links before it checks the path, and it never writes
  in `node_modules`.
- The middleware accepts only JSON requests from the same site. A page on another site cannot send
  an edit.
- Treat the dev server as local: anything that can reach it can edit your source files. Do not
  expose a dev server with `--host` on an untrusted network.

## Limits

- Svelte 5 and Vite only. The location data comes from Svelte 5 dev mode, and the dev-only switch is
  `import.meta.env.DEV`.
- The middleware does not change an element that contains template code: a `{...}` expression, a
  block, a component or a `<svelte:...>` element. Edit these in your editor.
- The bar writes text as you type it. Do not type `{` or `}`, because Svelte reads them as code.
- The middleware finds the closing tag with a plain text search. It does not support an element
  inside an element with the same tag, or a `>` in an attribute of the edited element. A save can
  then write broken markup, and Svelte shows an error.
- A delete of an element inside a block such as `{#each}` removes it for each item.
- In a component with a `<style>` block, Svelte adds a class such as `s-1a2b3c` to elements in dev.
  When you save an element that contains such elements, this class goes into the source.
- Saved HTML lands in the source as one line. Run Prettier after a session of edits if you care
  about formatting.
- Styling uses the browser's `execCommand`, which is deprecated but works in all current browsers.

## License

MIT
