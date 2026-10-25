# Design System

## Trạng thái

Giao diện đã chốt qua `RnD/theme-preview.html`: Geist, nền đen/xám trung tính, điểm nhấn Tokyo Night. Đã triển khai UI React tại root. Prototype WPF trong RnD là tham chiếu hành vi. Mục tiêu: nhìn nhanh biết công cụ nào đang chạy, quota còn bao nhiêu và khi nào reset.

Ngôn ngữ UI: **English only**. Tên trạng thái, thao tác, accessible names, lỗi adapter và menu tray đều dùng tiếng Anh. Ngày giờ hiển thị bằng locale `en-US`, vẫn giữ múi giờ máy người dùng. Các mô tả tiếng Việt trong tài liệu này giải thích thiết kế, không phải chuỗi đưa vào sản phẩm.

Compact gồm ba icon thật xếp dọc, hover/focus mới hiện cung quota 270 độ. Không nhãn, tooltip hay số hiển thị. Click mở detail từ cùng điểm neo bên phải, nút quay lại giữ nguyên điểm neo. Màu trạng thái quota áp dụng cho cung; icon chưa chạy, lỗi hoặc dữ liệu cũ mờ và không có cung quota giả.

## Bố cục

Icon app đã chốt: **Needle**, vòng cung đồng hồ đo với kim đặc, đơn sắc. App icon nền đen bo góc; tray dùng biểu tượng trắng ngà trên nền trong suốt. Nguồn vector chính trong `public/assets/app-icon.svg` và `app-mark.svg`, export PNG/ICO đa kích thước qua `scripts/generate-icons.mjs`. Các icon nhà cung cấp vẫn giữ riêng; build không cần archive RnD.

Panel neo mép phải màn hình, nền tối, bo góc phía trong. Header có tên app, ghim và chọn provider. Nội dung chính là các cửa sổ quota; footer có thời điểm cập nhật và làm mới. Danh sách dài cuộn trong vùng nội dung, giữ header/footer nhìn thấy.

Baseline kích thước lấy từ prototype: rộng 348 DIP, cao tối đa 600 DIP và luôn nằm trong work area trừ khoảng đệm 24 DIP. Cần kiểm tra DPI và nhãn tiếng Việt trên bản Tauri; chưa coi con số này là giới hạn cứng của thiết kế sản phẩm.

## Màu sắc đề xuất

| Token | Giá trị | Dùng cho |
|---|---|---|
| surface | `#111111` | Nền panel |
| surface-raised | `#171717` | Card và nút |
| border | `#2A2A2A` | Viền và phân tách |
| text-primary | `#EDEDED` | Nội dung chính |
| text-secondary | `#929292` | Chú thích và inactive |
| accent | `#7AA2F7` | Điều khiển active |
| warning | `#E0AF68` | Quota thấp hoặc lỗi tạm thời |
| danger | `#F7768E` | Quota rất thấp hoặc hết |

Màu riêng từng provider chỉ dùng nhận diện, không thay màu ngữ nghĩa của quota. Chốt màu thương hiệu/icon ở bước thiết kế, không tự dùng logo chưa kiểm tra quyền sử dụng.

## Typography và khoảng cách

Font Geist và Geist Mono được đóng gói cục bộ. Tiêu đề 23 px, số quota 32 px, phần nội dung phụ 10–12 px theo preview đã duyệt; cần tiếp tục xác minh độ đọc ở DPI thực. Khoảng cách theo thang 4, 8, 12, 16, 24 px. Kiểm tra tương phản thực tế, không chỉ dựa trên bảng màu.

## Quota và phân nhóm

- Thanh thể hiện **phần còn lại**, kèm số phần trăm bằng chữ. Không trộn used và remaining giữa các provider.
- Trên 25%: trạng thái bình thường; trên 10% đến 25%: cảnh báo; tối đa 10%: nguy cấp. Không chỉ dùng màu để truyền đạt.
- Window tuần/5 giờ nổi bật khi nguồn có dữ liệu. Quota model chưa rõ window phải ghi rõ “Hạn mức model”.
- Antigravity có thể có nhiều model: chi tiết được thu gọn, không coi cùng tên/percent là cùng pool. Thiết kế nhóm không được làm mất identity hay che nguồn dữ liệu khác nhau.
- Reset hiển thị giờ địa phương, có nhãn rõ; chỉ đếm ngược khi nguồn reset đáng tin. Không gọi reset là hết hạn subscription.
- Hiển thị phần trăm tối đa một chữ số thập phân; thiếu là “Chưa có dữ liệu”, không dùng 100% hay thanh đầy.

## Trạng thái giao diện

| Trạng thái | Biểu hiện |
|---|---|
| Chưa chạy | Tên công cụ + “chưa chạy”, không còn card quota cũ |
| Đang cập nhật lần đầu | Chỉ báo tải có giới hạn thời gian |
| Đang cập nhật lại | Giữ quota và timestamp cũ, báo đang cập nhật |
| Có dữ liệu | Phần trăm, reset và thời điểm đo |
| Dữ liệu một phần | Hiện phần đo được, ghi rõ phần thiếu |
| Dữ liệu cũ | Nhãn cũ sau 4 phút theo baseline prototype |
| Lỗi | Thông báo dễ hiểu, nút thử lại; không tự dẫn sang đăng nhập |

Không hiện token, auth blob, raw error hoặc thông tin triển khai trong luồng sử dụng thường. Chi tiết chẩn đoán nếu có phải được làm sạch. Ghi rõ nguồn tài khoản khi dữ liệu không được xác minh là của session hiện tại.

## Tương tác

Vùng mép nhìn thấy rộng 5 DIP và cao 100 DIP; app khởi động ẩn, hover 180 ms mở compact 54×152 DIP, rời 650 ms tự ẩn. Hidden và compact dùng chung khung cửa sổ native 54×152 DIP; trạng thái hidden cho chuột đi xuyên qua, native watcher chỉ xét dải mép thật. Thanh trượt bằng transform/opacity trong 240 ms, thu lại trong 200 ms, không resize cửa sổ hoặc remount thanh giữa hai trạng thái. Hỗ trợ reduced motion. Đã bỏ giai đoạn hiện 15 giây. Ghim ngăn tự ẩn. Tray có mở, ẩn và thoát.

Bản sản phẩm cần animation trượt ngắn khoảng 160–220 ms, hỗ trợ reduced motion. Hover không được cướp focus khi người dùng đang gõ trong terminal. Không đóng panel khi focus còn trong panel hoặc menu đang mở. Cần có cách mở qua tray và thao tác bàn phím, không phụ thuộc hover.

## Kiểm tra thiết kế trước phát hành

Kiểm tra nhãn dài/tiếng Việt, quota 0% và 100%, reset không có, dữ liệu một phần, lỗi quyền, mất mạng, chuyển tab lúc tải, màn hình nhỏ và DPI 100/125/150/200%. Đo hit area, contrast, keyboard focus và hành vi khi ứng dụng khác fullscreen. Multi-monitor và auto-start chưa được xác nhận trong phạm vi prototype.
