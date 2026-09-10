# Kế Hoạch Triển Khai & Quy Chuẩn: Ansible Role Import & Enterprise Security Hardening

> **Trạng thái:** `COMPLETED` (Đã triển khai, kiểm thử tự động 100% PASS và đẩy lên nhánh `dev`)  
> **Nhánh Git:** `dev`  
> **Tài liệu tham chiếu chuẩn:** [Red Hat Ansible Docs - Role Directory Structure](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-directory-structure)

---

## 1. Bối Cảnh & Mục Tiêu

Hệ thống Synapse cung cấp tính năng Self-Service Import Role/Playbook qua 6 Chốt Chặn Bảo Mật Cứng (Hard Security Gates). Kế hoạch này hoàn thiện việc tiêu chuẩn hóa gói nén Role Ansible tải lên, triệt tiêu nguy cơ tấn công qua file zip, đồng thời đảm bảo trải nghiệm người dùng liền mạch (không bị lỗi "tự bắn vào chân"):
1. **Chuẩn hóa cấu trúc thư mục Role** theo chuẩn chính thức của Red Hat / Ansible Galaxy.
2. **Triển khai 3 điều kiện tiên quyết** đã chốt trước khi merge:
   - **Điều kiện 1:** Tách riêng Allowlist "thư mục con" và "file rời tại root" để các file tài liệu (`README.md`, `LICENSE`...) và chính role mẫu do hệ thống sinh ra không bao giờ tự vi phạm thẩm định.
   - **Điều kiện 2:** Pipeline kiểm tra theo đúng thứ tự an toàn: `Zip-Slip Guard` &rarr; `Symlink Guard` &rarr; `Cấu trúc thư mục`. Toàn bộ thao tác duyệt thư mục bắt buộc dùng `fs.lstatSync` (tuyệt đối không dùng `fs.statSync` để tránh follow symlink ra ngoài).
   - **Điều kiện 3:** Bổ sung cơ chế phòng ngự **Zip Bomb** (kiểm tra dung lượng uncompressed $\le 50\text{MB}$, số lượng file $\le 500$, phát hiện tỷ lệ nén bất thường).
   - **Góp ý bổ sung:** Cảnh báo file nhạy cảm lọt trong zip (`.env`, `*.pem`, `id_rsa`...) dưới dạng Non-blocking Warning trên UI.
3. **Cải thiện UX & Hướng dẫn trực quan (Micro-copy)**:
   - Nút 1-click **"📥 Tải Role Mẫu Chuẩn (.zip)"** ngay trên modal.
   - Ghi chú giải thích định dạng tên `/^[a-z0-9_]+$/` và cấu trúc bắt buộc `tasks/main.yml`.
   - Banner cảnh báo Offline nếu backend chưa sẵn sàng.

---

## 2. Tiêu Chuẩn Kỹ Thuật Đã Hiện Thực Hóa

### 2.1. Cấu Trúc Cây Thư Mục Role Hợp Lệ
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
├── README.md           # [HỢP LỆ - FILE TẠI ROOT] Tài liệu hướng dẫn
└── LICENSE             # [HỢP LỆ - FILE TẠI ROOT] Giấy phép sử dụng
```

### 2.2. Chi Tiết 3 Điều Kiện Chốt & Cơ Chế Bảo Vệ
| Điều Kiện / Hạng Mục | Rủi Ro Phòng Ngừa | Giải Pháp Đã Triển Khai | Trạng Thái |
| :--- | :--- | :--- | :---: |
| **Điều kiện 1: Tách riêng 2 Allowlist** | Role mẫu hoặc role chuẩn từ Galaxy có `README.md`/`LICENSE` bị reject oan do vi phạm danh sách thư mục con. | Tách riêng:<br>• `ALLOWED_ROLE_SUBDIRS`: `tasks`, `defaults`, `vars`, `handlers`, `templates`, `files`, `meta`, `library`, `tests`, `lookup_plugins`, `filter_plugins`.<br>• `ALLOWED_ROOT_FILES`: `readme.md`, `readme.txt`, `license`, `license.txt`, `.gitkeep`, `.ansible-lint`, `requirements.yml`. | ✅ **DONE** |
| **Điều kiện 2: Thứ tự Pipeline & `fs.lstatSync`** | Vô tình follow symlink trỏ ra ngoài destDir khi duyệt cấu trúc (mở lại lỗ hổng symlink traversal). | • Pipeline: Zip-Slip & Zip-Bomb &rarr; Symlink scan &rarr; Structure validation &rarr; Syntax check.<br>• Mọi hàm duyệt (`findRoleRoot`, `validateRoleDirectoryStructure`) dùng `{ withFileTypes: true }` và `fs.lstatSync`. Tuyệt đối không dùng `fs.statSync`. | ✅ **DONE** |
| **Điều kiện 3: Chống Zip Bomb** | File zip nhỏ (vài chục KB) giải nén ra hàng GB làm tràn đĩa hoặc crash RAM. | • Pre-scan toàn bộ entry trước khi ghi ra đĩa.<br>• Giới hạn tổng dung lượng sau giải nén: tối đa **50 MB** (`MAX_UNCOMPRESSED_SIZE`).<br>• Giới hạn số file: tối đa **500 entries** (`MAX_ENTRY_COUNT`).<br>• Phát hiện tỷ lệ nén bất thường ($> 100\text{x}$ với file $> 1\text{MB}$). | ✅ **DONE** |
| **Góp ý: Secret Leak Warning** | Người dùng nén nhầm thư mục chứa `.env`, SSH key riêng tư (`id_rsa`). | Quét `SENSITIVE_PATTERNS`: `.env`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`. Trả về mảng `warnings` & hiển thị hộp cảnh báo màu vàng trên UI (không chặn cứng). | ✅ **DONE** |
| **Atomic Write cho Catalog** | Trùng ghi đồng thời làm hỏng file `catalog.json`. | Viết vào file tạm `${CATALOG_FILE}.tmp.<timestamp>` rồi dùng `fs.renameSync` nguyên tử. | ✅ **DONE** |
| **UX & Hướng dẫn trực quan** | Người dùng không biết đặt tên role đúng chuẩn hoặc cấu trúc zip cần gì. | • Nút **"📥 Tải Role Mẫu Chuẩn (.zip)"** (`GET /api/roles/template`).<br>• Micro-copy `.field-hint-text` giải thích regex `^[a-z0-9_]+$` và link trực tiếp tài liệu Ansible Docs.<br>• Banner cảnh báo khi Backend offline. | ✅ **DONE** |

---

## 3. Các File Đã Chỉnh Sửa & Triển Khai

1. [backend/roleManager.js](file:///d:/Code/VDT/Synapse/backend/roleManager.js):
   - Bổ sung `MAX_UNCOMPRESSED_SIZE = 50MB`, `MAX_ENTRY_COUNT = 500`, `SENSITIVE_PATTERNS`.
   - Bổ sung `ALLOWED_ROLE_SUBDIRS` và `ALLOWED_ROOT_FILES`.
   - Nâng cấp `extractZipWithSecurity`: chống Zip Bomb, chặn symlink entry, quét cảnh báo nhạy cảm.
   - Nâng cấp `findRoleRoot`: duyệt bằng `fs.lstatSync`, chuẩn hóa cờ `isRole` để không nhận nhầm `defaults/main.yml` thành playbook độc lập.
   - Hiện thực `validateRoleDirectoryStructure(roleDir)`: kiểm tra `tasks/main.yml` và phân loại thư mục/file hợp lệ.
   - Hiện thực `generateStandardRoleTemplateZip(roleName)`: sinh zip role mẫu chuẩn in-memory.

2. [backend/catalogStore.js](file:///d:/Code/VDT/Synapse/backend/catalogStore.js):
   - Triển khai Atomic Write trong `saveCatalog` qua file tạm và `fs.renameSync`.

3. [backend/server.js](file:///d:/Code/VDT/Synapse/backend/server.js):
   - Thêm API `GET /api/roles/template?name=<roleName>`.
   - Tích hợp `validateRoleDirectoryStructure` vào cả 2 endpoint `POST /api/roles/validate` và `POST /api/roles/import`.
   - Trả về danh sách `warnings` cảnh báo cấu trúc và file nhạy cảm.

4. [frontend/app.js](file:///d:/Code/VDT/Synapse/frontend/app.js) & [frontend/styles.css](file:///d:/Code/VDT/Synapse/frontend/styles.css):
   - Bổ sung hàm `downloadRoleTemplate(roleName)` kích hoạt tải file mẫu 1-click.
   - Thêm nút `"📥 Tải Role Mẫu Chuẩn (.zip)"` trong Import Modal.
   - Thêm các dòng ghi chú nhỏ `.field-hint-text` dưới Role Identifier và Dropzone upload.
   - Thêm Callout Box màu vàng hiển thị cảnh báo `warnings` ở Bước 2.
   - Thêm banner `backendOfflineBanner` cảnh báo khi backend chưa kết nối được.

5. [.gitignore](file:///d:/Code/VDT/Synapse/.gitignore):
   - Bổ sung `backend/temp/` vào danh sách loại trừ để bảo đảm thư mục giải nén tạm không bị commit.

---

## 4. Kết Quả Xác Minh & Kiểm Thử (Verification Results)

### 4.1. Bộ Kiểm Thử Cấu Trúc Ansible Doc & Hardening Gates (`scratch/test_ansible_doc_standard.mjs`)
- **TEST 1 (Missing tasks/):** Từ chối role thiếu `tasks/main.yml` kèm thông báo trích dẫn chuẩn Ansible Docs. $\rightarrow$ **PASS**
- **TEST 2 (Separate Allowlists):** Role chứa `README.md` và `LICENSE` tại root vượt qua kiểm tra sạch sẽ (ExitCode 0). $\rightarrow$ **PASS**
- **TEST 3 (Zip Bomb Defense):** File zip tỷ lệ nén $>100\text{x}$ và giải nén $>50\text{MB}$ bị chặn ngay lập tức (HTTP 400). $\rightarrow$ **PASS**
- **TEST 4 (Sensitive Leaks):** Phát hiện `.env` và `id_rsa`, trả về trong danh sách cảnh báo `warnings`. $\rightarrow$ **PASS**
- **TEST 5 (Template Roundtrip - Ngăn lỗi tự bắn vào chân):** Lấy file zip sinh từ `GET /api/roles/template` rồi validate trực tiếp qua `POST /api/roles/validate` $\rightarrow$ **PASS 100% (ExitCode 0)**, nhận diện chuẩn 3 tasks và 3 input parameters.

### 4.2. Bộ Kiểm Thử Hồi Quy 6 Chốt Chặn (`scratch/test_phase2_gates.mjs`)
- Đã chạy lại toàn bộ 9/9 ca kiểm thử (Path Traversal, Zip-Slip, Syntax Check, Jinja2 extraction, DRAFT enforcement, Overwrite flag, Publish workflow) $\rightarrow$ **PASS 9/9**.
