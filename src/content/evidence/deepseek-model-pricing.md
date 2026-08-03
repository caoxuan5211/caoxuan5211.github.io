+++
date = '2026-08-03T10:00:00+08:00'
draft = false
title = 'DeepSeek 模型定价'
tags = ['DeepSeek', 'API', 'AI', '定价']
categories = ['AI']
+++

# DeepSeek 模型定价

DeepSeek API 按 token 计费，价格单位是“每 100 万 tokens”（1M tokens）。token 是模型识别文本的最小单位，可以是一个词、一个数字或一个标点符号；实际费用按模型输入和输出的总 token 数计算。

截至 2026-08-03，DeepSeek 官方 API 文档中的两个主要模型是 `deepseek-v4-flash` 和 `deepseek-v4-pro`，两者都支持 1M 上下文，最大输出 384K，并默认开启思考模式（thinking mode）。

| 模型 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
| --- | ---: | ---: | ---: |
| `deepseek-v4-flash` | $0.0028 | $0.14 | $0.28 |
| `deepseek-v4-pro` | $0.003625 | $0.435 | $0.87 |

上表价格均为每 1M tokens 的美元价格。以 `deepseek-v4-flash` 为例，一次请求消耗 100K 输入（未命中缓存）和 20K 输出，费用约为 `0.14 × 0.1 + 0.28 × 0.02 = 0.0196` 美元，也就是不到 2 美分。

## 缓存命中为什么便宜

DeepSeek 支持上下文缓存（context caching）。多轮对话或重复使用相同系统提示词、工具定义、长文档前缀时，命中缓存的部分会按“缓存命中”价格计费，成本可以大幅下降。

`deepseek-v4-flash` 的缓存命中价只有未命中价的约 1/50，`deepseek-v4-pro` 约 1/120。因此，如果业务中有大量重复前缀，尽量把稳定的内容放在请求前部，并保持 prompt 结构一致，更容易命中缓存。

## 高峰低谷定价

官方文档还预告了高峰/低谷定价政策：高峰期价格可能是常规价格的 2 倍，适用于所有计费项。高峰时段为北京时间每天 9:00–12:00 和 14:00–18:00，具体生效日期以 DeepSeek 官方公告为准。

对成本敏感的应用，可以在政策落地后把批量任务安排到非高峰时段，或者用缓存命中来对冲高峰期的输入成本。

## 扣费规则

费用 = token 数 × 单价，会直接从充值余额或赠送余额中扣除。两者都存在时，系统会优先使用赠送余额。

DeepSeek 保留调整价格的权利，实际价格以官方页面为准：

- [DeepSeek API 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [Context Caching](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)
