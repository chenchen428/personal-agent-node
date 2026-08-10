# Photo to Zine Postcard

**中文** · [English](README_EN.md)

把你拍摄的照片转换成一套极简、留白充足、带手绘二创元素的 Zine 风格明信片。

这个仓库提供一份可直接复用的 [`SKILL.md`](SKILL.md)，用于指导 ChatGPT 将一张照片生成一套统一的明信片正反面：

- **正面** — 上方完整嵌入原始照片并保持原图比例；下方保留大量留白，生成一个来源明确的手绘主元素、极简元数据和 3 个取自原图的色块。
- **背面** — 使用统一、可书写的明信片布局，包括邮票区、分割线、地址线和留言区域。

<table>
  <tr>
    <td><a href="assets/forest-homestead.png"><img src="assets/forest-homestead.png" alt="Forest Homestead" /></a></td>
    <td><a href="assets/alpine-glow.png"><img src="assets/alpine-glow.png" alt="Alpine Glow" /></a></td>
    <td><a href="assets/turquoise-lake.png"><img src="assets/turquoise-lake.png" alt="Turquoise Lake" /></a></td>
  </tr>
  <tr>
    <td><a href="assets/green-door.png"><img src="assets/green-door.png" alt="Green Door" /></a></td>
    <td><a href="assets/blue-arc-lake.png"><img src="assets/blue-arc-lake.png" alt="Blue Arc Lake" /></a></td>
    <td><a href="assets/turquoise-basin.png"><img src="assets/turquoise-basin.png" alt="Turquoise Basin" /></a></td>
  </tr>
  <tr>
    <td><a href="assets/lake-at-dusk.png"><img src="assets/lake-at-dusk.png" alt="Lake at Dusk" /></a></td>
    <td><a href="assets/college-garden.png"><img src="assets/college-garden.png" alt="College Garden" /></a></td>
    <td><a href="assets/valley-current.png"><img src="assets/valley-current.png" alt="Valley Current" /></a></td>
  </tr>
</table>

以上为当前的 9 个官方案例，覆盖森林、雪山、湖泊、航拍、建筑、花园和黄昏等不同场景。点击图片可查看原图。

## 快速开始

1. 把这个仓库提供给 ChatGPT，或者直接上传 [`SKILL.md`](SKILL.md)。
2. 上传一张你拍摄的照片。
3. 输入：

```text
请读取这个仓库里的 SKILL.md，并把它作为唯一的设计规范。
把我上传的照片生成一套 Photo to Zine Postcard 明信片正反面。
```

如果 ChatGPT 无法直接访问仓库，也可以下载 `SKILL.md`，与照片一起上传。

## 设计原则

Photo to Zine Postcard 目前遵循 5 个核心原则：

1. **原始照片优先**：原图始终是明信片的视觉主体。
2. **保持原始比例**：不拉伸、不随意裁切、不重新绘制上方照片。
3. **大量留白**：不把画面填满，保持安静、克制的编辑设计感。
4. **只选择一个强主元素**：优先提取最有视觉吸引力、最能代表原图的元素。
5. **优先手绘二创**：适合时，将主元素转换成克制的水彩 / 水粉 / 墨线 / 拼贴式手绘效果；不适合时再使用原图裁切。

目标不是生成一张普通的 AI 海报，而是建立一套适合个人摄影作品的、可打印的明信片系统。

## 默认输出

- 纵向 `2:3`
- 参考成品尺寸：`100 × 150 mm / 4 × 6 in`
- 暖白 / 象牙白纸张背景
- 上方直接嵌入原始照片
- 下方一个主要手绘元素
- 可选一个小型辅助元素
- 固定 3 个取自原图的色块
- 一张统一、可书写的明信片背面
- 最高细节质量，适合后续 4× 超分辨率放大

## 如何定制自己的版本

这个仓库本身就是为了方便 Fork 和二次创作而设计的。

你可以修改：

- 手绘 / 插画风格
- 纸张纹理
- 字体和排版语言
- 明信片比例
- 标题、地点、日期等元数据布局
- 正反面结构
- 主元素选择策略
- 色块规则

建议先阅读 [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md)。如果改动较大，更推荐创建独立 variant，而不是不断给默认 Skill 增加规则。

## 官方案例

当前案例包括：

- [Forest Homestead](assets/forest-homestead.png)
- [Alpine Glow](assets/alpine-glow.png)
- [Turquoise Lake](assets/turquoise-lake.png)
- [Green Door](assets/green-door.png)
- [Blue Arc Lake](assets/blue-arc-lake.png)
- [Turquoise Basin](assets/turquoise-basin.png)
- [Lake at Dusk](assets/lake-at-dusk.png)
- [College Garden](assets/college-garden.png)
- [Valley Current](assets/valley-current.png)

案例索引见 [`examples/README.md`](examples/README.md)。

## 仓库结构

```text
photo-to-zine-postcard/
├── SKILL.md
├── README.md
├── README_EN.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── docs/
│   └── CUSTOMIZATION.md
├── examples/
│   └── README.md
└── assets/
    ├── forest-homestead.png
    ├── ...            # 其余语义化命名的官方案例
    └── README.md
```

## 当前版本

**v1.0.0** — Photo to Zine Postcard 首个公开版本。

当前版本主要针对 ChatGPT 图片生成进行优化，同时强调清晰边缘、精细纹理和低噪点，方便后续进行 4× 超分辨率放大。

## 参与贡献

欢迎提交 PR、改进默认 Skill，或者贡献新的衍生风格。详见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## License

MIT License，详见 [`LICENSE`](LICENSE)。
