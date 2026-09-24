# React Form Inspector

A Chrome extension for inspecting forms in a React app. When you **hover** a field, it shows:
<img width="360" height="524" alt="image" src="https://github.com/user-attachments/assets/ca5ce3fd-28c4-4fb2-9ba2-732081b5cd4d" />

- the **field name**: `email`, `password`, `terms`…
- the **component** the field belongs to, e.g. `LoginPane`
- the **line that declares** the field, e.g. `src/features/auth-dialog/ui/LoginPane.tsx:67`

**Click** a field to copy its name, or to open that exact line in VS Code (or Cursor, WebStorm…).

The extension is plain JavaScript with no build step: Chrome reads `manifest.json` and the JS/HTML/CSS files in this folder directly.

---

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `react-form-inspector` folder.
4. (Optional) Pin the extension icon to the toolbar.

**Sharing it with others:** send them the whole folder, as a zip or through git, and have them follow the same 4 steps. Whenever you change the code, press the extension's ↻ button in `chrome://extensions`, then reload the page you are inspecting.

## Usage

1. Open a React app running in development mode, e.g. `http://localhost:5173`.
2. Turn the inspector on, either way:
   - click the extension icon and choose **Start inspecting**, or
   - press **Alt+Shift+F**. To change the key, go to `chrome://extensions/shortcuts`.
3. Hover a field; its tag appears right below it.

| Action | Result |
|---|---|
| Click | Copies the field name. A field without a name copies its `path:line` instead. Can be switched to "open file" in the popup. |
| `Ctrl`/`⌘` + click | Opens the file at that line in your editor |
| `Shift` + click | Copies the field name |
| `P` | **Pins** the tag to the hovered field so you can use its buttons (copy component, copy path, copy all, component stack). Press `P` again to unpin. |
| `C` / `O` (while pinned) | Copy the name / open the file |
| `Esc` | Unpins. If nothing is pinned, turns the inspector off. |

The small bar in the bottom-right corner switches between two modes:

- **Fields**: only form fields are picked up.
- **All**: every element, with its component and line of code.

While the inspector is on, your clicks **do not reach the page**: inputs don't take focus, selects don't open, and dialogs don't close. Press `Esc` to get the page back.

## Project folder ("source")

Each site can point at **the folder its code lives in on your computer**, the one with `src/` inside, e.g. `C:\work\jira-app\apps\web`. To set it:

1. Open the site.
2. Click the extension icon, paste the path into **Project folder** and press **Save**.

From then on every path is rebuilt inside that folder, so "Open in VS Code" opens the right file on your machine.

**When do you need to paste one?**

- **The dev server runs on your own machine:** usually not. Vite writes the absolute path into the compiled code (`_jsxFileName`) and the extension reads it; the popup shows it as "Dev server reports: …" so you can check.
- **You open a teammate's dev server over the LAN** (`http://192.168.x.x:5173`): the paths the server reports are paths on **their** machine. Paste the folder of **your** checkout.
- **The dev server runs in Docker or on another machine:** same as above.
- **WSL:** paste the folder, or pick **Custom URL template** with
  `vscode://vscode-remote/wsl+Ubuntu{urlPath}:{line}:{column}`
- **The popup says only a relative path is known:** you must paste one.

The per-site folder list is managed under **All settings** (the options page).

## Editor

The popup's **Open in** menu offers VS Code, VS Code Insiders, Cursor, Windsurf, Zed, WebStorm, Custom URL template and Vite dev server.

- **The first time you open a file**, Chrome asks *"Open Visual Studio Code?"*. Tick **Always allow…** and it won't ask again.
- **Custom URL template** accepts these placeholders:

  | Placeholder | Value |
  |---|---|
  | `{path}` | absolute path, e.g. `C:/app/src/Form.tsx` |
  | `{urlPath}` | same as `{path}`, but always starting with `/` |
  | `{relPath}` | relative path, e.g. `src/Form.tsx` |
  | `{line}`, `{column}` | line and column |

- **Vite dev server** calls Vite's `/__open-in-editor` endpoint. Chrome asks nothing, but the editor opens on **the machine running the dev server** and is chosen by Vite (set the `LAUNCH_EDITOR` environment variable to pick one).

## How it works

This section is for anyone who wants to change the extension.

**1. It runs only when you turn it on.** When you click the popup or press the shortcut, Chrome grants `activeTab` for that tab only. The background worker (`background.js`) then injects the 4 files in `page/` into **the page's own world**, the same JS environment React runs in; that is the only place React's internal data can be read. So the extension never needs permission to "read all websites".

**2. From DOM to fiber** (`page/fiber.js`). React attaches a fiber to every DOM node under a key like `__reactFiber$…`. A fiber links to:
- `return`: the parent fiber
- `memoizedProps`: its props
- `_debugOwner`: the component that rendered it
- `_debugStack`: the stack trace from when the JSX ran. This exists since React 19; React ≤18 has `_debugSource` instead.

**3. The field name.** The extension walks up from the element through the parent fibers looking for a `name` prop, with two limits:
- It only accepts a `name` from a component that renders **exactly one field**, so `<Icon name="eye">` is never mistaken for one.
- It stops at the first ancestor that contains two or more fields: from there up, things belong to the form, not to this field.

This catches `register('email')` and `<Controller name="password">`, even when the name never reaches the DOM. For example `terms` is a Radix checkbox whose name exists only on the Controller.

**4. The declaring line.** It takes the *outermost* fiber that either:
- still carries the same name, or
- still passes one of the field's props down (`value`, `onChange`, `checked`, `placeholder`…).

That is why `<Input {...register('email')} />` points at `LoginPane.tsx` rather than into `Input.tsx`.

**5. The owning component.** The stack in `_debugStack` reads:

```
jsxDEV → where the JSX was written → … → the component function rendering → react_stack_bottom_frame
```

The owning component is the first owner **defined in the same file** as the declaring line. This handles render props such as `<Field>{(p) => <Input …/>}</Field>` correctly: the answer is `LoginPane`, not `Field`.

**6. The real line number** (`page/source.js`). The stack points into the code Vite compiled. The extension fetches that module again (same origin), reads its inline source map (base64 VLQ) and maps the position back to the line and column in the original `.tsx` file.

**7. The UI** (`page/overlay.js`). Everything lives in a Shadow DOM, so the page's CSS can't affect it, and it is built with DOM APIs, never `innerHTML`.

On top of those, `page/inspector.js` handles the pointer, the keys, copying and opening the editor, and `page/bridge.js` reports on/off so the badge can show "ON".

In the DevTools console you can call:

```js
await __REACT_FORM_INSPECTOR__.inspect($0) // $0 = the element selected in the Elements tab
```

## Limitations

- **A development build is required.** In production builds React keeps no source information, so only names are left (and they may be minified).
- **React 19.0** has no `_debugStack` yet. React ≤18 (`_debugSource`) and React ≥19.1 work.
- **After Vite hot-reloads a file**, elements mounted before the update can be a few lines off. The tag says "edited, reload for exact line"; reloading the page fixes it.
- **Webpack / Next.js:** the file is found, but the line may only be approximate. The extension is written mainly for Vite.
- **iframes** (e.g. Storybook): only the top page is inspected. For Storybook, open `iframe.html?id=…` directly.
- **A native `<dialog>` opened with `showModal()`** makes everything outside it inert. The tag still shows but its buttons can't be clicked; the `C`, `O` and `Esc` keys still work.
- **Pages with a "Leave site?" prompt** (`beforeunload`) may show it when a `vscode://` link opens the editor. If that happens, choose the "Vite dev server" editor.

## Troubleshooting

- **"Chrome does not allow extensions on its own pages":** `chrome://` pages and the Chrome Web Store don't allow extensions.
- **`file://` pages:** in `chrome://extensions`, open the extension's details and turn on "Allow access to file URLs".
- **"React not found on this page":** the app hasn't finished rendering, or it isn't React.
- **Opening a file does nothing:** check the selected editor. If you pressed "Cancel" in Chrome's prompt, try again and choose "Open".
- **Paths from the wrong machine:** paste the Project folder again in the popup.

## Layout

```
manifest.json        the extension declaration (MV3), permissions, shortcut
background.js        on/off, script injection, badge, turning back on after a reload
shared/settings.js   settings (folder per site, editor…) shared by every part
shared/base.css      colours and controls shared by the popup and options page
page/fiber.js        reads fibers: field name, declaring line, component
page/source.js       stack → source map → file:line, builds the editor URL
page/overlay.js      the on-page UI (brackets, tag, status bar)
page/inspector.js    the controller: pointer, keys, copy, open in editor
page/bridge.js       reports on/off for the badge
popup/               the popup behind the toolbar icon
options/             the "All settings" page
icons/               icons at 16/32/48/128
```

What people type into fields is never copied or sent anywhere. The only network requests the extension makes are for the inspected page's own scripts, to read their source maps.
