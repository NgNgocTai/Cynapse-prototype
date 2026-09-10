# Kế Hoạch Triển Khai & Tiêu Chuẩn Bảo Mật: Enterprise Ansible Role Import & Execution Safety

> **Trạng thái:** `COMPLETED & VERIFIED` (Đạt 12/12 kiểm thử an ninh chuyên sâu và 9/9 hồi quy)  
> **Nhánh Git:** `dev`  
> **Tài liệu tham chiếu chuẩn:** [Red Hat Ansible Docs - Role Directory Structure](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-directory-structure)

---

## 1. Bối Cảnh & Các Rủi Ro An Ninh Mở Rộng

Hệ thống Synapse cho phép người dùng tự đưa kịch bản tự động hóa (Ansible Role / Playbook) vào Catalog để chạy trên hạ tầng máy chủ thật (như cụm PostgreSQL Patroni `db01`). Qua 4 vòng rà soát chuyên sâu, các khoảng trống bảo mật còn lại đã được xử lý triệt để:

### 1.1. Zip Bomb: Ngăn Chặn OOM Tận Gốc Với Trần Bộ Nhớ C++ (`zlib.inflateRawSync`)
- **Vấn đề đã nhận diện:** Nếu chỉ đo dung lượng `content.length` sau khi gọi `entry.getData()`, thì đối với file nén độc hại (ví dụ 10KB nén ra 5GB), hàm `getData()` sẽ giải nén toàn bộ vào RAM cùng một lúc làm crash tiến trình (OOM) trước khi code kịp đo `content.length`.
- **Giải pháp triệt để:** 
  - Thay thế việc giải nén unconstrained bằng `zlib.inflateRawSync(compressed, { maxOutputLength: remainingAllowedBytes })`.
  - Node.js native zlib áp trần bộ nhớ ngay tại tầng C++ runtime. Nếu dữ liệu giải nén vượt quá `maxOutputLength` (giới hạn an toàn 50MB), native zlib sẽ ném ngay lỗi `ERR_BUFFER_TOO_LARGE` và ngắt tiến trình **trước khi RAM bị cấp phát tràn**.

### 1.2. Định Vị Đúng Vai Trò Của Gate 2b (Static Linter) & Chống Obfuscation
- **Phân định rõ ràng:** Bộ regex quét mã độc không phải là chiếc đũa thần chống lại kẻ tấn công có chủ đích cố tình obfuscate chuỗi (`base64 -d | sh`, python inline, quote-splitting).
- **Thiết kế thực tế:**
  - Gate 2b đóng vai trò **Static Hygiene Filter / Linter Tự Động** (bắt lỗi vô tình, mã độc thô, script tải từ ngoài vào, key nhúng trong code).
  - Bổ sung nhận diện các kỹ thuật obfuscation phổ biến: `base64 -d | sh`, `python/perl -c`, `lookup('pipe', ...)`, SSTI trong Jinja.
  - **Hàng rào an ninh thật sự** là cơ chế **Approval Workflow (Gate 4)**: Toàn bộ role mới vào bắt buộc ở trạng thái `DRAFT` và bị khóa cứng 100% không thể thực thi nếu chưa qua Quản trị viên duyệt.

### 1.3. Mở Rộng Phạm Vi Quét Của Gate 2b (Toàn Diện Mọi Thư Mục)
Không chỉ giới hạn trong `tasks/main.yml`, hàm `scanRoleSecurityComprehensive(roleDir)` quét toàn diện cây thư mục:
- **`tasks/` & `handlers/`:** Quét toàn bộ file YAML để phát hiện lệnh shell tùy ý, download script, reverse shell, hoặc module nguy hiểm (`shell`, `raw`, `fetch`).
- **`templates/` (.j2, .jinja2):** Quét phát hiện mã khai thác Server-Side Template Injection (SSTI / Python introspection: `__class__`, `__subclasses__`, `subprocess`), payload tải shell từ xa.
- **`vars/` & `defaults/`:** Quét phát hiện hàm `lookup('pipe', ...)` (thực thi mã tùy ý trên Controller node) hoặc đọc lén file nhạy cảm `lookup('file', '/etc/shadow')`.

### 1.4. Tầng Xác Thực & Phân Quyền (AuthN / AuthZ) Cho Endpoint Publish
- Triển khai middleware `adminAuthGuard` bảo vệ trực tiếp endpoint `POST /api/actions/:id/publish`.
- Kiểm tra header `x-admin-token` hoặc `Authorization: Bearer <token>` đối chiếu với `ADMIN_API_KEY` từ biến môi trường.
- Nếu không có quyền Quản trị viên, từ chối với HTTP 403 và ghi nhật ký Audit vi phạm bảo mật.

---

## 2. Tiêu Chuẩn Cấu Trúc Thư Mục Role Hợp Lệ

```text
<role_name>/
├── tasks/
│   └── main.yml        # [BẮT BUỘC] Entrypoint chứa danh sách tác vụ Ansible
├── defaults/
│   └── main.yml        # [KHUYẾN NGHỊ] Khai báo biến mặc định (Synapse tự sinh Form Inputs)
├── vars/
│   └── main.yml        # [HỢP LỆ] Biến nội bộ của role (được quét an ninh)
├── handlers/
│   └── main.yml        # [HỢP LỆ] Handler kích hoạt qua notify (được quét an ninh)
├── templates/          # [HỢP LỆ] Chứa template Jinja2 (.j2 - được quét chống SSTI)
├── files/              # [HỢP LỆ] File tĩnh, script chuyển giao
├── meta/
│   └── main.yml        # [HỢP LỆ] Metadata tác giả, license
├── tests/              # [HỢP LỆ] Kịch bản test
├── README.md           # [HỢP LỆ - FILE ROOT] Tài liệu hướng dẫn
└── LICENSE             # [HỢP LỆ - FILE ROOT] Giấy phép sử dụng
```

> ⛔ **KHÔNG HỖ TRỢ qua Self-Service Import:** `library/`, `lookup_plugins/`, `filter_plugins/`, `module_utils/`, `callback_plugins/`, `connection_plugins/`, `action_plugins/`, `inventory_plugins/` — Python là ngôn ngữ Turing-complete, không thể kiểm toán tự động.

---

## 3. Bảng Tổng Hợp 11 Chốt Chặn Bảo Mật

| Chốt Chặn | Phạm Vi | Cơ Chế Kỹ Thuật | Hành Vi |
| :--- | :--- | :--- | :---: |
| **Gate 1a** | Tên Role | Regex `/^[a-z0-9_]+$/` (Galaxy compliant). Chặn dấu `-`, chữ hoa, ký tự lạ. | **BLOCK** |
| **Gate 1b** | Zip-Slip (Windows + POSIX) | Chuẩn hóa `/` & `\`. Chặn UNC (`\\`), Windows Drive (`C:`), DOS Devices (`CON`, `PRN`...). Canonical path boundary check. | **BLOCK** |
| **Gate 1c** | Symlink Traversal | Chặn entry symlink trong zip. Duyệt thư mục bằng `fs.lstatSync` (tuyệt đối không follow symlink). | **BLOCK** |
| **Gate 1d** | Zip Bomb (C++ Ceiling) | Native `zlib.inflateRawSync({ maxOutputLength })` chặn đứng OOM trước khi cấp phát RAM. | **BLOCK** |
| **Gate 1e** | Secret Leaks | Quét `SENSITIVE_PATTERNS` (`.env`, `*.pem`, `id_rsa`, `credentials.json`). | **WARN** |
| **Gate 1f** | Cấu trúc Thư mục | Bắt buộc `tasks/main.yml`. Phân tách thư mục con & file root (không dùng wildcard). | **BLOCK** |
| **Gate 1g** | **Python Plugin Dirs** | **Reject cứng `library/`, `lookup_plugins/`, `filter_plugins/`, `module_utils/`, `callback_plugins/`, `connection_plugins/`, `action_plugins/`, `inventory_plugins/`.** Python là ngôn ngữ Turing-complete — không thể kiểm toán tự động một cách tin cậy. | **BLOCK** |
| **Gate 2a** | Syntax Check | Chạy `ansible-playbook --syntax-check` qua `child_process.spawn(bin, args)` an toàn. | **BLOCK** |
| **Gate 2b** | Execution Safety (Toàn Diện) | Quét tasks, handlers, templates, vars/defaults. Chặn `curl\|bash`, `/etc/shadow`, `rm -rf /`, SSTI, reverse shell, lookup pipe. Cảnh báo module `shell`, `raw`, `script`, `fetch`. | **BLOCK (Mã độc)<br>WARN (Module)** |
| **Gate 3** | Form Generation | Tự trích xuất biến Jinja2 từ `defaults/main.yml` và `tasks/main.yml`. | **AUTO** |
| **Gate 4** | DRAFT Enforcement & Admin Auth | Action mới import mang cờ `DRAFT`. Chặn tạo plan (HTTP 403), chặn thực thi (HTTP 403), chặn add blueprint (HTTP 400). Publish endpoint được bảo vệ bởi `adminAuthGuard` với `crypto.timingSafeEqual`. | **BLOCK** |

---

## 4. Hardening Bổ Sung (Vòng 5)

### 4.1. Chặn Cứng Python Plugin Directories (Gate 1g)

**Lý do thiết kế:** Khác với YAML task (đọc dễ, ý đồ độc hại lộ rõ qua pattern matching), Python là ngôn ngữ Turing-complete — `eval(base64.b64decode(...))`, `pickle.loads()` từ nguồn không tin cậy, hay logic độc hại split/obfuscate đều nằm ngoài khả năng quét tĩnh. Yêu cầu "admin audit thủ công" cho Python module đặt gánh nặng security review vượt quá năng lực thực tế của admin vận hành.

**Quyết định:** Loại bỏ hoàn toàn bề mặt tấn công thay vì cố giảm nhẹ:
- `ALLOWED_ROLE_SUBDIRS` chỉ còn: `tasks`, `defaults`, `vars`, `handlers`, `templates`, `files`, `meta`, `tests`
- `REJECTED_PLUGIN_DIRS`: `library`, `lookup_plugins`, `filter_plugins`, `module_utils`, `callback_plugins`, `connection_plugins`, `action_plugins`, `inventory_plugins`
- Message: *"Liên hệ Quản trị viên để thêm thủ công ngoài luồng Self-Service"*

### 4.2. Fail-Closed Admin AuthZ & Timing-Safe Comparison (`crypto.timingSafeEqual`)

- **Nguyên tắc Fail-Closed:**
  - Nếu `ADMIN_API_KEY` chưa được cấu hình trong biến môi trường server (`.env`), `adminAuthGuard` ngay lập tức từ chối với **HTTP 500** và ghi nhật ký Audit cảnh báo lỗi cấu hình. Tuyệt đối **không bao giờ fail-open** (không cho phép bỏ qua xác thực).
  - Nếu request thiếu header `x-admin-token` hoặc sai key, từ chối với **HTTP 403 Forbidden**.
  - Frontend tự động kiểm tra token trong `localStorage`, hiển thị prompt yêu cầu nhập Admin API Key khi Publish, và xóa cache nếu key không hợp lệ.
- **Timing-Safe Comparison:**
  - Thay thế so sánh chuỗi `providedKey !== adminKey` bằng `safeCompare()` sử dụng `crypto.timingSafeEqual`.
  - **Pitfall đã xử lý:** `timingSafeEqual` ném exception nếu 2 buffer khác độ dài → kiểm tra `bufA.length !== bufB.length` trước (độ dài không phải thông tin bí mật, chỉ nội dung mới cần constant-time).

### 4.3. Upload Rate-Limiting & DRAFT Governance

> **⚠️ QUAN TRỌNG:** Rate-limit là biện pháp giảm nhẹ tạm thời cho môi trường single-user/local. Nếu Synapse mở rộng ra network/multi-user thật, 2 endpoint `/api/roles/import` và `/api/roles/validate` **BẮT BUỘC** cần AuthN tối thiểu (API key/session check đơn giản) trước khi coi là an toàn. Rate-limit **KHÔNG** thay thế AuthZ.

| Cơ chế | Giá trị | Mục đích |
| :--- | :--- | :--- |
| Upload rate-limit (sliding window) | **30 req/min per IP** (mặc định, tùy biến qua `MAX_UPLOAD_PER_MIN`, hỗ trợ test & admin bypass) | Chặn spam/DoS tự động |
| DRAFT cap (hệ thống) | **20 DRAFT tối đa** (`MAX_PENDING_DRAFTS`) | Chặn disk-fill qua upload "chậm rãi, đều đặn, dưới ngưỡng limit" |
| **DRAFT cap (theo IP)** | **5 DRAFT tối đa / IP** (`MAX_PENDING_DRAFTS_PER_IP`) | **Chống DoS chiếm dụng:** Ngăn chặn một cá nhân/IP đơn lẻ spam lấp đầy toàn bộ 20 slot của hệ thống |
| DRAFT TTL auto-cleanup | **30 ngày** (`DRAFT_TTL_DAYS`) | Dọn rác tích lũy từ role không ai duyệt |
| Cleanup schedule | **Mỗi 6 giờ + lazy mỗi lần import** | Đảm bảo cleanup chạy cả khi không có traffic |

---

## 5. Kết Quả Kiểm Thử Toàn Diện (All Passed)

### 5.1. Bộ Kiểm Thử An Ninh Chuyên Sâu (12/12 PASS)
- **TEST 1:** Từ chối role thiếu `tasks/main.yml` → **PASS**
- **TEST 2:** Role có `README.md` và `LICENSE` vượt qua sạch sẽ → **PASS**
- **TEST 3:** Zip Bomb tỷ lệ bất thường >50MB bị chặn ngay → **PASS**
- **TEST 4:** Phát hiện `.env` và `id_rsa` trong mảng cảnh báo → **PASS**
- **TEST 5:** Mẫu sinh từ hệ thống tự validate chính nó thành công → **PASS**
- **TEST 6:** Chặn đứng UNC Path, Windows Drive, Backslash Traversal → **PASS**
- **TEST 7:** Chặn đứng lệnh `curl | bash` và đọc trộm `/etc/shadow` → **PASS**
- **TEST 8:** Hiển thị cảnh báo kiểm toán cho `shell` và `fetch` → **PASS**
- **TEST 9:** Phát hiện và chặn đứng khai thác SSTI trong templates → **PASS**
- **TEST 10:** Phát hiện và chặn đứng lệnh shell độc hại giấu trong handlers → **PASS**
- **TEST 11:** Phát hiện và chặn đứng `lookup('pipe', ...)` trong vars → **PASS**
- **TEST 12:** Kiểm tra `adminAuthGuard` Fail-Closed (chặn 403 khi thiếu token/sai token) → **PASS**

### 5.2. Bộ Kiểm Thử Hồi Quy (9/9 PASS)
- Bảo đảm 100% tương thích với toàn bộ quy trình Publish, Blueprint và Execution Pipeline.

### 5.3. Bộ Kiểm Thử Hardening V5 (39/39 PASS)
**Item 1 — Python Plugin Dir Rejection (13 tests):**
- `REJECTED_PLUGIN_DIRS` chứa đủ `library`, `lookup_plugins`, `filter_plugins`, `module_utils` → **PASS**
- `ALLOWED_ROLE_SUBDIRS` đã loại bỏ 3 dirs trên → **PASS**
- Role chứa `library/`, `lookup_plugins/`, `filter_plugins/`, `callback_plugins/` đều bị reject cứng → **PASS**
- Clean role không chứa Python dirs vẫn pass → **PASS**
- Template tự sinh vẫn self-validate thành công → **PASS**

**Item 3 — Timing-Safe Compare & Fail-Closed AuthZ (11 tests):**
- `crypto` module imported, `safeCompare` tồn tại với length check → **PASS**
- `adminAuthGuard` dùng `safeCompare` thay vì `!==` → **PASS**
- `adminAuthGuard` chuẩn Fail-Closed: HTTP 500 khi thiếu key, HTTP 403 khi sai key, không có bypass fallthrough → **PASS**
- `safeCompare`: equal/different/different-length strings, null/undefined edge cases → **PASS**

**Item 2 — Rate-limit & DRAFT Governance (15 tests):**
- `uploadRateLimit` middleware tồn tại và được áp dụng cho validate + import → **PASS**
- Sliding window 60s, HTTP 429 on exceed → **PASS**
- `MAX_PENDING_DRAFTS` (20) & `MAX_PENDING_DRAFTS_PER_IP` (5) → **PASS**
- Chặn đứng DoS chiếm dụng tài nguyên với per-IP draft cap → **PASS**
- Lưu vết `creatorIp` trên Action metadata → **PASS**
- `cleanupStaleDrafts` function, lazy + periodic cleanup → **PASS**
- Documentation: rate-limit KHÔNG thay thế AuthZ → **PASS**
- Startup log hiển thị DRAFT TTL + rate-limit config + Fail-Closed enforcement → **PASS**

---

## 6. Backlog: Post-Publish Execution Hardening (Định Hướng Mở Rộng)

> **Mục tiêu:** Quản trị rủi ro ở tầng thực thi sau khi Role đã được duyệt Publish. Ghi nhận backlog kỹ thuật để triển khai ở các phiên bản sau mà không làm chậm tiến độ scope hiện tại.

- **Nguy cơ nhận diện:** Task Ansible sử dụng `include_tasks`, `import_tasks`, hoặc `include_role` kết hợp với biến động Jinja trỏ ra ngoài phạm vi thư mục role (ví dụ: `include_tasks: "{{ dynamic_path }}/task.yml"`). Về mặt kỹ thuật, tại thời điểm chạy Ansible runtime trên Controller, hành vi này có thể vượt biên đọc hoặc thực thi các file YAML khác trên máy chủ điều khiển (khác với Zip-Slip vốn chỉ chặn lúc giải nén).
- **Giải pháp dự kiến:**
  1. Thêm bộ linter tĩnh ở Gate 2b kiểm tra đối số của các module include/import: Cảnh báo hoặc chặn các đường dẫn chứa ký tự `..` hoặc biến trỏ ra ngoài phạm vi `{{ role_path }}`.
  2. Cách ly Controller môi trường chạy Ansible bằng Linux Namespace / Containerized Execution Environment (chạy Ansible bên trong ephemeral Docker container hoặc Ansible Execution Environment - AEE với mount chỉ đọc vào thư mục role).
