# Architecture

## Trạng thái và quyết định

Ngày ghi nhận: 2026-10-25. Phiên bản Tauri được triển khai tại root. `RnD/` là archive cục bộ được gitignore, không phải dependency của repo hoặc bản đóng gói. Adapter sản phẩm ở `providers/`, chưa viết lại giao thức bằng Rust. Nguồn vector icon ở `public/assets/app-icon.svg` và `app-mark.svg`; các PNG/ICO cần build được lưu trong `src-tauri/icons/`. Windows là nền tảng đầu tiên; hỗ trợ macOS/Linux cần triển khai riêng phần dò tiến trình và kho xác thực.

| Thành phần | Công nghệ mục tiêu | Trách nhiệm |
|---|---|---|
| Desktop host | Tauri 2 / Rust | Vòng đời app, single instance, tray, cửa sổ, theo dõi mép màn hình |
| UI | React + TypeScript | Provider tabs, quota, trạng thái, tương tác |
| Styling | Tailwind CSS | Token giao diện, bố cục, hiệu ứng |
| Provider adapters | Node.js giai đoạn đầu | Tái sử dụng giao thức đã kiểm chứng trong RnD |
| OS integration | Rust và helper cục bộ | Dò session, kết nối cục bộ, truy cập xác thực đúng phạm vi |

## Luồng dữ liệu mục tiêu

```text
React UI → Tauri command → provider coordinator → Node adapter / OS helper
React UI ← sanitized snapshot ← coordinator ← provider API / local RPC
```

Rust quản lý vòng đời Node worker và cửa sổ; worker quản lý lịch refresh 180 giây, dò process 2 giây và một job mỗi provider. React hiển thị snapshot và gửi hành động làm mới, ghim, chọn provider. Không đặt token vào React state, localStorage, event payload hoặc lỗi giao diện. Không cần HTTP server localhost để nối UI với adapter; dùng Tauri IPC và pipe tiến trình. Chỉ lựa chọn theme được lưu localStorage.

Node.js không đi kèm Tauri mặc định. `prepare-desktop.mjs` đóng gói Node hiện dùng để build cùng adapter/helper dưới `src-tauri/resources/`, bỏ qua test fixture và file dev `*.local.json`; credential Antigravity (định danh công khai của jcode/Antigravity, không phải bí mật) được ghi thành `antigravity-oauth.json` từ biến môi trường hoặc file dev khi build. `package-portable.mjs` tạo thư mục app portable; cấu hình bundle dùng NSIS cho Windows current user. Không yêu cầu người dùng sản phẩm tự cài Node. Không dùng đường dẫn executable hoặc URL do frontend cung cấp.

Worker spawn reader riêng cho từng provider, timeout 40 giây. Rust quản lý worker bằng Windows Job Object khi hệ điều hành cho phép để dọn cả helper khi thoát, không chạm tới tiến trình công cụ người dùng. Snapshot được allowlist lại tại coordinator, loại auth, identity thô và diagnostics không dùng cho UI.

Native edge watcher dùng vị trí chuột thật, khởi động hidden, hover 180 ms để mở compact 54×152 DIP và rời 650 ms để ẩn; không có giai đoạn giữ mở 15 giây. Hidden và compact dùng cùng envelope native 54×152 DIP, hidden bật click-through và chỉ xét dải trigger 5×100 DIP theo DPI thực. React giữ thanh mounted, animate transform/opacity thay cho resize native. Layout chỉ cập nhật size/position khi giá trị thay đổi. Detail vẫn neo cùng mép phải work area màn hình chính. Single-instance plugin gọi compact của app đang mở. Chưa hỗ trợ đa màn hình hoặc tự khởi động cùng Windows.

Tauri canonicalize đường dẫn resource thành dạng Windows verbatim. Trước khi truyền executable, script và working directory cho Node, dùng `worker_paths::for_node` để chuẩn hóa drive path tương đương; có regression tests gọi Node thật. Bản release chỉ dùng resource đóng gói, không fallback vào đường dẫn source trên máy build.

## Hợp đồng dữ liệu

Chuẩn hóa snapshot thành trạng thái, thời điểm đo, nguồn, các bucket và window. Mỗi window gồm ID ổn định, nhãn, thời lượng nếu biết, phần trăm còn lại và reset nếu có. Dữ liệu thiếu là `null` hoặc không có window, không mặc định 100%.

Prototype dùng `{ ok, code, error, updatedAt, connection, source, notice, buckets }`; bucket có `{ id, name, plan?, windows }`, window có `{ key, label?, minutes, remaining, resetsAt }`. `updatedAt` là ISO UTC; `resetsAt` là Unix giây. TypeScript contract sẽ được định nghĩa khi triển khai. Không dùng tên hiển thị làm danh tính model hoặc tài khoản.

## Vòng đời và đồng thời

- Gate theo công cụ đang chạy trước khi đọc auth hoặc gọi API; xác minh lại tiến trình gốc sau khi nhận dữ liệu.
- Một job mỗi provider tại một thời điểm; kết quả gắn provider và phiên để tránh hiển thị nhầm khi đổi tab.
- Hủy hoặc bỏ kết quả khi phiên đóng; không tự khởi chạy công cụ người dùng.
- Prototype dò process mỗi 2 giây, refresh mỗi 180 giây, dữ liệu quá 4 phút được đánh dấu cũ; UI chờ tối đa 40 giây. Đây là baseline, cần đo lại khi chuyển host.
- Tái sử dụng last successful snapshot khi lỗi tạm thời, giữ nguyên timestamp. Khi công cụ đóng phải xóa snapshot đang hiển thị.

## Ranh giới bảo mật

Chỉ backend đọc đúng kho credential của provider. Giới hạn endpoint cố định, xác thực TLS cho API từ xa, không theo redirect mang token. Trường hợp chứng chỉ tự ký chỉ được xử lý riêng cho listener loopback đã xác minh thuộc PID Antigravity. Không log command line, auth blob hoặc phản hồi upstream thô.

Tauri permissions phải giới hạn command cần dùng; frontend không có quyền shell tùy ý hay đọc file tùy ý. Adapter và helper đóng gói là tài nguyên tin cậy, không nhận executable path hoặc URL tùy ý từ giao diện.

## Chuyển đổi từ prototype

1. Thống nhất tài liệu và thiết kế trước khi triển khai.
2. Scaffold Tauri/React; định nghĩa snapshot contract và dữ liệu mẫu.
3. Nối các adapter đang có qua coordinator, bảo toàn điều kiện chạy và phạm vi credential.
4. Chuyển tương tác cửa sổ/tray khỏi PowerShell, kiểm tra DPI, màn hình và focus.
5. Kiểm tra với tài khoản thực, đóng gói runtime và installer; quyết định cập nhật app riêng.

Các file statusline Antigravity cũ trong `RnD/` là lịch sử nghiên cứu, không phải kiến trúc sản phẩm. Không sao chép cơ chế bắt restart session vào phiên bản mới.

## Nguồn tham khảo

- https://v2.tauri.app/concept/architecture/
- https://v2.tauri.app/reference/webview-versions/
- Adapter và tests thực tế trong `../RnD/`.
