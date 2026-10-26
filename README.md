# Quota Peek

Ứng dụng desktop giúp lập trình viên xem quota Codex, Antigravity và Claude Code mà không phải gõ lệnh kiểm tra trong từng công cụ.

Ngôn ngữ sản phẩm là **tiếng Anh**, bao gồm giao diện, trạng thái, thông báo lỗi, menu khay hệ thống và launcher. Không có giao diện tiếng Việt hoặc lựa chọn ngôn ngữ trong phiên bản hiện tại; tài liệu nghiên cứu vẫn có thể dùng tiếng Việt.

Panel mặc định ẩn ở mép màn hình, trượt ra khi rê chuột và có thể ghim để theo dõi. Hiển thị phần trăm còn lại, thời điểm reset, trạng thái công cụ và độ mới của dữ liệu.

## Hai chế độ xem

**Compact:** khi trượt ra chỉ hiện ba icon Codex, Antigravity và Claude Code xếp dọc. Hover hoặc focus một icon làm hiện vòng cung hình móng ngựa quanh viền, biểu diễn quota còn lại; không có nhãn, tooltip hay số phần trăm. Vòng cung đứng yên, không phải loading spinner. Click icon mở chi tiết đúng công cụ; có nút quay lại compact.

| Icon | Quota dùng cho vòng cung |
|---|---|
| Codex | Cửa sổ 5 giờ |
| Antigravity | Model phiên bản cao nhất được nguồn trả về, ví dụ Argon 4; không chọn model có phần trăm cao nhất |
| Claude Code | Cửa sổ 5 giờ |

Nếu chưa chạy hoặc thiếu quota phù hợp, icon mờ và không hiện vòng quota giả. Không fallback từ quota 5 giờ sang tuần. Quy tắc xếp thứ tự phiên bản giữa các họ model Antigravity (so sánh từng phần số, ưu tiên Argon khi cùng phiên bản, lấy phần trăm thấp nhất đã đo khi cùng phiên bản và họ) được cài trong `src/selectors.ts`; preview dùng model mẫu Argon 4. Accessible name cho trình đọc màn hình vẫn có tên công cụ và trạng thái dù không hiện nhãn bằng mắt.

**Chi tiết:** giữ tabs, các cửa sổ quota, thời điểm reset, chi tiết model và trạng thái cập nhật như thiết kế hiện tại. Khi click icon, panel chi tiết mở rộng vào trong từ cùng điểm neo ở mép màn hình của thanh compact; không mở modal ở giữa màn hình. Quay lại compact vẫn giữ nguyên điểm neo.

Chạy `npm.cmd run dev:web`, mở `http://127.0.0.1:1420/?preview=1` để thử hai chế độ với dữ liệu minh họa. Phong cách: nền đen/xám trung tính, font Geist, điểm nhấn xanh tím Tokyo Night.

## Nguyên tắc sản phẩm

- Chỉ kiểm tra khi công cụ tương ứng đang chạy; nếu chưa chạy, thông báo rõ và xóa dữ liệu cũ.
- Tận dụng xác thực có sẵn trên máy; không yêu cầu đăng nhập vào Quota Peek.
- Không đóng session, tự mở phiên tương tác hoặc bắt người dùng đăng nhập lại để nhận quota.
- Phân biệt quota theo tài khoản với dữ liệu lấy trực tiếp từ phiên đang chạy.
- Không bịa phần trăm, cửa sổ thời gian hoặc ngày hết hạn subscription khi nguồn không cung cấp.
- Credential ở backend cục bộ; giao diện chỉ nhận dữ liệu quota đã chuẩn hóa. Không có server hay telemetry của Quota Peek.

## Trạng thái dự án

Phiên bản desktop dùng **Tauri 2 + React + TypeScript + Tailwind CSS**, với adapter sản phẩm trong `providers/` và Node runtime đóng gói cùng app. `RnD/` là archive cục bộ đã được gitignore; app, tests, icon và quá trình build không cần thư mục đó. Checkout source mới có đầy đủ mã trong `src/`, `providers/`, `public/`, `scripts/` và `src-tauri/`.

Độ đầy đủ quota phụ thuộc API, quyền và tài khoản từng nhà cung cấp. Windows là nền tảng đầu tiên; chưa hỗ trợ WSL, remote hoặc chọn giữa nhiều tài khoản. App chưa có auto-start hay auto-update.

## Chạy bản desktop

Trong quá trình phát triển, chạy **`npm run dev`** để mở cả Vite và Tauri, có cập nhật giao diện khi sửa code. `desktop:dev` là alias tương đương. Không dùng launcher riêng. Dừng phiên dev hiện tại bằng Ctrl+C trước khi chạy phiên mới.

Sau khi build bản portable, mở `release/Quota Peek/quota-peek.exe` trực tiếp. Giữ nguyên cả thư mục portable khi di chuyển, vì app cần runtime và adapter trong `resources/`. Bản portable và installer chưa được ký số nên Windows SmartScreen sẽ hiện cảnh báo: chọn More info rồi Run anyway. Installer NSIS cài theo từng người dùng (không cần quyền admin) và tự cài WebView2 Evergreen nếu máy còn thiếu.

App khởi động ẩn ngay ở mép phải màn hình chính. Rê chuột vào vạch mép 180 ms để mở thanh compact 54×152 DIP; thanh trượt ra trong 240 ms bằng animation, không resize cửa sổ giữa hidden và compact. Rời chuột 650 ms để tự ẩn, không có thời gian giữ mở 15 giây. Khi ẩn, phần trong suốt cho phép click vào app phía dưới. Dùng khay hệ thống để mở/ẩn/thoát; ghim trong chế độ chi tiết để giữ panel mở.

Nếu đang dùng bản app cũ, thoát riêng Quota Peek cũ trước khi chạy chế độ dev. Không đóng các phiên Codex, Antigravity hoặc Claude Code.

## Phát triển và build

Yêu cầu Node.js 24+ để phát triển và chạy tests, Rust stable và Visual Studio C++ Build Tools trên Windows. Người dùng bản đóng gói không cần tự cài Node. WebView2 được dùng để hiển thị UI.

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run desktop:build
npm.cmd run desktop:installer
```

`desktop:build` tạo executable và bản portable. `desktop:installer` là bước tùy chọn sau đó để tạo installer NSIS trong `src-tauri/target/release/bundle/nsis/`. `package:portable` dùng để đóng gói lại executable đã build mà không compile lại.

Antigravity dùng client id/secret OAuth công khai của ứng dụng cài sẵn, giống jcode và Antigravity IDE; đây không phải bí mật của riêng bạn và không cần Google Cloud project. Đặt giá trị trong `providers/antigravity-oauth.local.json` (đã gitignore để tránh cảnh báo secret scanning của GitHub) hoặc biến môi trường `QUOTA_PEEK_ANTIGRAVITY_CLIENT_ID` và `QUOTA_PEEK_ANTIGRAVITY_CLIENT_SECRET`. `prepare:desktop` đọc các giá trị này và ghi `resources/providers/antigravity-oauth.json` để đóng gói; file `.local.json` không được copy thẳng vào resources. Vì là định danh công khai nên đóng gói là bình thường, không cần xoay (rotate).

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
```

`npm.cmd run dev:web` chỉ mở UI trình duyệt ở `http://127.0.0.1:1420`; thêm `?preview=1` để dùng dữ liệu minh họa. Browser mặc định không giả vờ đã kết nối quota. Giao diện web không đọc credential hoặc gọi API provider.

Các script build đặt cache Cargo/npm trong workspace. Bridge registry chỉ phục vụ build: Node thực hiện HTTPS xác minh chứng chỉ tới crates.io, Cargo dùng loopback; không tắt TLS verification và không đưa bridge này vào app. Bridge ưu tiên cổng 38471 (đổi bằng `QUOTA_PEEK_CARGO_PORT`) và tự chuyển sang cổng tạm nếu cổng đã bận, nên có thể chạy nhiều build desktop song song.

### Publish bản phát hành

Sau khi build portable và installer, chạy `npm run package:release` để tạo ZIP và checksum. Chạy `npm run release:publish` từ terminal của người phát hành để commit source, push `main`, tạo tag đúng theo `version` trong `package.json`, upload binary và publish GitHub release tới `thethien2906/harness-quota-check` (đổi repo bằng biến môi trường `QUOTA_PEEK_RELEASE_REPO`).

Script dùng GitHub CLI đang cài hoặc bản portable trong `.cache/gh/bin/gh.exe`; dùng xác thực GitHub hiện có, chỉ yêu cầu đăng nhập qua trình duyệt nếu chưa có. Không ghi token vào repo hoặc truyền token qua tham số lệnh. Không force-push, không di chuyển tag đã tồn tại, kiểm tra không track archive/build output trước khi push. `RnD/` luôn được ignore.

### Kiểm chứng hiện tại

Đã tạo bản source riêng không có `RnD/`, dependency hay output build cũ: `npm ci`, build frontend, chuẩn bị runtime, tái tạo icon và build release Windows x64 đều thành công từ bản source đó. Cache Rust được tái sử dụng, nhưng mã app và tài nguyên được đọc từ bản source độc lập. Bộ kiểm tra hiện tại có 65 kiểm tra adapter/coordinator/logic, 7 kiểm tra Rust (đường dẫn Windows, geometry của trigger và DPI) và 6 kiểm tra UI, đều pass.

Lỗi bộ đọc thoát khi nhận đường dẫn `\\?\C:\...` từ Tauri đã được tái hiện và sửa bằng chuẩn hóa đường dẫn trước khi gọi Node. Quota tài khoản thật trong host Tauri cần xác nhận khi mở trực tiếp từ Windows; môi trường sandbox không truy cập đầy đủ profile/WebView/credential của người dùng.

## Cấu trúc

```text
README.md
src/                    React UI, hợp đồng dữ liệu và lựa chọn compact quota
providers/              Adapter sản phẩm và worker/coordinator
src-tauri/              Desktop host Rust, tray, cửa sổ và IPC
scripts/                Build và đóng gói runtime
docs/
  ARCHITECTURE.md        Kiến trúc mục tiêu và kế hoạch chuyển đổi
  PROVIDER_BEHAVIOR.md   Quy tắc nghiệp vụ, nguồn dữ liệu và lưu ý từng provider
  DESIGN_SYSTEM.md       Quy ước giao diện và tương tác
```

## Tài liệu

- [Kiến trúc](docs/ARCHITECTURE.md)
- [Hành vi và giới hạn provider](docs/PROVIDER_BEHAVIOR.md)
- [Hệ thống thiết kế](docs/DESIGN_SYSTEM.md)

Archive `RnD/` chỉ có trên máy nghiên cứu nếu được giữ lại, không nằm trong các bước chạy/build của repo.
