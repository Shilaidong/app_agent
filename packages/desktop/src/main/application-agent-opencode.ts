import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { APPLICATION_AGENT_MODEL, APPLICATION_AGENT_MODEL_ID } from "./application-agent-model"
import type { ApplicationTask } from "./application-agent"

const root = dirname(fileURLToPath(import.meta.url))

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8")
}

function readBundledEgoBrowserResource(relativePath: string) {
  const candidates = [
    join(process.resourcesPath ?? "", "ego-browser", relativePath),
    join(root, "../../resources/ego-browser", relativePath),
  ]
  for (const candidate of candidates) {
    try {
      if (!candidate || !existsSync(candidate)) continue
      return readFileSync(candidate, "utf8")
    } catch {}
  }
  throw new Error("Missing bundled ego-browser resource: " + relativePath)
}

async function writeEgoBrowserSkill(base: string) {
  const skillBase = join(base, "skills", "ego-browser")
  await mkdir(join(skillBase, "references"), { recursive: true })
  await mkdir(join(skillBase, "scripts"), { recursive: true })
  await writeFile(join(skillBase, "SKILL.md"), readBundledEgoBrowserResource("SKILL.md"), "utf8")
  await writeFile(join(skillBase, "references/install.md"), readBundledEgoBrowserResource("references/install.md"), "utf8")
  await writeFile(join(skillBase, "scripts/install.sh"), readBundledEgoBrowserResource("scripts/install.sh"), "utf8")
}

export function buildApplicationAgentStartPrompt(task: ApplicationTask) {
  const inputJson = JSON.stringify(task.input, null, 2)
  return `你现在是 Terra-Edu 申请 Agent，请立刻接管这个申请任务。不要等待顾问再输入第一条指令。

这条消息就是启动信号。除非遇到必须由顾问确认的信息或登录动作，否则请从“创建申请工作区”开始自动执行完整流程。

重要交互规则：遇到不确定信息、材料用途、学校要求解释或申请平台字段选择时，优先调用 OpenCode 内置 question 工具向顾问提出清晰选项；顾问回复后，把确认结果写入 task_state.json、missing_items.json 或 application_progress.json，再继续执行。

长流程规则：这是一个从 0 到 1 的连续申请任务。上下文接近上限时允许 OpenCode 自动 compaction，但 compaction 完成后必须继续执行当前未完成步骤；不要因为上下文压缩、工具输出被截断、某一步耗时较长、ego-browser 交接给顾问或浏览器自动化临时暂停就直接结束任务。每次继续前先读取 todowrite、03_state/application_progress.json、03_state/task_state.json 和 03_state/agent_execution_audit.json 恢复现场。

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
- ego-browser skill：macOS 申请平台填表的唯一浏览器自动化后端。通过 ego lite 的独立 task space 打开/复用申请平台，使用 snapshotText、fillInput、click、js、cdp、captureScreenshot、handOffTaskSpace、takeOverTaskSpace、completeTaskSpace 完成真人式观察、填写、复查和保存。
- application-agent_cua：不再直接控制 Chrome，也不再调用 cua-driver；它只记录 ego-browser 填表阶段的 task space、观察结果、已验证字段、保存页面、上传材料、阻塞弹窗、失败原因和审计链。
- application-agent_login：从 03_state/login_credentials.json 读取本机保存的申请平台账号状态，并通过钥匙串读取密码后填写登录页；不会把密码输出给 Agent。
- application-agent_risk：识别并阻断最终提交、付款、不可逆推荐信邀请、保存账号密码等高风险动作。
- application-agent_requirements：保存 webfetch/websearch 得到的学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

## 工具调用硬性约束

- 启动后先调用 OpenCode 内置 todowrite，建立默认 10 步任务清单；每完成或阻塞一步，都更新 todowrite，并调用 application-agent_state 同步 application_progress.json。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、ego-browser 填表状态记录和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- 学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方学校/项目/申请要求页面。抓取结果必须调用 application-agent_requirements 落盘。
- bash 允许用于官方 ego-browser skill 指定的 ego-browser nodejs heredoc 浏览器操作，以及读取文件内容、OCR/文本提取、检查环境或辅助诊断；不得用普通 bash 临时脚本替代 application-agent_workspace、application-agent_materials、application-agent_documents、application-agent_state、application-agent_cua、application-agent_risk。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- 如果看到 OpenCode compaction/summary/上下文压缩相关消息，必须把它当作正常维护动作：先读取最新状态文件恢复任务现场，然后继续执行 todowrite 中未完成的下一步。
- ego-browser 操作必须符合官方 skill：每轮 Bash 用 useOrCreateTaskSpace 或 takeOverTaskSpace 选中同一个申请 task space；用 openOrReuseTab 打开申请链接；用 snapshotText() 观察；用 fillInput、click、js、cdp、pressKey、typeText 等 helper 一次推进一组动作；所有对顾问可见输出必须用 cliLog(...)。
- 页面里出现下拉、autocomplete、Slate 动态菜单、浏览器 alert/confirm/prompt 时，不要再切回 cua-driver 或坐标硬点。先通过 pageInfo()、snapshotText()、js(...) 或 cdp(...) 判断页面状态；必要时用键盘 typeahead 和 DOM/CDP 组合处理，并在保存前后再次 snapshotText() 或 pageInfo() 验证。
- 如果 pageInfo() 返回 dialog 信息，必须用 ego-browser 官方建议的 cdp('Page.handleJavaScriptDialog', { accept: false }) 或更安全的取消策略处理；“离开此网站？”/“Leave site?” 一律取消或留在页面，防止未保存表单丢失。
- 如果任务需要顾问登录、验证码、MFA 或人工接管，调用 ego-browser 的 handOffTaskSpace(task.id)，并在顾问明确回复继续后用 takeOverTaskSpace(task.id) 恢复。不要自动抢回控制。
- 点击 SAVE 前，必须在 ego-browser 脚本内检查当前 modal/page 的必填空项和 validation 文案；保存后必须再次读取页面，确认没有错误提示，才调用 application-agent_cua 的 record_save_verified 写入 savedPages。

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
10. 进入填表阶段时，先调用 application-agent_cua 的 prepare_ego_task 记录 ego-browser 后端、申请链接和 task space 名称；然后严格使用官方 ego-browser skill 的 Bash heredoc 操作申请平台。首次脚本必须 useOrCreateTaskSpace、openOrReuseTab、snapshotText，并把 task.id、pageInfo 和页面摘要用 cliLog 输出。
11. 如需登录，优先使用顾问在 ego lite / Chrome 迁移后的真实登录态；如 03_state/login_credentials.json 里有已保存平台账号密码，可调用 application-agent_login 辅助填写登录页，但不能输出明文密码。需要 MFA/验证码时，调用 handOffTaskSpace 交给顾问，顾问回复继续后再 takeOverTaskSpace。
12. 登录完成后必须按 ego-browser 真人式循环推进：snapshotText/pageInfo 观察页面和 modal，填 1-3 个字段后再次 snapshotText 或 pageInfo 复查，遇到新菜单/新字段就调整策略，最后保存前后都做验证，并调用 application-agent_cua record_save_verified 记录。
13. 遇到 select、combobox、dropdown、degree program、state、school、test type 等下拉选择时，优先用 ego-browser 的语义 workflow：snapshotText refs/locators、fillInput、click、js DOM/CDP 和键盘 typeahead；必要时再用 visual workflow 截图辅助，但不能回退到 cua-driver。
14. 如果浏览器弹出 alert/confirm/prompt 或“离开此网站？”确认框，在 ego-browser 脚本里用 pageInfo/dialog 与 cdp('Page.handleJavaScriptDialog', { accept:false }) 或安全取消策略处理；处理结果再调用 application-agent_cua record_blocker 写入进度。
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
9. 调用 application-agent_cua 的 prepare_ego_task 记录 ego-browser 填表上下文；随后按官方 ego-browser skill 使用 ego-browser nodejs heredoc 打开申请平台、读取 snapshot、填写字段和保存页面。需要 MFA/验证码时用 handOffTaskSpace 交给顾问，顾问回复继续后 takeOverTaskSpace 恢复。
10. 能填写的先填写，能保存的先保存；缺失内容跳过并记录，不确定内容用 question 询问顾问。顾问补充材料后，重新读取 06_new_materials，更新档案并继续申请。

可用 Custom Tools：
- application-agent_workspace：工作区初始化、复制原始材料、刷新材料计数。
- application-agent_materials：材料分类、materials_index 生成。
- application-agent_documents：从 missing_items.json 生成 Word 清单、表单和总结。
- application-agent_state：更新 task_state.json。
- ego-browser skill：macOS 申请平台填表后端。必须使用官方 helper：useOrCreateTaskSpace、openOrReuseTab、snapshotText、fillInput、click、js、cdp、captureScreenshot、handOffTaskSpace、takeOverTaskSpace、completeTaskSpace。
- application-agent_cua：记录 ego-browser 填表状态、task space、观察结果、已验证字段、已保存页面、上传材料、阻塞弹窗和失败原因；不直接控制浏览器。
- application-agent_login：用本机钥匙串保存的申请平台账号密码填写登录页；不会向 Agent 输出明文密码。
- application-agent_risk：高风险动作识别和硬拦截。
- application-agent_requirements：保存学校、项目、平台要求，生成 application_requirements.json/md，并把确定缺失项同步到 missing_items.json。

工具调用硬性约束：
- 启动后必须调用 todowrite，建立默认 10 步计划；每完成一步要同步 todowrite 和 application-agent_state。
- 学校、项目、专业、申请平台要求必须优先用 webfetch 读取已知链接；链接信息不足时用 websearch 查找官方页面。抓取结果必须调用 application-agent_requirements 落盘。
- 默认流程中的工作区创建、材料分类、状态更新、文档生成、ego-browser 填表状态记录和高风险识别，必须调用对应的 application-agent_* Custom Tool。
- bash 允许用于官方 ego-browser skill 指定的 ego-browser nodejs heredoc 浏览器操作，以及读取文件内容、OCR/文本提取、检查环境或辅助诊断；不得用普通 bash 临时脚本替代 application-agent_workspace、application-agent_materials、application-agent_documents、application-agent_state、application-agent_cua、application-agent_risk。
- 每次调用申请专用 Custom Tool 后，工具会写入 03_state/agent_execution_audit.json。任务总结前必须检查该审计文件，确认关键工具链已经执行。
- 如果某个 Custom Tool 调用失败，先记录失败原因并告知顾问，再决定是否用普通命令做有限兜底；不能无声绕过工具链。
- 遇到原生系统样式下拉弹层、Slate 动态菜单、autocomplete、alert 或“离开此网站？”时，不要坐标硬点，也不要切回旧 cua-driver；用 ego-browser 的 snapshotText/pageInfo/js/cdp/键盘策略处理，并在每次选择后复查。
- 填表必须像真人一样小步推进：每页先 snapshotText/pageInfo；每填 1-3 个字段就复查；遇到新菜单、新字段、alert 或“离开此网站？”先处理阻塞；保存必须在 ego-browser 脚本里保存前检查、保存后复查，再调用 application-agent_cua record_save_verified，不能用 record_saved 直接算成功。

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
5. 只做可解释的通用申请分析；除非申请平台页面已经通过 ego-browser snapshot/pageInfo 识别，不要臆测平台专属字段。
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
    description: "通过 ego-browser / ego lite 打开申请平台、等待顾问登录、识别页面字段、填写可确认信息并保存页面。",
    body: `执行步骤：
1. 首次进入平台前调用 application-agent_cua，action 使用 prepare_ego_task，记录申请链接、taskSpaceName 和本轮目标。
2. 按官方 ego-browser skill 使用 Bash heredoc：ego-browser nodejs <<'EOF' ... EOF。每个 heredoc 里先 useOrCreateTaskSpace(name) 或 takeOverTaskSpace(id)，不要新建多个无关 Space。
3. 首次脚本用 openOrReuseTab(applicationUrl, { wait:true }) 打开申请链接，然后 cliLog 输出 task.id、pageInfo() 和 snapshotText() 摘要。
4. 如果页面需要登录，优先复用 ego lite 从 Chrome 迁移来的登录态；如需要账号密码，可调用 application-agent_login 辅助登录，但不能输出明文密码。
5. 如果需要 MFA、验证码、邮箱验证或顾问手动确认，调用 ego-browser 的 handOffTaskSpace(task.id)，并提示顾问完成。顾问明确回复继续后，再用 takeOverTaskSpace(task.id) 恢复，不要自动抢回控制。
6. 登录后先用 snapshotText() 和 pageInfo() 观察页面、modal、必填字段、保存按钮、错误提示和当前 URL；随后调用 application-agent_cua record_observation 写入 application_progress.json。
7. 对每个字段，先从 student_profile.md 查找可确认答案；无法确认则记录缺失，不瞎填。
8. 普通文本字段优先使用 ego-browser 的 fillInput('@ref' 或 loc=...)、typeText、pressKey，或一次性 js(...) DOM 填写；填写后再次 snapshotText/pageInfo 复查，并调用 application-agent_cua record_field_verified。
9. 下拉框、学校、专业、州、国家、日期、考试类型等控件优先使用 ego-browser 的语义 workflow：snapshotText refs/locators、click、fillInput、pressKey/typeahead、js DOM/CDP。选择后必须复查显示值/隐藏值，并调用 record_select_verified。
10. 每填 1-3 个字段后再次观察。若页面出现新字段、新菜单或动态必填项，先处理新内容，再继续。
11. 如果 pageInfo() 返回 { dialog: ... }，说明网页 JavaScript dialog 阻塞页面。对 validation alert 先读取错误文案；对“离开此网站？”或 Leave site 一律用 cdp('Page.handleJavaScriptDialog', { accept:false }) 取消。处理后调用 record_blocker。
12. 保存页面前，在 ego-browser 脚本里扫描 required、aria-required、红色错误、validation 文案和 modal 内空值；发现必填空项时不要点 SAVE，先补字段或写 missing_items。
13. 保存页面后必须再次 snapshotText/pageInfo 验证没有错误提示，且页面或列表显示保存结果；确认后调用 application-agent_cua record_save_verified。不要用 record_saved 直接算成功。
14. 上传材料用 ego-browser uploadFile；上传后观察页面确认文件名或状态，再调用 record_upload。
15. 每次准备点击 submit、final submit、payment、recommendation invite、不可逆确认前，必须先调用 application-agent_risk；命中 BLOCKED 就停止。
16. 当前页完成后，如果不需要顾问继续看页面，调用 completeTaskSpace(task.id, { keep:false })；如果要留给顾问复核，调用 completeTaskSpace(task.id, { keep:true }) 并只保留必要标签页。

输出要求：
- 持续告诉顾问正在填写哪个页面、保存了什么、缺了什么。
- 默认使用 ego-browser 语义 workflow；只有页面是 canvas/虚拟编辑器或语义信息明显不足时，才用 captureScreenshot 的 visual workflow。`,
  },
  {
    name: "material-upload",
    description: "根据申请平台要求匹配本地材料并尝试上传，记录成功或失败原因。",
    body: `执行步骤：
1. 读取 student_profile.md、materials_index.json 和当前申请页面状态。
2. 只上传用途和字段要求能明确匹配的材料；不确定材料不能上传。
3. 上传前检查高风险：不要上传含账号密码、无关隐私或用途不明文件。
4. 上传材料必须通过 ego-browser uploadFile 完成；上传后用 snapshotText/pageInfo 或必要截图确认文件名/状态。
5. 上传成功调用 application-agent_cua record_upload；失败调用 record_failure；需要证据时使用 ego-browser captureScreenshot，并把截图路径或页面证据写入 detail/evidence。
6. 上传后更新 application_progress.json 和 task_summary.md。

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
  description: "Prepare ego-browser login with credentials saved by the Terra-Edu desktop app. The password stays in the macOS keychain and is never returned to the agent, logs, or workspace files.",
  args: inputArg({
    action: { type: "string", enum: ["fill_saved_credentials", "record_mfa_required", "record_login_failure"], description: "Use fill_saved_credentials to prepare an ego-browser keychain-login snippet; use record_mfa_required when MFA/CAPTCHA/email verification appears." },
    taskSpaceId: { type: "string", description: "Optional ego-browser task space id to reuse with takeOverTaskSpace." },
    taskSpaceName: { type: "string", description: "Optional ego-browser task space name to use with useOrCreateTaskSpace." },
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
    password = ""
    const usernameSelector = String(input.usernameSelector || "")
    const passwordSelector = String(input.passwordSelector || "")
    const submitSelector = String(input.submitSelector || "")
    const shouldSubmit = input.submit !== false
    const taskSpaceSelector = input.taskSpaceId
      ? "const task = await takeOverTaskSpace(" + JSON.stringify(String(input.taskSpaceId)) + ")"
      : "const task = await useOrCreateTaskSpace(" + JSON.stringify(String(input.taskSpaceName || ["Terra-Edu", task.input?.studentName, task.input?.school].filter(Boolean).join(" / "))) + ")"
    const snippet = [
      "ego-browser nodejs <<'EOF'",
      "import { execFileSync } from 'node:child_process'",
      taskSpaceSelector,
      "const username = " + JSON.stringify(String(credential.username)),
      "const serviceName = " + JSON.stringify(String(credential.serviceName)),
      "const password = execFileSync('security', ['find-generic-password', '-s', serviceName, '-a', username, '-w'], { encoding: 'utf8' }).trim()",
      "const usernameSelector = " + JSON.stringify(usernameSelector),
      "const passwordSelector = " + JSON.stringify(passwordSelector),
      "const submitSelector = " + JSON.stringify(submitSelector),
      "const shouldSubmit = " + JSON.stringify(shouldSubmit),
      "await js(({ username, password, usernameSelector, passwordSelector, submitSelector, shouldSubmit }) => {",
      "  const visible = (el) => !!(el && el.offsetParent !== null && !el.disabled && el.getAttribute('aria-disabled') !== 'true')",
      "  const setNative = (el, value) => { const proto = Object.getPrototypeOf(el); const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); if (desc && desc.set) desc.set.call(el, value); else el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }",
      "  const pick = (selector, fallbacks) => { if (selector) { const hit = document.querySelector(selector); if (visible(hit)) return hit } return Array.from(document.querySelectorAll(fallbacks)).find(visible) }",
      "  const userEl = pick(usernameSelector, 'input[type=email],input[name*=email i],input[id*=email i],input[name*=user i],input[id*=user i],input[type=text]')",
      "  const passEl = pick(passwordSelector, 'input[type=password]')",
      "  if (!userEl || !passEl) return { ok:false, reason:'login_fields_not_found' }",
      "  setNative(userEl, username); setNative(passEl, password)",
      "  let submitted = false",
      "  if (shouldSubmit) {",
      "    let submitEl = submitSelector ? document.querySelector(submitSelector) : null",
      "    if (!visible(submitEl)) submitEl = Array.from(document.querySelectorAll('button,input[type=submit],[role=button]')).find((el) => visible(el) && /log in|login|sign in|continue|next|登录|登入|继续|下一步/i.test(String(el.innerText || el.value || el.getAttribute('aria-label') || '')))",
      "    if (visible(submitEl)) { submitEl.click(); submitted = true } else { passEl.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true })); submitted = true }",
      "  }",
      "  return { ok:true, usernameFilled:true, passwordFilled:true, submitted }",
      "}, { username, password, usernameSelector, passwordSelector, submitSelector, shouldSubmit })",
      "cliLog(JSON.stringify({ loginAttempted: true, taskSpaceId: task.id, info: await pageInfo(), snapshot: await snapshotText() }, null, 2))",
      "EOF",
    ].join("\n")
    await appendLog(workspace, "cua", "已确认本机钥匙串存在申请平台凭证；已生成 ego-browser 登录步骤，密码不会写入日志。")
    await saveTask(workspace, task, "等待顾问登录", "已准备通过 ego-browser 使用本机钥匙串填写登录页；如页面要求 MFA、验证码或邮箱验证，请顾问手动完成。")
    await appendAudit(workspace, "login", "fill_saved_credentials", "completed", "prepared ego-browser keychain login snippet", ctx)
    return JSON.stringify({ status: "prepared", usernameAvailable: true, passwordSource: "macOS keychain", snippet }, null, 2)
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
  description: "Coordinate ego-browser / ego lite application-platform filling. This tool does not directly control Chrome or call cua-driver. Use the official ego-browser skill for browser actions, then call this tool to record task space, observations, verified fields, verified saves, uploads, blockers, failures, and audit state.",
  args: inputArg({
    action: { type: "string", enum: ["prepare_ego_task", "resume_ego", "record_observation", "record_field_verified", "record_select_verified", "record_save_verified", "record_blocker", "handoff_to_consultant", "complete_ego_task", "record_failure", "record_saved", "record_upload", "block_high_risk"], description: "ego-browser coordination action. Browser control itself must be done through the official ego-browser skill, not this tool." },
    applicationUrl: { type: "string", description: "Application platform URL, defaults to task input." },
    taskSpaceName: { type: "string", description: "ego-browser task space name for this application task." },
    taskSpaceId: { type: "string", description: "ego-browser task space id returned by useOrCreateTaskSpace." },
    currentUrl: { type: "string", description: "Current URL reported by ego-browser pageInfo." },
    pageTitle: { type: "string", description: "Current page title reported by ego-browser pageInfo or snapshot." },
    fieldLabel: { type: "string", description: "Human-readable field label, such as State, Institution, Current Title." },
    text: { type: "string", description: "Field value, selected option, page summary, or observation text." },
    expectedText: { type: "string", description: "Expected visible value after ego-browser verification." },
    optionLabel: { type: "string", description: "Selected option label for record_select_verified." },
    optionValue: { type: "string", description: "Selected option value for record_select_verified." },
    evidence: { type: "string", description: "Short verification evidence from snapshotText/pageInfo/screenshot/readback." },
    confirmed: { type: "boolean", description: "Required true for record_save_verified after ego-browser verified there are no required-field or validation errors." },
    detail: { type: "string", description: "Operation detail, failure reason, saved page, upload material, or high-risk action" },
  }, ["action"]),
  async execute(args, ctx) {
    const input = args.input || {}
    const workspace = root(ctx)
    const task = await loadTask(workspace)
    const progress = await readJson(join(workspace, "03_state/application_progress.json"), { currentPage: "", completedPages: [], savedPages: [], uploadedMaterials: [], failedActions: [], highRiskBlocks: [] })
    const auditAction = String(input.action || "unknown")
    await appendAudit(workspace, "cua", auditAction, "started", input.detail || "")
    if (input.action === "block_high_risk") {
      return await risk.execute({ input: { action: input.detail || "high risk application action", page: progress.currentPage || "" } }, ctx as any)
    }
    if (input.action === "resume_ego") {
      ensureCuaProgress(progress)
      progress.browserBackend = "ego-browser"
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "",
        taskSpaceName: input.taskSpaceName || progress.egoBrowser?.taskSpaceName || "",
        resumedAt: new Date().toISOString(),
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已恢复 ego-browser 填表上下文：" + (input.taskSpaceId || input.taskSpaceName || "当前申请 Space"))
      await saveTask(workspace, task, "正在填写申请平台", "ego-browser task space 已恢复，Agent 可继续通过官方 skill 填写。")
      await appendAudit(workspace, "cua", auditAction, "completed", "resumed ego-browser task space")
      return "ego-browser 填表上下文已恢复。请在下一轮 Bash heredoc 中使用 takeOverTaskSpace(taskSpaceId) 或 useOrCreateTaskSpace(taskSpaceName) 继续。"
    }
    if (input.action === "prepare_ego_task") {
      ensureCuaProgress(progress)
      const url = String(input.applicationUrl || task.input?.applicationUrl || "").trim()
      if (!url) throw new Error("applicationUrl is required for prepare_ego_task")
      const taskSpaceName = String(input.taskSpaceName || ["Terra-Edu", task.input?.studentName, task.input?.school, task.input?.program].filter(Boolean).join(" / ")).trim()
      progress.browserBackend = "ego-browser"
      progress.currentPage = progress.currentPage || "申请平台准备中"
      progress.currentUrl = url
      progress.platformLastOpenedAt = new Date().toISOString()
      progress.platformLastOpenedUrl = url
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceName,
        taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "",
        applicationUrl: url,
        backend: "ego-browser",
        preparedAt: new Date().toISOString(),
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已准备 ego-browser 填表任务：" + taskSpaceName + " -> " + url)
      await saveTask(workspace, task, "正在填写申请平台", "已切换到 ego-browser / ego lite 后端，准备在独立 Space 中打开申请平台。")
      await appendAudit(workspace, "cua", auditAction, "completed", "prepared ego-browser task")
      return [
        "ego-browser 填表任务已准备。下一步必须使用官方 ego-browser skill，不要调用 cua-driver。",
        "",
        "建议首轮 heredoc：",
        "ego-browser nodejs <<'EOF'",
        "const task = await useOrCreateTaskSpace(" + JSON.stringify(taskSpaceName) + ")",
        "await openOrReuseTab(" + JSON.stringify(url) + ", { wait: true, timeout: 30 })",
        "cliLog(JSON.stringify({ taskSpaceId: task.id, info: await pageInfo(), snapshot: await snapshotText() }, null, 2))",
        "EOF",
        "",
        "拿到 taskSpaceId、pageInfo 和 snapshot 后，调用 application-agent_cua record_observation 记录观察结果，再继续填写。",
      ].join("\n")
    }
    if (input.action === "record_observation") {
      ensureCuaProgress(progress)
      progress.browserBackend = "ego-browser"
      progress.currentPage = input.pageTitle || input.detail || progress.currentPage || "申请平台页面"
      progress.currentUrl = input.currentUrl || progress.currentUrl || ""
      progress.lastObservedAt = new Date().toISOString()
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "",
        taskSpaceName: input.taskSpaceName || progress.egoBrowser?.taskSpaceName || "",
        lastSnapshotSummary: input.text || input.evidence || "",
        lastObservedAt: progress.lastObservedAt,
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser 页面观察已记录：" + (progress.currentPage || "申请平台页面"))
      await saveTask(workspace, task, "正在填写申请平台", "已通过 ego-browser snapshot/pageInfo 观察当前页面，准备继续小步填写。")
      await appendAudit(workspace, "cua", auditAction, "completed", "recorded ego-browser observation")
      return "ego-browser 页面观察已记录。继续用 snapshotText refs/locators、fillInput、click、js 或 cdp 小步填写，并在 1-3 个字段后再次观察。"
    }
    if (input.action === "record_field_verified" || input.action === "record_select_verified") {
      ensureCuaProgress(progress)
      const kind = input.action === "record_select_verified" ? "select" : "field"
      const label = String(input.fieldLabel || input.detail || (kind === "select" ? "下拉字段" : "普通字段"))
      const value = String(input.optionLabel || input.optionValue || input.text || input.expectedText || "")
      appendLimited(progress, "filledFields", { at: new Date().toISOString(), kind, label, value, backend: "ego-browser", taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "" })
      appendLimited(progress, "verifiedFields", { at: new Date().toISOString(), kind, label, value, expected: input.expectedText || value, evidence: input.evidence || "", backend: "ego-browser" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser 已填写并复查：" + label + " -> " + value)
      await saveTask(workspace, task, "正在填写申请平台", "已填写并复查字段：" + label)
      await appendAudit(workspace, "cua", auditAction, "completed", label + " verified via ego-browser")
      return (kind === "select" ? "下拉/选项" : "字段") + "已记录为 ego-browser 验证完成。继续每 1-3 个字段观察一次页面。"
    }
    if (input.action === "record_blocker") {
      ensureCuaProgress(progress)
      appendLimited(progress, "blockedDialogs", { at: new Date().toISOString(), detail: input.detail || input.text || "ego-browser handled blocker", evidence: input.evidence || "", backend: "ego-browser" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser 已处理阻塞弹窗：" + (input.detail || "未命名弹窗"))
      await saveTask(workspace, task, "正在填写申请平台", "已处理申请页面弹窗或阻塞状态，准备继续。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "handled ego-browser blocker")
      return "阻塞处理已记录。若是 Leave site / 离开此网站，应确认 ego-browser 已用 accept:false 取消离开。"
    }
    if (input.action === "handoff_to_consultant") {
      ensureCuaProgress(progress)
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "",
        handoffAt: new Date().toISOString(),
        handoffReason: input.detail || "需要顾问接管 ego-browser Space。",
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "已交接 ego-browser task space 给顾问：" + (input.detail || "需要人工登录/验证。"))
      await saveTask(workspace, task, "等待顾问登录", input.detail || "请顾问在 ego lite Space 中完成登录、验证码或人工确认，然后回复继续。")
      await appendAudit(workspace, "cua", auditAction, "completed", "handoff to consultant")
      return "已记录顾问接管。ego-browser 脚本中应已调用 handOffTaskSpace(task.id)。顾问回复继续后，用 takeOverTaskSpace(task.id) 恢复。"
    }
    if (input.action === "record_save_verified") {
      ensureCuaProgress(progress)
      if (!input.confirmed) {
        appendLimited(progress, "failedActions", { at: new Date().toISOString(), action: "record_save_verified", reason: "missing confirmed:true", page: progress.currentPage || "" })
        await writeJson(join(workspace, "03_state/application_progress.json"), progress)
        await appendLog(workspace, "cua", "收到未确认保存记录，未写入 savedPages：" + (input.detail || progress.currentPage || "申请页面"))
        await saveTask(workspace, task, "正在保存申请进度", "保存记录需要 ego-browser 保存前检查和保存后复查，未确认前不算成功。")
        await appendAudit(workspace, "cua", auditAction, "failed", "unverified save record")
        return "UNVERIFIED_SAVE_RECORDED: 必须在 ego-browser 脚本里完成保存前 required/validation 检查、点击 SAVE、保存后 snapshot/pageInfo 复查，并以 confirmed:true 调用 record_save_verified。"
      }
      const pageName = String(input.detail || input.pageTitle || progress.currentPage || "申请页面")
      if (!Array.isArray(progress.savedPages)) progress.savedPages = []
      progress.savedPages.push({ at: new Date().toISOString(), page: pageName, url: input.currentUrl || progress.currentUrl || "", backend: "ego-browser", evidence: input.evidence || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser 已验证保存页面：" + pageName)
      await saveTask(workspace, task, "正在保存申请进度", "已通过 ego-browser 保存并复查当前页面：" + pageName)
      await appendAudit(workspace, "cua", auditAction, "completed", "verified save via ego-browser")
      return "页面已记录为 ego-browser 验证保存。继续下一页前请再次 snapshotText/pageInfo。"
    }
    if (input.action === "complete_ego_task") {
      ensureCuaProgress(progress)
      progress.egoBrowser = {
        ...(progress.egoBrowser || {}),
        taskSpaceId: input.taskSpaceId || progress.egoBrowser?.taskSpaceId || "",
        completedAt: new Date().toISOString(),
        completionDetail: input.detail || "",
      }
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "ego-browser task space 完成：" + (input.detail || "本轮填表阶段完成。"))
      await saveTask(workspace, task, "阶段性完成", input.detail || "本轮 ego-browser 填表阶段已完成。")
      await appendAudit(workspace, "cua", auditAction, "completed", "completed ego-browser task")
      return "ego-browser task space 完成状态已记录。若页面需要留给顾问复核，请确保 ego-browser 脚本已 completeTaskSpace(task.id, { keep:true })。"
    }
    if (input.action === "record_saved") {
      ensureCuaProgress(progress)
      appendLimited(progress, "unverifiedSaveRequests", { at: new Date().toISOString(), detail: input.detail || progress.currentPage || "申请页面", page: progress.currentPage || "" })
      await writeJson(join(workspace, "03_state/application_progress.json"), progress)
      await appendLog(workspace, "cua", "收到未验证保存记录请求，未写入 savedPages：" + (input.detail || "申请页面"))
      await saveTask(workspace, task, "正在保存申请进度", "保存请求已记录，但必须通过 ego-browser 保存前检查和保存后复查，再调用 record_save_verified 才算保存成功。")
      await appendAudit(workspace, "cua", auditAction, "completed", input.detail || "unverified save request")
      return "UNVERIFIED_SAVE_RECORDED: record_saved 不再把页面计为保存成功。请先用 ego-browser 完成保存前检查、点击保存、保存后复查，再以 confirmed:true 调用 record_save_verified 写入 savedPages。"
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
description: Terra-Edu 留学申请 Agent，服务留学顾问完成申请资料整理、缺失项识别、Word 清单和 ego-browser 填表。
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
  await writeEgoBrowserSkill(base)
  for (const command of COMMAND_DEFINITIONS) {
    await writeFile(join(base, "commands", `${command[0]}.md`), renderCommand(command), "utf8")
  }
  await writeFile(join(base, "tools/application-agent.ts"), renderApplicationAgentTools(), "utf8")
}
