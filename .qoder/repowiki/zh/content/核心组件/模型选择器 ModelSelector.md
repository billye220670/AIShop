# 模型选择器 ModelSelector

<cite>
**本文引用的文件**
- [ModelSelector.tsx](file://src/components/common/ModelSelector.tsx)
- [ModelBottomSheet.tsx](file://src/components/common/ModelBottomSheet.tsx)
- [models.ts](file://src/config/models.ts)
- [index.ts](file://src/types/index.ts)
- [TopNavBar.tsx](file://src/components/layout/TopNavBar.tsx)
- [roleRepo.ts](file://src/db/roleRepo.ts)
- [index.css](file://src/index.css)
</cite>

## 更新摘要
**变更内容**
- 新增多页面导航系统，支持推荐模型、所有模型、角色管理和角色创建视图
- 实现平滑的页面切换动画，包含前进和后退方向的滑入滑出效果
- 增强角色管理功能，支持自定义角色的创建、选择和删除
- 优化底部弹窗的用户体验，提供完整的聊天设置界面
- 扩展 Props 接口以支持角色管理相关功能

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录：使用示例与主题适配](#附录使用示例与主题适配)

## 简介
ModelSelector 是一个通用的 AI 模型选择器组件，支持在桌面端下拉菜单与移动端底部弹窗两种交互形态。**最新更新**：ModelBottomSheet 组件经过重大重构，现在支持多页面导航，包括推荐模型视图、所有模型视图、角色管理视图和角色创建视图，并提供平滑的滑动动画效果。

该组件提供以下能力：
- 多厂商模型分组展示（Anthropic、OpenAI、Google、xAI、国内模型等）
- 当前选中模型的图标、名称显示
- **新增**：推荐模型优先展示，支持横向滚动浏览
- **新增**：完整的多页面导航系统，支持页面间平滑切换
- **新增**：角色管理系统，支持自定义角色的创建、选择和删除
- 紧凑模式下的"联网搜索"和"Artifact"开关集成
- 键盘与外部点击关闭的无障碍交互
- 基于 Provider 的图标映射与深色图标背景适配

## 项目结构
- 组件层
  - src/components/common/ModelSelector.tsx：主选择器组件，负责触发按钮、弹出定位、分组渲染、事件处理
  - src/components/common/ModelBottomSheet.tsx：**重构后**的底部弹窗，包含多页面导航系统
- 配置与类型
  - src/config/models.ts：模型数据定义（聊天、图像等），以及按类型获取模型的函数
  - src/types/index.ts：Model 类型定义，包含 id、name、provider、type、能力、价格等字段
  - src/db/roleRepo.ts：**新增**的角色管理数据库操作
- 使用位置
  - src/components/layout/TopNavBar.tsx：在顶部导航栏中引入 ModelSelector，并传入 compact 模式及高级功能开关

```mermaid
graph TB
A["TopNavBar.tsx"] --> B["ModelSelector.tsx"]
B --> C["ModelBottomSheet.tsx"]
C --> D["推荐模型视图"]
C --> E["所有模型视图"]
C --> F["角色管理视图"]
C --> G["角色创建视图"]
B --> H["models.ts"]
B --> I["types/index.ts"]
C --> J["roleRepo.ts"]
```

**图表来源**
- [TopNavBar.tsx:89-98](file://src/components/layout/TopNavBar.tsx#L89-L98)
- [ModelSelector.tsx:1-6](file://src/components/common/ModelSelector.tsx#L1-L6)
- [ModelBottomSheet.tsx:1-5](file://src/components/common/ModelBottomSheet.tsx#L1-L5)
- [roleRepo.ts:1-72](file://src/db/roleRepo.ts#L1-L72)

## 核心组件
- ModelSelector
  - 职责：渲染触发按钮、计算弹出菜单定位、分组渲染模型列表、处理打开/关闭、ESC 与外部点击关闭；compact 模式下切换为底部弹窗
  - 关键特性：
    - 动态定位：根据视口空间自动选择上/下弹出方向，避免溢出
    - 分组排序：按预设顺序对厂商分组进行排序展示
    - 图标适配：深色图标 provider 使用圆形白底容器提升对比度
    - 动画过渡：进入/退出时透明度与缩放过渡
    - 可访问性：role="listbox" 列表、ESC 关闭、外部点击关闭
- ModelBottomSheet
  - 职责：**重构后**的底部弹窗，提供多页面导航系统，包括推荐模型视图、所有模型视图、角色管理视图和角色创建视图
  - 关键特性：
    - **新增**：多页面导航系统，支持页面间的平滑滑动动画
    - **新增**：推荐模型优先展示，点击"更多"进入全部模型视图
    - **新增**：角色管理功能，支持自定义角色的创建、选择和删除
    - 分组展示与选中高亮
    - 平滑视图切换动画，支持前进和后退方向

**章节来源**
- [ModelSelector.tsx:69-178](file://src/components/common/ModelSelector.tsx#L69-L178)
- [ModelBottomSheet.tsx:117-192](file://src/components/common/ModelBottomSheet.tsx#L117-L192)

## 架构总览
ModelSelector 作为入口，根据 compact 属性决定渲染路径：
- 非紧凑模式：使用 createPortal 将菜单挂载到 body，计算固定坐标并渲染分组列表
- 紧凑模式：渲染 ModelBottomSheet，内部维护多页面状态与切换动画

```mermaid
sequenceDiagram
participant U as "用户"
participant N as "TopNavBar.tsx"
participant S as "ModelSelector.tsx"
participant B as "ModelBottomSheet.tsx"
U->>N : 点击头部区域
N->>S : 传入 models, selectedModel, onModelChange, compact=true
U->>S : 点击选择器按钮
alt compact 模式
S->>B : 打开底部弹窗默认显示推荐模型视图
B->>B : 用户可在页面间导航
B-->>S : 选择模型或角色后调用相应回调
else 非 compact 模式
S->>S : 计算菜单定位并渲染下拉菜单
U->>S : 点击某模型项
S-->>N : 调用 onModelChange(modelId)
end
```

**图表来源**
- [TopNavBar.tsx:89-98](file://src/components/layout/TopNavBar.tsx#L89-L98)
- [ModelSelector.tsx:69-104](file://src/components/common/ModelSelector.tsx#L69-L104)
- [ModelSelector.tsx:245-317](file://src/components/common/ModelSelector.tsx#L245-L317)
- [ModelBottomSheet.tsx:143-192](file://src/components/common/ModelBottomSheet.tsx#L143-L192)

## 详细组件分析

### Props 接口定义
- models: Model[] — 模型列表，来源于配置或业务逻辑过滤后的结果
- selectedModel: string — 当前选中的模型 ID
- onModelChange: (modelId: string) => void — 模型变更回调，用于更新父级状态
- compact?: boolean — 是否启用紧凑模式（默认 false）。开启后使用底部弹窗而非下拉菜单
- webSearchEnabled?: boolean — 紧凑模式下"联网搜索"开关状态
- onWebSearchToggle?: () => void — 紧凑模式下"联网搜索"开关回调
- artifactEnabled?: boolean — 紧凑模式下"Artifact"开关状态
- onArtifactToggle?: () => void — 紧凑模式下"Artifact"开关回调
- **新增** roles: RoleData[] — 角色列表数据
- **新增** selectedRoleId: string — 当前选中的角色 ID
- **新增** onRoleSelect: (roleId: string) => void — 角色选择回调
- **新增** onRolesChanged: () => void — 角色列表变更通知回调

**章节来源**
- [ModelSelector.tsx:7-22](file://src/components/common/ModelSelector.tsx#L7-L22)
- [ModelBottomSheet.tsx:8-24](file://src/components/common/ModelBottomSheet.tsx#L8-L24)

### 多页面导航系统
**新增功能**：ModelBottomSheet 现在实现了完整的四页面导航系统：

- **推荐模型视图**：展示精选模型卡片，支持横向滚动浏览
- **所有模型视图**：按厂商分组的完整模型列表
- **角色管理视图**：管理自定义角色，支持创建、选择和删除
- **角色创建视图**：输入系统提示词创建新角色

页面导航特性：
- 平滑的滑动动画，支持前进和后退方向
- 固定的顶部导航栏，包含返回按钮和页面标题
- 页面状态管理，确保正确的导航层级

**章节来源**
- [ModelBottomSheet.tsx:117-192](file://src/components/common/ModelBottomSheet.tsx#L117-L192)
- [ModelBottomSheet.tsx:281-414](file://src/components/common/ModelBottomSheet.tsx#L281-L414)
- [ModelBottomSheet.tsx:416-484](file://src/components/common/ModelBottomSheet.tsx#L416-L484)
- [ModelBottomSheet.tsx:486-595](file://src/components/common/ModelBottomSheet.tsx#L486-L595)
- [ModelBottomSheet.tsx:597-635](file://src/components/common/ModelBottomSheet.tsx#L597-L635)

### 角色管理功能
**新增功能**：完整的角色管理系统，支持用户自定义角色：

- **角色创建**：通过输入系统提示词创建新角色，自动提取角色名
- **角色选择**：在默认角色和自定义角色之间切换
- **角色删除**：安全的删除机制，需要二次确认防止误删
- **持久化存储**：角色数据存储在 IndexedDB，支持跨设备同步

角色管理特性：
- 默认角色始终置顶显示，名为"PortAI"
- 自定义角色按创建时间排序显示
- 删除操作需要两次点击确认，3秒内再次点击才真正删除
- 创建完成后自动返回角色列表

**章节来源**
- [ModelBottomSheet.tsx:149-155](file://src/components/common/ModelBottomSheet.tsx#L149-L155)
- [ModelBottomSheet.tsx:214-247](file://src/components/common/ModelBottomSheet.tsx#L214-L247)
- [ModelBottomSheet.tsx:504-595](file://src/components/common/ModelBottomSheet.tsx#L504-L595)
- [roleRepo.ts:14-72](file://src/db/roleRepo.ts#L14-L72)

### 平滑动画系统
**新增功能**：页面切换的平滑动画效果：

- **前进动画**：旧页面向左滑出，新页面从右侧滑入
- **后退动画**：旧页面向右滑出，新页面从左侧滑入
- **动画控制**：使用 CSS 类名动态切换，配合 JavaScript 状态管理
- **性能优化**：使用 transform 和 opacity 属性，确保流畅的 60fps 动画

动画实现细节：
- 使用 `animate-slide-in-right`、`animate-slide-out-left` 等 CSS 动画类
- 通过 `pageAnimClass` 函数根据导航方向动态应用动画类
- 动画时长为 0.3s，使用 ease-out 缓动函数

**章节来源**
- [ModelBottomSheet.tsx:194-202](file://src/components/common/ModelBottomSheet.tsx#L194-L202)
- [index.css:459-517](file://src/index.css#L459-L517)

### 模型信息展示逻辑
- 图标映射
  - 通过 PROVIDER_ICON_MAP 将 provider 名称映射到 /public/providers/ 下的 SVG 文件名
  - getProviderIcon 返回完整 URL，供 img 标签加载
  - DARK_ICON_PROVIDERS 指定需要白色圆形背景的 provider，以提升对比度
- 分组与排序
  - PROVIDER_GROUP_MAP 将 provider 映射为显示组名（如"国内模型"）
  - GROUP_ORDER 控制分组显示顺序，未识别的组排在末尾
- 渲染细节
  - 触发按钮显示当前模型的图标与名称，右侧带设置图标
  - 下拉菜单使用 role="listbox"，每个模型项包含图标、名称，选中态高亮
  - **新增**：底部弹窗包含推荐模型横向卡片与全部模型纵向列表，选中项带边框与勾选标识

**章节来源**
- [ModelSelector.tsx:18-55](file://src/components/common/ModelSelector.tsx#L18-L55)
- [ModelSelector.tsx:184-230](file://src/components/common/ModelSelector.tsx#L184-L230)
- [ModelSelector.tsx:245-317](file://src/components/common/ModelSelector.tsx#L245-L317)
- [ModelBottomSheet.tsx:267-279](file://src/components/common/ModelBottomSheet.tsx#L267-L279)
- [ModelBottomSheet.tsx:440-479](file://src/components/common/ModelBottomSheet.tsx#L440-L479)

### 交互行为与键盘导航
- 打开/关闭
  - 点击按钮切换 open 状态；compact 模式直接打开底部弹窗
  - 外部点击（mousedown）与 ESC 键关闭菜单
- 定位计算
  - 使用 useLayoutEffect + requestAnimationFrame 测量按钮位置，计算上下可用空间，选择最佳 placement
  - 监听 resize 与 scroll 事件重新计算，确保菜单始终可见
- 列表交互
  - 非 compact 模式：点击模型项调用 onModelChange 并关闭菜单
  - **新增**：compact 模式：底部弹窗内支持多页面导航，选择模型或角色后调用相应回调并关闭弹窗
- 可访问性
  - 列表使用 role="listbox"，便于屏幕阅读器识别
  - 按钮具备清晰的语义与焦点样式

**章节来源**
- [ModelSelector.tsx:106-178](file://src/components/common/ModelSelector.tsx#L106-L178)
- [ModelSelector.tsx:118-158](file://src/components/common/ModelSelector.tsx#L118-L158)
- [ModelSelector.tsx:295-313](file://src/components/common/ModelSelector.tsx#L295-L313)
- [ModelBottomSheet.tsx:204-212](file://src/components/common/ModelBottomSheet.tsx#L204-L212)

### 价格信息与能力显示
- 价格信息
  - Model 类型包含 price.input 与 price.output 字符串字段，用于展示输入/输出单价
  - 当前 ModelSelector 的下拉菜单仅展示图标与名称；如需展示价格，可在 renderModelItem 中扩展 UI
- 能力显示
  - Model 类型包含 inputCapabilities 与 outputCapabilities，可用于能力筛选或提示
  - **新增**：底部弹窗的"所有模型"视图展示模型描述信息，提供更详细的模型介绍

**章节来源**
- [index.ts:109-123](file://src/types/index.ts#L109-L123)
- [models.ts:3-235](file://src/config/models.ts#L3-L235)
- [ModelBottomSheet.tsx:467-469](file://src/components/common/ModelBottomSheet.tsx#L467-L469)

### 实际使用示例
- 在顶部导航栏中使用紧凑模式，并传递高级功能开关
  - 传入 models、selectedModel、onModelChange
  - compact 设为 true，同时传入 webSearchEnabled、onWebSearchToggle、artifactEnabled、onArtifactToggle
  - **新增**：传入 roles、selectedRoleId、onRoleSelect、onRolesChanged 以启用角色管理功能
  - 参考路径：[TopNavBar.tsx:89-98](file://src/components/layout/TopNavBar.tsx#L89-L98)
- 在非紧凑模式下使用下拉菜单
  - 传入 models、selectedModel、onModelChange，compact 保持默认 false
  - 菜单将自动定位并渲染分组列表

**章节来源**
- [TopNavBar.tsx:89-112](file://src/components/layout/TopNavBar.tsx#L89-L112)
- [ModelSelector.tsx:69-104](file://src/components/common/ModelSelector.tsx#L69-L104)

### 自定义样式与主题适配
- CSS 变量
  - 组件大量使用 CSS 变量（如 --color-accent、--color-bg-elevated、--color-text-tertiary 等）进行主题化
  - 可通过全局样式覆盖这些变量以适配不同主题
- 深色图标背景
  - 针对 OpenAI、xAI、Xiaomi 等 provider，使用白色半透明圆形背景提升对比度
- 响应式布局
  - 紧凑模式使用底部弹窗，适合移动端；非紧凑模式使用固定定位下拉菜单，适合桌面端
- **新增**：动画样式
  - 定义了完整的页面切换动画类，支持前进和后退方向的滑入滑出效果
- 扩展建议
  - 若需展示价格或能力，可在 renderModelItem 中添加额外 UI，并使用现有 CSS 变量保持一致风格

**章节来源**
- [ModelSelector.tsx:209-227](file://src/components/common/ModelSelector.tsx#L209-L227)
- [ModelSelector.tsx:291-293](file://src/components/common/ModelSelector.tsx#L291-L293)
- [ModelBottomSheet.tsx:250-297](file://src/components/common/ModelBottomSheet.tsx#L250-L297)
- [index.css:459-517](file://src/index.css#L459-L517)

## 依赖关系分析
- 组件依赖
  - ModelSelector 依赖 ModelBottomSheet（compact 模式）、React DOM Portal、Lucide 图标
  - ModelBottomSheet 依赖 BottomSheet（基础弹窗容器）、Lucide 图标、角色管理数据库
- 数据依赖
  - 模型数据来自 models.ts，类型定义来自 types/index.ts
  - **新增**：角色数据来自 roleRepo.ts，提供 CRUD 操作
- 使用方依赖
  - TopNavBar 作为使用方，传入必要 props 并处理状态更新

```mermaid
classDiagram
class ModelSelector {
+props : models, selectedModel, onModelChange, compact, webSearchEnabled, onWebSearchToggle, artifactEnabled, onArtifactToggle, roles, selectedRoleId, onRoleSelect, onRolesChanged
+toggle()
+close()
+renderModelItem(model)
}
class ModelBottomSheet {
+props : isOpen, onClose, models, selectedModel, onModelChange, webSearchEnabled, onWebSearchToggle, artifactEnabled, onArtifactToggle, roles, selectedRoleId, onRoleSelect, onRolesChanged
+handleModelSelect(modelId)
+navigate(target)
+goBack()
+renderRecommendedView()
+renderAllModelsView()
+renderRolesView()
+renderCreateRoleView()
}
class RoleRepository {
+createRole(systemPrompt)
+deleteRole(id)
+listRoles()
}
class ModelsConfig {
+CHAT_MODELS
+IMAGE_MODELS
+getModelsByType(type)
}
class Types {
+Model
+RoleData
}
ModelSelector --> ModelBottomSheet : "compact 模式使用"
ModelBottomSheet --> RoleRepository : "角色管理"
ModelSelector --> ModelsConfig : "读取模型数据"
ModelSelector --> Types : "类型约束"
ModelBottomSheet --> Types : "类型约束"
```

**图表来源**
- [ModelSelector.tsx:1-6](file://src/components/common/ModelSelector.tsx#L1-L6)
- [ModelBottomSheet.tsx:1-5](file://src/components/common/ModelBottomSheet.tsx#L1-L5)
- [roleRepo.ts:1-72](file://src/db/roleRepo.ts#L1-L72)
- [models.ts:275-284](file://src/config/models.ts#L275-L284)
- [index.ts:109-123](file://src/types/index.ts#L109-L123)

**章节来源**
- [ModelSelector.tsx:1-6](file://src/components/common/ModelSelector.tsx#L1-L6)
- [ModelBottomSheet.tsx:1-5](file://src/components/common/ModelBottomSheet.tsx#L1-L5)
- [roleRepo.ts:1-72](file://src/db/roleRepo.ts#L1-L72)
- [models.ts:275-284](file://src/config/models.ts#L275-L284)
- [index.ts:109-123](file://src/types/index.ts#L109-L123)

## 性能考量
- 定位计算优化
  - 使用 useLayoutEffect 与 requestAnimationFrame 确保 DOM 完全渲染后再测量，减少重排
  - 监听 resize 与 scroll 事件时及时清理，避免内存泄漏
- 动画与卸载
  - 打开时通过两次 rAF 触发进入动画；关闭时延迟卸载 DOM，保证动画完成
  - **新增**：页面切换动画使用 CSS transform 和 opacity，确保 GPU 加速和流畅性能
- 列表渲染
  - 分组与排序仅在必要时执行，避免频繁重算
  - **新增**：推荐模型列表预计算，避免重复查找
- 建议
  - 若模型数量较大，可考虑虚拟滚动或分页加载
  - 图标资源建议使用缓存策略，减少重复请求
  - **新增**：角色数据变化时使用增量更新，避免全量刷新

**章节来源**
- [ModelSelector.tsx:106-158](file://src/components/common/ModelSelector.tsx#L106-L158)
- [ModelSelector.tsx:106-116](file://src/components/common/ModelSelector.tsx#L106-L116)
- [ModelBottomSheet.tsx:194-202](file://src/components/common/ModelBottomSheet.tsx#L194-L202)

## 故障排查指南
- 菜单被遮挡或溢出
  - 检查父容器是否存在 overflow:hidden 影响定位；组件已使用 fixed 定位与 portal 解决
  - 确认窗口尺寸变化后是否正确重新计算定位
- 图标不显示
  - 确认 public/providers/ 目录下存在对应 SVG 文件
  - 检查 BASE_URL 环境变量是否正确
- 选中态异常
  - 确认 selectedModel 与 models 中的 id 一致
  - 检查 onModelChange 是否正确更新父级状态
- 紧凑模式开关无效
  - 确认 compact 为 true 且传入了必要的 webSearchEnabled/onWebSearchToggle、artifactEnabled/onArtifactToggle
- **新增**：角色管理问题
  - 确认 roles 数组正确传递给组件
  - 检查 onRoleSelect 和 onRolesChanged 回调是否正确实现
  - 验证 IndexedDB 连接是否正常，角色数据是否正确存储
- **新增**：页面导航问题
  - 确认页面状态管理正常工作
  - 检查动画类是否正确应用到 DOM 元素
  - 验证 navigate 和 goBack 函数的调用时机

**章节来源**
- [ModelSelector.tsx:118-158](file://src/components/common/ModelSelector.tsx#L118-L158)
- [ModelSelector.tsx:160-178](file://src/components/common/ModelSelector.tsx#L160-L178)
- [ModelSelector.tsx:18-55](file://src/components/common/ModelSelector.tsx#L18-L55)
- [ModelBottomSheet.tsx:143-192](file://src/components/common/ModelBottomSheet.tsx#L143-L192)
- [roleRepo.ts:37-72](file://src/db/roleRepo.ts#L37-L72)

## 结论
ModelSelector 提供了灵活、可复用的模型选择能力，支持桌面与移动端两种交互形态，具备良好的可访问性与主题适配能力。**最新重大更新**：ModelBottomSheet 组件经过全面重构，现在提供完整的四页面导航系统，包括推荐模型、所有模型、角色管理和角色创建视图，并实现了平滑的滑动动画效果。通过最小化的 props 接口与清晰的分组展示逻辑，开发者可以快速集成到不同场景中，并根据需求扩展价格与能力信息的展示。

## 附录：使用示例与主题适配
- 基本用法（非紧凑模式）
  - 传入 models、selectedModel、onModelChange，compact 保持默认 false
  - 菜单将自动定位并渲染分组列表
- 紧凑模式（移动端）
  - 设置 compact 为 true，并传入 webSearchEnabled、onWebSearchToggle、artifactEnabled、onArtifactToggle
  - **新增**：传入 roles、selectedRoleId、onRoleSelect、onRolesChanged 以启用角色管理功能
  - 底部弹窗将展示推荐模型与全部模型，支持开关控制和角色管理
- 主题适配
  - 通过 CSS 变量覆盖颜色与背景，确保与整体主题一致
  - 深色图标 provider 自动使用白色背景提升可读性
  - **新增**：利用定义的动画类实现自定义页面切换效果

**章节来源**
- [TopNavBar.tsx:89-112](file://src/components/layout/TopNavBar.tsx#L89-L112)
- [ModelSelector.tsx:69-104](file://src/components/common/ModelSelector.tsx#L69-L104)
- [ModelSelector.tsx:245-317](file://src/components/common/ModelSelector.tsx#L245-L317)
- [ModelBottomSheet.tsx:184-369](file://src/components/common/ModelBottomSheet.tsx#L184-L369)
- [index.css:459-517](file://src/index.css#L459-L517)