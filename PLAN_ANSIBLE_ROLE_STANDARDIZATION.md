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

---

## 3. Bảng Tổng Hợp 8 Chốt Chặn Bảo Mật

| Chốt Chặn | Phạm Vi | Cơ Chế Kỹ Thuật | Hành Vi |
| :--- | :--- | :--- | :---: |
| **Gate 1a** | Tên Role | Regex `/^[a-z0-9_]+$/` (Galaxy compliant). Chặn dấu `-`, chữ hoa, ký tự lạ. | **BLOCK** |
| **Gate 1b** | Zip-Slip (Windows + POSIX) | Chuẩn hóa `/` & `\`. Chặn UNC (`\\`), Windows Drive (`C:`), DOS Devices (`CON`, `PRN`...). Canonical path boundary check. | **BLOCK** |
| **Gate 1c** | Symlink Traversal | Chặn entry symlink trong zip. Duyệt thư mục bằng `fs.lstatSync` (tuyệt đối không follow symlink). | **BLOCK** |
| **Gate 1d** | Zip Bomb (C++ Ceiling) | Native `zlib.inflateRawSync({ maxOutputLength })` chặn đứng OOM trước khi cấp phát RAM. | **BLOCK** |
| **Gate 1e** | Secret Leaks | Quét `SENSITIVE_PATTERNS` (`.env`, `*.pem`, `id_rsa`, `credentials.json`). | **WARN** |
| **Gate 1f** | Cấu trúc Thư mục | Bắt buộc `tasks/main.yml`. Phân tách thư mục con & file root (không dùng wildcard). | **BLOCK** |
| **Gate 2a** | Syntax Check | Chạy `ansible-playbook --syntax-check` qua `child_process.spawn(bin, args)` an toàn. | **BLOCK** |
| **Gate 2b** | Execution Safety (Toàn Diện) | Quét tasks, handlers, templates, vars/defaults. Chặn `curl\|bash`, `/etc/shadow`, `rm -rf /`, SSTI, reverse shell, lookup pipe. Cảnh báo module `shell`, `raw`, `script`, `fetch`. | **BLOCK (Mã độc)<br>WARN (Module)** |
| **Gate 3** | Form Generation | Tự trích xuất biến Jinja2 từ `defaults/main.yml` và `tasks/main.yml`. | **AUTO** |
| **Gate 4** | DRAFT Enforcement & Admin Auth | Action mới import mang cờ `DRAFT`. Chặn tạo plan (HTTP 403), chặn thực thi (HTTP 403), chặn add blueprint (HTTP 400). Publish endpoint được bảo vệ bởi `adminAuthGuard`. | **BLOCK** |

---

## 4. Kết Quả Kiểm Thử Toàn Diện (All Passed)

### 4.1. Bộ Kiểm Thử An Ninh Chuyên Sâu (`scratch/test_ansible_doc_standard.mjs` - 12/12 PASS)
- **TEST 1:** Từ chối role thiếu `tasks/main.yml` $\rightarrow$ **PASS**
- **TEST 2:** Role có `README.md` và `LICENSE` vượt qua sạch sẽ $\rightarrow$ **PASS**
- **TEST 3:** Zip Bomb tỷ lệ bất thường $>50\text{MB}$ bị chặn ngay $\rightarrow$ **PASS**
- **TEST 4:** Phát hiện `.env` và `id_rsa` trong mảng cảnh báo $\rightarrow$ **PASS**
- **TEST 5:** Mẫu sinh từ hệ thống tự validate chính nó thành công $\rightarrow$ **PASS**
- **TEST 6:** Chặn đứng UNC Path (`\\attacker\share`), Windows Drive (`C:/Windows`), Backslash Traversal (`..\..\evil.txt`) $\rightarrow$ **PASS**
- **TEST 7:** Chặn đứng lệnh `curl | bash` và đọc trộm `/etc/shadow` trong tasks $\rightarrow$ **PASS**
- **TEST 8:** Hiển thị cảnh báo kiểm toán cho `ansible.builtin.shell` và `fetch` $\rightarrow$ **PASS**
- **TEST 9:** Phát hiện và chặn đứng khai thác SSTI trong `templates/innocent.j2` $\rightarrow$ **PASS**
- **TEST 10:** Phát hiện và chặn đứng lệnh shell độc hại giấu trong `handlers/main.yml` $\rightarrow$ **PASS**
- **TEST 11:** Phát hiện và chặn đứng thực thi mã qua `lookup('pipe', ...)` trong `vars/main.yml` $\rightarrow$ **PASS**
- **TEST 12:** Kiểm tra `adminAuthGuard` trên endpoint Publish Action $\rightarrow$ **PASS**

### 4.2. Bộ Kiểm Thử Hồi Quy 6 Chốt Chặn (`scratch/test_phase2_gates.mjs` - 9/9 PASS)
- Bảo đảm 100% tương thích với toàn bộ quy trình Publish, Blueprint và Execution Pipeline của Synapse.
