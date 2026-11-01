# sveltedit

Edit the text of your Svelte site in the browser, in dev mode, and save it straight back into the
`.svelte` source files.

A bar appears at the top of the page. Turn editing on, move the pointer over any text, and press the
pen. Edit the text in place, make parts bold, italic or underlined, and press Save. The dev server
writes the change into the source file, and Vite reloads the page from the changed file.

## Packages

| Package          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `sveltedit`      | The editor bar, one Svelte 5 component.                           |
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

The bar renders only when `import.meta.env.DEV` is true, and the middleware runs only in the dev
server (`apply: "serve"`). A production build contains neither.

## How it works

In dev mode, Svelte 5 records the source location of each element on the element itself
(`__svelte_meta.loc`). The bar finds the location of the element you edit and sends the element's
new HTML to `POST /__sveltedit`. The middleware finds the element at that line and column in the
`.svelte` file, replaces its content, and writes the file.

## What it refuses

The middleware replaces an element's full content, so it refuses an edit when the current content
holds template code: an expression or block (`{` or `}`), a component tag, or a `<svelte:` element.
Edit that text in the source. New text is brace-escaped on save, so an edit can never add template
code.

## Safety

- The middleware exists only in the dev server. It writes only inside the Vite project root, and
  only to `.svelte` files.
- Treat the dev server as local: anything that can reach it can edit your source files. Do not
  expose a dev server with `--host` on an untrusted network.

## Limits

- Svelte 5 and Vite only. The location data comes from Svelte 5 dev mode, and the dev-only switch is
  `import.meta.env.DEV`.
- Saved HTML lands in the source as one line. Run Prettier after a session of edits if you care
  about formatting.
- Styling uses the browser's `execCommand`, which is deprecated but works in all current browsers.

## License

MIT
