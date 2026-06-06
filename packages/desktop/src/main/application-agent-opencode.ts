import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { APPLICATION_AGENT_MODEL, APPLICATION_AGENT_MODEL_ID } from "./application-agent-model"
import type { ApplicationTask } from "./application-agent"

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8")
}

export function buildApplicationAgentStartPrompt(task: ApplicationTask) {
  const inputJson = JSON.stringify(task.input, null, 2)
  return `你现在是 Terra-Edu 申请 Agent，请立刻接管这个申请任务。不要等待顾问再输入第一条指令。

这条消息就是启动信号。除非遇到必须由顾问确认的信息或登录动作，否则请从“创建申请工作区”开始自动执行完整流程。

重要交互规则：遇到不确定信息、材料用途、学校要求解释或申请平台字段选择时，优先调用 OpenCode 内置 question 工具向顾问提出清晰选项；顾问回复后，把确认结果写入 task_state.json、missing_items.json 或 application_progress.json，再继续执行。

长流程规则：这是一个从 0 到 1 的连续申请任务。上下文接近上限时允许 OpenCode 自动 compaction，但 compaction 完成后必须继续执行当前未完成步骤；不要因为上下文压缩、工具输出被截断、某一步耗时较长或 CUA 临时暂停就直接结束任务。每次继续前先读取 todowrite、03_state/application_progress.json、03_state/task_state.json 和 03_state/agent_execution_audit.json 恢复现场。

## 任务创建页信息

\`\`\`json
${inputJson}
\`\`\`

## 固定路径

- OpenCode 当前会话目录：${task.sessionDirectory}
- 目标申请工作区：${task.workspacePath}
- 原始学生资料文件夹（只读来源）：${task.input.sourceFolder}
- 申请平台链接：${task.input.applicationUrl}

## 申请专用 Custom Tools

你必须优先使用这些 OpenCode Custom Tools 完成可工具化步骤，不要只靠普通 shell 临时拼流程：

- application-agent_workspace：创建目录、复制原始材料到 00_original_backup、刷新文件计数。
- application-agent_materials：分类 00_original_backup 中的材料，写入 materials_index。
- application-agent_documents：从 missing_items.json 生成信息表、材料表、Word 清单和任务总结。
- application-agent_state：按统一 task_state.json schema 更新状态、统计和进度。
- application-agent_cua：通过 cua-driver 打开/复用申请平台，并优先按真人式循环执行 observe_page → fill_field_verified/select_option_verified → observe_page → save_page_verified；低级点击/输入工具只作为兜底。默认不截图，只有失败证据、上传证据、保存证据或顾问要求时才截图。
- application-agent_login：从 03_state/login_credentials.json 读取本机保存的申请平台账号状态，并通过钥匙串读取密码后填写登录页；不会把密码输出给 Agent。
- application-agent_risk：识别并阻断最终提交、付款、不可逆推荐信邀请、保存账号密码等高风险动作。
- application-agent_requirements：保存 webfetch/websearch 得到的学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

## 工具调用硬性约束

- 启动后先调用 OpenCode 内置 todowrite，建立默认 10 步任务清单；每完成或阻塞一步，都更新 todowrite，并调用 application-agent_state 同步 application_progress.json。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、自动登录、CUA 操作和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- 学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方学校/项目/申请要求页面。抓取结果必须调用 application-agent_requirements 落盘。
- bash 只允许用于读取文件内容、OCR/文本提取、检查环境或辅助诊断；不得用 bash 替代 application-agent_workspace、application-agent_materials、application-agent_documents、application-agent_state、application-agent_cua、application-agent_risk。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- 如果看到 OpenCode compaction/summary/上下文压缩相关消息，必须把它当作正常维护动作：先读取最新状态文件恢复任务现场，然后继续执行 todowrite 中未完成的下一步。
- 页面里出现像 macOS/Chrome 系统弹层一样漂浮在页面上方的下拉选项时，通常是原生 HTML select 的浏览器弹层；不要用坐标点击选项，也不要直接宣布“AX 树限制无法填写”。先调用 observe_page，再调用 select_option_verified；它会按 DOM、AX set_value、AX popup menu、原生菜单键盘 typeahead 的顺序自动兜底并二次复查。
- 如果 application-agent_cua 返回 CUA_STOPPED，说明此前顾问手动停止过自动化；当顾问明确说继续、继续填表、恢复 CUA 或正在当前任务里要求继续填写时，先调用 application-agent_cua 的 resume_cua，再重试原动作，不要把字段总结成“需要鼠标选择”。
- 如果 Chrome 返回“通过 AppleScript 执行 JavaScript 的功能已关闭”或 “Allow JavaScript from Apple Events” 相关错误，只代表 DOM 脚本通道不可用，不代表不能填表。必须继续使用 select_option_verified 的 AX/原生键盘兜底、fill_field_verified 的 AX/键盘策略或 keyboard_fill_sequence 填写；只有这些工具都返回失败时才停止 CUA。
- 如果出现浏览器 alert/confirm/prompt 弹窗，例如标题含“显示”、正文提示 “is required”，必须先调用 application-agent_cua handle_blocker 关闭并记录提示；然后 observe_page，补齐对应字段，不能重复点击 SAVE 触发同一个弹窗。
- 如果 Chrome 出现“离开此网站？”“Leave site?”，必须调用 application-agent_cua handle_blocker，默认选择“取消/留在页面”，防止未保存表单丢失。Chrome “要恢复页面吗？”“Chrome 未正确关闭”等恢复弹窗也用 handle_blocker 关闭，不要点击“恢复”。
- open_platform 只在首次进入平台或当前没有可用申请页时调用；如果 application_progress.json 已记录平台近期打开，直接 observe_page/list_windows 复用现有 Chrome 页面，不要反复打开申请链接或把 URL 填进网页输入框。
- 点击 SAVE 前必须调用 save_page_verified；它会先重新检查当前 modal 的必填字段，尤其是日期三段式 Month/Day/Year、考试分数与百分位、Registration Number。只要 AX/DOM 显示空值或校验错误，就先补字段，不要保存。

## 你必须由 OpenCode 自己执行的工作

在执行过程中，你必须像真正的申请 Agent 聊天助手一样持续输出可读进度。每开始一个大步骤前先用 1-3 句话告诉顾问“正在做什么、为什么做、预计产出什么”；每完成一个大步骤后说明“已完成什么、文件保存在哪里、下一步是什么”。不要长时间只调用工具而不输出任何对顾问可见的文字。

1. 调用 application-agent_workspace 初始化目标申请工作区并复制原始材料副本。
2. 在目标申请工作区确认标准目录：
   - 00_original_backup
   - 01_classified_materials/identity
   - 01_classified_materials/academic
   - 01_classified_materials/language
   - 01_classified_materials/essays
   - 01_classified_materials/recommendation
   - 01_classified_materials/financial
   - 01_classified_materials/platform_related
   - 01_classified_materials/other
   - 01_classified_materials/needs_review
   - 02_generated
   - 03_state
   - 04_logs
   - 05_screenshots
   - 06_new_materials
3. 只读取原始学生资料文件夹，不修改它；后续只操作 00_original_backup 和申请工作区内部文件。
4. 实际读取 PDF、Word、图片、表格等材料内容；不能只根据文件名生成学生档案。如果某个文件无法解析，请记录到 needs_review 和不确定项。
5. 调用 application-agent_materials 分类材料到 01_classified_materials。无法确认用途的材料必须进入 needs_review。
6. 生成并维护这些文件：
   - 02_generated/student_profile.md
   - 02_generated/info_collection_form.md
   - 02_generated/material_collection_form.md
   - 02_generated/missing_materials.docx
   - 02_generated/application_requirements.md
   - 02_generated/task_summary.md
   - 03_state/task_state.json
   - 03_state/missing_items.json
   - 03_state/application_progress.json
   - 03_state/application_requirements.json
   - 04_logs/agent_log.md
   - 04_logs/cua_log.md
7. 生成学生档案前，先用 webfetch 读取申请链接；如不能确认学校/项目要求，用 websearch 搜索官方页面，然后调用 application-agent_requirements 落盘。
8. student_profile.md 必须是基于材料内容和申请要求的结构化学生申请档案，包含材料路径、已确认信息、缺失项、不确定项和申请目标。
9. missing_materials.docx 必须通过 application-agent_documents 从 03_state/missing_items.json 生成，面向顾问、学生和家长，避免技术语言。
10. 进入 CUA 阶段时，调用 application-agent_cua 打开或复用申请平台链接；如 03_state/login_credentials.json 里有已保存密码，调用 application-agent_login 填写登录页；如需 MFA/验证码，提示顾问手动完成。登录完成后必须按真人式循环：observe_page 观察页面和 modal，填 1-3 个字段后再次 observe_page，遇到新菜单/新字段就调整策略，最后 save_page_verified。默认不保存截图，只有失败、上传、保存证据或顾问要求时才截图。
11. 遇到 select、combobox、dropdown、degree program、state、school、test type 等下拉选择时，必须调用 select_option_verified。像系统框一样的原生 select 弹层不要坐标点击；select_option_verified 会按 DOM、AX set_value、AX popup menu、原生菜单键盘 typeahead 分层尝试，并在选择后 observe_page 复查。
12. 如果浏览器弹出 alert/confirm/prompt 或“离开此网站？”确认框，调用 handle_blocker；“离开此网站？”一律选择取消/留在页面。从提示文本判断缺失字段，补齐字段后再尝试 save_page_verified。
13. 如果 application-agent_cua 返回 CUA_STOPPED，先判断顾问是否已经要求继续；如果是，调用 resume_cua 并重试，不要把下拉框交给鼠标。CUA_RATE_LIMITED 才停止本轮 CUA，记录当前页面和待填字段。
14. 如果 application-agent_cua 返回 CUA_CHROME_JS_DISABLED，立即停止 DOM 相关重试，但继续使用 select_option_verified 的 AX/原生键盘兜底、fill_field_verified 的 AX/键盘策略和 keyboard_fill_sequence。
15. 不确定内容用 question 提供 2-3 个顾问可选答案；每个关键阶段都要在对话里告诉顾问进度，并调用 application-agent_state 同步更新 03_state/task_state.json。
16. 完成当前可做内容后，检查 agent_execution_audit.json，输出阶段性总结和下一步需要顾问补充的内容。

## 安全边界

- 严禁自动最终提交申请。
- 严禁自动付款。
- 严禁发送不可逆推荐信邀请。
- 严禁把账号密码写入聊天、日志、档案或工作区；只允许读取本机加密凭证库执行登录。
- 严禁瞎填、猜填不确定字段。
- 遇到最终提交、付款、不可逆确认、推荐信邀请时，必须停止并写入 task_summary.md 的人工处理事项。

请现在开始执行第 1 步：创建目标申请工作区。`
}


const DEFAULT_APPLICATION_PROMPT = `你是 Terra-Edu 申请 Agent，服务对象是留学顾问。

你的目标是帮助顾问自动完成学生资料整理、申请信息生成、申请平台填写、缺失材料识别和补充材料清单输出。

顾问已经在任务创建页填写基础信息，包括学生姓名、学生资料文件夹、申请学校、申请项目、申请类型、申请平台或申请链接。任务开始后，你必须自动执行申请流程，不要等待顾问一步一步指挥。

默认流程：
1. 先调用 OpenCode 内置 todowrite 创建 10 步计划，并在每个阶段更新进度。
2. 调用 application-agent_workspace 创建/刷新专属申请工作区，并把原始资料复制到 00_original_backup。
3. 读取学生资料副本，识别申请相关文件。
4. 调用 application-agent_materials 整理材料，无法判断的文件放入 needs_review。
5. 使用 webfetch 读取申请链接；信息不足时用 websearch 查找官方学校/项目要求，并调用 application-agent_requirements 落盘。
6. 生成结构化 student_profile.md。
7. 检查缺失信息和缺失材料，已有信息不要重复要求，并写入 03_state/missing_items.json。
8. 调用 application-agent_documents，根据 missing_items.json 生成信息表、材料表、Word 清单和总结。
9. 调用 application-agent_cua 打开申请平台；如已保存平台账号密码，调用 application-agent_login 填写登录页；需要 MFA/验证码时暂停并提示顾问手动完成。
10. 能填写的先填写，能保存的先保存；缺失内容跳过并记录，不确定内容用 question 询问顾问。顾问补充材料后，重新读取 06_new_materials，更新档案并继续申请。

可用 Custom Tools：
- application-agent_workspace：工作区初始化、复制原始材料、刷新材料计数。
- application-agent_materials：材料分类、materials_index 生成。
- application-agent_documents：从 missing_items.json 生成 Word 清单、表单和总结。
- application-agent_state：更新 task_state.json。
- application-agent_cua：调用 cua-driver 进行申请平台操作；优先使用 observe_page、fill_field_verified、select_option_verified、save_page_verified、handle_blocker 组成真人式填表循环；低级点击/输入/选择只作为兜底；默认不截图。
- application-agent_login：用本机钥匙串保存的申请平台账号密码填写登录页；不会向 Agent 输出明文密码。
- application-agent_risk：高风险动作识别和硬拦截。
- application-agent_requirements：保存学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

工具调用硬性约束：
- 启动后必须调用 todowrite，建立默认 10 步计划；每完成一步要同步 todowrite 和 application-agent_state。
- 学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方页面。抓取结果必须调用 application-agent_requirements 落盘。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、自动登录、CUA 操作和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- bash 只允许用于读取文件内容、OCR/文本提取、检查环境或辅助诊断；不得用 bash 替代 application-agent_workspace、application-agent_materials、application-agent_documents、application-agent_state、application-agent_cua、application-agent_risk。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- 遇到原生系统样式下拉弹层时，不要坐标点击，也不要先盲目 Escape；调用 application-agent_cua observe_page 后再调用 select_option_verified。它会按 DOM、AX set_value、AX popup menu、原生菜单键盘 typeahead 兜底，并在选择后复查。
- 填表必须像真人一样小步推进：每页先 observe_page；每填 1-3 个字段就复查；遇到新菜单、新字段、alert 或“离开此网站？”先 handle_blocker；保存必须用 save_page_verified，不能用 record_saved 直接算成功。

安全规则：
- 不删除或覆盖原始学生文件。
- 不在信息不确定时猜测填写。
- 可调用 OpenCode 内置 question 工具；所有问题必须短、清楚、带 2-3 个顾问可执行选项，并接受自定义回复。
- 不自动点击最终提交申请。
- 不自动付款。
- 不自动发送不可逆推荐信邀请。
- 可以使用 application-agent_login 调用本机加密凭证库自动登录，但不得把密码写入任何文件、聊天或日志。
- 可以填写、上传和保存，但最终提交必须由顾问人工确认。

你必须在每个关键阶段通过对话框告诉顾问当前进度。`

const SKILL_DEFINITIONS = [
  {
    name: "task-initialization",
    description: "创建申请任务上下文，读取任务创建页信息并自动启动默认申请流程。",
    body: `执行步骤：
1. 读取任务创建页输入，确认学生姓名、资料文件夹、申请学校、项目、类型和申请链接均存在。
2. 说明本次任务边界：Agent 可以整理、填写、保存和上传可确认材料，但不能最终提交、付款或发送不可逆推荐信邀请。
3. 立即调用 todowrite 创建 10 步默认计划，并调用 application-agent_state，把状态更新为“正在创建申请工作区”。
4. 调用 workspace-building skill，进入默认 10 步流程，不等待顾问再输入第一条指令。

输出要求：
- 对话里用 1-3 句话说明当前开始做什么。
- 需要顾问确认时调用 OpenCode question 工具，提供短问题和 2-3 个可选答案。`,
  },
  {
    name: "student-file-reading",
    description: "读取申请工作区中的学生材料副本，识别文档、表格、图片、PDF 和未知材料。",
    body: `执行步骤：
1. 只读取 00_original_backup，不读取或修改原始学生文件夹。
2. 列出所有文件路径、扩展名、大小和可能用途。
3. 对有文本层的 PDF、doc/docx、xlsx/csv、txt/md 优先提取文字摘要；对扫描 PDF、图片、护照照片、成绩单截图，调用可用的 OpenCode MCP、本地 OCR 或系统工具提取文字。
4. OCR 或文本提取结果必须写入 03_state/extracted_text/ 或 02_generated/material_text_index.md；如果工具不可用，记录失败原因，不要假装读懂。
5. 无法识别用途的材料标记为 needs_review。

输出要求：
- 汇报识别到的材料类型和无法识别的文件。
- 后续判断必须基于文件内容、OCR 结果或明确文件名，不确定就记录。`,
  },
  {
    name: "workspace-building",
    description: "创建隔离申请工作区，复制原始材料，建立标准目录和初始状态文件。",
    body: `执行步骤：
1. 调用 application-agent_workspace，action 使用 initialize。
2. 确认目录包含 00_original_backup、01_classified_materials、02_generated、03_state、04_logs、05_screenshots、06_new_materials。
3. 确认原始学生文件夹没有被修改；所有后续读写都在申请工作区内完成。
4. 调用 application-agent_state，把状态更新为“正在读取文件”。

输出要求：
- 告诉顾问工作区已创建，原始材料已复制为副本。
- 如果复制失败，记录失败文件和原因，不要继续假装完成。`,
  },
  {
    name: "material-organization",
    description: "按身份、学术、语言、文书、推荐、财务、平台相关、其他、待确认分类材料。",
    body: `执行步骤：
1. 调用 application-agent_materials 对 00_original_backup 中的文件分类。
2. 优先结合文件名、文本提取/OCR 结果和文件内容判断用途。
3. 分类目录必须覆盖 identity、academic、language、essays、recommendation、financial、platform_related、other、needs_review。
4. 不确定材料进入 needs_review，并在 missing_items.json 中加入“待确认材料用途”。
5. 分类完成后调用 application-agent_state 更新为“正在生成学生资料”。

输出要求：
- 汇报已分类数量、主要材料类型、待确认数量。
- 不要移动或覆盖原始学生文件夹。`,
  },
  {
    name: "student-profile-generation",
    description: "根据已有材料生成结构化 student_profile.md，作为后续填表核心资料库。",
    body: `执行步骤：
1. 读取 03_state/materials_index.json、文本/OCR 提取结果、已有缺失项和任务输入。
2. 生成或更新 02_generated/student_profile.md。
3. 档案必须包含：基本信息、联系方式、家庭信息、教育经历、成绩、语言成绩、活动、奖项、文书、推荐人、申请目标、材料目录、材料路径、缺失信息、不确定信息、填表注意事项。
4. 对无法确认的字段写“待确认”，不要编造。
5. 生成后调用 application-agent_state 更新为“正在检查缺失内容”。

输出要求：
- 告诉顾问档案路径和主要已确认信息。
- 明确列出仍不确定的关键字段。`,
  },
  {
    name: "application-target-analysis",
    description: "根据学校、项目、专业、申请类型和平台判断通用申请信息与材料需求。",
    body: `执行步骤：
1. 读取任务输入、student_profile.md 和材料目录。
2. 先用 webfetch 读取任务中的申请链接；如果链接只到登录页或信息不足，用 websearch 查找学校官网、项目页和 admissions requirements 官方页面。
3. 调用 application-agent_requirements，把来源 URL、抓取时间、可信度、字段需求、材料需求、待确认要求写入 application_requirements.json/md。
4. 基于申请学校、项目、专业、申请类型和官方来源判断通用需求：身份、学历、成绩、语言、简历、文书、推荐人、资金、紧急联系人、申请问题。
5. 只做可解释的通用申请分析；除非申请平台页面已经打开并被 CUA 识别，不要臆测平台专属字段。
6. 把缺失信息、缺失材料、不确定字段交给 missing-content-recording skill。

输出要求：
- 区分“确定缺失”和“需要确认”。
- 已有的信息不要重复问。
- 每条学校/项目要求要能追溯到 application_requirements.json 中的来源。`,
  },
  {
    name: "missing-content-recording",
    description: "记录申请过程中发现的所有缺失信息、缺失材料和不确定内容。",
    body: `执行步骤：
1. 读取现有 03_state/missing_items.json，去重后更新，不要反复制造相同缺失项。
2. 每个缺失项必须包含 name、type、source、whyNeeded、prepareFrom、formatRequirement、blocksProgress、status、addedToWordList。
3. 信息类、材料类、不确定类分别标记为 information、material、uncertain。
4. 页面填表过程中发现的缺失项要记录 page/currentPage。
5. 更新后调用 application-agent_state 同步缺失数量和当前状态。

输出要求：
- 只列真正缺失、无法判断或必须顾问确认的内容。
- 不要把已经在 student_profile.md 中确认的信息重复写成缺失。`,
  },
  {
    name: "word-checklist-generation",
    description: "根据 missing_items.json 生成适合发给学生或家长的 Word 缺失材料清单。",
    body: `执行步骤：
1. 必须从 03_state/missing_items.json 读取缺失项，不从聊天记录临时拼清单。
2. 调用 application-agent_documents，action 使用 generate_word 或 generate_all。
3. Word 清单面向顾问、学生和家长，避免技术语言。
4. 每项说明：缺什么、为什么需要、去哪里准备、格式要求、是否影响继续申请。
5. 如果没有缺失项，也生成“当前暂无需补充”的清单或在总结中说明。

输出要求：
- 告诉顾问 Word 文件路径。
- 不要输出内部 JSON 字段名给学生/家长。`,
  },
  {
    name: "cua-application-filling",
    description: "通过 CUA 打开申请平台、等待顾问登录、识别页面字段、填写可确认信息并保存页面。",
    body: `执行步骤：
1. 首次进入平台时调用 application-agent_cua，action 使用 open_platform 打开申请链接；后续继续填表优先 capture_state/list_windows 复用现有 Chrome 页面，不要反复 open_platform。
2. 如果页面需要登录，先读取 03_state/login_credentials.json；如 hasSavedPassword 为 true，调用 application-agent_login 自动填写登录页。Agent 不能要求工具输出或展示明文密码。
3. 如果需要 MFA、验证码或邮箱验证，调用 application-agent_login record_mfa_required，并提示顾问手动完成；完成后继续。
4. 登录后先调用 application-agent_cua observe_page；它会读取 AX/DOM 状态、当前页面、modal、必填空项、保存按钮和阻塞弹窗。默认不要请求截图。
5. 对每个字段，先从 student_profile.md 查找可确认答案；无法确认则记录缺失，不瞎填。
6. 普通文本字段优先调用 fill_field_verified。它会尝试 DOM、AX、键盘输入，并立刻 observe_page 二次复查；返回 FIELD_FILLED_NEEDS_RECHECK 时不要保存，先重新观察或重试字段。
7. 下拉框、学校、专业、州、国家、日期、考试类型等控件必须调用 select_option_verified。它会处理普通 select、原生系统菜单、autocomplete 学校搜索、Slate 动态下拉，并在选择后复查显示值/隐藏值。
8. 每填 1-3 个字段后再次调用 observe_page。若页面出现新字段、新菜单或动态必填项，先处理新内容，再继续。
9. 如果页面状态里出现像 macOS/Chrome 系统菜单一样的原生 select 弹层，不要点弹层选项；直接调用 select_option_verified，必要时先 handle_blocker 或 dismiss_native_menu 关闭残留弹层后重试。
10. 对 GRE/GMAT/TOEFL 分数、百分位、日期、注册号这类连续普通输入框，如果 fill_field_verified 不能稳定处理，才用 keyboard_fill_sequence 通过 Tab 顺序填写；填写后必须 observe_page 复查。
11. 如果出现浏览器 alert/confirm/prompt 或“离开此网站？”确认框，调用 handle_blocker。“离开此网站？”必须选择取消/留在页面；从提示文本判断缺失字段，补齐字段后再保存。若出现 Chrome “要恢复页面吗？”恢复弹窗，关闭它，不要点恢复。
12. 保存页面必须调用 save_page_verified。它会保存前扫描必填空项、点击保存、保存后检查 validation error/alert/页面状态，成功后才写入 savedPages。不要再用 record_saved 直接当作保存成功。
13. 如果工具返回 CUA_STOPPED，先调用 application-agent_cua resume_cua，再重试当前字段；不要直接把字段列为“鼠标点击操作”。如果返回 CUA_CHROME_JS_DISABLED，不要停止整个 CUA；停止 DOM 相关重试，继续使用 verified action 的 AX/键盘兜底。只有 CUA_RATE_LIMITED 才停止本轮 CUA。
14. 每次准备点击 submit、final submit、payment、recommendation invite、不可逆确认前，必须先调用 application-agent_risk；命中 BLOCKED 就停止。

输出要求：
- 持续告诉顾问正在填写哪个页面、保存了什么、缺了什么。
- 不要用视觉坐标猜选下拉项，除非 observe_page、select_option_verified 和键盘兜底都失败且顾问明确允许。`,
  },
  {
    name: "material-upload",
    description: "根据申请平台要求匹配本地材料并尝试上传，记录成功或失败原因。",
    body: `执行步骤：
1. 读取 student_profile.md、materials_index.json 和当前申请页面状态。
2. 只上传用途和字段要求能明确匹配的材料；不确定材料不能上传。
3. 上传前检查高风险：不要上传含账号密码、无关隐私或用途不明文件。
4. 上传成功调用 application-agent_cua record_upload；失败调用 record_failure；需要证据时再额外调用 capture_state 保存截图。
5. 上传后更新 application_progress.json 和 task_summary.md。

输出要求：
- 汇报上传了哪些材料、哪些失败、失败原因和是否需要顾问手动处理。`,
  },
  {
    name: "continue-after-supplement",
    description: "顾问补齐材料后重新读取新材料，更新档案和缺失项，并继续申请填写。",
    body: `执行步骤：
1. 优先读取 06_new_materials；如顾问说明材料在其他位置，先复制进申请工作区后再处理。
2. 调用 application-agent_workspace refresh 或相应工具刷新文件计数。
3. 重新执行 student-file-reading、material-organization、student-profile-generation、missing-content-recording。
4. 根据新的 missing_items.json 重新生成 Word 清单和任务总结。
5. 如果关键缺失已补齐，调用 cua-application-filling 继续从 application_progress.json 中的当前位置填写。

输出要求：
- 告诉顾问哪些缺失已解决、哪些仍然缺。
- 不要覆盖顾问明确保留的旧版本文件。`,
  },
  {
    name: "task-summary",
    description: "总结当前任务状态、完成内容、未完成内容、生成文件、申请平台进度和下一步建议。",
    body: `执行步骤：
1. 读取 task_state.json、application_progress.json、missing_items.json、materials_index.json、application_requirements.json、agent_execution_audit.json 和已生成文件列表。
2. 调用 application-agent_documents，action 使用 generate_summary 或 generate_all。
3. 总结已完成、未完成、缺失项、学校/项目要求来源、工具链审计结果、失败原因、高风险拦截、已保存页面、已上传材料、下一步建议。
4. 明确提醒最终提交、付款、推荐信邀请等需要顾问人工处理。

输出要求：
- 语言面向顾问，一眼能看懂。
- 不输出 OpenCode 内部实现细节或原始工具调用堆栈。`,
  },
]

const COMMAND_DEFINITIONS = [
  ["organize-materials", "整理学生资料", "请读取当前申请工作区材料副本，调用 material-organization skill，整理材料并更新材料目录。"],
  ["generate-profile", "生成学生申请档案", "请调用 student-profile-generation skill，基于当前材料生成或更新 student_profile.md。"],
  ["check-missing", "检查缺失内容", "请先调用 application-target-analysis skill，用 webfetch/websearch 获取官方申请要求并调用 application-agent_requirements 落盘，再调用 missing-content-recording skill 更新 missing_items.json。"],
  ["generate-info-form", "生成信息收集表", "请根据 missing_items.json 生成面向顾问和学生的信息补充清单。"],
  ["generate-material-form", "生成材料收集表", "请根据 missing_items.json 生成面向学生和家长的材料收集表。"],
  ["start-application", "开始申请填表", "请调用 cua-application-filling skill，打开申请平台，等待顾问登录，并填写可确认字段。"],
  ["continue-application", "继续申请填表", "请从 application_progress.json 恢复申请进度，继续填写和保存可确认页面。"],
  ["continue-after-supplement", "材料已经补好了，继续申请", "请调用 continue-after-supplement skill，读取补充材料，更新档案和缺失项，并继续申请填表。"],
  ["generate-word-checklist", "生成 Word 缺失清单", "请调用 word-checklist-generation skill，根据 missing_items.json 重新生成 missing_materials.docx。"],
  ["summarize-progress", "总结当前进度", "请调用 task-summary skill，总结已完成、未完成、缺失项、生成文件和下一步建议。"],
]

function renderSkill(skill: { name: string; description: string; body: string }) {
  return `---
name: ${skill.name}
description: ${skill.description}
compatibility: opencode
metadata:
  product: terra-edu-application-agent
---

## 作用

${skill.body}

## 执行原则

- 在申请工作区内操作，不修改原始学生资料。
- 只要步骤有对应 application-agent_* Custom Tool，必须优先调用该工具；bash 只能做 OCR、文本提取、环境检查和有限诊断，不能替代申请专用工具链。
- 每次关键工具调用后检查 03_state/agent_execution_audit.json 或对应状态文件，确认工具链留下可回归的执行证据。
- 启动和复杂流程必须使用 todowrite 管理 10 步计划，并在 application_progress.json 同步关键状态。
- 申请学校、项目和平台要求必须优先用 webfetch/websearch 获取官方来源，再调用 application-agent_requirements 落盘。
- 已有信息不要重复要求。
- 遇到扫描 PDF 或图片材料，先调用可用 MCP、本地 OCR 或系统工具提取文字；失败要记录，不要猜。
- 不确定内容必须使用 OpenCode question 询问顾问，给出 2-3 个清楚选项并允许自定义回复。
- 最终提交、付款、推荐信邀请和不可逆确认必须停止并交给顾问。
`
}

function renderCommand(command: string[]) {
  return `---
description: ${command[1]}
agent: application-agent
model: opencode-go/deepseek-v4-pro
---

${command[2]}
`
}

function renderApplicationAgentTools() {
  return String.raw`import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, relative } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type ToolContext = { directory?: string; sessionID?: string; messageID?: string; threadID?: string; agent?: string; root?: string; worktree?: string }
type JsonSchema = Record<string, unknown>

function objectArg(properties: JsonSchema, required: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  }
}

function inputArg(properties: JsonSchema, required: string[] = []) {
  return {
    input: objectArg(properties, required),
  }
}

const statusValues = [
  "已创建",
  "正在复制原始材料",
  "正在创建申请工作区",
  "正在读取文件",
  "正在整理材料",
  "正在生成学生资料",
  "正在检查缺失内容",
  "等待顾问登录",
  "正在填写申请平台",
  "正在保存申请进度",
  "正在上传材料",
  "等待补充材料",
  "可继续申请",
  "阶段性完成",
  "异常中断",
] as const

const generated = [
  ["学生申请档案", "02_generated/student_profile.md", "markdown"],
  ["信息收集表", "02_generated/info_collection_form.md", "markdown"],
  ["材料收集表", "02_generated/material_collection_form.md", "markdown"],
  ["Word 缺失材料清单", "02_generated/missing_materials.docx", "docx"],
  ["任务总结", "02_generated/task_summary.md", "markdown"],
  ["任务状态", "03_state/task_state.json", "json"],
  ["缺失项记录", "03_state/missing_items.json", "json"],
  ["申请进度记录", "03_state/application_progress.json", "json"],
  ["申请要求记录", "03_state/application_requirements.json", "json"],
  ["申请要求摘要", "02_generated/application_requirements.md", "markdown"],
  ["登录凭证状态", "03_state/login_credentials.json", "json"],
  ["工具执行审计", "03_state/agent_execution_audit.json", "json"],
  ["Agent 日志", "04_logs/agent_log.md", "log"],
  ["CUA 日志", "04_logs/cua_log.md", "log"],
] as const

const workspaceDirs = [
  "00_original_backup",
  "01_classified_materials/identity",
  "01_classified_materials/academic",
  "01_classified_materials/language",
  "01_classified_materials/essays",
  "01_classified_materials/recommendation",
  "01_classified_materials/financial",
  "01_classified_materials/platform_related",
  "01_classified_materials/other",
  "01_classified_materials/needs_review",
  "02_generated",
  "03_state",
  "04_logs",
  "05_screenshots",
  "06_new_materials",
]

function root(ctx: { directory?: string }) {
  if (!ctx.directory) throw new Error("OpenCode tool context is missing directory")
  return ctx.directory
}

async function readJson(path: string, fallback: any) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8")
}

function redactSensitiveText(value: unknown) {
  return String(value ?? "")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/\\n[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "\\n[REDACTED_EMAIL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(const\s+password\s*=\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_PASSWORD]"')
    .replace(/(const\s+username\s*=\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_USERNAME]"')
    .replace(/(const\s+password\s*=\\?")([^"\\]*(?:\\.[^"\\]*)*)(\\?")/gi, '$1[REDACTED_PASSWORD]$3')
    .replace(/(const\s+username\s*=\\?")([^"\\]*(?:\\.[^"\\]*)*)(\\?")/gi, '$1[REDACTED_USERNAME]$3')
    .replace(/("password"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_PASSWORD]"')
    .replace(/("username"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_USERNAME]"')
    .replace(/("authorization"\s*:\s*)"(?:\\.|[^"])*"/gi, '$1"[REDACTED_AUTH]"')
}

async function appendLog(workspace: string, kind: "agent" | "cua", message: string) {
  const file = join(workspace, "04_logs", kind === "agent" ? "agent_log.md" : "cua_log.md")
  const current = existsSync(file) ? await readFile(file, "utf8") : "# " + (kind === "agent" ? "Agent" : "CUA") + " 日志\n\n"
  await writeFile(file, current + "- " + new Date().toISOString() + " " + redactSensitiveText(message) + "\n", "utf8")
}

async function appendAudit(workspace: string, tool: string, action: string, status: "started" | "completed" | "failed", detail = "", ctx?: ToolContext) {
  try {
    const file = join(workspace, "03_state", "agent_execution_audit.json")
    const current = await readJson(file, [])
    const entries = Array.isArray(current) ? current : []
    entries.push({
      at: new Date().toISOString(),
      tool: "application-agent_" + tool,
      action,
      status,
      detail: redactSensitiveText(detail),
      context: {
        sessionID: ctx?.sessionID || "",
        messageID: ctx?.messageID || "",
        threadID: ctx?.threadID || "",
        agent: ctx?.agent || "",
        directory: ctx?.directory || workspace,
        root: ctx?.root || "",
        worktree: ctx?.worktree || "",
      },
    })
    await writeJson(file, entries)
  } catch (error: any) {
    await appendLog(workspace, "agent", "工具执行审计写入失败：" + String(error?.message || error)).catch(() => {})
  }
}

async function stopCuaDriver() {
  for (const pattern of ["cua-driver", "CuaDriver.app/Contents/MacOS/cua-driver"]) {
    await new Promise<void>((resolve) => {
      execFile("pkill", ["-f", pattern], () => resolve())
    })
  }
}

async function notifyCuaStopped(reason: string) {
  await new Promise<void>((resolve) => {
    execFile(
      "osascript",
      [
        "-e",
        "display notification " + JSON.stringify(reason) + " with title " + JSON.stringify("Terra-Edu 申请 Agent：CUA 已停止"),
      ],
      () => resolve(),
    )
  })
}

async function readCuaControl(workspace: string) {
  return await readJson(join(workspace, "03_state/cua_control.json"), {
    stopped: false,
    stoppedAt: "",
    reason: "",
    domAutomationUnavailable: false,
    domAutomationUnavailableAt: "",
    domAutomationUnavailableReason: "",
    recentActions: [],
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
  })
}

async function writeCuaControl(workspace: string, control: any) {
  control.updatedAt = new Date().toISOString()
  await writeJson(join(workspace, "03_state/cua_control.json"), control)
}

function isChromeJavaScriptAppleEventsDisabled(message: string) {
  return /AppleScript 执行 JavaScript 的功能已关闭|允许 Apple 事件中的 JavaScript|Allow JavaScript from Apple Events|JavaScript from Apple Events|applescript/i.test(message)
    && /execute_javascript|JavaScript execution failed|执行 JavaScript/i.test(message)
}

function chromeJavaScriptAppleEventsHelp() {
  return "Chrome 未开启“允许 Apple 事件中的 JavaScript”，DOM 控件识别、自动登录和 DOM 下拉选择不可用。CUA 将改用 AX/键盘事件 fallback 继续填写普通文本字段；如需恢复 DOM 策略，可在 Chrome 菜单“查看 > 开发者 > 允许 Apple 事件中的 JavaScript”开启。"
}

function isCuaStopSignal(message: string) {
  return /CUA_(STOPPED|RATE_LIMITED)/.test(message)
}

function isCuaDomUnavailableSignal(message: string) {
  return /CUA_CHROME_JS_DISABLED/.test(message)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nativeSelectTypeahead(text: string) {
  const normalized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
  return normalized.slice(0, 24)
}

function normalizeOptionText(text: string) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function normalizeApplicationUrl(value?: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (!URL.canParse(raw)) return normalizeOptionText(raw).replace(/\/+$/, "")
  const url = new URL(raw)
  url.hash = ""
  const pathname = url.pathname.replace(/\/+$/, "")
  return (url.protocol + "//" + url.host + (pathname || "/") + url.search).toLowerCase()
}

function findAxSelectableOptionIndex(tree: string, desired: string) {
  const wanted = normalizeOptionText(desired)
  if (!wanted) return undefined

  const candidates: Array<{ index: number; label: string; exact: boolean; line: string }> = []
  for (const line of String(tree || "").split(/\r?\n/)) {
    if (!/\bAX(?:MenuItem|CheckBox|RadioButton)\b/.test(line)) continue
    const indexMatch = line.match(/\[(\d+)\]/)
    if (!indexMatch) continue
    const labelMatch = line.match(/=\s*"([^"]+)"/) || line.match(/\bAX(?:MenuItem|CheckBox|RadioButton)\s+"([^"]+)"/)
    if (!labelMatch) continue
    const label = labelMatch[1] || ""
    const normalized = normalizeOptionText(label)
    if (!normalized) continue
    if (normalized === wanted) candidates.push({ index: Number(indexMatch[1]), label, exact: true, line })
    else if (normalized.includes(wanted) || wanted.includes(normalized)) candidates.push({ index: Number(indexMatch[1]), label, exact: false, line })
  }

  const exact = candidates.find((candidate) => candidate.exact)
  return exact?.index ?? candidates[0]?.index
}

async function pressCuaTypeahead(workspace: string, auditAction: string, pid: number, windowId: number, text: string) {
  const value = nativeSelectTypeahead(text)
  if (!value) {
    await execCua(workspace, auditAction, ["call", "type_text", JSON.stringify({ pid, text })], 10000)
    return
  }
  for (const char of value) {
    const key = char === " " ? "space" : char
    await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid, window_id: windowId, key })], 5000)
    await sleep(45)
  }
}

async function assertCuaAllowed(workspace: string, action: string) {
  const control = await readCuaControl(workspace)
  if (control.stopped) {
    const reason = control.reason || "CUA 自动化已停止。"
    await appendLog(workspace, "cua", "已阻止 CUA 调用：" + action + "；原因：" + reason)
    await appendAudit(workspace, "cua", action, "failed", "CUA stopped: " + reason)
    throw new Error("CUA_STOPPED: " + reason + " 如需继续，请由顾问重新发起“开始填表/继续填表”。")
  }

  const now = Date.now()
  const recent = Array.isArray(control.recentActions) ? control.recentActions : []
  const nextRecent = recent
    .filter((item: any) => now - Date.parse(String(item.at || "")) < 60_000)
    .concat({ at: new Date(now).toISOString(), action })
  control.recentActions = nextRecent

  if (nextRecent.length > 36) {
    control.stopped = true
    control.stoppedAt = new Date(now).toISOString()
    control.reason = "CUA 在 60 秒内调用超过 36 次，疑似自动化循环或前台抢占，已自动熔断。"
    await writeCuaControl(workspace, control)
    await stopCuaDriver()
    await notifyCuaStopped(control.reason)
    await appendLog(workspace, "cua", control.reason)
    await appendAudit(workspace, "cua", action, "failed", control.reason)
    throw new Error("CUA_RATE_LIMITED: " + control.reason)
  }

  await writeCuaControl(workspace, control)
}

async function markCuaSuccess(workspace: string) {
  const control = await readCuaControl(workspace)
  control.consecutiveFailures = 0
  await writeCuaControl(workspace, control)
}

async function markCuaFailure(workspace: string, action: string, error: unknown) {
  const control = await readCuaControl(workspace)
  const message = String((error as any)?.message || error)
  if (isChromeJavaScriptAppleEventsDisabled(message)) {
    control.domAutomationUnavailable = true
    control.domAutomationUnavailableAt = new Date().toISOString()
    control.domAutomationUnavailableReason = chromeJavaScriptAppleEventsHelp()
    control.consecutiveFailures = 0
  } else {
    control.consecutiveFailures = Number(control.consecutiveFailures || 0) + 1
    if (control.consecutiveFailures >= 3) {
      control.stopped = true
      control.stoppedAt = new Date().toISOString()
      control.reason = "CUA 连续失败 3 次，疑似页面卡死或驱动失控，已自动停止以释放 Chrome 前台控制。"
      await stopCuaDriver()
      await notifyCuaStopped(control.reason)
    }
  }
  await writeCuaControl(workspace, control)
  await appendLog(workspace, "cua", "CUA 调用失败：" + action + "；" + message)
  if (isChromeJavaScriptAppleEventsDisabled(message)) await appendLog(workspace, "cua", control.domAutomationUnavailableReason)
  if (control.stopped) await appendLog(workspace, "cua", control.reason)
}

async function execCua(workspace: string, action: string, args: string[], timeout = 15_000) {
  await assertCuaAllowed(workspace, action)
  try {
    const result = await execFileAsync("cua-driver", args, { timeout })
    await markCuaSuccess(workspace)
    return result
  } catch (error) {
    await markCuaFailure(workspace, action, error)
    const control = await readCuaControl(workspace)
    if (isChromeJavaScriptAppleEventsDisabled(String((error as any)?.message || error))) {
      const updated = await readCuaControl(workspace)
      throw new Error("CUA_CHROME_JS_DISABLED: " + (updated.domAutomationUnavailableReason || chromeJavaScriptAppleEventsHelp()))
    }
    throw error
  }
}

function ensureCuaProgress(progress: any) {
  if (!progress || typeof progress !== "object") progress = {}
  if (!Array.isArray(progress.completedPages)) progress.completedPages = []
  if (!Array.isArray(progress.savedPages)) progress.savedPages = []
  if (!Array.isArray(progress.uploadedMaterials)) progress.uploadedMaterials = []
  if (!Array.isArray(progress.failedActions)) progress.failedActions = []
  if (!Array.isArray(progress.highRiskBlocks)) progress.highRiskBlocks = []
  if (!Array.isArray(progress.filledFields)) progress.filledFields = []
  if (!Array.isArray(progress.verifiedFields)) progress.verifiedFields = []
  if (!Array.isArray(progress.blockedDialogs)) progress.blockedDialogs = []
  if (!Array.isArray(progress.validationMessages)) progress.validationMessages = []
  if (!Array.isArray(progress.requiredEmptyFields)) progress.requiredEmptyFields = []
  return progress
}

function appendLimited(progress: any, key: string, item: any, limit = 120) {
  if (!Array.isArray(progress[key])) progress[key] = []
  progress[key].push(item)
  if (progress[key].length > limit) progress[key] = progress[key].slice(progress[key].length - limit)
}

function parseJsonObjectFromText(text: string) {
  const raw = String(text || "").trim()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {}
  const first = raw.indexOf("{")
  if (first < 0) return undefined
  for (let end = raw.length; end > first; end -= 1) {
    const chunk = raw.slice(first, end).trim()
    if (!chunk.endsWith("}")) continue
    try {
      return JSON.parse(chunk)
    } catch {}
  }
  return undefined
}

function normalizedMatch(actual: string, expected: string) {
  const a = normalizeOptionText(actual)
  const e = normalizeOptionText(expected)
  if (!e) return true
  if (!a) return false
  return a === e || a.includes(e) || e.includes(a)
}

function isBeforeUnloadText(text: string) {
  return /离开此网站|离开网站|Leave this site|Leave site|changes.*not be saved|may not be saved|可能不会保存|不会保存您所做的更改|unsaved changes/i.test(String(text || ""))
}

function isRestoreDialogText(text: string) {
  return /要恢复页面吗|Chrome 未正确关闭|restore pages|didn.t shut down correctly|恢复页面/i.test(String(text || ""))
}

function buildDomObservationScript() {
  return [
    "(function(){",
    "const norm=(v)=>String(v||'').trim().replace(/\\s+/g,' ');",
    "const visible=(el)=>!!(el&&el.offsetParent!==null&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');",
    "const cssPath=(el)=>{if(!el||!el.tagName)return '';if(el.id)return '#'+CSS.escape(el.id);const parts=[];let cur=el;while(cur&&cur.nodeType===1&&parts.length<6){let part=cur.tagName.toLowerCase();if(cur.name)part+='[name=\"'+String(cur.name).replace(/\"/g,'\\\\\"')+'\"]';else{const p=cur.parentElement;if(p){const same=Array.from(p.children).filter(x=>x.tagName===cur.tagName);if(same.length>1)part+=':nth-of-type('+(same.indexOf(cur)+1)+')';}}parts.unshift(part);cur=cur.parentElement;}return parts.join(' > ');};",
    "const labelFor=(el)=>{const id=el.id;if(id){const l=document.querySelector('label[for=\"'+CSS.escape(id)+'\"]');if(l)return norm(l.innerText||l.textContent);}let cur=el;for(let i=0;i<5&&cur;i++,cur=cur.parentElement){const own=cur.querySelector&&cur.querySelector(':scope > label');if(own)return norm(own.innerText||own.textContent);const prev=cur.previousElementSibling;if(prev&&/label|div|span|p|td|th/i.test(prev.tagName)){const t=norm(prev.innerText||prev.textContent);if(t&&t.length<140)return t;}}return norm(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.name||el.id);};",
    "const valueOf=(el)=>{const tag=el.tagName.toLowerCase();if(tag==='select')return norm(el.selectedOptions[0]?.textContent||el.value||'');if(el.type==='checkbox'||el.type==='radio')return el.checked?'checked':'';return norm(el.value||el.getAttribute('aria-valuetext')||el.textContent||'');};",
    "const isReq=(el,label)=>!!(el.required||el.getAttribute('aria-required')==='true'||/\\*/.test(label||'')||/required/i.test(el.getAttribute('class')||''));",
    "const controls=Array.from(document.querySelectorAll('input,select,textarea,[role=combobox],button,[aria-haspopup=listbox]')).filter(visible).slice(0,180).map((el,index)=>{const tag=el.tagName.toLowerCase();const label=labelFor(el);const options=tag==='select'?Array.from(el.options).map(o=>({label:norm(o.textContent),value:o.value,selected:o.selected})).slice(0,100):[];const value=valueOf(el);const required=isReq(el,label);return {index,tag,type:el.getAttribute('type')||'',role:el.getAttribute('role')||'',name:el.getAttribute('name')||'',id:el.id||'',label,selector:cssPath(el),value,required,empty:required&&!value,disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true',options};});",
    "const dialogs=Array.from(document.querySelectorAll('[role=dialog],[aria-modal=true],.modal,.dialog')).filter(visible).map(d=>({title:norm((d.querySelector('h1,h2,h3,.modal-title,.title')||d).innerText||d.textContent).slice(0,160),selector:cssPath(d)})).slice(0,12);",
    "const buttons=controls.filter(c=>c.tag==='button'||/button|submit/i.test(c.type)).filter(c=>/save|continue|next|保存|下一步|继续/i.test(c.label||c.value||c.name||c.id)).slice(0,20);",
    "const errors=Array.from(document.querySelectorAll('.error,.errors,.validation,.field-validation-error,.alert,[role=alert],.text-danger')).filter(visible).map(e=>norm(e.innerText||e.textContent)).filter(Boolean).slice(0,30);",
    "const redTexts=Array.from(document.querySelectorAll('body *')).filter(visible).filter(e=>{const s=getComputedStyle(e);return /rgb\\(?(255, 0, 0|220, 38, 38|185, 28, 28)|red/i.test(s.color)&&norm(e.innerText||e.textContent).length<180;}).map(e=>norm(e.innerText||e.textContent)).filter(Boolean).slice(0,30);",
    "const heading=norm((document.querySelector('h1')||document.querySelector('h2')||document.querySelector('[aria-current=true]')||{}).innerText||'');",
    "return {ok:true,url:location.href,title:document.title,pageTitle:heading||document.title,modalTitle:dialogs[0]?.title||'',dialogs,controls,requiredEmpty:controls.filter(c=>c.empty&&!c.disabled),saveButtons:buttons,validationMessages:Array.from(new Set(errors.concat(redTexts))).slice(0,40)};",
    "})()",
  ].join("")
}

function buildDomSetFieldScript(selector: string, labelHint: string, value: string) {
  return [
    "(function(){",
    "const selector=" + JSON.stringify(String(selector || "")) + ";",
    "const labelHint=" + JSON.stringify(String(labelHint || "")) + ";",
    "const value=" + JSON.stringify(String(value || "")) + ";",
    "const norm=(v)=>String(v||'').trim().toLowerCase().replace(/\\s+/g,' ');",
    "const visible=(el)=>!!(el&&el.offsetParent!==null&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');",
    "const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true}));",
    "const setNative=(el,next)=>{const proto=Object.getPrototypeOf(el);const desc=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');if(desc&&desc.set)desc.set.call(el,next);else el.value=next;fire(el,'input');fire(el,'change');};",
    "const labelFor=(el)=>{const id=el.id;if(id){const l=document.querySelector('label[for=\"'+CSS.escape(id)+'\"]');if(l)return l.innerText||l.textContent||'';}let cur=el;for(let i=0;i<5&&cur;i++,cur=cur.parentElement){const own=cur.querySelector&&cur.querySelector(':scope > label');if(own)return own.innerText||own.textContent||'';const prev=cur.previousElementSibling;if(prev)return prev.innerText||prev.textContent||'';}return el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.name||el.id||'';};",
    "const candidates=[];if(selector){const el=document.querySelector(selector);if(el)candidates.push(el);}const all=Array.from(document.querySelectorAll('input,select,textarea,[role=combobox]')).filter(visible);if(labelHint)candidates.push(...all.filter(el=>norm(labelFor(el)).includes(norm(labelHint))||norm(el.name||el.id||'').includes(norm(labelHint))));candidates.push(...all);",
    "for(const el of Array.from(new Set(candidates))){if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')continue;const tag=el.tagName.toLowerCase();if(tag==='select'){const opts=Array.from(el.options);const opt=opts.find(o=>norm(o.value)===norm(value)||norm(o.textContent)===norm(value)||norm(o.textContent).includes(norm(value))||norm(value).includes(norm(o.textContent)));if(!opt)continue;el.value=opt.value;fire(el,'input');fire(el,'change');return {ok:true,method:'dom-select-as-field',label:labelFor(el),selector:selector||'',value:el.selectedOptions[0]?.textContent||el.value};}el.focus();setNative(el,value);return {ok:true,method:'dom-set-field',label:labelFor(el),selector:selector||'',value:el.value||el.getAttribute('aria-valuetext')||''};}",
    "return {ok:false,reason:'field not found',selector,labelHint,value};",
    "})()",
  ].join("")
}

function buildDomSelectScript(selector: string, labelHint: string, desired: string, desiredValue: string) {
  return [
    "(function(){",
    "const selector=" + JSON.stringify(String(selector || "")) + ";",
    "const labelHint=" + JSON.stringify(String(labelHint || "")) + ";",
    "const wanted=" + JSON.stringify(String(desired || "")) + ";",
    "const wantedValue=" + JSON.stringify(String(desiredValue || desired || "")) + ";",
    "const norm=(v)=>String(v||'').trim().toLowerCase().replace(/\\s+/g,' ');",
    "const visible=(el)=>!!(el&&el.offsetParent!==null&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');",
    "const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true}));",
    "const setNative=(el,next)=>{const proto=Object.getPrototypeOf(el);const desc=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');if(desc&&desc.set)desc.set.call(el,next);else el.value=next;fire(el,'input');fire(el,'change');};",
    "const labelFor=(el)=>{const id=el.id;if(id){const l=document.querySelector('label[for=\"'+CSS.escape(id)+'\"]');if(l)return l.innerText||l.textContent||'';}let cur=el;for(let i=0;i<5&&cur;i++,cur=cur.parentElement){const own=cur.querySelector&&cur.querySelector(':scope > label');if(own)return own.innerText||own.textContent||'';const prev=cur.previousElementSibling;if(prev)return prev.innerText||prev.textContent||'';}return el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.name||el.id||'';};",
    "const candidates=[];if(selector){const el=document.querySelector(selector);if(el)candidates.push(el);}const all=Array.from(document.querySelectorAll('select,input[role=combobox],input[aria-autocomplete],input[list],[role=combobox],[aria-haspopup=listbox]')).filter(visible);if(labelHint)candidates.push(...all.filter(el=>norm(labelFor(el)).includes(norm(labelHint))||norm(el.name||el.id||'').includes(norm(labelHint))));candidates.push(...all);",
    "for(const el of Array.from(new Set(candidates))){if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')continue;const tag=el.tagName.toLowerCase();if(tag==='select'){const opts=Array.from(el.options);const opt=opts.find(o=>norm(o.textContent)===norm(wanted)||norm(o.value)===norm(wantedValue)||norm(o.textContent).includes(norm(wanted))||norm(wanted).includes(norm(o.textContent)));if(opt){el.value=opt.value;fire(el,'input');fire(el,'change');return {ok:true,method:'dom-select',label:labelFor(el),selected:opt.textContent,value:opt.value,actual:el.selectedOptions[0]?.textContent||el.value};}}else{el.focus();setNative(el,wanted);el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowDown',bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));return {ok:true,method:'dom-combobox-query',label:labelFor(el),selected:wanted,actual:el.value||el.getAttribute('aria-valuetext')||wanted};}}",
    "return {ok:false,reason:'select/combobox not found',selector,labelHint,wanted};",
    "})()",
  ].join("")
}

function buildDomSaveScript(selector: string) {
  return [
    "(function(){",
    "const selector=" + JSON.stringify(String(selector || "")) + ";",
    "const norm=(v)=>String(v||'').trim().replace(/\\s+/g,' ');",
    "const visible=(el)=>!!(el&&el.offsetParent!==null&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');",
    "const candidates=[];if(selector){const el=document.querySelector(selector);if(el)candidates.push(el);}candidates.push(...Array.from(document.querySelectorAll('button,input[type=submit],input[type=button],a')).filter(visible).filter(el=>/save|保存|continue|next|下一步|继续/i.test(norm(el.innerText||el.value||el.getAttribute('aria-label')||el.textContent||''))));",
    "const el=Array.from(new Set(candidates))[0];if(!el)return {ok:false,reason:'save button not found'};const label=norm(el.innerText||el.value||el.getAttribute('aria-label')||el.textContent||'');el.click();return {ok:true,method:'dom-click-save',label};",
    "})()",
  ].join("")
}

async function observeCuaPage(workspace: string, auditAction: string, input: any, progress: any) {
  ensureCuaProgress(progress)
  const result: any = { ok: true, at: new Date().toISOString(), ax: "", dom: null, dialogs: [], notes: [] }
  const payload: any = { pid: input.pid, window_id: input.windowId, capture_mode: input.saveScreenshot ? "som" : "ax" }
  if (input.saveScreenshot) {
    result.screenshotPath = join(workspace, "05_screenshots", "cua-" + Date.now() + ".png")
    payload.screenshot_out_file = result.screenshotPath
  }
  const state = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify(payload)], 30000)
  result.ax = String(state.stdout || "")

  const control = await readCuaControl(workspace)
  if (!control.domAutomationUnavailable) {
    try {
      const dom = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: buildDomObservationScript() })], 30000)
      result.dom = parseJsonObjectFromText(String(dom.stdout || ""))
    } catch (error: any) {
      const message = String(error?.message || error)
      if (isCuaDomUnavailableSignal(message)) result.notes.push("DOM unavailable; using AX-only observation.")
      else result.notes.push("DOM observation failed: " + message)
    }
  } else {
    result.notes.push("DOM automation unavailable; using AX-only observation.")
  }

  try {
    const windowsRes = await execCua(workspace, auditAction, ["call", "list_windows", "--compact"], 10000)
    const parsed = parseJsonObjectFromText(String(windowsRes.stdout || "")) || {}
    const windows = Array.isArray(parsed.windows) ? parsed.windows : []
    for (const window of windows) {
      if (Number(window.pid) !== Number(input.pid)) continue
      const title = String(window.title || "")
      const width = Number(window.bounds?.width || 0)
      const height = Number(window.bounds?.height || 0)
      const looksLikeDialog = /显示|alert|confirm|prompt|dialog|required|验证|提示|离开|Leave|恢复|Restore/i.test(title) || (width > 0 && height > 0 && width <= 760 && height <= 420)
      if (!looksLikeDialog) continue
      let tree = ""
      try {
        const dialogState = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify({ pid: input.pid, window_id: Number(window.window_id), capture_mode: "ax" }), "--compact"], 10000)
        tree = String(dialogState.stdout || "")
      } catch {}
      const text = title + "\n" + tree
      result.dialogs.push({ windowId: Number(window.window_id), title, kind: isBeforeUnloadText(text) ? "beforeunload" : isRestoreDialogText(text) ? "restore" : "dialog", text: tree.slice(0, 1200) })
    }
  } catch (error: any) {
    result.notes.push("dialog scan failed: " + String(error?.message || error))
  }

  const dom = result.dom || {}
  progress.currentPage = String(dom.pageTitle || dom.title || progress.currentPage || "申请平台页面")
  progress.currentUrl = String(dom.url || progress.currentUrl || "")
  progress.currentModal = String(dom.modalTitle || "")
  progress.requiredEmptyFields = Array.isArray(dom.requiredEmpty) ? dom.requiredEmpty : []
  progress.validationMessages = Array.isArray(dom.validationMessages) ? dom.validationMessages : []
  progress.blockedDialogs = result.dialogs
  progress.lastObservedAt = result.at
  if (result.screenshotPath) progress.lastScreenshotPath = result.screenshotPath
  await writeJson(join(workspace, "03_state/application_progress.json"), progress)
  return result
}

async function recordFieldProgress(workspace: string, progress: any, kind: string, detail: string, value: string, method: string, verified: boolean) {
  ensureCuaProgress(progress)
  const entry = { at: new Date().toISOString(), kind, detail, value, method, verified, page: progress.currentPage || "", modal: progress.currentModal || "" }
  appendLimited(progress, "filledFields", entry)
  if (verified) appendLimited(progress, "verifiedFields", entry)
  await writeJson(join(workspace, "03_state/application_progress.json"), progress)
}

function summarizeObservation(result: any) {
  const dom = result?.dom || {}
  return JSON.stringify({
    pageTitle: dom.pageTitle || "",
    url: dom.url || "",
    modalTitle: dom.modalTitle || "",
    requiredEmpty: Array.isArray(dom.requiredEmpty) ? dom.requiredEmpty.slice(0, 20) : [],
    validationMessages: Array.isArray(dom.validationMessages) ? dom.validationMessages.slice(0, 20) : [],
    saveButtons: Array.isArray(dom.saveButtons) ? dom.saveButtons.slice(0, 8) : [],
    dialogs: Array.isArray(result?.dialogs) ? result.dialogs : [],
    notes: Array.isArray(result?.notes) ? result.notes : [],
    screenshotPath: result?.screenshotPath || "",
  }, null, 2)
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string) {
    if (!existsSync(current)) return
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      if (entry.isFile()) out.push(full)
    }
  }
  await walk(dir)
  return out
}

function generatedFiles(workspace: string) {
  return [
    { label: "申请工作区", path: workspace, kind: "folder" },
    ...generated.map(([label, path, kind]) => ({ label, path: join(workspace, path), kind })),
  ].filter((item) => item.kind === "folder" || existsSync(item.path))
}

function classifyMissingType(item: any) {
  const type = String(item?.type ?? "")
  if (type === "information" || type.includes("信息缺失")) return "information"
  if (type === "material" || type.includes("材料缺失") || type.includes("文书缺失")) return "material"
  return "uncertain"
}

function normalizeMissingItems(raw: any) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []
  return source.map((item: any, index: number) => {
    const type = classifyMissingType(item)
    return {
      id: item.id ?? "missing-" + String(index + 1).padStart(2, "0"),
      name: String(item.name ?? item.title ?? "未命名缺失项"),
      type,
      status: type === "uncertain" ? "needs_confirmation" : "missing",
      source: item.source ?? "application_target",
      page: item.page ?? "",
      whyNeeded: item.whyNeeded ?? item.reason ?? item.why_needed ?? "申请平台或学校申请要求需要该内容。",
      prepareFrom: item.prepareFrom ?? item.preparation_method ?? item.prepare_from ?? "请顾问向学生确认或补充。",
      formatRequirement: item.formatRequirement ?? item.format_requirement ?? "按申请平台要求提供清晰 PDF、Word、图片或文字信息。",
      blocksProgress: Boolean(item.blocksProgress ?? item.affects_continuation ?? false),
      addedToWordList: item.addedToWordList ?? item.include_in_word ?? true,
      urgency: item.urgency ?? "medium",
    }
  })
}

function requirementList(value: any) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function normalizeRequirementSources(value: any) {
  const source = Array.isArray(value) ? value : []
  return source.map((item: any) => ({
    url: String(item?.url || item || "").trim(),
    title: String(item?.title || "").trim(),
    fetchedAt: String(item?.fetchedAt || new Date().toISOString()),
    confidence: String(item?.confidence || "medium"),
    notes: String(item?.notes || "").trim(),
  })).filter((item: any) => item.url)
}

function renderRequirementsMarkdown(task: any, requirements: any) {
  const input = task.input || {}
  const lines = [
    "# 申请要求摘要",
    "",
    "学生：" + (input.studentName || ""),
    "申请学校：" + (input.school || ""),
    "申请项目：" + (input.program || ""),
    "更新时间：" + (requirements.updatedAt || new Date().toISOString()),
    "",
    "## 来源",
    "",
  ]
  const sources = normalizeRequirementSources(requirements.sources)
  if (sources.length === 0) lines.push("- 暂无可确认来源，需顾问人工确认。")
  for (const source of sources) lines.push("- " + (source.title ? source.title + "：" : "") + source.url + "（可信度：" + source.confidence + "）")
  lines.push("", "## 字段要求", "")
  const fields = requirementList(requirements.fieldRequirements)
  if (fields.length === 0) lines.push("- 暂未确认字段要求。")
  for (const item of fields) lines.push("- " + item)
  lines.push("", "## 材料要求", "")
  const materials = requirementList(requirements.materialRequirements)
  if (materials.length === 0) lines.push("- 暂未确认材料要求。")
  for (const item of materials) lines.push("- " + item)
  lines.push("", "## 待确认", "")
  const uncertain = requirementList(requirements.uncertainRequirements)
  if (uncertain.length === 0) lines.push("- 暂无额外待确认要求。")
  for (const item of uncertain) lines.push("- " + item)
  lines.push("", "说明：最终以申请平台页面和学校官方要求为准。")
  return lines.join("\n") + "\n"
}

async function summarizeCounts(workspace: string) {
  const totalFiles = (await listFiles(join(workspace, "00_original_backup"))).length
  const missingRaw = await readJson(join(workspace, "03_state/missing_items.json"), [])
  const missing = normalizeMissingItems(missingRaw)
  return {
    totalFiles,
    missingInformation: missing.filter((item: any) => item.type === "information").length,
    missingMaterials: missing.filter((item: any) => item.type === "material").length,
    uncertainItems: missing.filter((item: any) => item.type === "uncertain").length,
  }
}

async function loadTask(workspace: string) {
  const fallbackInput = await readJson(join(workspace, "03_state/task_input.json"), {})
  const now = new Date().toISOString()
  const task = await readJson(join(workspace, "03_state/task_state.json"), null)
  if (task?.input) return task
  return {
    id: task?.id ?? task?.task_id ?? basename(workspace),
    slug: task?.slug ?? basename(workspace),
    workspacePath: workspace,
    sessionDirectory: workspace,
    createdAt: task?.createdAt ?? now,
    updatedAt: task?.updatedAt ?? now,
    status: task?.status && statusValues.includes(task.status) ? task.status : "已创建",
    input: fallbackInput,
    counts: await summarizeCounts(workspace),
    generatedFiles: generatedFiles(workspace),
    progress: Array.isArray(task?.progress) ? task.progress : [],
  }
}

async function saveTask(workspace: string, task: any, status?: string, message?: string) {
  const now = new Date().toISOString()
  task.workspacePath = workspace
  task.sessionDirectory = workspace
  task.updatedAt = now
  task.counts = await summarizeCounts(workspace)
  task.generatedFiles = generatedFiles(workspace)
  if (status && statusValues.includes(status as any)) task.status = status
  if (!Array.isArray(task.progress)) task.progress = []
  if (message) task.progress.push({ at: now, status: task.status, message })
  await writeJson(join(workspace, "03_state/task_state.json"), task)
  return task
}

function categoryFor(name: string) {
  const lower = name.toLowerCase()
  if (/passport|护照|id card|身份证|identity/.test(lower)) return ["identity", "命中身份材料关键词"]
  if (/transcript|成绩|在读|毕业|degree|diploma|academic|school report|成绩单/.test(lower)) return ["academic", "命中学术材料关键词"]
  if (/toefl|ielts|duolingo|sat|act|gre|gmat|托福|雅思|多邻国|语言/.test(lower)) return ["language", "命中语言或标化关键词"]
  if (/essay|personal statement|statement|文书|ps|cv|resume|简历/.test(lower)) return ["essays", "命中文书或简历关键词"]
  if (/recommend|reference|推荐|rl|lor/.test(lower)) return ["recommendation", "命中推荐材料关键词"]
  if (/bank|finance|financial|资金|存款|资产|deposit/.test(lower)) return ["financial", "命中财务材料关键词"]
  if (/common app|coalition|ucas|apply|portal|申请平台|账号/.test(lower)) return ["platform_related", "命中申请平台关键词"]
  const ext = extname(lower)
  if ([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".heic"].includes(ext)) return ["other", "文件类型常见，但文件名无法判断具体用途"]
  return ["needs_review", "文件类型或文件名无法确认用途"]
}

async function uniquePath(path: string) {
  if (!existsSync(path)) return path
  const dir = dirname(path)
  const ext = extname(path)
  const stem = basename(path, ext)
  let index = 2
  let candidate = join(dir, stem + "-" + index + ext)
  while (existsSync(candidate)) {
    index += 1
    candidate = join(dir, stem + "-" + index + ext)
  }
  return candidate
}

export const workspace = {
  description: "Create or refresh the isolated Terra-Edu application workspace. Copies the original student folder into 00_original_backup without modifying the source folder.",
  args: inputArg({
    action: { type: "string", enum: ["initialize", "refresh"], description: "initialize creates directories and copies source materials; refresh only updates counts" },
    sourceFolder: { type: "string", description: "Optional source student folder. Defaults to task input sourceFolder." },
  }),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    for (const dir of workspaceDirs) await mkdir(join(workspace, dir), { recursive: true })
    const task = await loadTask(workspace)
    const action = input.action || "initialize"
    await appendAudit(workspace, "workspace", action, "started")
    const source = input.sourceFolder || task.input?.sourceFolder
    if (action === "initialize") {
      if (!source) throw new Error("sourceFolder is required for workspace initialization")
      if (!existsSync(source)) throw new Error("sourceFolder does not exist: " + source)
      const entries = await readdir(source, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        const from = join(source, entry.name)
        const to = await uniquePath(join(workspace, "00_original_backup", entry.name))
        await cp(from, to, { recursive: true, force: false, errorOnExist: false })
      }
      await appendLog(workspace, "agent", "已初始化申请工作区，并把原始资料复制到 00_original_backup。")
      await saveTask(workspace, task, "正在读取文件", "申请工作区已创建，原始材料副本已进入 00_original_backup。")
    } else {
      await saveTask(workspace, task, task.status, "已刷新申请工作区状态和材料计数。")
    }
    await appendAudit(workspace, "workspace", action, "completed", "workspace ready")
    return "申请工作区已就绪：" + workspace
  },
}

export const materials = {
  description: "Classify materials from 00_original_backup into 01_classified_materials and write materials_index files.",
  args: inputArg({
    action: { type: "string", enum: ["classify"], description: "Classify all backed-up materials" },
  }),
  async execute(_args, ctx) {
    const workspace = root(ctx)
    await appendAudit(workspace, "materials", "classify", "started")
    const task = await loadTask(workspace)
    const files = await listFiles(join(workspace, "00_original_backup"))
    const records = []
    for (const file of files) {
      const fileName = basename(file)
      const [category, reason] = categoryFor(fileName)
      const targetDir = join(workspace, "01_classified_materials", category)
      await mkdir(targetDir, { recursive: true })
      const target = await uniquePath(join(targetDir, fileName))
      await cp(file, target, { force: false, errorOnExist: false })
      records.push({
        originalPath: file,
        backupPath: relative(workspace, file),
        classifiedPath: relative(workspace, target),
        fileName,
        extension: extname(fileName).toLowerCase(),
        category,
        confidence: category === "needs_review" ? "needs_review" : category === "other" ? "medium" : "high",
        reason,
      })
    }
    await writeJson(join(workspace, "03_state/materials_index.json"), records)
    const md = ["# 材料目录", "", "原始材料副本目录：" + join(workspace, "00_original_backup"), ""]
    for (const item of records) md.push("- " + item.fileName + " -> " + item.classifiedPath + "（" + item.category + "，" + item.reason + "）")
    await writeFile(join(workspace, "02_generated/materials_index.md"), md.join("\n") + "\n", "utf8")
    await appendLog(workspace, "agent", "已完成材料分类，共 " + records.length + " 个文件。")
    await saveTask(workspace, task, "正在生成学生资料", "材料已分类完成，materials_index 已更新。")
    await appendAudit(workspace, "materials", "classify", "completed", "classified " + records.length + " files")
    return "已分类 " + records.length + " 个文件。无法确认用途的文件会留在 needs_review。"
  },
}

export const state = {
  description: "Update Terra-Edu task_state.json using the unified desktop schema, including status, progress, generated files, and missing item counts.",
  args: inputArg({
    status: { type: "string", enum: statusValues, description: "Current task status" },
    message: { type: "string", description: "Human-readable progress message for the consultant" },
  }, ["status", "message"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const task = await loadTask(workspace)
    await appendAudit(workspace, "state", String(input.status || "update"), "started", input.message || "")
    await saveTask(workspace, task, input.status, input.message)
    await appendLog(workspace, "agent", input.message)
    await appendAudit(workspace, "state", String(input.status || "update"), "completed", input.message || "")
    return "状态已更新：" + input.status
  },
}

export const documents = {
  description: "Generate consultant/student-facing forms, Word missing-material checklist, and task summary from 03_state/missing_items.json.",
  args: inputArg({
    action: { type: "string", enum: ["generate_forms", "generate_word", "generate_summary", "generate_all"], description: "Which document set to generate" },
  }),
  async execute(args, ctx) {
    const inputArgs = args.input || {}
    const action = inputArgs.action || "generate_all"
    const workspace = root(ctx)
    await appendAudit(workspace, "documents", action, "started")
    const task = await loadTask(workspace)
    const input = task.input || {}
    const missing = normalizeMissingItems(await readJson(join(workspace, "03_state/missing_items.json"), []))
    const materials = await readJson(join(workspace, "03_state/materials_index.json"), [])
    const title = String(input.studentName || basename(workspace))
    if (action === "generate_forms" || action === "generate_all") {
      const infoItems = missing.filter((item: any) => item.type !== "material")
      const materialItems = missing.filter((item: any) => item.type === "material")
      await writeFile(join(workspace, "02_generated/info_collection_form.md"), renderCollection(title, input, "信息补充清单", infoItems), "utf8")
      await writeFile(join(workspace, "02_generated/material_collection_form.md"), renderCollection(title, input, "材料补充清单", materialItems), "utf8")
    }
    if (action === "generate_word" || action === "generate_all") {
      await writeFile(join(workspace, "02_generated/missing_materials.docx"), makeDocx(renderWordChecklist(title, input, missing)))
    }
    if (action === "generate_summary" || action === "generate_all") {
      const lines = ["# " + title + " 申请任务总结", "", "## 已完成", "", "- 已创建隔离申请工作区。", "- 已复制原始材料副本，未修改原始文件夹。", "- 已整理材料 " + materials.length + " 个。", "- 已生成或更新缺失项清单和顾问可转发文档。", "", "## 仍需处理", ""]
      for (const item of missing) lines.push("- " + item.name + "：" + item.whyNeeded)
      lines.push("", "## 人工处理事项", "", "- 最终提交申请、付款、不可逆推荐信邀请和账号密码输入必须由顾问人工确认。")
      await writeFile(join(workspace, "02_generated/task_summary.md"), lines.join("\n") + "\n", "utf8")
    }
    await appendLog(workspace, "agent", "已根据 missing_items.json 生成申请文档。")
    await saveTask(workspace, task, missing.some((item: any) => item.blocksProgress) ? "等待补充材料" : "阶段性完成", "已生成信息表、材料表、Word 缺失清单和阶段总结。")
    await appendAudit(workspace, "documents", action, "completed", "generated documents from missing_items.json")
    return "文档已生成到 02_generated。Word 清单基于 03_state/missing_items.json。"
  },
}

export const requirements = {
  description: "Persist official school/program/application-platform requirements gathered by webfetch/websearch. Writes 03_state/application_requirements.json, 02_generated/application_requirements.md, and can sync confirmed missing items into missing_items.json.",
  args: inputArg({
    sources: { type: "array", description: "Official source records with url, title, fetchedAt, confidence, and notes" },
    fieldRequirements: { type: "array", description: "Application field requirements discovered from official sources or platform pages" },
    materialRequirements: { type: "array", description: "Material requirements discovered from official sources or platform pages" },
    uncertainRequirements: { type: "array", description: "Requirements that need consultant confirmation" },
    missingItems: { type: "array", description: "Confirmed missing items to merge into 03_state/missing_items.json" },
    notes: { type: "string", description: "Short consultant-facing research summary" },
  }),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    await appendAudit(workspace, "requirements", "update", "started", input.notes || "", ctx)
    const task = await loadTask(workspace)
    const existing = await readJson(join(workspace, "03_state/application_requirements.json"), {})
    const requirements = {
      studentName: task.input?.studentName || "",
      school: task.input?.school || "",
      program: task.input?.program || "",
      applicationType: task.input?.applicationType || "",
      applicationUrl: task.input?.applicationUrl || "",
      updatedAt: new Date().toISOString(),
      sources: normalizeRequirementSources([...(existing.sources || []), ...(input.sources || [])]),
      fieldRequirements: Array.from(new Set([...requirementList(existing.fieldRequirements), ...requirementList(input.fieldRequirements)])),
      materialRequirements: Array.from(new Set([...requirementList(existing.materialRequirements), ...requirementList(input.materialRequirements)])),
      uncertainRequirements: Array.from(new Set([...requirementList(existing.uncertainRequirements), ...requirementList(input.uncertainRequirements)])),
      notes: input.notes || existing.notes || "",
    }
    await writeJson(join(workspace, "03_state/application_requirements.json"), requirements)
    await writeFile(join(workspace, "02_generated/application_requirements.md"), renderRequirementsMarkdown(task, requirements), "utf8")

    const incomingMissing = normalizeMissingItems(input.missingItems || [])
    if (incomingMissing.length > 0) {
      const existingMissing = normalizeMissingItems(await readJson(join(workspace, "03_state/missing_items.json"), []))
      const seen = new Set(existingMissing.map((item: any) => String(item.name).toLowerCase() + ":" + item.type))
      for (const item of incomingMissing) {
        const key = String(item.name).toLowerCase() + ":" + item.type
        if (!seen.has(key)) {
          existingMissing.push({ ...item, source: item.source || "application_target" })
          seen.add(key)
        }
      }
      await writeJson(join(workspace, "03_state/missing_items.json"), existingMissing)
    }

    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    progress.requirementsLastUpdatedAt = requirements.updatedAt
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await saveTask(workspace, task, "正在检查缺失内容", "已保存学校/项目申请要求，并准备对照学生材料检查缺失项。")
    await appendLog(workspace, "agent", "已保存申请要求：" + (requirements.notes || "见 application_requirements.md"))
    await appendAudit(workspace, "requirements", "update", "completed", "sources " + requirements.sources.length, ctx)
    return JSON.stringify({
      status: "completed",
      files: ["03_state/application_requirements.json", "02_generated/application_requirements.md"],
      sources: requirements.sources.length,
      fieldRequirements: requirements.fieldRequirements.length,
      materialRequirements: requirements.materialRequirements.length,
      missingItemsMerged: incomingMissing.length,
    }, null, 2)
  },
}

export const login = {
  description: "Fill the application-platform login page with credentials saved by the Terra-Edu desktop app. The password is read from the macOS keychain and is never returned to the agent, logs, or workspace files.",
  args: inputArg({
    action: { type: "string", enum: ["fill_saved_credentials", "record_mfa_required", "record_login_failure"], description: "Use fill_saved_credentials on a login form; use record_mfa_required when MFA/CAPTCHA/email verification appears." },
    pid: { type: "number", description: "Target browser pid from CUA launch/capture output" },
    windowId: { type: "number", description: "Target browser window_id" },
    usernameSelector: { type: "string", description: "Optional CSS selector for username/email input" },
    passwordSelector: { type: "string", description: "Optional CSS selector for password input" },
    submitSelector: { type: "string", description: "Optional CSS selector for login/continue button" },
    submit: { type: "boolean", description: "Whether to click the detected login/continue button after filling credentials. Defaults to true." },
    detail: { type: "string", description: "Human-readable login page or failure detail" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    await appendAudit(workspace, "login", String(input.action || "login"), "started", input.detail || "", ctx)
    const task = await loadTask(workspace)
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    if (input.action === "record_mfa_required") {
      await appendLog(workspace, "cua", "登录需要顾问处理 MFA/验证码/邮箱验证：" + (input.detail || ""))
      await saveTask(workspace, task, "等待顾问登录", "申请平台需要 MFA、验证码或邮箱验证，请顾问手动完成后让 Agent 继续。")
      await appendAudit(workspace, "login", "record_mfa_required", "completed", input.detail || "", ctx)
      return JSON.stringify({ status: "needs_human", reason: "mfa_or_captcha_required" })
    }
    if (input.action === "record_login_failure") {
      if (!Array.isArray(progress.failedActions)) progress.failedActions = []
      progress.failedActions.push({ at: new Date().toISOString(), action: "login", reason: input.detail || "登录失败", page: progress.currentPage || "登录页" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "登录失败：" + (input.detail || "未提供原因"))
      await saveTask(workspace, task, "等待顾问登录", "自动登录失败，请顾问检查账号、密码、验证码或平台状态。")
      await appendAudit(workspace, "login", "record_login_failure", "failed", input.detail || "", ctx)
      return JSON.stringify({ status: "failed", reason: input.detail || "login_failed" })
    }
    if (!input.pid || !input.windowId) throw new Error("fill_saved_credentials requires pid and windowId")
    const credential = await readJson(join(workspace, "03_state/login_credentials.json"), null)
    if (!credential?.username || !credential?.serviceName || !credential?.hasSavedPassword) {
      await saveTask(workspace, task, "等待顾问登录", "当前申请平台没有保存密码，请顾问手动登录或在任务创建页保存平台账号密码。")
      await appendAudit(workspace, "login", "fill_saved_credentials", "failed", "missing saved credentials", ctx)
      return JSON.stringify({ status: "needs_human", reason: "missing_saved_credentials" })
    }
    let password = ""
    try {
      const res = await execFileAsync("security", ["find-generic-password", "-s", String(credential.serviceName), "-a", String(credential.username), "-w"], { timeout: 10000 })
      password = String(res.stdout || "").trim()
    } catch (error: any) {
      await appendAudit(workspace, "login", "fill_saved_credentials", "failed", "keychain read failed", ctx)
      return JSON.stringify({ status: "needs_human", reason: "keychain_password_unavailable" })
    }
    if (!password) return JSON.stringify({ status: "needs_human", reason: "empty_saved_password" })
    const js = "(function(){"
      + "const username=" + JSON.stringify(String(credential.username)) + ";"
      + "const password=" + JSON.stringify(password) + ";"
      + "const usernameSelector=" + JSON.stringify(String(input.usernameSelector || "")) + ";"
      + "const passwordSelector=" + JSON.stringify(String(input.passwordSelector || "")) + ";"
      + "const submitSelector=" + JSON.stringify(String(input.submitSelector || "")) + ";"
      + "const shouldSubmit=" + JSON.stringify(input.submit !== false) + ";"
      + "const visible=(el)=>!!(el&&el.offsetParent!==null&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');"
      + "const setNative=(el,value)=>{const proto=Object.getPrototypeOf(el);const desc=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');if(desc&&desc.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};"
      + "const pick=(selector,fallbacks)=>{if(selector){const hit=document.querySelector(selector);if(visible(hit))return hit;}return Array.from(document.querySelectorAll(fallbacks)).find(visible);};"
      + "const userEl=pick(usernameSelector,'input[type=email],input[name*=email i],input[id*=email i],input[name*=user i],input[id*=user i],input[type=text]');"
      + "const passEl=pick(passwordSelector,'input[type=password]');"
      + "if(!userEl||!passEl)return {ok:false,reason:'login_fields_not_found'};"
      + "setNative(userEl,username);setNative(passEl,password);"
      + "let submitted=false;"
      + "if(shouldSubmit){let submitEl=submitSelector?document.querySelector(submitSelector):null;if(!visible(submitEl)){submitEl=Array.from(document.querySelectorAll('button,input[type=submit],[role=button]')).find(el=>visible(el)&&/log in|login|sign in|continue|next|登录|登入|继续|下一步/i.test(String(el.innerText||el.value||el.getAttribute('aria-label')||'')));}"
      + "if(visible(submitEl)){submitEl.click();submitted=true;}else{passEl.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));submitted=true;}}"
      + "return {ok:true,usernameFilled:true,passwordFilled:true,submitted};"
      + "})()"
    password = ""
    let res
    try {
      res = await execCua(workspace, "login_fill_saved_credentials", ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: js })], 30000)
    } catch (error: any) {
      const message = String(error?.message || error)
      if (isCuaStopSignal(message)) {
        await saveTask(workspace, task, "异常中断", "自动登录所需的 Chrome DOM 通道不可用，已停止 CUA，避免继续抢占 Chrome 前台。")
        await appendAudit(workspace, "login", "fill_saved_credentials", "failed", message, ctx)
        return JSON.stringify({ status: "blocked", reason: message })
      }
      if (isCuaDomUnavailableSignal(message)) {
        await saveTask(workspace, task, "等待顾问登录", "Chrome DOM 登录通道不可用；CUA 未停止，后续可用键盘/AX 策略继续填写已登录后的普通表单。")
        await appendAudit(workspace, "login", "fill_saved_credentials", "failed", message, ctx)
        return JSON.stringify({ status: "needs_human_or_keyboard_login", reason: message })
      }
      throw error
    }
    await appendLog(workspace, "cua", "已用本机保存的申请平台凭证填写登录页；密码未写入日志。")
    await saveTask(workspace, task, "等待顾问登录", "已自动填写申请平台账号密码。如页面要求 MFA、验证码或邮箱验证，请顾问手动完成。")
    await appendAudit(workspace, "login", "fill_saved_credentials", "completed", "credential filled without exposing password", ctx)
    return JSON.stringify({ status: "completed", usernameFilled: true, passwordFilled: true, output: String(res.stdout || "").replace(/password[^,}]*/ig, "password:redacted") })
  },
}

export const risk = {
  description: "Check and block high-risk application actions: final submission, payment, irreversible recommendation invitation, credential storage, or guessing uncertain fields.",
  args: inputArg({
    action: { type: "string", description: "Action the agent is about to perform" },
    page: { type: "string", description: "Optional page or context" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const text = String(input.action || "").toLowerCase()
    await appendAudit(workspace, "risk", String(input.action || "check"), "started")
    const blocked = /submit|final|payment|pay|付款|最终提交|提交申请|推荐信邀请|recommendation invite|保存密码|password|猜填|不可逆/.test(text)
    if (!blocked) {
      await appendAudit(workspace, "risk", String(input.action || "check"), "completed", "allowed")
      return "该动作未命中高风险规则，可以继续，但不确定字段仍需先确认。"
    }
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    if (!Array.isArray(progress.highRiskBlocks)) progress.highRiskBlocks = []
    progress.highRiskBlocks.push({ at: new Date().toISOString(), action: input.action, page: input.page || "", reason: "高风险申请动作必须交给顾问人工处理。" })
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await appendLog(workspace, "cua", "已阻断高风险动作：" + input.action)
    const task = await loadTask(workspace)
    await saveTask(workspace, task, "等待补充材料", "已阻断高风险动作：" + input.action + "。该步骤必须由顾问人工处理。")
    await appendAudit(workspace, "risk", String(input.action || "check"), "completed", "blocked")
    return "BLOCKED: " + input.action + "。最终提交、付款、不可逆推荐信邀请、保存密码和猜填均禁止自动执行。"
  },
}

export const cua = {
  description: "Use cua-driver for application-platform browser operations. Prefer the human-like high-level loop: observe_page, fill_field_verified, select_option_verified, save_page_verified, handle_blocker. Low-level click/type/select actions remain as fallbacks. Default observation is AX/DOM without screenshot; screenshots are only for failure or evidence.",
  args: inputArg({
    action: { type: "string", enum: ["resume_cua", "list_windows", "open_platform", "observe_page", "fill_field_verified", "select_option_verified", "save_page_verified", "handle_blocker", "capture_state", "inspect_controls", "enable_browser_dom", "dismiss_dialog", "dismiss_native_menu", "click_element", "dom_set_field", "type_text", "set_value", "select_option", "keyboard_fill_sequence", "press_key", "record_failure", "record_saved", "record_upload", "block_high_risk"], description: "CUA operation. Prefer observe_page before each page/modal, fill_field_verified and select_option_verified for fields, save_page_verified before saving, and handle_blocker for Chrome alert/beforeunload/native dialog. Use list_windows to find an already-open Chrome window before open_platform. Low-level actions are fallback only." },
    applicationUrl: { type: "string", description: "Application platform URL, defaults to task input" },
    pid: { type: "number", description: "Optional target browser pid" },
    windowId: { type: "number", description: "Optional target browser window_id" },
    browserBundleId: { type: "string", description: "Optional browser bundle id, defaults to com.google.Chrome" },
    elementIndex: { type: "number", description: "Optional element_index from the last capture_state/get_window_state call" },
    text: { type: "string", description: "Text/value to type or set" },
    cssSelector: { type: "string", description: "Optional CSS selector for select_option DOM fallback, such as select[name='state']" },
    fieldLabel: { type: "string", description: "Human-readable field label for verified fill/select, such as State, Institution, Current Title." },
    optionLabel: { type: "string", description: "Desired dropdown option label for select_option" },
    optionValue: { type: "string", description: "Desired dropdown option value for select_option" },
    expectedText: { type: "string", description: "Expected visible value after fill/select/save verification. Defaults to text or optionLabel." },
    key: { type: "string", description: "Key name for press_key, such as tab, return, escape" },
    matchText: { type: "string", description: "Optional dialog text/title to match when dismissing browser alerts or validation dialogs" },
    modifiers: { type: "array", items: { type: "string" }, description: "Optional modifiers for press_key, such as cmd, shift, option, ctrl" },
    replace: { type: "boolean", description: "For type_text or keyboard_fill_sequence, select existing field content before typing." },
    delayMs: { type: "number", description: "Typing delay in milliseconds for CUA type_text fallback." },
    saveScreenshot: { type: "boolean", description: "For capture_state only. Default false uses capture_mode=ax to avoid macOS Screen Recording prompts. Set true only for failure evidence, upload/save evidence, or consultant request." },
    values: {
      type: "array",
      description: "Ordered values for keyboard_fill_sequence. Each item can be a string or { text, detail, replace }.",
      items: {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              text: { type: "string" },
              detail: { type: "string" },
              replace: { type: "boolean" },
            },
          },
        ],
      },
    },
    tabAfterEach: { type: "boolean", description: "For keyboard_fill_sequence, press Tab after each value except the last. Defaults to true." },
    confirmed: { type: "boolean", description: "Required true for enable_browser_dom because it may restart the browser after consultant confirmation." },
    x: { type: "number", description: "Optional x pixel for direct click" },
    y: { type: "number", description: "Optional y pixel for direct click" },
    detail: { type: "string", description: "Operation detail, failure reason, saved page, upload material, or high-risk action" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const task = await loadTask(workspace)
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    const auditAction = String(input.action || "unknown")
    await appendAudit(workspace, "cua", auditAction, "started", input.detail || "")
    if (input.action === "resume_cua") {
      await writeCuaControl(workspace, {
        stopped: false,
        stoppedAt: "",
        reason: "",
        domAutomationUnavailable: false,
        domAutomationUnavailableAt: "",
        domAutomationUnavailableReason: "",
        recentActions: [],
        consecutiveFailures: 0,
      })
      await writeFile(join(dirname(workspace), ".cua_global_stop.json"), JSON.stringify({ stopped: false, stoppedAt: "", workspacePath: workspace }, null, 2) + "\n", "utf8").catch(() => {})
      await appendLog(workspace, "cua", "已恢复 CUA 自动化：" + (input.detail || "顾问要求继续填写。"))
      await saveTask(workspace, task, "正在填写申请平台", "CUA 自动化已恢复，可以继续填写可确认字段。")
      await appendAudit(workspace, "cua", auditAction, "completed", "resumed CUA automation")
      return "CUA 自动化已恢复。请立即重试刚才失败的 select_option、type_text 或 keyboard_fill_sequence。"
    }
    if (input.action === "block_high_risk") {
      return await risk.execute({ input: { action: input.detail || "high risk application action", page: progress.currentPage || "" } }, ctx as any)
    }
    if (input.action === "list_windows") {
      const res = await execCua(workspace, auditAction, ["call", "list_windows", JSON.stringify({})], 10000)
      await appendLog(workspace, "cua", "已列出当前可用窗口，用于复用已打开的申请平台页面。")
      await appendAudit(workspace, "cua", auditAction, "completed", "listed windows")
      return "窗口列表已读取。请选择 Google Chrome 且 URL/标题对应当前申请平台的窗口，然后用 capture_state 继续。\n" + String(res.stdout || "")
    }
    if (input.action === "open_platform") {
      const url = input.applicationUrl || task.input?.applicationUrl
      if (!url) throw new Error("applicationUrl is required")
      const now = new Date()
      const recentlyOpened =
        normalizeApplicationUrl(progress.platformLastOpenedUrl) === normalizeApplicationUrl(url) &&
        Date.parse(progress.platformLastOpenedAt || "") > 0 &&
        now.getTime() - Date.parse(progress.platformLastOpenedAt || "") < 10 * 60 * 1000
      if (recentlyOpened) {
        progress.currentPage = progress.currentPage || "申请平台登录/首页"
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "已跳过重复打开申请平台，复用现有 Chrome 页面：" + url)
        await saveTask(workspace, task, "正在填写申请平台", "申请平台近期已打开，正在复用现有 Chrome 页面继续填写。")
        await appendAudit(workspace, "cua", auditAction, "completed", "reused already opened platform")
        return "申请平台近期已打开，已跳过重复打开。请直接 capture_state/list_windows 并继续当前页面。"
      }
      const payload = { bundle_id: "com.google.Chrome", urls: [url] }
      let output = ""
      try {
        const res = await execCua(workspace, auditAction, ["call", "launch_app", JSON.stringify(payload)], 30000)
        output = String(res.stdout || res.stderr || "")
      } catch (error: any) {
        const message = String(error?.message || error)
        output = "cua-driver launch_app failed: " + message
        if (!Array.isArray(progress.failedActions)) progress.failedActions = []
        progress.failedActions.push({ at: new Date().toISOString(), action: "open_platform", reason: output, page: url })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        if (isCuaStopSignal(message)) {
          await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "BLOCKED: " + message
        }
      }
      progress.currentPage = "申请平台登录/首页"
      progress.platformLastOpenedAt = now.toISOString()
      progress.platformLastOpenedUrl = url
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已调用 cua-driver 打开申请平台：" + url)
      await saveTask(workspace, task, "等待顾问登录", "申请平台已打开。如果需要登录，请顾问手动登录；Agent 不保存账号密码。")
      await appendAudit(workspace, "cua", auditAction, "completed", "opened platform")
      return "已尝试通过 cua-driver 打开申请平台。\n" + output
    }
    if (input.action === "observe_page") {
      if (!input.pid || !input.windowId) throw new Error("observe_page requires pid and windowId")
      const observed = await observeCuaPage(workspace, auditAction, input, progress)
      await appendLog(workspace, "cua", input.saveScreenshot ? "真人式观察：已读取页面状态并保存失败/证据截图。实际请求截图的进程可能是 CuaDriver 或 Chrome Helper，不一定是 Terra App。" : "真人式观察：已读取页面 AX/DOM 状态（未截图）。")
      await saveTask(workspace, task, "正在填写申请平台", "已观察当前页面、modal、必填空项、保存按钮和可能弹窗，准备按真人式循环继续。")
      await appendAudit(workspace, "cua", auditAction, "completed", "observed page with verification state")
      return "真人式页面观察完成。默认未截图；如 macOS 仍弹截图权限，请给 CuaDriver/Chrome Helper 授权，或仅在失败证据路径使用截图。\n" + summarizeObservation(observed)
    }
    if (input.action === "handle_blocker") {
      if (!input.pid) throw new Error("handle_blocker requires pid")
      ensureCuaProgress(progress)
      const matchText = String(input.matchText || input.detail || "").trim()
      const candidateWindowIds: number[] = []
      if (input.windowId) candidateWindowIds.push(Number(input.windowId))
      if (!candidateWindowIds.length) {
        try {
          const windowsRes = await execCua(workspace, auditAction, ["call", "list_windows", "--compact"], 10000)
          const parsed = parseJsonObjectFromText(String(windowsRes.stdout || "")) || {}
          const windows = Array.isArray(parsed.windows) ? parsed.windows : []
          for (const window of windows) {
            if (Number(window.pid) !== Number(input.pid)) continue
            const title = String(window.title || "")
            const width = Number(window.bounds?.width || 0)
            const height = Number(window.bounds?.height || 0)
            const looksLikeBlocker = /显示|alert|confirm|prompt|dialog|required|验证|提示|离开|Leave|恢复|Restore/i.test(title) || (width > 0 && height > 0 && width <= 760 && height <= 420)
            if (looksLikeBlocker) candidateWindowIds.push(Number(window.window_id))
          }
        } catch (error: any) {
          await appendLog(workspace, "cua", "扫描阻塞弹窗失败，将尝试当前窗口按键处理：" + String(error?.message || error))
        }
      }
      if (!candidateWindowIds.length) throw new Error("handle_blocker could not find candidate blocker windows")

      const attempts: string[] = []
      for (const windowId of candidateWindowIds) {
        let tree = ""
        try {
          const state = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify({ pid: input.pid, window_id: windowId, capture_mode: "ax" }), "--compact"], 10000)
          tree = String(state.stdout || "")
        } catch (error: any) {
          attempts.push("get_window_state failed for " + windowId + ": " + String(error?.message || error))
        }
        const allText = matchText + "\n" + tree
        const beforeUnload = isBeforeUnloadText(allText)
        const restoreDialog = isRestoreDialogText(allText)
        const preferred = beforeUnload ? /(取消|Cancel|留在|Stay|Don.t Leave|不离开)/i : restoreDialog ? /(关闭|Close|取消|Cancel|不恢复|No)/i : /(确定|OK|Ok|好|关闭|Close|Continue|继续|Yes|是)/i
        let buttonIndex: number | undefined
        for (const line of tree.split(/\r?\n/)) {
          if (!/\bAXButton\b/.test(line) || !preferred.test(line)) continue
          const indexMatch = line.match(/\[(\d+)\]/)
          if (indexMatch) {
            buttonIndex = Number(indexMatch[1])
            break
          }
        }
        try {
          let res
          if (buttonIndex !== undefined) {
            res = await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: windowId, element_index: buttonIndex })], 10000)
          } else {
            const key = beforeUnload || restoreDialog ? "escape" : "return"
            res = await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: windowId, key })], 10000)
          }
          appendLimited(progress, "blockedDialogs", { at: new Date().toISOString(), windowId, kind: beforeUnload ? "beforeunload-cancelled" : restoreDialog ? "restore-dismissed" : "dialog-dismissed", detail: matchText || tree.slice(0, 300) })
          await writeJson(join(workspace, "03_state/application_progress.json"), progress)
          await appendLog(workspace, "cua", beforeUnload ? "已取消 Chrome 离开页面确认，防止未保存表单丢失。" : restoreDialog ? "已关闭 Chrome 恢复页面弹窗。" : "已处理阻塞弹窗。")
          await saveTask(workspace, task, "正在填写申请平台", beforeUnload ? "已留在当前页面，防止未保存内容丢失。" : "已处理页面阻塞弹窗，准备继续。")
          await appendAudit(workspace, "cua", auditAction, "completed", beforeUnload ? "cancelled beforeunload" : "handled blocker")
          return (beforeUnload ? "已选择取消/留在页面，未离开当前申请页。" : "阻塞弹窗已处理。") + "\n" + String(res.stdout || "") + (tree ? "\n\n弹窗内容：\n" + tree.slice(0, 1200) : "")
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("handle blocker failed for " + windowId + ": " + message)
        }
      }
      appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "handle_blocker", reason: attempts.join("\n"), page: progress.currentPage || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendAudit(workspace, "cua", auditAction, "failed", attempts.join("\n"))
      return "handle_blocker failed.\n" + attempts.join("\n")
    }
    if (input.action === "fill_field_verified") {
      if (!input.pid || !input.windowId || input.text === undefined) throw new Error("fill_field_verified requires pid, windowId, and text")
      ensureCuaProgress(progress)
      const value = String(input.text)
      const label = String(input.fieldLabel || input.detail || "")
      const expected = String(input.expectedText || value)
      const attempts: string[] = []
      let method = ""
      let verified = false
      let output = ""

      try {
        const dom = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: buildDomSetFieldScript(String(input.cssSelector || ""), label, value) })], 30000)
        output = String(dom.stdout || "")
        const parsed = parseJsonObjectFromText(output)
        const data = parsed?.result || parsed
        if (data?.ok) {
          method = String(data.method || "dom-set-field")
          verified = normalizedMatch(String(data.value || ""), expected)
        } else {
          attempts.push("DOM fill returned no match: " + output)
        }
      } catch (error: any) {
        const message = String(error?.message || error)
        if (isCuaStopSignal(message)) {
          await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "BLOCKED: " + message
        }
        attempts.push("DOM fill failed: " + message)
      }

      if (!verified && input.elementIndex !== undefined) {
        try {
          const res = await execCua(workspace, auditAction, ["call", "set_value", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, value })], 30000)
          output += "\n" + String(res.stdout || "")
          method = "AX set_value"
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("AX set_value failed: " + message)
        }
      }

      if (!method && input.elementIndex !== undefined) {
        try {
          await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex })], 10000)
          await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "a", modifiers: ["cmd"] })], 10000).catch(() => {})
          const res = await execCua(workspace, auditAction, ["call", "type_text", JSON.stringify({ pid: input.pid, text: value })], 30000)
          output += "\n" + String(res.stdout || "")
          method = "keyboard type_text"
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("keyboard fill failed: " + message)
        }
      }

      const observed = await observeCuaPage(workspace, auditAction, { ...input, saveScreenshot: false }, progress)
      const controls = Array.isArray(observed.dom?.controls) ? observed.dom.controls : []
      const matching = controls.find((control: any) => {
        const controlLabel = String(control.label || control.name || control.id || "")
        if (label && !normalizedMatch(controlLabel, label)) return false
        return normalizedMatch(String(control.value || ""), expected)
      })
      verified = verified || Boolean(matching) || (expected.length > 0 && normalizedMatch(JSON.stringify(observed.dom || {}), expected))
      await recordFieldProgress(workspace, progress, "field", label || input.cssSelector || "普通字段", value, method || "unknown", verified)
      await appendLog(workspace, "cua", (verified ? "已填写并复查字段：" : "已填写但复查不确定：") + (label || input.cssSelector || "普通字段"))
      await saveTask(workspace, task, "正在填写申请平台", (verified ? "已填写并复查字段：" : "字段已填写但需要继续观察确认：") + (label || input.cssSelector || "普通字段"))
      await appendAudit(workspace, "cua", auditAction, verified ? "completed" : "failed", (label || "field") + " via " + (method || "unknown"))
      if (!verified) return "FIELD_FILLED_NEEDS_RECHECK: 字段已尝试填写，但二次检查未确认目标值。请 observe_page 后再决定是否重试。\n尝试记录：\n" + attempts.join("\n") + "\n输出：\n" + output + "\n观察摘要：\n" + summarizeObservation(observed)
      return "字段已填写并通过二次检查。\n方法：" + method + "\n" + output
    }
    if (input.action === "select_option_verified") {
      if (!input.pid || !input.windowId) throw new Error("select_option_verified requires pid and windowId")
      ensureCuaProgress(progress)
      const desired = String(input.optionLabel || input.optionValue || input.text || "").trim()
      if (!desired) throw new Error("select_option_verified requires optionLabel, optionValue, or text")
      const desiredValue = String(input.optionValue || desired)
      const label = String(input.fieldLabel || input.detail || "")
      const attempts: string[] = []
      let method = ""
      let output = ""

      try {
        const dom = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: buildDomSelectScript(String(input.cssSelector || ""), label, desired, desiredValue) })], 30000)
        output = String(dom.stdout || "")
        const parsed = parseJsonObjectFromText(output)
        const data = parsed?.result || parsed
        if (data?.ok) method = String(data.method || "dom-select")
        else attempts.push("DOM verified select returned no match: " + output)
      } catch (error: any) {
        const message = String(error?.message || error)
        if (isCuaStopSignal(message)) {
          await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "BLOCKED: " + message
        }
        attempts.push("DOM verified select failed: " + message)
      }

      if (!method && input.elementIndex !== undefined) {
        try {
          const res = await execCua(workspace, auditAction, ["call", "set_value", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, value: desired })], 30000)
          output += "\n" + String(res.stdout || "")
          method = "AX set_value"
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("AX set_value select failed: " + message)
        }
      }

      if (!method && input.elementIndex !== undefined) {
        try {
          await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, action: "press" })], 10000)
          await sleep(250)
          const state = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify({ pid: input.pid, window_id: input.windowId, query: desired, capture_mode: "ax" }), "--compact"], 15000)
          const optionIndex = findAxSelectableOptionIndex(String(state.stdout || ""), desired)
          if (optionIndex !== undefined) {
            const res = await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: optionIndex, action: "press" })], 10000)
            output += "\n" + String(res.stdout || "")
            method = "AX popup menu"
          } else {
            attempts.push("AX popup menu did not expose matching option: " + desired)
          }
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("AX popup select failed: " + message)
        }
      }

      if (!method && input.elementIndex !== undefined) {
        try {
          await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "escape" })], 5000).catch(() => {})
          await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex })], 10000)
          await sleep(140)
          await pressCuaTypeahead(workspace, auditAction, Number(input.pid), Number(input.windowId), desired)
          const res = await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "return" })], 10000)
          output += "\n" + String(res.stdout || "")
          method = "native menu keyboard typeahead"
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("native keyboard select failed: " + message)
        }
      }

      const observed = await observeCuaPage(workspace, auditAction, { ...input, saveScreenshot: false }, progress)
      const controls = Array.isArray(observed.dom?.controls) ? observed.dom.controls : []
      const matching = controls.find((control: any) => {
        const controlLabel = String(control.label || control.name || control.id || "")
        if (label && !normalizedMatch(controlLabel, label)) return false
        return normalizedMatch(String(control.value || ""), desired)
      })
      const verified = Boolean(matching) || normalizedMatch(JSON.stringify(observed.dom || {}), desired)
      await recordFieldProgress(workspace, progress, "select", label || input.cssSelector || "下拉字段", desired, method || "unknown", verified)
      await appendLog(workspace, "cua", (verified ? "已选择并复查下拉项：" : "已选择但复查不确定：") + (label || desired) + " -> " + desired)
      await saveTask(workspace, task, "正在填写申请平台", (verified ? "已选择并复查：" : "下拉项已尝试选择但需要继续观察：") + (label || desired))
      await appendAudit(workspace, "cua", auditAction, verified ? "completed" : "failed", (label || "select") + " via " + (method || "unknown"))
      if (!verified) return "SELECT_NEEDS_RECHECK: 已尝试选择，但二次检查未确认目标值。不要立刻保存；先 observe_page 或重试。\n尝试记录：\n" + attempts.join("\n") + "\n输出：\n" + output + "\n观察摘要：\n" + summarizeObservation(observed)
      return "下拉项已选择并通过二次检查。\n方法：" + method + "\n" + output
    }
    if (input.action === "save_page_verified") {
      if (!input.pid || !input.windowId) throw new Error("save_page_verified requires pid and windowId")
      ensureCuaProgress(progress)
      const before = await observeCuaPage(workspace, auditAction, { ...input, saveScreenshot: false }, progress)
      const requiredEmpty = Array.isArray(before.dom?.requiredEmpty) ? before.dom.requiredEmpty : []
      if (requiredEmpty.length > 0 && !input.confirmed) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "save_page_verified", reason: "required fields empty before save", page: progress.currentPage || "", fields: requiredEmpty.slice(0, 20) })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "保存前复查发现必填空项，已阻止保存：" + JSON.stringify(requiredEmpty.slice(0, 8)))
        await saveTask(workspace, task, "正在填写申请平台", "保存前发现必填空项，先补齐后再保存。")
        await appendAudit(workspace, "cua", auditAction, "failed", "required fields empty before save")
        return "SAVE_BLOCKED_REQUIRED_FIELDS: 保存前发现必填空项，不能直接 SAVE。\n" + summarizeObservation(before)
      }

      let output = ""
      try {
        if (input.detail) {
          const checked = await risk.execute({ input: { action: input.detail, page: progress.currentPage || "" } }, ctx as any)
          if (String(checked).startsWith("BLOCKED")) return checked
        }
        if (input.elementIndex !== undefined) {
          const res = await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex })], 30000)
          output = String(res.stdout || "")
        } else {
          const res = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: buildDomSaveScript(String(input.cssSelector || "")) })], 30000)
          output = String(res.stdout || "")
          const parsed = parseJsonObjectFromText(output)
          const data = parsed?.result || parsed
          if (!data?.ok) throw new Error("DOM save click returned no match: " + output)
        }
      } catch (error: any) {
        const message = String(error?.message || error)
        if (isCuaStopSignal(message)) {
          await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "BLOCKED: " + message
        }
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "save_page_verified", reason: message, page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendAudit(workspace, "cua", auditAction, "failed", message)
        return "SAVE_CLICK_FAILED: " + message
      }

      await sleep(900)
      const after = await observeCuaPage(workspace, auditAction, { ...input, saveScreenshot: false }, progress)
      const beforeUnload = Array.isArray(after.dialogs) ? after.dialogs.find((dialog: any) => dialog.kind === "beforeunload") : undefined
      if (beforeUnload) {
        await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: beforeUnload.windowId, key: "escape" })], 10000).catch(() => {})
        appendLimited(progress, "blockedDialogs", { at: new Date().toISOString(), kind: "beforeunload-cancelled-after-save", detail: beforeUnload.title || beforeUnload.text || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "SAVE 后出现离开页面确认，已取消以防未保存内容丢失。")
        await saveTask(workspace, task, "正在填写申请平台", "SAVE 后出现离开页面确认，已取消并留在当前页面。")
        await appendAudit(workspace, "cua", auditAction, "failed", "beforeunload appeared after save")
        return "SAVE_BLOCKED_BEFOREUNLOAD: 已取消离开页面确认，未把页面记为已保存。\n" + summarizeObservation(after)
      }

      const afterRequired = Array.isArray(after.dom?.requiredEmpty) ? after.dom.requiredEmpty : []
      const validation = Array.isArray(after.dom?.validationMessages) ? after.dom.validationMessages : []
      if (afterRequired.length > 0 || validation.length > 0) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "save_page_verified", reason: "validation after save", page: progress.currentPage || "", requiredEmpty: afterRequired.slice(0, 20), validation: validation.slice(0, 20) })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "保存后仍有校验错误，未记为保存成功：" + JSON.stringify({ requiredEmpty: afterRequired.slice(0, 8), validation: validation.slice(0, 8) }))
        await saveTask(workspace, task, "正在填写申请平台", "保存后页面提示仍需补字段，先处理错误再继续。")
        await appendAudit(workspace, "cua", auditAction, "failed", "validation after save")
        return "SAVE_NEEDS_FIX: 保存后仍有必填空项或校验错误，不要重复点 SAVE，先补字段。\n" + summarizeObservation(after)
      }

      const pageName = String(input.detail || progress.currentPage || before.dom?.pageTitle || "申请页面")
      if (!Array.isArray(progress.savedPages)) progress.savedPages = []
      progress.savedPages.push({ at: new Date().toISOString(), page: pageName, url: progress.currentUrl || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已验证保存页面：" + pageName)
      await saveTask(workspace, task, "正在保存申请进度", "已保存并复查当前页面：" + pageName)
      await appendAudit(workspace, "cua", auditAction, "completed", "verified saved page")
      return "页面已保存并通过保存后复查。\n" + output + "\n保存后观察：\n" + summarizeObservation(after)
    }
    if (input.action === "capture_state") {
      if (!input.pid || !input.windowId) throw new Error("capture_state requires pid and windowId from cua-driver launch/list_windows output")
      const file = join(workspace, "05_screenshots", "cua-" + Date.now() + ".png")
      const payload: any = { pid: input.pid, window_id: input.windowId, capture_mode: input.saveScreenshot ? "som" : "ax" }
      if (input.saveScreenshot) payload.screenshot_out_file = file
      const res = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify(payload)], 30000)
      await appendLog(workspace, "cua", input.saveScreenshot ? "已保存页面截图和 AX 状态：" + file : "已读取页面 AX 状态（未截图）。")
      await saveTask(workspace, task, "正在填写申请平台", input.saveScreenshot ? "已捕获申请页面状态和截图，准备填写可确认字段。" : "已读取申请页面状态，准备填写可确认字段。")
      await appendAudit(workspace, "cua", auditAction, "completed", "captured page state")
      return (input.saveScreenshot ? "截图已保存：" + file : "页面 AX 状态已读取（未截图）") + "\n" + String(res.stdout || "")
    }
    if (input.action === "enable_browser_dom") {
      if (!input.confirmed) {
        await appendAudit(workspace, "cua", auditAction, "failed", "consultant confirmation required")
        return "CONFIRMATION_REQUIRED: 开启 Chrome “Allow JavaScript from Apple Events” 会重启浏览器，用于更接近浏览器内部自动填表的 DOM 控制。请先用 question 向顾问确认，再以 confirmed:true 调用本动作。"
      }
      const bundleId = String(input.browserBundleId || "com.google.Chrome")
      const res = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ action: "enable_javascript_apple_events", bundle_id: bundleId, user_has_confirmed_enabling: true })], 30000)
      const control = await readCuaControl(workspace)
      control.domAutomationUnavailable = false
      control.domAutomationUnavailableAt = ""
      control.domAutomationUnavailableReason = ""
      await writeCuaControl(workspace, control)
      await appendLog(workspace, "cua", "已尝试开启浏览器 DOM 自动化通道：" + bundleId)
      await saveTask(workspace, task, "正在填写申请平台", "浏览器 DOM 自动化通道已尝试开启，后续优先使用页面级自动填表。")
      await appendAudit(workspace, "cua", auditAction, "completed", "enabled browser DOM automation")
      return "浏览器 DOM 自动化通道已尝试开启；如 Chrome 被重启，请回到申请页面后继续。\n" + String(res.stdout || "")
    }
    if (input.action === "dismiss_native_menu") {
      if (!input.pid) throw new Error("dismiss_native_menu requires pid")
      const payload: any = { pid: input.pid, key: "escape" }
      if (input.windowId) payload.window_id = input.windowId
      const res = await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify(payload)], 10000)
      await appendLog(workspace, "cua", "已关闭原生下拉/菜单弹层：" + (input.detail || "escape"))
      await saveTask(workspace, task, "正在填写申请平台", "已关闭原生下拉/菜单弹层，准备继续填写。")
      await appendAudit(workspace, "cua", auditAction, "completed", "dismissed native menu")
      return "原生菜单弹层已关闭。\n" + String(res.stdout || "")
    }
    if (input.action === "dismiss_dialog") {
      if (!input.pid) throw new Error("dismiss_dialog requires pid")
      const matchText = String(input.matchText || input.detail || "").trim().toLowerCase()
      const candidateWindowIds: number[] = []
      if (input.windowId) candidateWindowIds.push(Number(input.windowId))
      if (!candidateWindowIds.length) {
        try {
          const windowsRes = await execCua(workspace, auditAction, ["call", "list_windows", "--compact"], 10000)
          const parsed = JSON.parse(String(windowsRes.stdout || "{}"))
          const windows = Array.isArray(parsed.windows) ? parsed.windows : []
          for (const window of windows) {
            if (Number(window.pid) !== Number(input.pid)) continue
            const title = String(window.title || "")
            const looksLikeDialog = /显示|alert|confirm|prompt|dialog|required|验证|提示/i.test(title) || (Number(window.bounds?.width || 0) <= 700 && Number(window.bounds?.height || 0) <= 300)
            if (looksLikeDialog) candidateWindowIds.push(Number(window.window_id))
          }
        } catch (error: any) {
          await appendLog(workspace, "cua", "查找浏览器弹窗窗口失败，将尝试当前窗口按键关闭：" + String(error?.message || error))
        }
      }
      if (!candidateWindowIds.length && input.windowId) candidateWindowIds.push(Number(input.windowId))
      if (!candidateWindowIds.length) throw new Error("dismiss_dialog could not find candidate dialog windows")

      const attempts: string[] = []
      for (const windowId of candidateWindowIds) {
        let tree = ""
        try {
          const state = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify({ pid: input.pid, window_id: windowId }), "--compact"], 10000)
          tree = String(state.stdout || "")
        } catch (error: any) {
          attempts.push("get_window_state failed for " + windowId + ": " + String(error?.message || error))
        }
        if (matchText && tree && !tree.toLowerCase().includes(matchText)) {
          attempts.push("dialog " + windowId + " did not match: " + matchText)
          continue
        }
        const buttonMatch = tree.match(/\[(\d+)\]\s+AXButton[^\n]*(确定|OK|Ok|好|关闭|Close|Continue|继续|Yes|是)/)
        try {
          if (buttonMatch) {
            const res = await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: windowId, element_index: Number(buttonMatch[1]) })], 10000)
            await appendLog(workspace, "cua", "已关闭浏览器弹窗：" + (input.detail || matchText || "未命名弹窗"))
            await appendAudit(workspace, "cua", auditAction, "completed", "dismissed dialog by button")
            return "弹窗已关闭（按钮）。\n" + String(res.stdout || "") + (tree ? "\n\n弹窗内容：\n" + tree.slice(0, 1200) : "")
          }
          const res = await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: windowId, key: "return" })], 10000)
          await appendLog(workspace, "cua", "已通过 Return 关闭浏览器弹窗：" + (input.detail || matchText || "未命名弹窗"))
          await appendAudit(workspace, "cua", auditAction, "completed", "dismissed dialog by return")
          return "弹窗已关闭（Return）。\n" + String(res.stdout || "") + (tree ? "\n\n弹窗内容：\n" + tree.slice(0, 1200) : "")
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("dismiss failed for " + windowId + ": " + message)
        }
      }
      if (!Array.isArray(progress.failedActions)) progress.failedActions = []
      progress.failedActions.push({ at: new Date().toISOString(), action: "dismiss_dialog", reason: attempts.join("\n"), page: progress.currentPage || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "关闭浏览器弹窗失败：" + attempts.join(" | "))
      await appendAudit(workspace, "cua", auditAction, "failed", attempts.join("\n"))
      return "dismiss_dialog failed.\n" + attempts.join("\n")
    }
    if (input.action === "inspect_controls") {
      if (!input.pid || !input.windowId) throw new Error("inspect_controls requires pid and windowId")
      const js = "(function(){"
        + "const norm=(v)=>String(v||'').trim().replace(/\\s+/g,' ');"
        + "const cssPath=(el)=>{if(!el||!el.tagName)return '';if(el.id)return '#'+CSS.escape(el.id);const parts=[];let cur=el;while(cur&&cur.nodeType===1&&parts.length<5){let part=cur.tagName.toLowerCase();if(cur.name)part+='[name=\"'+String(cur.name).replace(/\"/g,'\\\\\"')+'\"]';else{const p=cur.parentElement;if(p){const same=Array.from(p.children).filter(x=>x.tagName===cur.tagName);if(same.length>1)part+=':nth-of-type('+(same.indexOf(cur)+1)+')';}}parts.unshift(part);cur=cur.parentElement;}return parts.join(' > ');};"
        + "const labelFor=(el)=>{const id=el.id;if(id){const l=document.querySelector('label[for=\"'+CSS.escape(id)+'\"]');if(l)return norm(l.innerText||l.textContent);}let cur=el;for(let i=0;i<4&&cur;i++,cur=cur.parentElement){const own=cur.querySelector&&cur.querySelector('label');if(own)return norm(own.innerText||own.textContent);const prev=cur.previousElementSibling;if(prev&&/label|div|span|p|td|th/i.test(prev.tagName)){const t=norm(prev.innerText||prev.textContent);if(t&&t.length<120)return t;}}return norm(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.name||el.id);};"
        + "const visible=(el)=>!!(el&&el.offsetParent!==null&&getComputedStyle(el).visibility!=='hidden');"
        + "const controls=Array.from(document.querySelectorAll('select,input,textarea,button,[role=combobox],[aria-haspopup=listbox],[role=listbox]')).filter(visible).slice(0,120).map((el,index)=>{const tag=el.tagName.toLowerCase();const options=tag==='select'?Array.from(el.options).map(o=>({label:norm(o.textContent),value:o.value,selected:o.selected})).slice(0,80):[];return {index,tag,type:el.getAttribute('type')||'',role:el.getAttribute('role')||'',name:el.getAttribute('name')||'',id:el.id||'',label:labelFor(el),selector:cssPath(el),value:tag==='select'?(el.selectedOptions[0]?.textContent||el.value||''):(el.value||el.getAttribute('aria-valuetext')||''),disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true',options};});"
        + "const nativeSelectHints=controls.filter(c=>c.tag==='select').map(c=>({label:c.label,selector:c.selector,value:c.value,options:c.options.map(o=>o.label).filter(Boolean)}));"
        + "return {ok:true,controlCount:controls.length,nativeSelectHints,controls};"
        + "})()"
      let res
      try {
        res = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: js })], 30000)
      } catch (error: any) {
        const message = String(error?.message || error)
        if (isCuaDomUnavailableSignal(message)) {
          await appendLog(workspace, "cua", "DOM 控件识别不可用，已切换为 AX/键盘填表策略。")
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "DOM_INSPECT_UNAVAILABLE: " + message + "\n请改用 capture_state 获取 AX 树，并对简单连续输入框使用 type_text replace 或 keyboard_fill_sequence。"
        }
        throw error
      }
      await appendLog(workspace, "cua", "已识别页面表单控件。遇到系统样式原生下拉框时，应直接用 select_option，不要先盲目 Escape。")
      await saveTask(workspace, task, "正在填写申请平台", "已识别当前页面的表单控件和下拉选项。")
      await appendAudit(workspace, "cua", auditAction, "completed", "inspected form controls")
      return "页面控件识别结果。若截图中出现系统样式下拉弹层，请不要坐标点击；直接 select_option，只有确实需要关闭已打开菜单时才 dismiss_native_menu。\n" + String(res.stdout || "")
    }
    if (input.action === "click_element") {
      if (!input.pid) throw new Error("click_element requires pid")
      if (input.detail) {
        const checked = await risk.execute({ input: { action: input.detail, page: progress.currentPage || "" } }, ctx as any)
        if (String(checked).startsWith("BLOCKED")) return checked
      }
      const payload: any = { pid: input.pid }
      if (input.elementIndex !== undefined) {
        if (!input.windowId) throw new Error("click_element with elementIndex requires windowId")
        payload.window_id = input.windowId
        payload.element_index = input.elementIndex
      } else {
        if (input.x === undefined || input.y === undefined) throw new Error("click_element requires either elementIndex or x/y")
        payload.x = input.x
        payload.y = input.y
        if (input.windowId) payload.window_id = input.windowId
      }
      const res = await execCua(workspace, auditAction, ["call", "click", JSON.stringify(payload)], 30000)
      await appendLog(workspace, "cua", "已点击页面元素：" + (input.detail || String(input.elementIndex ?? "")))
      await saveTask(workspace, task, "正在填写申请平台", "已点击申请页面中的可确认元素。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "clicked element")
      return "点击已执行。\n" + String(res.stdout || "")
    }
    if (input.action === "dom_set_field") {
      if (!input.pid || !input.windowId || !input.cssSelector || input.text === undefined) throw new Error("dom_set_field requires pid, windowId, cssSelector, and text")
      const value = String(input.text)
      const js = "(function(){"
        + "const selector=" + JSON.stringify(String(input.cssSelector || "")) + ";"
        + "const value=" + JSON.stringify(value) + ";"
        + "const norm=(v)=>String(v||'').trim().toLowerCase().replace(/\\s+/g,' ');"
        + "const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true}));"
        + "const setNative=(el,next)=>{const proto=Object.getPrototypeOf(el);const desc=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');if(desc&&desc.set)desc.set.call(el,next);else el.value=next;fire(el,'input');fire(el,'change');};"
        + "const el=document.querySelector(selector);"
        + "if(!el)return {ok:false,reason:'selector not found',selector};"
        + "if(el.disabled||el.getAttribute('aria-disabled')==='true')return {ok:false,reason:'field disabled',selector};"
        + "if(el.tagName==='SELECT'){const opts=Array.from(el.options);const opt=opts.find(o=>norm(o.value)===norm(value)||norm(o.textContent)===norm(value)||norm(o.textContent).includes(norm(value))||norm(value).includes(norm(o.textContent)));if(!opt)return {ok:false,reason:'select option not found',selector,value,options:opts.map(o=>({label:o.textContent,value:o.value})).slice(0,60)};el.value=opt.value;fire(el,'input');fire(el,'change');return {ok:true,method:'dom-select',selector,selected:opt.textContent,value:opt.value};}"
        + "el.focus();setNative(el,value);return {ok:true,method:'dom-set-value',selector,value};"
        + "})()"
      try {
        const res = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: js })], 30000)
        const output = String(res.stdout || "")
        if (!/"ok"\s*:\s*true/.test(output) && !/ok.*true/.test(output)) {
          throw new Error("DOM set returned no match: " + output)
        }
        await appendLog(workspace, "cua", "已通过 DOM 设置字段：" + (input.detail || input.cssSelector))
        await saveTask(workspace, task, "正在填写申请平台", "已通过页面级自动化填写字段：" + (input.detail || "普通字段"))
        await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "dom set field")
        return "字段已通过 DOM 设置。\n" + output
      } catch (error: any) {
        const message = String(error?.message || error)
        if (isCuaDomUnavailableSignal(message)) {
          await appendLog(workspace, "cua", "DOM 字段设置不可用，需改用 AX/键盘：" + (input.detail || input.cssSelector))
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "DOM_SET_UNAVAILABLE: " + message + "\n请改用 set_value、type_text 或 keyboard_fill_sequence。"
        }
        throw error
      }
    }
    if (input.action === "type_text") {
      if (!input.pid || !input.text) throw new Error("type_text requires pid and text")
      const payload: any = { pid: input.pid, text: input.text }
      if (input.elementIndex !== undefined) {
        if (!input.windowId) throw new Error("type_text with elementIndex requires windowId")
        payload.window_id = input.windowId
        payload.element_index = input.elementIndex
      }
      if (typeof input.delayMs === "number") payload.delay_ms = Math.max(0, Math.min(200, Math.round(input.delayMs)))
      if (input.replace) {
        const focusPayload: any = { pid: input.pid, key: "a", modifiers: ["cmd"] }
        if (input.windowId) focusPayload.window_id = input.windowId
        if (input.elementIndex !== undefined) focusPayload.element_index = input.elementIndex
        try {
          await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify(focusPayload)], 10000)
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          await appendLog(workspace, "cua", "替换输入前选择已有内容失败，将尝试直接输入：" + message)
        }
      }
      const res = await execCua(workspace, auditAction, ["call", "type_text", JSON.stringify(payload)], 30000)
      await appendLog(workspace, "cua", "已填写普通字段：" + (input.detail || "未命名字段"))
      await saveTask(workspace, task, "正在填写申请平台", "已填写一个可确认字段：" + (input.detail || "普通字段"))
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "typed text")
      return "文本已输入。\n" + String(res.stdout || "")
    }
    if (input.action === "set_value") {
      if (!input.pid || !input.windowId || input.elementIndex === undefined || !input.text) throw new Error("set_value requires pid, windowId, elementIndex, and text")
      const payload = { pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, value: input.text }
      const res = await execCua(workspace, auditAction, ["call", "set_value", JSON.stringify(payload)], 30000)
      await appendLog(workspace, "cua", "已设置字段值：" + (input.detail || "未命名字段"))
      await saveTask(workspace, task, "正在填写申请平台", "已设置一个可确认字段：" + (input.detail || "普通字段"))
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "set value")
      return "字段值已设置。\n" + String(res.stdout || "")
    }
    if (input.action === "select_option") {
      if (!input.pid || !input.windowId) throw new Error("select_option requires pid and windowId")
      const desired = String(input.optionLabel || input.optionValue || input.text || "").trim()
      if (!desired) throw new Error("select_option requires optionLabel, optionValue, or text")
      const attempts = []
      if (input.elementIndex !== undefined) {
        try {
          const payload = { pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, value: desired }
	          const res = await execCua(workspace, auditAction, ["call", "set_value", JSON.stringify(payload)], 30000)
	          await appendLog(workspace, "cua", "已智能选择下拉项（AX set_value）：" + (input.detail || desired))
	          await saveTask(workspace, task, "正在填写申请平台", "已选择下拉项：" + (input.detail || desired))
	          await appendAudit(workspace, "cua", auditAction, "completed", "selected option by AX")
	          return "下拉项已选择（AX set_value）。\n" + String(res.stdout || "")
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("AX set_value failed: " + message)
        }
      }

      if (input.elementIndex !== undefined) {
        try {
          await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, action: "press" })], 10000)
          await sleep(300)
          const state = await execCua(workspace, auditAction, ["call", "get_window_state", JSON.stringify({ pid: input.pid, window_id: input.windowId, query: desired, capture_mode: "ax" }), "--compact"], 15000)
          const optionIndex = findAxSelectableOptionIndex(String(state.stdout || ""), desired)
          if (optionIndex !== undefined) {
            const res = await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: optionIndex, action: "press" })], 10000)
            await appendLog(workspace, "cua", "已智能选择下拉项（AX popup menu）：" + (input.detail || desired))
            await saveTask(workspace, task, "正在填写申请平台", "已选择下拉项：" + (input.detail || desired))
            await appendAudit(workspace, "cua", auditAction, "completed", "selected option by AX popup menu")
            return "下拉项已选择（AX popup menu）。\n" + String(res.stdout || "")
          }
          attempts.push("AX popup menu did not expose matching option: " + desired)
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("AX popup menu fallback failed: " + message)
        }
      }

      const js = "(function(){"
        + "const wanted=" + JSON.stringify(desired) + ";"
        + "const wantedValue=" + JSON.stringify(String(input.optionValue || desired)) + ";"
        + "const selector=" + JSON.stringify(String(input.cssSelector || "")) + ";"
        + "const labelHint=" + JSON.stringify(String(input.detail || "")) + ";"
        + "const norm=(v)=>String(v||'').trim().toLowerCase().replace(/\\s+/g,' ');"
        + "const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true}));"
        + "const setNative=(el,value)=>{const proto=Object.getPrototypeOf(el);const desc=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');if(desc&&desc.set)desc.set.call(el,value);else el.value=value;fire(el,'input');fire(el,'change');};"
        + "const byLabel=()=>{if(!labelHint)return null;const labels=Array.from(document.querySelectorAll('label'));const hit=labels.find(l=>norm(l.innerText).includes(norm(labelHint)));if(!hit)return null;if(hit.htmlFor)return document.getElementById(hit.htmlFor);return hit.querySelector('select,input,[role=combobox],button,[aria-haspopup=listbox]');};"
        + "const controls=[];"
        + "if(selector){const el=document.querySelector(selector);if(el)controls.push(el);}"
        + "const labeled=byLabel();if(labeled)controls.push(labeled);"
        + "controls.push(...document.querySelectorAll('select,input[role=combobox],input[aria-autocomplete],button[aria-haspopup=listbox],[role=combobox],[aria-haspopup=listbox]'));"
        + "for(const el of Array.from(new Set(controls))){"
        + " if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')continue;"
        + " if(el.tagName==='SELECT'){const opts=Array.from(el.options);const opt=opts.find(o=>norm(o.textContent)===norm(wanted)||norm(o.value)===norm(wantedValue)||norm(o.textContent).includes(norm(wanted))||norm(wanted).includes(norm(o.textContent)));if(opt){el.value=opt.value;fire(el,'input');fire(el,'change');return {ok:true,method:'dom-select',selected:opt.textContent,value:opt.value};}}"
        + " if(el.matches('input,[role=combobox]')){el.focus();setNative(el,wanted);el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));return {ok:true,method:'dom-combobox-query',selected:wanted};}"
        + "}"
        + "return {ok:false,reason:'No matching select/combobox found',wanted,selector,labelHint};"
        + "})()"
      try {
        const res = await execCua(workspace, auditAction, ["call", "page", JSON.stringify({ pid: input.pid, window_id: input.windowId, action: "execute_javascript", javascript: js })], 30000)
        const output = String(res.stdout || "")
	        if (/"ok"\s*:\s*true/.test(output) || /ok.*true/.test(output)) {
	          await appendLog(workspace, "cua", "已智能选择下拉项（DOM）：" + (input.detail || desired))
	          await saveTask(workspace, task, "正在填写申请平台", "已选择下拉项：" + (input.detail || desired))
	          await appendAudit(workspace, "cua", auditAction, "completed", "selected option by DOM")
	          return "下拉项已选择（DOM smart select）。\n" + output
        }
        attempts.push("DOM smart select returned no match: " + output)
      } catch (error: any) {
        const message = String(error?.message || error)
        if (isCuaStopSignal(message)) {
          await saveTask(workspace, task, "异常中断", "Chrome DOM 通道不可用或 CUA 已停止，已停止下拉选择，避免继续抢占 Chrome 前台。")
          await appendAudit(workspace, "cua", auditAction, "failed", message)
          return "BLOCKED: " + message
        }
        attempts.push("DOM smart select failed: " + message)
      }

      if (input.elementIndex !== undefined) {
        try {
          await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "escape" })], 5000).catch(() => {})
          await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex })], 10000)
          await sleep(140)
          await pressCuaTypeahead(workspace, auditAction, Number(input.pid), Number(input.windowId), desired)
          const res = await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "return" })], 10000)
          await appendLog(workspace, "cua", "已智能选择下拉项（原生菜单键盘兜底）：" + (input.detail || desired))
          await saveTask(workspace, task, "正在填写申请平台", "已通过原生菜单键盘选择下拉项：" + (input.detail || desired))
          await appendAudit(workspace, "cua", auditAction, "completed", "selected option by native keyboard fallback")
          return "下拉项已通过原生菜单键盘兜底选择。\n" + String(res.stdout || "")
        } catch (error: any) {
          const message = String(error?.message || error)
          if (isCuaStopSignal(message)) {
            await saveTask(workspace, task, "异常中断", "CUA 已停止或自动熔断，避免继续强制拉起 Chrome 前台。")
            await appendAudit(workspace, "cua", auditAction, "failed", message)
            return "BLOCKED: " + message
          }
          attempts.push("keyboard fallback failed: " + message)
        }
      }

      if (!Array.isArray(progress.failedActions)) progress.failedActions = []
      progress.failedActions.push({ at: new Date().toISOString(), action: "select_option", reason: attempts.join("\n"), page: progress.currentPage || "", detail: input.detail || desired })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "智能选择下拉项失败：" + (input.detail || desired))
      await appendAudit(workspace, "cua", auditAction, "failed", attempts.join("\n"))
      return "select_option failed. Do not guess by visual coordinates unless the consultant explicitly confirms.\n" + attempts.join("\n")
    }
    if (input.action === "keyboard_fill_sequence") {
      if (!input.pid || !input.windowId) throw new Error("keyboard_fill_sequence requires pid and windowId")
      const values = Array.isArray(input.values) ? input.values : []
      if (values.length === 0) throw new Error("keyboard_fill_sequence requires non-empty values")
      const normalized = values.map((item: any, index: number) => {
        if (typeof item === "string" || typeof item === "number") return { text: String(item), detail: "field " + String(index + 1), replace: input.replace !== false }
        return {
          text: String(item?.text ?? ""),
          detail: String(item?.detail || "field " + String(index + 1)),
          replace: item?.replace ?? input.replace !== false,
        }
      }).filter((item: any) => item.text.length > 0)
      if (normalized.length === 0) throw new Error("keyboard_fill_sequence values contain no text")

      if (input.elementIndex !== undefined) {
        await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, element_index: input.elementIndex, key: "a", modifiers: ["cmd"] })], 10000)
      } else if (input.x !== undefined && input.y !== undefined) {
        await execCua(workspace, auditAction, ["call", "click", JSON.stringify({ pid: input.pid, window_id: input.windowId, x: input.x, y: input.y })], 10000)
        if (input.replace !== false) await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "a", modifiers: ["cmd"] })], 10000)
      } else if (input.replace !== false) {
        await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "a", modifiers: ["cmd"] })], 10000)
      }

      const completed: string[] = []
      for (let index = 0; index < normalized.length; index += 1) {
        const item = normalized[index]
        if (index > 0 && item.replace) {
          await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "a", modifiers: ["cmd"] })], 10000).catch(() => {})
        }
        const payload: any = { pid: input.pid, text: item.text }
        if (typeof input.delayMs === "number") payload.delay_ms = Math.max(0, Math.min(200, Math.round(input.delayMs)))
        await execCua(workspace, auditAction, ["call", "type_text", JSON.stringify(payload)], 30000)
        completed.push(item.detail + "=" + item.text)
        if (index < normalized.length - 1 && input.tabAfterEach !== false) {
          await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify({ pid: input.pid, window_id: input.windowId, key: "tab" })], 10000)
        }
      }

      if (!Array.isArray(progress.keyboardFilledFields)) progress.keyboardFilledFields = []
      progress.keyboardFilledFields.push({ at: new Date().toISOString(), detail: input.detail || "keyboard fill sequence", values: completed, page: progress.currentPage || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已通过键盘顺序填写连续字段：" + (input.detail || completed.join(", ")))
      await saveTask(workspace, task, "正在填写申请平台", "已通过键盘顺序填写连续字段：" + (input.detail || String(completed.length) + " 个字段"))
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || completed.join(", "))
      return "连续字段已通过键盘顺序填写。\n" + completed.join("\n")
    }
    if (input.action === "press_key") {
      if (!input.pid || !input.key) throw new Error("press_key requires pid and key")
      const payload: any = { pid: input.pid, key: input.key }
      if (Array.isArray(input.modifiers)) payload.modifiers = input.modifiers
      if (input.windowId) payload.window_id = input.windowId
      if (input.elementIndex !== undefined) payload.element_index = input.elementIndex
      const res = await execCua(workspace, auditAction, ["call", "press_key", JSON.stringify(payload)], 30000)
      await appendLog(workspace, "cua", "已按键：" + input.key)
      await saveTask(workspace, task, "正在填写申请平台", "已执行页面按键：" + input.key)
      await appendAudit(workspace, "cua", auditAction, "completed", input.key)
      return "按键已执行。\n" + String(res.stdout || "")
    }
    if (input.action === "record_saved") {
      ensureCuaProgress(progress)
      appendLimited(progress, "unverifiedSaveRequests", { at: new Date().toISOString(), detail: input.detail || progress.currentPage || "申请页面", page: progress.currentPage || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "收到未验证保存记录请求，未写入 savedPages：" + (input.detail || "申请页面"))
      await saveTask(workspace, task, "正在保存申请进度", "保存请求已记录，但必须调用 save_page_verified 复查后才算保存成功。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "unverified save request")
      return "UNVERIFIED_SAVE_RECORDED: record_saved 不再把页面计为保存成功。请调用 save_page_verified 完成保存前检查、点击保存、保存后复查，再写入 savedPages。"
    }
    if (input.action === "record_upload") {
      if (!Array.isArray(progress.uploadedMaterials)) progress.uploadedMaterials = []
      progress.uploadedMaterials.push(input.detail || "未命名材料")
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已记录材料上传：" + (input.detail || "未命名材料"))
      await saveTask(workspace, task, "正在上传材料", "已记录可确认材料上传结果。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "uploaded material")
      return "材料上传记录已更新。"
    }
    if (!Array.isArray(progress.failedActions)) progress.failedActions = []
    progress.failedActions.push({ at: new Date().toISOString(), action: input.action, reason: input.detail || "未提供原因", page: progress.currentPage || "" })
    await writeJson(join(workspace, "03_state/application_progress.json"), progress)
    await appendLog(workspace, "cua", "已记录 CUA 失败：" + (input.detail || "未提供原因"))
    await saveTask(workspace, task, "异常中断", "CUA 操作遇到问题，已记录失败原因。")
    await appendAudit(workspace, "cua", auditAction, "failed", input.detail || "未提供原因")
    return "CUA 失败原因已记录。"
  },
}


function renderCollection(studentName: string, input: any, title: string, items: any[]) {
  const lines = ["# " + studentName + " " + title, "", "申请学校：" + (input.school || ""), "申请项目：" + (input.program || ""), "", "以下只列出缺失、无法判断或需要确认的内容。", ""]
  if (items.length === 0) lines.push("当前没有需要补充的内容。")
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    lines.push("## " + (index + 1) + ". " + item.name, "", "- 为什么需要：" + item.whyNeeded, "- 去哪里准备：" + item.prepareFrom, "- 格式要求：" + item.formatRequirement, "- 是否影响继续申请：" + (item.blocksProgress ? "是" : "否"), "")
  }
  return lines.join("\n") + "\n"
}

function renderWordChecklist(studentName: string, input: any, items: any[]) {
  const lines = [
    studentName + " 补充材料清单",
    "",
    "申请学校：" + (input.school || ""),
    "申请项目：" + (input.program || ""),
    "",
    "请按以下要求补充材料或信息。补齐后请发给顾问，或放入指定补充材料文件夹。",
    "",
  ]
  const included = items.filter((item: any) => item.addedToWordList !== false)
  if (included.length === 0) lines.push("当前没有需要补充的材料或信息。")
  for (let index = 0; index < included.length; index += 1) {
    const item = included[index]
    lines.push(String(index + 1) + ". " + item.name, "为什么需要：" + item.whyNeeded, "如何准备：" + item.prepareFrom, "文件格式：" + item.formatRequirement, "")
  }
  lines.push("说明：最终提交申请、付款和推荐信邀请需由顾问人工确认完成。")
  return lines.join("\n")
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function makeDocx(text: string) {
  const body = text.split("\n").map((line) => "<w:p><w:r><w:t xml:space=\"preserve\">" + escapeXml(line) + "</w:t></w:r></w:p>").join("\n")
  const documentXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" + body + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr></w:body></w:document>"
  return zipStore({
    "[Content_Types].xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
    "_rels/.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
    "word/document.xml": documentXml,
  })
}

function zipStore(files: Record<string, string>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name)
    const data = Buffer.from(content, "utf8")
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }
  const centralOffset = offset
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, end])
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
`
}

export async function writeOpenCodeConfig(workspacePath: string) {
  const base = join(workspacePath, ".opencode")
  await mkdir(join(base, "agents"), { recursive: true })
  await mkdir(join(base, "commands"), { recursive: true })
  await mkdir(join(base, "prompts"), { recursive: true })
  await mkdir(join(base, "tools"), { recursive: true })
  await writeJson(join(base, "opencode.json"), {
    $schema: "https://opencode.ai/config.json",
    model: APPLICATION_AGENT_MODEL,
    permission: {
      "*": "allow",
      read: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        "*.env.example": "allow",
      },
      edit: {
        "*": "allow",
        "../*": "deny",
      },
      external_directory: {
        "*": "allow",
      },
      skill: {
        "*": "allow",
      },
      todowrite: "allow",
      webfetch: "allow",
      websearch: "allow",
      question: "allow",
      bash: {
        "*": "allow",
        "rm -rf *": "deny",
        "git push*": "deny",
      },
      "cua_final_submit": "deny",
      "cua_payment": "deny",
      "cua_recommendation_invite": "deny",
    },
    agent: {
      "application-agent": {
        description: "Terra-Edu 留学申请 Agent，自动整理资料、识别缺失项、生成清单并协助填写申请平台。",
        mode: "primary",
        model: APPLICATION_AGENT_MODEL,
        prompt: "{file:./prompts/application-agent.md}",
        permission: {
          "*": "allow",
          question: "allow",
          skill: { "*": "allow" },
          todowrite: "allow",
          webfetch: "allow",
          websearch: "allow",
        },
      },
    },
    tool_output: {
      max_lines: 300,
      max_bytes: 16384,
    },
    compaction: {
      auto: true,
      prune: true,
      tail_turns: 18,
      preserve_recent_tokens: 60000,
      reserved: 12000,
    },
  })
  await writeFile(join(base, "prompts/application-agent.md"), DEFAULT_APPLICATION_PROMPT, "utf8")
  await writeFile(
    join(base, "agents/application-agent.md"),
    `---
description: Terra-Edu 留学申请 Agent，服务留学顾问完成申请资料整理、缺失项识别、Word 清单和 CUA 填表。
mode: primary
model: opencode-go/deepseek-v4-pro
permission:
  "*": allow
  question: allow
  skill:
    "*": allow
  todowrite: allow
  webfetch: allow
  websearch: allow
---

${DEFAULT_APPLICATION_PROMPT}
`,
    "utf8",
  )
  for (const skill of SKILL_DEFINITIONS) {
    const dir = join(base, "skills", skill.name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "SKILL.md"), renderSkill(skill), "utf8")
  }
  for (const command of COMMAND_DEFINITIONS) {
    await writeFile(join(base, "commands", `${command[0]}.md`), renderCommand(command), "utf8")
  }
  await writeFile(join(base, "tools/application-agent.ts"), renderApplicationAgentTools(), "utf8")
}
