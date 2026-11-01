# sveltedit

Allows you to edit .svelte files much more easily without ever touching code. Simply click the edit button and hover over any element, and edit the text. This library is meant to be as lightweight as possible and rely on very little external dependencies for security reasons.

Use this only as a devDependency to avoid packaging it in your prod builds!

## Packages

| Package          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `sveltedit`      | The editor bar                           |
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
(`__svelte_meta.loc`). We utilize this to find the location of the element you edit and sends the element's
new HTML to `POST /__sveltedit` on the vite server endpoint. The middleware finds the element at that line and column in the
`.svelte` file, replaces its content, and writes the file.


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
