# BÁO CÁO TIẾN ĐỘ & BẢN ĐỀ XUẤT KIẾN TRÚC TỰ ĐỘNG HÓA (GỬI MENTOR)

**Dự án:** Synapse — Self-Service Network/IT Automation & Orchestration Platform  
**Người thực hiện:** Nhóm dự án VDT  
**Chủ đề:** Lựa chọn phương án tự động hóa quản lý Job Template trên AWX cho giai đoạn tiếp theo (Phase 3/4)

---

## I. TỔNG QUAN TIẾN ĐỘ ĐÃ ĐẠT ĐƯỢC (CURRENT STATE)

Dự án hiện đã hoàn thành trọn vẹn 2 giai đoạn nền tảng:

1. **Phase 1 — Action Catalog & Template Parameterization:**
   - Xây dựng Catalog Action theo chuẩn Intent-based.
   - Giải quyết bài toán tách biệt vai trò: **FO (First Operator/DevOps)** quản lý Template lõi; **BO (Business Operator)** chỉ cần nhập tham số nghiệp vụ (ví dụ: service name, target host) qua giao diện.
   - Cơ chế bắn API sang AWX với tham số động qua `extra_vars` (đã test thành công với AWX Job Template thật `#10`).

2. **Phase 2 — Blueprint Composer & Fail-fast Workflow Orchestration:**
   - Hiện thực hóa triết lý kiến trúc: **Action là Primitive (nguyên tử) — Blueprint là Composition (ghép nối)**. Hệ thống không khóa cứng mà hỗ trợ thực thi cả Action đơn lẻ lẫn Blueprint đa bước.
   - Xây dựng giao diện **Blueprint Composer 2 cột**: cho phép kéo thả/sắp xếp thứ tự các Action thành một pipeline tuần tự.
   - **Orchestrator Engine đa bước:** Điều phối tuần tự từng bước qua AWX, cơ chế Fail-fast (dừng ngay và kích hoạt compensation nếu có bước lỗi), lưu vết riêng biệt `awx_job_id`, thời gian bắt đầu/kết thúc cho từng bước.

---

## II. ĐIỂM NGHẼN CẦN GIẢI QUYẾT (THE PROBLEM & BOTTLENECK)

Hiện tại, luồng chạy kịch bản (Runtime) đã hoạt động rất mượt mà. Tuy nhiên, quy trình **chuẩn bị Day-0 / Day-1 (Provisioning)** vẫn còn phụ thuộc vào thao tác thủ công:

* **Vấn đề:** Khi FO muốn giới thiệu một loại Automation Intent mới (ví dụ: viết thêm một playbook mới `backup_file.yml` hoặc `health_check.yml`), FO hiện vẫn phải:
  1. Đăng nhập thủ công vào giao diện web của AWX.
  2. Bấm tạo Job Template, chọn Playbook, chọn Inventory, bật *Prompt on launch*.
  3. Lấy con số `Job Template ID` được AWX sinh ra và copy ngược lại vào cấu hình của Synapse (file JSON/Database).
* **Mục tiêu đặt ra:** Làm thế nào để **tự động hóa hoàn toàn khâu tạo Job Template trên AWX và đồng bộ ID về Synapse**, giúp FO không cần phải thao tác thủ công trên UI của AWX nữa?

---

## III. PHÂN TÍCH CÁC PHƯƠNG ÁN GIẢI QUYẾT (PROPOSED SOLUTIONS)

Nhóm đã nghiên cứu các mô hình triển khai thực tế trong công nghiệp (ServiceNow, Red Hat AAP, Backstage) và tổng hợp thành 3 phương án chính:

---

### Phương án 1: Trực tiếp qua AWX REST API (Synapse-driven Provisioning)

* **Mô hình hoạt động:**
  - Bản thân AWX là một hệ thống "API-First". Mọi thao tác trên UI đều tương ứng với REST API: `POST /api/v2/job_templates/`.
  - Backend của Synapse (Node.js) sẽ mở rộng thêm module trong `awxClient.js`.
  - Khi FO tạo Template/Action mới trên giao diện Synapse (hoặc tải file YAML lên), Synapse tự động gửi request HTTP sang AWX để tạo Job Template, nhận `id` trả về và lưu thẳng vào Database trong vòng ~200ms.
* **Ưu điểm:**
  - **Triển khai nhanh & gọn nhẹ:** Tận dụng 100% stack hiện có của Synapse (Node.js/Express). Không cần cài thêm bất kỳ phần mềm hay công cụ bên thứ 3 nào trên server.
  - **Trải nghiệm tức thời (Real-time Feedback):** Mọi thao tác phản hồi ngay lập tức trên UI cho người dùng.
  - **Dễ kiểm soát:** Lỗi API được bắt và hiển thị trực tiếp lên giao diện.
* **Nhược điểm:**
  - Khâu quản lý mã nguồn Playbook vẫn cần một bước trung gian (đẩy Playbook lên Git trước để AWX nhận diện được file `.yml` đó).
  - Thiếu cơ chế phát hiện sai lệch trạng thái (Drift Detection) nếu ai đó cố tình vào AWX xóa thủ công Job Template.

---

### Phương án 2: GitOps kết hợp Terraform (Infrastructure as Code)

* **Mô hình hoạt động:**
  - Chuẩn mực quản trị hạ tầng qua mã nguồn (IaC).
  - FO không thao tác trên web mà commit Playbook `.yml` kèm một file định nghĩa Terraform (`.tf` sử dụng provider `redhat.ansible` hoặc `ansible/tower`) lên Git Repo.
  - CI/CD Pipeline (GitHub Actions / GitLab CI) tự động chạy `terraform plan` và `terraform apply` để tạo Job Template trên AWX.
  - Sau khi tạo xong, CI/CD gọi một Webhook về Synapse Backend: `POST /api/internal/templates/sync` để cập nhật ID mới vào cơ sở dữ liệu.
* **Ưu điểm:**
  - **Chuẩn DevOps / GitOps Enterprise:** Toàn bộ cấu hình Job Template được version control trên Git, có lịch sử commit, review code (Pull Request).
  - **State Management & Drift Detection:** Nếu Job Template trên AWX bị sửa đổi hay xóa nhầm, Terraform sẽ tự động khôi phục về trạng thái chuẩn.
* **Nhược điểm:**
  - **Kiến trúc phức tạp:** Cần dựng thêm hệ thống CI/CD Runner, cấu hình Terraform State backend (S3/Consul), webhook callback.
  - **Độ trễ cao:** Không phù hợp cho thao tác tức thì trên Web UI (mỗi lần chạy pipeline mất từ 1 - 3 phút).
  - Đòi hỏi FO phải biết cú pháp Terraform (HCL).

---

### Phương án 3: GitOps kết hợp Ansible Collection chính chủ (`awx.awx`)

* **Mô hình hoạt động:**
  - Triết lý "Ansible-on-Ansible" do chính Red Hat khuyến nghị.
  - Tương tự như Phương án 2, nhưng thay vì dùng Terraform, FO hoặc CI/CD sẽ chạy một playbook quản trị sử dụng module `awx.awx.job_template` để cấu hình AWX.
* **Ưu điểm:**
  - **Cùng một hệ sinh thái:** Chỉ sử dụng duy nhất kiến thức Ansible, không cần học thêm Terraform.
  - Được hỗ trợ chính thức và cập nhật liên tục từ Red Hat.
* **Nhược điểm:**
  - Vẫn đòi hỏi hạ tầng CI/CD hoặc phải cài đặt môi trường Python + Ansible Core trên máy chủ để thực thi.
  - Không có tính năng State Management mạnh mẽ như Terraform (khó theo dõi việc xóa/hủy tài nguyên).

---

## IV. BẢNG SO SÁNH TỔNG HỢP (TRADE-OFF MATRIX)

| Tiêu chí so sánh | Phương án 1: AWX REST API | Phương án 2: GitOps + Terraform | Phương án 3: GitOps + Ansible (`awx.awx`) |
| :--- | :--- | :--- | :--- |
| **Độ phức tạp kiến trúc** | **Thấp** (Tích hợp sẵn trong Web App) | **Cao** (Cần CI/CD + Terraform state) | **Trung bình - Cao** (Cần CI/CD + Ansible runner) |
| **Tốc độ phản hồi** | **Tức thời (~0.2s)** | Chậm (1 - 3 phút qua CI/CD) | Chậm (30s - 1 phút qua CI/CD) |
| **Công cụ phụ thuộc** | Không (Chỉ dùng REST API HTTP) | Cần Terraform CLI, Git provider | Cần Python, Ansible CLI, Git provider |
| **Tính Audit & Version Control** | Phụ thuộc vào audit log của Synapse | **Rất cao** (Git commit history + PR) | **Rất cao** (Git commit history + PR) |
| **Độ phù hợp cho Prototype/Demo** | **Rất cao (9.5/10)** | Trung bình (6.5/10) | Khá (7.5/10) |
| **Độ phù hợp cho Prod Quy mô lớn**| Khá (7.5/10) | **Rất cao (9.5/10)** | Cao (8.5/10) |

---

## V. ĐỀ XUẤT CỦA NHÓM & CÂU HỎI XIN Ý KIẾN MENTOR

### 1. Đề xuất của nhóm:
Nhóm nhận thấy dự án hiện đang ở giai đoạn hoàn thiện sản phẩm Prototype để kiểm chứng giải pháp (PoC/MVP). Do đó:
- **Trong ngắn hạn (Phase 3):** Ưu tiên triển khai **Phương án 1 (AWX REST API)** vì giúp hoàn thiện trọn vẹn trải nghiệm "Self-service Web Portal", chứng minh được tính năng tự động tạo Job Template ngay trên UI mà không làm phình to kiến trúc hệ thống.
- **Trong dài hạn (Phase 4 / Production):** Khi đưa vào môi trường doanh nghiệp thực tế, có thể tiến hóa lên **Phương án 2 (GitOps + Terraform)** cho các tác vụ mang tính chất hạ tầng cốt lõi (Day-0).

### 2. Câu hỏi xin ý kiến Mentor:
1. *Theo góc nhìn và kinh nghiệm vận hành thực tế của Mentor tại doanh nghiệp/tập đoàn, Mentor đánh giá thế nào về việc cho phép Portal tự động gọi REST API của AWX để tạo Job Template (Phương án 1) so với việc bắt buộc đi qua GitOps (Phương án 2/3)?*
2. *Đối với phạm vi và mục tiêu đánh giá của đồ án/bài tập lớn hiện tại, nhóm nên chốt triển khai theo **Phương án 1** để có sản phẩm hoàn chỉnh, mượt mà trên giao diện, hay nên đầu tư xây dựng hẳn **Pipeline GitOps (Phương án 2 hoặc 3)** để làm nổi bật yếu tố quy trình chuẩn DevOps?*
