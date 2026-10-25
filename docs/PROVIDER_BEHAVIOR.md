# Provider Behavior

Tài liệu ghi nhận quy tắc nghiệp vụ và giới hạn tích hợp tại 2026-10-25. API nội bộ có thể thay đổi. Phân biệt kết quả đã quan sát với giả định cần xác minh; test mô phỏng pass không chứng minh mọi tài khoản đều trả đủ quota.

## Quy tắc chung

Bản sản phẩm dùng adapter trong `providers/`; các đường dẫn `RnD/` phía dưới là nguồn nghiên cứu gốc. Worker gate trước khi gọi adapter, đồng thời adapter vẫn tự kiểm tra lại phiên.

- Chỉ lấy quota khi provider đang chạy. Không dùng quota tài khoản đã lưu để ngụ ý đang kết nối trực tiếp với session.
- Không yêu cầu đăng nhập riêng, restart công cụ hoặc thay đổi session để bật theo dõi.
- Mọi phần trăm trên UI là **còn lại**. Claude trả utilization đã dùng, cần đổi bằng `100 - utilization`.
- Chỉ nhận số hữu hạn trong miền hợp lệ. Thiếu, null hoặc lỗi parse không có nghĩa là 0% hoặc 100%.
- Không suy ra quota tuần từ quota model, không cộng hoặc lấy trung bình các pool khác nhau.
- Không suy ra ngày hết hạn subscription từ thời điểm reset quota.
- Lỗi phải phân biệt chưa chạy, quyền truy cập, auth không dùng được, timeout, rate limit và thiếu dữ liệu.
- Dữ liệu cũ giữ timestamp lần đo thành công và được đánh dấu. Công cụ đóng thì xóa dữ liệu.
- Chưa hỗ trợ chọn nhiều tài khoản. Credential kế thừa từ môi trường panel không chứng minh trùng cấu hình chỉ tồn tại trong terminal khác.

## Codex

**Nguồn:** RPC `account/rateLimits/read` qua Codex app-server. Dò process tên `codex`, chọn executable/home phù hợp. Daemon dùng `codex app-server proxy` với HTTP Upgrade/WebSocket; CLI độc lập mở app-server đọc tạm rồi đóng helper. Helper không tạo hội thoại hay gọi model.

**Xác thực:** Codex tự quản lý; app không đọc/copy credential. Ưu tiên `CODEX_HOME` kế thừa, sau đó home suy từ daemon, cuối cùng `%USERPROFILE%/.codex`.

**Fallback:** Khi socket thiếu hoặc protocol không tương thích, thử app-server trực tiếp với cùng CLI/home. Không đổi transport để vượt lỗi quyền bị chặn. Kiểm tra PID gốc còn tồn tại trước khi dùng dữ liệu.

**Giới hạn:** API key không tương đương quota subscription ChatGPT. WSL, remote, Windows user khác hoặc auth chỉ trong bộ nhớ có thể không truy cập được. Ngày hết hạn subscription chưa có nguồn đáng tin cậy. Người dùng đã xác nhận quota Codex hoạt động trong prototype.

**Tham chiếu:** `RnD/quota.mjs`, `runtime.mjs`, `websocket-stream.mjs` và tests tương ứng.

## Antigravity / agy

**Gate:** CLI `agy`, IDE Antigravity hoặc language server thuộc đường dẫn Antigravity. Không nhận nhầm Windsurf chỉ vì tên language server giống nhau.

**Xác thực:** Ưu tiên đúng Windows Credential Manager target `gemini:antigravity`; fallback đúng `%USERPROFILE%/.jcode/antigravity_oauth.json`. Không quét credential khác. Chỉ truyền blob qua private pipe trong backend. jcode auth có thể thuộc tài khoản khác với phiên agy, phải ghi rõ nguồn.

**Luồng mặc định theo jcode:** Mỗi lần refresh gọi `fetchAvailableModels` trước, không chờ summary thiếu. Nếu project không dùng được hoặc catalog rỗng, dùng `loadCodeAssist` lấy project rồi thử lại; không tự onboard project. Đọc catalog production và daily, thêm model còn thiếu theo ID. Không hardcode danh sách phiên bản Gemini; model không có displayName dùng ID. Không hiện model internal hoặc model thiếu fraction hợp lệ.

**Summary bổ sung:** Gọi `retrieveUserQuotaSummary` để có nhóm và cửa sổ tuần/5 giờ khi API cung cấp. Production được ưu tiên khi trùng window; daily bổ sung cửa sổ còn thiếu. Quota model và summary giữ riêng. Các model cùng tên không được gộp nếu ID khác; pool khác như Argon không được suy thành cùng pool Gemini thông thường.

**Quan sát thực tế:** OAuth có sẵn của agy đọc được Claude/GPT tuần và 5 giờ. Trong phản hồi đã chẩn đoán, cả production và daily summary đều chỉ có Claude/GPT, dù `/usage` trong agy có thể hiển thị Gemini. Điều này chưa chứng minh Google không có dữ liệu Gemini; request/context nội bộ có thể khác. Sau khi thêm catalog, người dùng thấy quota Gemini 3.5; việc bổ sung catalog daily để tìm model mới đã triển khai nhưng chưa có xác nhận đầy đủ model thực tế.

**Không gán sai thời gian:** `fetchAvailableModels.quotaInfo` chỉ là quota model cùng reset API cung cấp; không tự gọi là tuần hay 5 giờ. Catalog toàn 100% bị đánh dấu chưa xác minh thay vì khẳng định pool đầy. Nếu summary vẫn hợp lệ, giữ summary.

**Compact:** chọn phiên bản số cao nhất trong các model Gemini/Argon có window `model` đo được; so sánh các phần số, không so sánh chuỗi hoặc phần trăm. Cùng phiên bản ưu tiên họ Argon; cùng họ/phiên bản nhưng có nhiều biến thể thì lấy quota thấp nhất đã đo. Không fallback sang Claude/GPT hoặc summary tuần nếu không nhận diện được phiên bản. Preview dùng fixture, còn sản phẩm chọn từ dữ liệu API thật; dữ liệu lỗi/quá cũ không hiện vòng gauge.

**Fallback local:** Nếu OAuth không dùng được, thử RPC của server CLI/IDE đang chạy trên listener thuộc PID đã xác minh. CSRF chỉ ở bộ nhớ và chỉ gửi loopback. IDE trùng được gộp khi xác minh cùng tài khoản; phần trăm giống nhau không đủ để gộp. Local legacy model quota không được suy diễn cửa sổ tuần.

**Token:** Google refresh dùng token lưu sẵn, giữ kết quả trong bộ nhớ, không ghi đè credential agy/jcode. Không mở browser/login. Endpoint allowlist ở `antigravity-oauth.mjs`. Client id/secret OAuth không nằm trong source: đọc từ `QUOTA_PEEK_ANTIGRAVITY_CLIENT_ID`/`QUOTA_PEEK_ANTIGRAVITY_CLIENT_SECRET` hoặc file cục bộ `antigravity-oauth.local.json` cùng thư mục adapter (gitignored, được đóng gói vào resources khi build).

**Cơ chế đã loại:** Statusline bridge và nút Kết nối CLI buộc mở lại agy. Các file legacy giữ trong RnD để tham chiếu và cleanup; không dùng cho luồng quota hiện tại. Sau khi di chuyển thư mục, cleanup khớp đường dẫn mới có thể không nhận bridge cũ ở đường dẫn root; không được ghi đè statusline tùy chỉnh để giải quyết.

**Tham chiếu:** `RnD/ANTIGRAVITY.md`, `antigravity.mjs`, `antigravity-oauth.mjs`, helpers và tests. Cách catalog dựa trên https://github.com/1jehuang/jcode/blob/master/crates/jcode-base/src/provider/antigravity.rs.

## Claude Code

**Gate:** Native process `claude.exe`; với bản npm, chỉ nhận Node command line thuộc `@anthropic-ai/claude-code`. Chỉ emit PID, không log arguments. Không nhận mọi `node.exe` là Claude. Dò process bị chặn là lỗi quyền/detection, không kết luận chưa chạy.

**Xác thực:** Đọc `CLAUDE_CONFIG_DIR/.credentials.json`, nếu không có biến thì `%USERPROFILE%/.claude/.credentials.json`; dùng `claudeAiOauth.accessToken`. Không dùng browser cookie hoặc API key thay cho OAuth subscription.

**API:** `GET https://api.anthropic.com/api/oauth/usage`, header beta `oauth-2025-04-20`. Chỉ gọi HTTPS tới endpoint cố định, không theo redirect. Các window được hỗ trợ: `five_hour`, `seven_day`, `seven_day_sonnet`, `seven_day_opus`, `seven_day_oauth_apps`. Omit window thiếu/không hợp lệ; reset lấy `resets_at`.

**Gia hạn:** Không tự refresh vì refresh token có thể xoay, làm lệch credential của CLI. Nếu token hết hạn hoặc bị từ chối, chờ Claude Code cập nhật rồi đọc lại. Không bắt đăng nhập lại như bước kết nối app.

**Giới hạn:** OAuth thiếu quyền usage, tài khoản API key, config ở terminal khác, WSL hoặc profile khác chưa được đảm bảo. Usage credits/chi tiêu và ngày hết hạn gói không nằm trong phạm vi hiện tại. Người dùng đã báo app có vẻ hoạt động sau khi thêm Claude; chưa có chẩn đoán xác nhận đầy đủ mọi window.

**Tham chiếu:** `RnD/CLAUDE.md`, `claude.mjs`, `discover-claude.ps1`, `claude.test.mjs`; giao thức đối chiếu https://github.com/steipete/CodexBar/blob/main/docs/claude.md.
