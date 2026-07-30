# 高德 Web 服务查询合同

## 目录

- [服务与凭据](#服务与凭据)
- [POI 查询](#poi-查询)
- [路线查询](#路线查询)
- [规范化快照](#规范化快照)
- [错误与降级](#错误与降级)

## 服务与凭据

- 创建 Web 服务 Key：
  <https://lbs.amap.com/api/webservice/create-project-and-key>
- POI 搜索：
  <https://lbs.amap.com/api/webservice/guide/api/search/>
- 路径规划：
  <https://lbs.amap.com/api/webservice/guide/api/direction>
- 路径规划 2.0：
  <https://lbs.amap.com/api/webservice/guide/api/newroute>

本合同于 2026-07-30 对照以上官方文档。高德要求 Web 服务 API Key；
只从 `--key-file` 指向的本地忽略文件读取。不要把 Key 值写进仓库、命令行
参数、生成页面、来源记录或错误日志；Key 文件应位于客户 Workspace 的
`secrets/` 目录。

输入和输出统一按 UTF-8 处理。高德坐标为 GCJ-02，参数顺序为
`经度,纬度`。不要把 WGS-84 点位当成 GCJ-02 直接送入查询，也不要在
没有明确坐标系的情况下静默转换。

## POI 查询

脚本使用：

```text
GET https://restapi.amap.com/v3/place/text
```

至少提供 `keywords` 或 `types`。脚本强制要求旅行地点同时提供 `city`，
并默认使用 `citylimit=true`；只有明确需要跨城候选时才可设为 `false`。
官方文档建议在需要精确区县时使用 `adcode`。

可保存的最小字段：

```json
{
  "id": "provider POI id",
  "name": "display name",
  "address": "provider address",
  "location": "longitude,latitude",
  "type": "provider category path",
  "typecode": "provider type code",
  "cityname": "city",
  "adname": "district"
}
```

同名分店、景区入口、火车站进出站口、酒店门店和大型园区必须消歧。
选择结果时记录候选数量和选择依据；不能只因排序第一就视为正确。

## 路线查询

脚本使用高德官方基础路径接口：

| 模式 | 接口 |
| --- | --- |
| 步行 | `/v3/direction/walking` |
| 公交 | `/v3/direction/transit/integrated` |
| 驾车 | `/v3/direction/driving` |
| 骑行 | `/v4/direction/bicycling` |

所有模式必须提供 `origin` 与 `destination`。公交还必须提供起点城市
`city`，跨城时补充 `cityd`。脚本只保留最多三条候选路线和用于行程判断
的摘要字段，不保存 Key。

官方文档明确提示：道路、数据和算法会变化，相同起终点隔一段时间可能
返回不同结果。因此快照必须带 `queriedAt`；未来日期的路线不能写成实时
路况结论。

## 规范化快照

每次输出包含：

```json
{
  "schemaVersion": 1,
  "provider": "amap",
  "operation": "poi | route",
  "queriedAt": "ISO-8601",
  "request": {},
  "result": {}
}
```

`request` 只保留可公开复核的查询条件，不含 Key、签名、设备标识或用户
位置历史。`result` 只保留规划所需字段。原始响应可能包含会变化或与任务
无关的数据，不默认整包落盘。

## 错误与降级

- Key 缺失：停止实时查询，输出可复核的 dry-run 请求，不生成假结果。
- POI 多义：返回候选，要求规划方基于地址、类型和上下文选择。
- 路线无结果：保留失败状态，尝试合理的替代交通模式或调整点位。
- 配额或权限错误：报告官方错误码，不重复快速重试消耗配额。
- 网络错误：保留未核验状态；网页可展示高德搜索/导航入口，但不能把入口
  本身当作查询证据。
- 页面交付：只嵌入规范化快照和公开导航链接，不在浏览器端调用带 Key 的
  Web 服务。
