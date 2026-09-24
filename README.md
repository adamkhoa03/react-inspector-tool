# React Form Inspector

Chrome extension để soi form của app React. Khi bạn **hover** vào một field, extension hiện:

- **tên field**: `email`, `password`, `terms`…
- **component** chứa field đó, ví dụ `LoginPane`
- **dòng khai báo** field, ví dụ `src/features/auth-dialog/ui/LoginPane.tsx:67`

Khi **click** vào field, bạn copy được tên field hoặc mở thẳng file đó trong VS Code (hoặc Cursor, WebStorm…).

Extension viết bằng JavaScript thuần, không cần build. Chrome đọc trực tiếp `manifest.json` cùng các file JS/HTML/CSS trong folder này.

---

## Cài đặt

1. Mở `chrome://extensions`.
2. Bật **Developer mode** ở góc phải trên.
3. Bấm **Load unpacked** rồi chọn folder `react-form-inspector` này.
4. (Tuỳ chọn) Ghim icon extension lên thanh công cụ.

**Chia sẻ cho người khác:** gửi họ cả folder, dạng file zip hoặc qua git. Họ làm lại đúng 4 bước trên. Mỗi lần bạn sửa code, bấm nút ↻ của extension trong `chrome://extensions`, rồi tải lại trang đang soi.

## Cách dùng

1. Mở app React đang chạy ở chế độ dev, ví dụ `http://localhost:5173`.
2. Bật inspector theo một trong hai cách:
   - bấm icon extension, chọn **Start inspecting**, hoặc
   - nhấn **Alt+Shift+F**. Muốn đổi phím thì vào `chrome://extensions/shortcuts`.
3. Hover vào field, tag thông tin sẽ hiện ngay dưới field.

| Thao tác | Kết quả |
|---|---|
| Click | Copy tên field. Field không có tên thì copy `path:line`. Có thể đổi thành "mở file" trong popup. |
| `Ctrl`/`⌘` + click | Mở file ở đúng dòng trong editor |
| `Shift` + click | Copy tên field |
| `P` | **Pin** tag vào field đang hover, để bấm được các nút trong tag (copy component, copy path, copy tất cả, component stack). Nhấn `P` lần nữa để bỏ pin. |
| `C` / `O` (khi đang pin) | Copy tên / mở file |
| `Esc` | Bỏ pin. Nếu đang không pin thì tắt inspector. |

Thanh nhỏ ở góc phải dưới có nút chuyển giữa hai mode:

- **Fields**: chỉ bắt field của form.
- **All**: bắt mọi phần tử, kèm component và dòng code của phần tử đó.

Trong lúc inspector đang bật, click của bạn **không đi xuống trang**. Nhờ vậy input không bị focus, Select không bị mở, dialog cũng không tự đóng. Nhấn `Esc` để trả lại trang như bình thường.

## Project folder ("source")

Mỗi site có thể gắn với **thư mục chứa code trên máy của bạn**, tức là folder có `src/` bên trong, ví dụ `C:\work\jira-app\apps\web`. Cách gắn:

1. Mở site đó.
2. Bấm icon extension, paste đường dẫn vào ô **Project folder** rồi bấm **Save**.

Từ lúc đó, mọi đường dẫn đều được tính lại theo thư mục này, nên nút "Open in VS Code" mở đúng file trên máy bạn.

**Khi nào cần paste?**

- **Chạy dev server trên chính máy mình:** thường không cần. Vite ghi sẵn đường dẫn tuyệt đối vào code (`_jsxFileName`), extension tự đọc được, và popup sẽ hiện dòng "Dev server reports: …".
- **Mở dev server của đồng nghiệp qua mạng LAN** (`http://192.168.x.x:5173`): đường dẫn server báo về là đường dẫn trên máy **họ**. Paste thư mục checkout của **bạn** vào.
- **Dev server chạy trong Docker hoặc trên máy khác:** giống trường hợp trên.
- **WSL:** paste thư mục, hoặc chọn **Custom URL template** với
  `vscode://vscode-remote/wsl+Ubuntu{urlPath}:{line}:{column}`
- **Popup báo chỉ có đường dẫn tương đối:** bắt buộc phải paste.

Danh sách thư mục theo từng site được quản lý ở **All settings** (trang options).

## Editor

Popup có mục **Open in** với các lựa chọn: VS Code, VS Code Insiders, Cursor, Windsurf, Zed, WebStorm, Custom URL template hoặc Vite dev server.

- **Lần đầu mở file**, Chrome sẽ hỏi *"Open Visual Studio Code?"*. Tick **Always allow…** thì những lần sau không hỏi nữa.
- **Custom URL template** dùng được các biến sau:

  | Biến | Giá trị |
  |---|---|
  | `{path}` | đường dẫn tuyệt đối, ví dụ `C:/app/src/Form.tsx` |
  | `{urlPath}` | như `{path}` nhưng luôn bắt đầu bằng `/` |
  | `{relPath}` | đường dẫn tương đối, ví dụ `src/Form.tsx` |
  | `{line}`, `{column}` | dòng và cột |

- **Vite dev server** gọi endpoint `/__open-in-editor` của Vite. Chrome không hỏi gì, nhưng editor được mở trên **máy đang chạy dev server** và do Vite tự chọn (đặt biến `LAUNCH_EDITOR` nếu muốn chỉ định editor).

## Cách hoạt động

Phần này dành cho ai muốn sửa extension.

**1. Chỉ chạy khi bạn bật.** Lúc bạn bấm popup hoặc nhấn phím tắt, Chrome cấp quyền `activeTab` cho đúng tab đó. Background (`background.js`) inject 4 file trong `page/` vào **world của trang**, tức là cùng môi trường JS với React. Chỉ ở đó mới đọc được dữ liệu nội bộ của React. Cách này không cần quyền "đọc mọi trang web".

**2. Từ DOM tới fiber** (`page/fiber.js`). React gắn fiber vào mỗi DOM node qua một key có dạng `__reactFiber$…`. Fiber có các liên kết sau:
- `return`: fiber cha
- `memoizedProps`: props
- `_debugOwner`: component đã render ra nó
- `_debugStack`: stack trace lúc JSX được gọi. Có từ React 19; ở React ≤18 thay bằng `_debugSource`.

**3. Tên field.** Extension đi ngược từ phần tử lên các fiber cha để tìm prop `name`. Có hai giới hạn:
- Chỉ nhận `name` của component render **đúng một field**. Nhờ vậy `<Icon name="eye">` không bị nhận nhầm.
- Dừng khi gặp một tổ tiên chứa từ 2 field trở lên, vì từ đó trở lên là của form chứ không còn là của field.

Cách này bắt được `register('email')`, `<Controller name="password">`, kể cả khi tên không xuất hiện trên DOM. Ví dụ `terms` là Radix checkbox, tên chỉ nằm ở Controller.

**4. Dòng khai báo.** Lấy fiber *ngoài cùng* thoả một trong hai điều kiện:
- còn mang đúng tên đó, hoặc
- còn truyền xuống cùng một prop cho field (`value`, `onChange`, `checked`, `placeholder`…).

Nhờ vậy `<Input {...register('email')} />` trỏ về `LoginPane.tsx`, chứ không lọt vào bên trong `Input.tsx`.

**5. Component chứa field.** Stack trong `_debugStack` có dạng:

```
jsxDEV → nơi viết JSX → … → hàm component đang render → react_stack_bottom_frame
```

Component chứa field là owner đầu tiên được định nghĩa **cùng file** với dòng khai báo. Quy tắc này xử lý đúng các render prop như `<Field>{(p) => <Input …/>}</Field>`: kết quả là `LoginPane`, không phải `Field`.

**6. Số dòng thật** (`page/source.js`). Stack trỏ vào code mà Vite đã biên dịch. Extension fetch lại module đó (cùng origin), đọc source map inline (base64 VLQ), rồi đổi ra dòng và cột trong file `.tsx` gốc.

**7. Giao diện** (`page/overlay.js`). Toàn bộ nằm trong Shadow DOM, nên CSS của trang không ảnh hưởng tới nó. Nội dung được dựng bằng DOM API, không dùng `innerHTML`.

Ngoài ra còn có `page/inspector.js` (bắt chuột/phím, copy, mở editor) và `page/bridge.js` (báo trạng thái để hiện badge "ON").

Trong DevTools console, bạn có thể gọi:

```js
await __REACT_FORM_INSPECTOR__.inspect($0) // $0 = phần tử đang chọn trong tab Elements
```

## Giới hạn

- **Cần build development.** Ở build production, React không giữ thông tin nguồn nên chỉ còn tên (có khi đã bị minify).
- **React 19.0** chưa có `_debugStack`. React ≤18 (`_debugSource`) và React ≥19.1 thì chạy được.
- **Sau khi Vite hot-reload một file**, các phần tử đã mount từ trước có thể lệch dòng. Tag sẽ ghi "edited, reload for exact line"; tải lại trang là hết.
- **Webpack / Next.js:** tìm được file nhưng số dòng có thể chỉ gần đúng. Extension được viết chủ yếu cho Vite.
- **iframe** (ví dụ Storybook): chỉ soi được trang chính. Với Storybook, mở thẳng `iframe.html?id=…`.
- **Native `<dialog>` mở bằng `showModal()`** làm mọi thứ ngoài dialog thành inert. Tag vẫn hiện nhưng không bấm được nút; các phím `C`, `O`, `Esc` vẫn dùng được.
- **Trang có hộp "Leave site?"** (`beforeunload`) có thể bật hộp này khi bạn mở editor bằng link `vscode://`. Gặp trường hợp này thì chọn editor "Vite dev server".

## Xử lý sự cố

- **"Chrome does not allow extensions on its own pages":** các trang `chrome://` và Chrome Web Store không cho extension chạy.
- **Trang `file://`:** trong `chrome://extensions`, mở chi tiết extension và bật "Allow access to file URLs".
- **"React not found on this page":** app chưa render xong, hoặc không phải React.
- **Mở file mà không có gì xảy ra:** kiểm tra lại editor đã chọn. Nếu lỡ bấm "Cancel" ở hộp thoại của Chrome, thử lại rồi chọn "Open".
- **Đường dẫn sai máy:** paste lại Project folder trong popup.

## Cấu trúc

```
manifest.json        khai báo extension (MV3), quyền, phím tắt
background.js        bật/tắt, inject script, badge, tự bật lại sau khi reload
shared/settings.js   cài đặt (thư mục theo site, editor…) dùng chung
shared/base.css      màu và control dùng chung cho popup/options
page/fiber.js        đọc fiber: tên field, dòng khai báo, component
page/source.js       stack → source map → file:line, dựng URL mở editor
page/overlay.js      giao diện trong trang (khung, tag, thanh trạng thái)
page/inspector.js    điều khiển: chuột, phím, copy, mở editor
page/bridge.js       báo trạng thái bật/tắt cho badge
popup/               popup khi bấm icon
options/             trang "All settings"
icons/               icon 16/32/48/128
```

Dữ liệu trong ô input không bao giờ bị copy hay gửi đi đâu. Extension chỉ fetch các script của chính trang đang soi, để đọc source map.
