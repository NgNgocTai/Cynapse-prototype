# Kế Hoạch Triển Khai & Tiêu Chuẩn Bảo Mật: Enterprise Ansible Role Import & Execution Safety

> **Trạng thái:** `COMPLETED & VERIFIED` (Đã củng cố toàn diện, vượt qua 8/8 bài kiểm thử chuyên sâu và 9/9 hồi quy)  
> **Nhánh Git:** `dev`  
> **Tài liệu tham chiếu chuẩn:** [Red Hat Ansible Docs - Role Directory Structure](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-directory-structure)

---

## 1. Bối Cảnh & Các Rủi Ro An Ninh Mở Rộng

Hệ thống Synapse cho phép người dùng tự đưa kịch bản tự động hóa (Ansible Role / Playbook) vào Catalog để chạy trên hạ tầng máy chủ thật (như cụm PostgreSQL Patroni `db01`). Sau khi rà soát chuyên sâu, 4 lỗ hổng/bất nhất kỹ thuật đã được xử lý triệt để:

1. **Đồng bộ tuyệt đối Allowlist Root Files (Loại bỏ hoàn toàn Wildcard `*.md`, `*.txt`)**:
   - Trước đây có sự không nhất quán giữa việc cho phép wildcard `*.md`, `*.txt` với chuẩn đóng gói nghiêm ngặt.
   - **Quy chuẩn mới:** Chỉ chấp nhận chính xác các file tài liệu chuẩn: `readme.md`, `readme.txt`, `readme`, `license`, `license.txt`, `license.md`, `changelog.md`, `contributing.md`, `.gitkeep`, `.ansible-lint`, `requirements.yml`, `requirements.yaml`, `meta.yml`. Mọi file rời khác ngoài danh mục này đều bị phát hiện và cảnh báo.

2. **Gia cố Zip-Slip toàn diện trên môi trường Windows**:
   - Không chỉ chặn `../`, hệ thống chuẩn hóa cả hai dấu phân cách `/` và `\`.
   - Chặn tuyệt đối đường dẫn tuyệt đối kiểu Windows (`C:\...`, `D:/...`).
   - Chặn đường dẫn mạng **UNC Path** (`\\server\share\...` hoặc `//server/share/...`).
   - Chặn các tên thiết bị hệ thống dành riêng của Windows (**DOS Device Names**): `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`.
   - Sử dụng thuật toán chuẩn `path.resolve(destDir, rawName)` và kiểm tra tiền tố `targetPath.startsWith(canonicalDest + path.sep)`.

3. **Cơ chế phòng ngự Zip Bomb 2 tầng (Header Pre-Scan + Runtime Byte Metering)**:
   - *Tầng 1 (Pre-Scan):* Quét nhanh header để loại bỏ ngay các gói zip khai báo $>500$ entries hoặc uncompressed size $>50\text{MB}$.
   - *Tầng 2 (Runtime Metering):* Đếm byte giải nén thực tế trong bộ nhớ (`actualTotalDecompressedBytes += content.length`). Nếu file zip cố tình giả mạo header để vượt qua tầng 1 thì tầng 2 sẽ lập tức phát hiện khi dữ liệu thật vượt quá 50MB hoặc tỷ lệ nén thực tế $>100\text{x}$ &rarr; Hủy tiến trình, xóa sạch thư mục tạm và trả lỗi HTTP 400.

4. **Gate 2b: Thẩm định An Toàn Nội Dung Tác Vụ (Task Execution Safety Guard)**:
   - *Vấn đề cốt lõi:* Cú pháp YAML đúng không có nghĩa là an toàn để thực thi trên hạ tầng thật.
   - *Chặn cứng (Blocking - HTTP 400):* Phát hiện và từ chối ngay lập tức các tác vụ chứa:
     - Lệnh tải mã độc từ xa pipe vào shell: `curl ... | bash`, `wget ... | sh`.
     - Lệnh xóa hủy diệt hệ thống: `rm -rf /`, `rm -rf /*`.
     - Lệnh đọc/đánh cắp file mật khẩu hệ thống: `/etc/shadow`, `/etc/gshadow`.
     - Lệnh tạo Reverse Shell: `/dev/tcp/`, `/dev/udp/`, `nc -e`, `mkfifo /tmp/`, `bash -i >&`.
     - Khóa bí mật nhúng trực tiếp: `BEGIN RSA/OPENSSH PRIVATE KEY`.
   - *Cảnh báo Kiểm toán (Audit Warnings):* Nhận diện và cảnh báo các module có quyền năng thực thi tùy ý (`ansible.builtin.shell`, `raw`, `script`) hoặc module chuyển file về máy chủ (`fetch`).
   - *Khóa cứng Gate 4 (DRAFT Enforcement):* Role mới import luôn ở trạng thái `DRAFT` & Backend chặn cứng 100% việc tạo Execution Plan (HTTP 403), thực thi trực tiếp (HTTP 403) hoặc đưa vào Blueprint (HTTP 400). Chỉ khi Quản trị viên thẩm định và duyệt qua `POST /api/actions/:id/publish` thì Action mới được phép vận hành.

---

## 2. Tiêu Chuẩn Cấu Trúc Thư Mục Role Hợp Lệ

```text
<role_name>/
├── tasks/
│   └── main.yml        # [BẮT BUỘC] Entrypoint chứa danh sách tác vụ Ansible
├── defaults/
│   └── main.yml        # [KHUYẾN NGHỊ] Khai báo biến mặc định (Synapse tự sinh Form Inputs)
├── vars/
│   └── main.yml        # [HỢP LỆ] Biến nội bộ của role
├── handlers/
│   └── main.yml        # [HỢP LỆ] Handler kích hoạt qua notify
├── templates/          # [HỢP LỆ] Chứa template Jinja2 (.j2)
├── files/              # [HỢP LỆ] File tĩnh, script chuyển giao
├── meta/
│   └── main.yml        # [HỢP LỆ] Metadata tác giả, license
├── tests/              # [HỢP LỆ] Kịch bản test
├── README.md           # [HỢP LỆ - FILE ROOT] Tài liệu hướng dẫn
└── LICENSE             # [HỢP LỆ - FILE ROOT] Giấy phép sử dụng
```

---

## 3. Bảng Tổng Hợp Các Chốt Chặn Bảo Mật

| Chốt Chặn | Phạm Vi | Cơ Chế Kỹ Thuật | Hành Vi |
| :--- | :--- | :--- | :---: |
| **Gate 1a** | Tên Role | Regex `/^[a-z0-9_]+$/` (Galaxy compliant). Chặn dấu `-`, chữ hoa, ký tự lạ. | **BLOCK** |
| **Gate 1b** | Zip-Slip (Windows + POSIX) | Chuẩn hóa `/` & `\`. Chặn UNC (`\\`), Windows Drive (`C:`), DOS Devices (`CON`, `PRN`...). Canonical path boundary check. | **BLOCK** |
| **Gate 1c** | Symlink Traversal | Chặn entry symlink trong zip. Duyệt thư mục bằng `fs.lstatSync` (tuyệt đối không follow symlink). | **BLOCK** |
| **Gate 1d** | Zip Bomb (2 Tầng) | Tầng 1: Pre-scan header ($\le 500$ entries, $\le 50\text{MB}$).<br>Tầng 2: Đếm byte giải nén thực tế và tỷ lệ nén thực tế. | **BLOCK** |
| **Gate 1e** | Secret Leaks | Quét `SENSITIVE_PATTERNS` (`.env`, `*.pem`, `id_rsa`, `credentials.json`). | **WARN** |
| **Gate 1f** | Cấu trúc Thư mục | Bắt buộc `tasks/main.yml`. Phân tách thư mục con & file root (không dùng wildcard). | **BLOCK** |
| **Gate 2a** | Syntax Check | Chạy `ansible-playbook --syntax-check` qua `child_process.spawn(bin, args)` an toàn. | **BLOCK** |
| **Gate 2b** | Execution Safety | Quét mã độc: `curl\|bash`, `/etc/shadow`, `rm -rf /`, reverse shell, private key.<br>Cảnh báo module `shell`, `raw`, `script`, `fetch`. | **BLOCK (Mã độc)<br>WARN (Module)** |
| **Gate 3** | Form Generation | Tự trích xuất biến Jinja2 từ `defaults/main.yml` và `tasks/main.yml`. | **AUTO** |
| **Gate 4** | DRAFT Enforcement | Action mới import mang cờ `DRAFT`. Chặn tạo plan (HTTP 403), chặn thực thi (HTTP 403), chặn add blueprint (HTTP 400). | **BLOCK** |
| **Gate 5** | Auto-Blueprint | Checkbox tự tạo Blueprint mặc định **UNCHECKED (false)**. | **SAFE** |
| **Gate 6** | Zero Hardcode | Biến môi trường WSL, Ansible binary cấu hình qua `.env`. | **STRICT** |

---

## 4. Kết Quả Kiểm Thử Toàn Diện (All Passed)

### 4.1. Bộ Kiểm Thử An Ninh Chuyên Sâu (`scratch/test_ansible_doc_standard.mjs`)
- **TEST 1 (Missing tasks/):** Từ chối role thiếu `tasks/main.yml` $\rightarrow$ **PASS**
- **TEST 2 (Strict Root Files):** Role có `README.md` và `LICENSE` vượt qua sạch sẽ $\rightarrow$ **PASS**
- **TEST 3 (Zip Bomb Defense):** Gói nén tỷ lệ bất thường và $>50\text{MB}$ bị chặn ngay $\rightarrow$ **PASS**
- **TEST 4 (Sensitive Leaks):** Phát hiện `.env` và `id_rsa` trong mảng cảnh báo $\rightarrow$ **PASS**
- **TEST 5 (Template Roundtrip):** Mẫu sinh từ hệ thống tự validate chính nó thành công $\rightarrow$ **PASS**
- **TEST 6 (Windows Zip-Slip Hardening):** Chặn đứng UNC Path (`\\attacker\share`), Windows Drive Letter (`C:/Windows`), và Backslash Traversal (`..\..\evil.txt`) $\rightarrow$ **PASS**
- **TEST 7 (Gate 2b - Malicious Execution Rejection):** Chặn đứng lệnh `curl | bash` và lệnh đọc `/etc/shadow` $\rightarrow$ **PASS**
- **TEST 8 (Gate 2b - High-Risk Module Warnings):** Phát hiện và hiển thị rõ cảnh báo kiểm toán cho `ansible.builtin.shell` và `fetch` $\rightarrow$ **PASS**

### 4.2. Bộ Kiểm Thử Hồi Quy 6 Chốt Chặn (`scratch/test_phase2_gates.mjs`)
- Đạt **9/9 tests PASS**, bảo đảm tương thích hoàn toàn với toàn bộ quy trình Publish và Pipeline của Synapse.
