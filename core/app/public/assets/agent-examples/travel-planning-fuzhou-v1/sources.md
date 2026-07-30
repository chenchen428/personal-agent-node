# 福州老城水岸行程来源记录

状态：`historical-example`

本代表产物使用脱敏的历史规划数据展示信息结构，不包含实时高德查询快照、
真实姓名、订单号或凭据。页面中的距离、时长、价格、营业与天气信息不能作为
当前出行依据。

## 正式任务使用的来源

| 事实 | 首选来源 | 本样例状态 |
| --- | --- | --- |
| POI 身份、地址、坐标 | 高德 POI 搜索 Web 服务 | 待用 `amap-travel-routing` 重跑 |
| 相邻路段距离与时长 | 高德路径规划 Web 服务 | 历史估算 |
| 火车班次与票价 | 中国铁路 12306 | 历史估算 |
| 景点开放与预约 | 景区、文旅或运营方官方渠道 | 待复核 |
| 游船班次 | 运营方官方渠道 | 待复核 |
| 天气与预警 | 官方气象与预警渠道 | 待复核 |
| 餐厅与酒店营业 | 选定门店官方渠道与地图详情 | 门店待消歧 |

## 高德官方文档

- POI 搜索：<https://lbs.amap.com/api/webservice/guide/api/search/>
- 路径规划：<https://lbs.amap.com/api/webservice/guide/api/direction>
- 创建 Web 服务 Key：
  <https://lbs.amap.com/api/webservice/create-project-and-key>

正式产物应在 `amap/` 目录保存不含 Key 的规范化查询快照，并在出发前
重新查询路线关键段。
