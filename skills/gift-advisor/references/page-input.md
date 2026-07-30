# Gift Page Input

Write `<project-dir>/gift-plan.json` with `schemaVersion: 1`. The generator validates the complete contract against `schemas/gift-plan.schema.json`.

## Required structure

```json
{
  "schemaVersion": 1,
  "title": "给林小姐的生日礼物提案",
  "subtitle": "实用、安静，也保留一点共同记忆",
  "generatedAt": "2026-07-28T10:00:00.000Z",
  "locale": "zh-CN",
  "recipient": {
    "displayName": "林小姐",
    "relationship": "伴侣",
    "occasion": "生日",
    "location": "杭州",
    "interests": ["手冲咖啡", "周末徒步"]
  },
  "budget": {
    "currency": "CNY",
    "min": 300,
    "max": 800
  },
  "intent": "希望她感到被认真观察，而不是收到一件昂贵但无关的东西。",
  "constraints": ["不送香水", "不送需要长期订阅的产品"],
  "portrait": {
    "facts": ["她每天自己手冲咖啡", "周末更喜欢两三人的短途活动"],
    "inferences": [
      {
        "preference": "重视参与过程",
        "evidence": "会自己调磨豆和水温",
        "implication": "适合可探索但不增加明显负担的礼物"
      }
    ],
    "unknowns": ["是否已经有高精度咖啡秤"],
    "disclaimer": "这是一份基于可观察信息的送礼判断，不是心理诊断。"
  },
  "strategies": [
    {
      "id": "daily-ritual",
      "label": "日常仪式",
      "tagline": "把高频小事变得更好",
      "rationale": "回应她对过程和质感的投入。"
    },
    {
      "id": "shared-memory",
      "label": "共同记忆",
      "tagline": "留下一次可回看的经历",
      "rationale": "不增加家中物品负担。"
    }
  ],
  "recommendations": [
    {
      "id": "coffee-scale",
      "strategyId": "daily-ritual",
      "rank": 1,
      "title": "带计时的精密咖啡秤",
      "category": "咖啡器具",
      "productFamily": "咖啡秤",
      "price": { "currency": "CNY", "min": 320, "max": 520 },
      "summary": "让她常用的手冲流程更稳定，但不会替代她喜欢的参与感。",
      "fitReasons": ["对应每天手冲的高频习惯", "兼顾研究参数和直接使用"],
      "watchouts": ["购买前确认她现有咖啡秤型号"],
      "personalization": ["附一张你记录她常用配方的小卡片"],
      "fitScore": 94,
      "product": {
        "brand": "TIMEMORE",
        "model": "Basic 2.0 Electronic Espresso Scale",
        "label": "前往 TIMEMORE 官方商品页",
        "url": "https://www.timemore.com/products/timemore-basic-2-0-electronic-espresso-scale-with-timer",
        "merchant": "TIMEMORE 官方商城",
        "checkedAt": "2026-07-28",
        "availability": "核验时可加入购物车",
        "listedPrice": {
          "currency": "USD",
          "amount": 55,
          "display": "US$55"
        },
        "priceNote": "人民币区间为页面美元标价的估算，运费和税费以结账页为准。",
        "image": {
          "url": "https://cdn.shopify.com/s/files/1/0642/9153/7138/files/basic2_6a5e72d4-4a6c-4965-af06-a229184744c3.png?v=1713174597",
          "alt": "TIMEMORE Basic 2.0 黑色电子咖啡秤官方商品图",
          "sourceUrl": "https://www.timemore.com/products/timemore-basic-2-0-electronic-espresso-scale-with-timer",
          "checkedAt": "2026-07-28"
        }
      }
    }
  ],
  "deliveryPlan": [
    {
      "step": "01",
      "title": "先确认重复风险",
      "detail": "自然询问她现有咖啡秤是否需要升级。"
    }
  ],
  "sources": [
    {
      "title": "TIMEMORE Basic 2.0 Electronic Espresso Scale",
      "url": "https://www.timemore.com/products/timemore-basic-2-0-electronic-espresso-scale-with-timer",
      "publisher": "TIMEMORE",
      "checkedAt": "2026-07-28"
    }
  ]
}
```

## Required product evidence

Every recommendation requires `product`. The product page, image source, and matching `sources` row must use the same check date. Record the visible listed price separately from the recommendation's budget-currency range:

```json
{
  "brand": "TIMEMORE",
  "model": "Basic 2.0 Electronic Espresso Scale",
  "label": "前往 TIMEMORE 官方商品页",
  "url": "https://www.timemore.com/products/timemore-basic-2-0-electronic-espresso-scale-with-timer",
  "merchant": "TIMEMORE 官方商城",
  "checkedAt": "2026-07-28",
  "availability": "核验时可加入购物车",
  "listedPrice": {
    "currency": "USD",
    "amount": 55,
    "display": "US$55"
  },
  "priceNote": "人民币区间为页面美元标价的估算，运费和税费以结账页为准。",
  "image": {
    "url": "https://cdn.shopify.com/s/files/1/0642/9153/7138/files/basic2_6a5e72d4-4a6c-4965-af06-a229184744c3.png?v=1713174597",
    "alt": "TIMEMORE Basic 2.0 黑色电子咖啡秤官方商品图",
    "sourceUrl": "https://www.timemore.com/products/timemore-basic-2-0-electronic-espresso-scale-with-timer",
    "checkedAt": "2026-07-28"
  }
}
```

All URLs must use public HTTPS. The generator rejects missing products, placeholder hosts, duplicated product or image URLs, source/date mismatches, and unverified local addresses. `fitScore` is a comparison aid, not a probability. Keep it between 0 and 100.
