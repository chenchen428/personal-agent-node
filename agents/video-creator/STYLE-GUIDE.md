# 视频创作风格指南

这份指南把“风格”定义为可以执行和验收的创作合同，而不是“高级、电影感、科技感”一类模糊形容词。完整参数位于同目录的 `styles.json`。

## 开工前必须完成的风格决定

在 `BRIEF.md` 中记录：

```yaml
style:
  primaryStyleId: pa-continuous-product-story
  secondaryStyleId: null
  selectionReason: 多个真实产品场景，需要建立连续而可信的产品认知
  intentionalDeviations: []
  targetAspectRatio: 16:9
  targetDurationSeconds: 39
```

- 每个项目必须选择一个主风格。
- 只有主风格确实缺少一种必要表达时，才选择一个辅助风格；辅助风格最多影响 25% 的成片。
- 不把三个以上风格拼成“混搭”，也不以“多给几个版本”逃避选型。
- 用户指定风格时，先映射到最接近的风格 ID，再说明不适用或需要偏离的部分。
- 用户未指定时，由视频创作 Agent 按受众、素材、渠道和叙事目标自动选择，并把理由写入简报。
- 修改已有工程时默认继承现有主风格，除非用户明确要求换风格或当前风格与新渠道冲突。

## 七套可用风格

| 风格 ID | 名称 | 最适合 | 核心语法 |
| --- | --- | --- | --- |
| `pa-continuous-product-story` | PA 连续产品叙事 | 多场景产品介绍、品牌短片 | 深色连续画布，真实证据逐级推进，温暖克制 |
| `ui-proof-walkthrough` | 界面证据演示 | 单功能、工作流、产品 demo | 问题 → 操作 → 反馈 → 结果，界面始终是主角 |
| `kinetic-type-launch` | 动势文字发布 | 发布预告、观点短片、社交 teaser | 少量强文案、清楚层级、文字与节拍共同推进 |
| `human-case-documentary` | 人物案例纪实 | 用户故事、客户案例、创作者故事 | 人物 → 阻力 → 产品介入 → 可观察变化 |
| `cinematic-journey` | 电影感旅程 | 横屏旅行片、目的地故事 | 建立 → 移动 → 抵达 → 细节 → 停顿 → 回望 |
| `postcard-memory-collage` | 旅行明信片拼贴 | 照片为主、家庭回忆、旅行日记 | 日期、地点、票据和素材构成有层级的记忆拼贴 |
| `vertical-travel-spark` | 竖屏旅行火花 | Shorts、Reels、竖屏传播 | 前两秒钩子，动作匹配，清晰地名，静音可懂 |

## 默认产品介绍风格

`pa-continuous-product-story` 来自当前 Personal Agent 介绍片，是产品介绍的默认选择。

它不是“黑底加霓虹”的通用科技模板，而是一套叙事约束：

1. 先说明产品是什么、给谁用、如何进入。
2. 每个案例按“用户需要 → PA 支持 → 可见结果”展开。
3. 同一时刻只保留一个主要信息层级。
4. 真实界面、真实输入和真实产物是画面证据，光效和抽象粒子不能替代证据。
5. 场景通过共享对象、位移、缩放、遮罩和空间层级连续变化，不切成互不相关的幻灯片。
6. 不同能力用不同强调色，但背景、字体、圆角、阴影和字幕轨保持一个系统。
7. 声音温暖、低密度，不使用密集提示音制造“智能感”。
8. 结尾既给出品牌主张，也说明一个可以核实的事实或下一步。

如果产品只需要说明一个操作，改用 `ui-proof-walkthrough`；如果主要由一句观点驱动，改用 `kinetic-type-launch`；如果价值必须通过真实人物建立，改用 `human-case-documentary`。

## 产品风格选型

### 界面证据演示

- 一个镜头对应一个操作目标。
- 光标、触点、箭头和放大只负责引导视线，不抢过产品界面。
- 给观众看清操作前状态、动作、反馈和结果。
- 功能过多时拆成系列，不制作一支无法读取的“功能马拉松”。

### 动势文字发布

- 先完成文案再设计动画；每屏只有一个语义单元。
- 通过字号、字重、字距、分行、位置和遮罩建立节奏。
- 同一时间只强调一个关键词。
- 至少保留一处真实产品或真实结果，避免整片只剩口号。

### 人物案例纪实

- 产品退到支持者位置，人物和变化是主线。
- 明确真实采访、事实、推断和创作性重建。
- A-roll 承担人物表达，B-roll 说明地点、动作、工具、细节和结果。
- 不用“纪录片滤镜”伪造真实感。

## 旅行风格选型

### 电影感旅程

- 先建立地点与出发原因，再组织移动、抵达、细节、停顿和离开。
- 拍摄或整理素材时建立 shot list：建立镜头、中景、人物动作、近景细节、环境纹理和现场声。
- 剪辑优先考虑情绪、故事、节奏和视线，其次才是转场花样。
- 尊重原始镜头运动；速度坡、稳定和裁切必须有叙事理由。

### 旅行明信片拼贴

- 适合照片多、短视频少，但日期、地点和人物关系清楚的素材。
- 清晰字体承担事实，手写式字体只承担短感受。
- 同屏同时运动的素材不超过三个。
- 票据、地图、胶带和邮戳只有在支持事实或记忆时才出现。

### 竖屏旅行火花

- 0–2 秒使用片内最强的真实地点或动作，不使用与旅程无关的 clickbait。
- 横屏素材转竖屏前先确定主体安全区，不做机械居中裁切。
- 前快、中间一次呼吸、结尾利落；不要从头到尾同一速度。
- 地名、人物和主线在静音状态也能理解。

## 允许混合的方式

- `pa-continuous-product-story` + `ui-proof-walkthrough`：多场景产品片中，用一小段真实操作证明关键能力。
- `pa-continuous-product-story` + `human-case-documentary`：产品片以真实人物开场，其余回到连续产品画布。
- `cinematic-journey` + `postcard-memory-collage`：横屏旅程中用短拼贴承担时间跳跃。
- `cinematic-journey` + `vertical-travel-spark`：先完成横屏主片，再独立重构竖屏短版；不直接机械裁切。

以下混合默认禁止：

- `kinetic-type-launch` 与 `postcard-memory-collage` 同时作为主语法；
- 高能竖屏节奏直接覆盖人物纪实采访；
- 用产品 UI 风格包装无法确认来源的旅行素材；
- 只改变 LUT、字体或转场名称就声称换了风格。

## 所有风格共享的硬标准

### 叙事和事实

- 每个镜头必须推进情绪、故事、节奏或证据中的至少一项。
- 产品能力、地点、日期、人物、价格和成果不能编造。
- B-roll 必须支持主线，不用漂亮空镜填时间。
- 无旁白版本仍能理解；有人声版本提供完整字幕。

### 视觉和动效

- 转场保持清晰焦点；复杂变化优先保留一个共享对象。
- 动效短促、精确并服务状态变化，不为装饰而动。
- 常规叠字与背景至少达到 4.5:1 对比度；大字至少 3:1。
- 不使用每秒三次以上闪烁。
- 重要信息不能只靠颜色、声音或运动中的任意一种表达。

### 声音

- 人声存在时，音乐和环境声必须明显退后；默认以人声清晰为先。
- 现场声负责建立地点和真实感，不使用素材库声音伪造现场事实。
- 音效只确认重要动作，不为每次出现、移动或完成逐一打点。

### 交付

- 为开场、主要转场、结尾和每种新视觉语法生成审阅快照。
- 检查分辨率、比例、帧率、时长、编码、音轨、响度和文件大小。
- 平台变体是重新构图和重新节奏，不是一次机械裁切。
- 技术门禁通过后，仍明确标记视觉、节奏和品牌表达等待用户最终验收。

## 研究依据

这些资料只用于抽象方法，不授权复制任何品牌资产、文案、界面或具体动画：

- [Apple Human Interface Guidelines · Motion](https://developer.apple.com/design/human-interface-guidelines/motion)：动效应服务理解，反馈短促精确，并提供非动效信息通道。
- [Material Design · Choreography](https://m1.material.io/motion/choreography.html)：复杂转场维持一个焦点，共享对象帮助观众理解空间连续性。
- [Vimeo · Software demo videos](https://vimeo.com/blog/post/software-video-demos)：真实问题和真实界面优先，演示应短而聚焦，标注不能抢过产品。
- [Vimeo · Video storytelling](https://vimeo.com/blog/post/video-storytelling)：故事先于推销，先定义受众、目标和叙事结构。
- [Adobe · Introduction to video editing](https://www.adobe.com/creativecloud/video/discover/edit-a-video.html)：剪辑优先考虑情绪、故事、节奏和视线，社交短片尽早建立钩子。
- [Adobe · B-roll](https://www.adobe.com/creativecloud/video/discover/b-roll.html)：B-roll 用于建立地点、平滑转场和补充意义，拍摄前应建立 shot list。
- [Adobe Learn · Create a travel video](https://www.adobe.com/learn/premiere-pro/web/create-travel-video)：旅行创作从概念、分镜和 shot list 开始，并统一考虑构图、帧率、焦段、颜色和运动。
- [Adobe Learn · Animate text](https://www.adobe.com/learn/after-effects/web/creating-animating-text)：文字动效用于抓住注意、引导视线和推进故事，仍需服从对齐、层级、对比和平衡。
- [W3C WAI · Audio and video content](https://www.w3.org/WAI/media/av/av-content/)：字幕对比度、闪烁、感官冗余和人声/背景音关系属于视频验收。
- [YouTube Help · Shorts upload tips](https://support.google.com/youtube/answer/12921536?hl=en)：竖屏短片按移动端和平台规则独立设计与验证。
