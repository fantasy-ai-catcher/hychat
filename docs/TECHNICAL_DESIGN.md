# HyChat Technical Design

版本：0.1  
日期：2026-06-06  
目标运行环境：Node.js terminal client + Supabase backend

## 1. 技术选型

### 1.1 Client

1. Node.js 22 LTS 或更新版本。
2. TypeScript。
3. pnpm，用于包管理和脚本运行。
4. `@supabase/supabase-js` v2，用于 Auth、Data API 和 Realtime。
5. Ink + React，用于 terminal UI。
6. `zod`，用于环境变量、命令参数和外部 API 响应校验。
7. `commander`，用于 CLI 启动参数。
8. `dotenv`，用于本地开发环境变量。
9. 用户目录下 `.hychat/session.json`，用于 MVP 保存 Supabase session；后续可切到 `keytar` 或系统钥匙串。
10. Vitest，用于单元测试。

### 1.2 Backend

1. Supabase Postgres，用于房间、成员、消息、watchlist 和股票缓存。
2. Supabase Auth，用于用户认证。
3. Supabase Row Level Security，用于房间级权限。
4. Supabase Realtime Postgres Changes，用于 MVP 的消息和 watchlist 更新通知。
5. Supabase Realtime Broadcast/Presence，作为后续在线状态、typing 状态和更大规模房间的升级方向。
6. Supabase Edge Functions，用于调用第三方股票 API。注意 Edge Functions 使用 Deno TypeScript runtime，这是 Supabase 平台约束。
7. Supabase Cron，用于可选预刷新股票缓存、清理孤儿缓存和后续消息清理。
8. Supabase CLI，用于本地开发、migration、Edge Function 和数据库验收。

### 1.3 外部服务

股票数据通过 adapter 接入。当前默认 provider 为 Yahoo Finance（免密钥）。

选型结论：

1. 默认使用 Yahoo Finance 的 `v8/finance/chart` 免密钥接口查询美股、港股、A 股和日股，零额外成本，单一数据源覆盖四个市场。
2. 接口无需 API key；Edge Function 仅依赖标准 Supabase secrets。
3. terminal client、数据库 watchlist 和聊天功能只使用内部 canonical symbol，由 adapter 负责映射到 Yahoo symbol（US 无后缀、`.HK`、`.SS`/`.SZ`、`.T`）。
4. Yahoo 为非官方接口，可能限流或变更；若港股/A 股不稳定，可加 Sina/Tencent 作为 fallback；若要求更强实时行情，可切换 Longbridge / Futu。

Provider 候选：

| Provider | 适用性 | 优势 | 劣势 | 当前决策 |
| --- | --- | --- | --- | --- |
| Yahoo Finance | 高 | 免密钥，单源覆盖美股/港股/A 股/日股，HTTP 简单，适合 Edge Function | 非官方接口，可能限流/变更/封 IP | 当前默认 |
| Twelve Data | 中 | HTTP API 简单，官方 | 免费档偏美股，港股/A 股/日股多为付费 | 已弃用 |
| Longbridge | 高 | 覆盖 US/HK/CN，有 Node SDK，实时行情能力更强 | 需要账号、行情权限和更复杂的鉴权 | 实时行情升级首选 |
| Futu/moomoo | 中高 | 港美 A 覆盖强，实时能力强 | 通常需要 OpenD 网关，不适合直接放进 Edge Function | 备选 |
| Financial Modeling Prep | 中 | 基本面和财务数据强，全球覆盖 | 港股/A 股通常需要更高付费档，报价覆盖需逐项验证 | 财务数据补充 |
| Alpha Vantage | 中低 | 免费/低价起步，历史和日线容易接入 | 频率限制和实时能力不适合 watchlist 高频刷新 | 备选 fallback |
| EODHD | 中低 | EOD/历史数据成本友好 | 港股覆盖和实时能力不适合作唯一 provider | 历史数据备选 |
| Polygon | 低 | 美股数据质量好 | 不能统一覆盖港股/A 股 | 不作为三地统一 provider |

文档依据：

1. Yahoo Finance（非官方）：`https://query1.finance.yahoo.com/v8/finance/chart/<symbol>`，参考实现见 yfinance 库
2. Longbridge OpenAPI：https://open.longbridge.com/
3. Futu OpenAPI：https://openapi.futunn.com/
4. Financial Modeling Prep pricing：https://site.financialmodelingprep.com/developer/docs/pricing
5. Alpha Vantage documentation：https://www.alphavantage.co/documentation/
6. EODHD exchange list：https://eodhd.com/financial-apis/exchanges-list/
7. Polygon Stocks API：https://polygon.io/stocks

## 2. Supabase 文档依据

本设计参考了 Supabase 当前文档和 2026 年变更：

1. Realtime 支持 Broadcast、Presence 和 Postgres Changes，聊天是官方适用场景。文档：https://supabase.com/docs/guides/realtime
2. Supabase 建议数据库变化订阅优先使用 Broadcast，Postgres Changes 更简单但扩展性较弱。文档：https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
3. `supabase-js` v2 是 Node.js client 的核心依赖。文档：https://supabase.com/docs/reference/javascript/installing
4. Data API 需要显式 grant，RLS 决定行级访问。文档：https://supabase.com/docs/guides/api/securing-your-api
5. 2026-04-28 Supabase changelog 说明新表不再默认暴露给 Data API，需要显式 `GRANT`。变更：https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
6. Edge Functions 可用于第三方集成和 secrets 管理。文档：https://supabase.com/docs/guides/functions 和 https://supabase.com/docs/guides/functions/secrets
7. Supabase Cron 可用 cron 语法执行 SQL、数据库函数或 HTTP 请求。文档：https://supabase.com/docs/guides/cron

## 3. 方案选项

### 3.1 方案 A：Postgres Changes 直连订阅

client 写入 `messages` 表，再直接订阅 `messages` 的 Postgres Changes。

优点：

1. 实现最少，适合最快 MVP。
2. 不需要额外 trigger 和 Realtime authorization topic 设计。

缺点：

1. Supabase 文档明确说明扩展性弱于 Broadcast。
2. 房间 topic 和授权模型不如 Broadcast 清晰。

### 3.2 方案 B：Broadcast-first

client 写入 Postgres，数据库 trigger 通过 Broadcast 推送消息和 watchlist 变化。

优点：

1. 符合 Supabase 当前推荐方向。
2. private topic 更适合房间级授权。
3. 后续扩展消息类型、watchlist 更新和 quote 更新更统一。

缺点：

1. 初始 migration 更复杂。
2. 需要同时维护数据表 RLS 和 Realtime authorization。

### 3.3 方案 C：自建 Node.js WebSocket 服务

Node.js 服务处理 WebSocket、聊天消息和股票刷新，Supabase 只做数据库和 Auth。

优点：

1. 全部后端逻辑可保持 Node.js runtime。
2. 对 WebSocket 行为有完全控制。

缺点：

1. 运维复杂度更高。
2. 重复实现 Supabase Realtime 已提供的能力。
3. MVP 目标下收益不足。

当前 MVP：采用方案 A（Postgres Changes 直连订阅），因为它能最快交付可用聊天和 watchlist 同步，并且仍然受表级 RLS 约束。

后续推荐升级：采用方案 B（Broadcast-first）。它比方案 A 稍复杂，但权限边界、presence、typing 和大房间扩展更稳；相比方案 C，能最大化利用 Supabase 托管能力。

## 4. 架构概览

```text
Terminal Client
  | Auth/Data API/Postgres Changes
  v
Supabase API Gateway
  |-------------------- Auth
  |-------------------- Postgres + RLS
  |-------------------- Realtime Postgres Changes
  |-------------------- Edge Functions
                            |
                            v
                       Stock Provider API

Optional Supabase Cron -> Edge Function refresh-stock-quotes -> Postgres stock_quotes
```

设计原则：

1. terminal client 只持有 Supabase publishable key 或兼容期 anon key。
2. terminal client 不直接访问股票供应商。
3. MVP 所有写入先进入 Postgres，再由 Postgres Changes 通知订阅者。
4. 所有私密数据访问都经过 RLS。
5. 股票行情失败不影响聊天主流程。

## 5. 数据模型

### 5.1 profiles

保存用户展示信息。入口为邮箱 OTP 登录（新账号需邀请码），底层使用 Supabase Auth。
身份是邮箱；display_name 是与身份解耦的显示名，可改、不要求唯一。

字段：

```text
id uuid primary key references auth.users(id)
email text unique  -- 历史遗留字段，恒为 null（真实邮箱在 auth.users）
display_name text not null  -- 显示名，可重复（无唯一索引），首次默认取邮箱 @ 前缀
display_color text not null default 'white'
role text not null check (role in ('admin', 'member'))
status text not null check (status in ('active', 'disabled'))
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

访问规则：

1. 用户可读取同房间成员的 profile。
2. 用户不能直接写 profiles 表：登录后建档走 `ensure_profile(invite_code)` RPC，
   改显示名走 `set_display_name` RPC，改颜色走 `update_profile_color` RPC。
3. 第一个建立的 profile 成为 admin，其余用户必须携带有效邀请码注册。

### 5.1b invite_codes

保存 admin 生成的一次性邀请码。

字段：

```text
id uuid primary key default gen_random_uuid()
code text not null unique
created_by uuid not null references auth.users(id)
used_by uuid references auth.users(id)
used_at timestamptz
expires_at timestamptz not null default now() + interval '30 days'
room_id uuid references rooms(id) on delete cascade  -- 历史字段，新码恒为 null
created_at timestamptz not null default now()
```

访问规则：

1. 启用 RLS 且不创建 policy，客户端不能直接读写。
2. 生成走 `create_invite_code()` RPC：只生成全局账号注册码，仅 admin 可调。
   （房间码已废弃；房间开放后无需把人拉进房间。）
3. 消费在 `ensure_profile(invite_code)` RPC 内完成：校验未用且未过期，标记已用。
4. `list_invite_codes()` 列出自己发的码（admin 可见全部），
   `revoke_invite_code(code)` 撤销未使用的码。

### 5.2 rooms

保存聊天室。

字段：

```text
id uuid primary key default gen_random_uuid()
name text not null
owner_id uuid not null references auth.users(id)
message_retention_days int not null default 30
message_retention_min_count int not null default 5000
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

`message_retention_*` 供 `cleanup_old_messages` 使用：只删除同时满足
“早于 retention_days”且“超出最近 min_count 条”的消息，即每个房间始终
至少保留最近 min_count 条。

访问规则：

1. rooms 表 RLS 仍限成员/owner 可读（进房后才读房间内容）。
2. owner 可更新房间名。
3. 房间发现走 `list_rooms_with_counts()` RPC（SECURITY DEFINER）：返回所有
   房间 + 成员数 + 当前用户是否已加入，绕过 RLS 实现"开放发现"。

### 5.3 room_members

保存房间成员关系。

字段：

```text
room_id uuid not null references rooms(id) on delete cascade
user_id uuid not null references auth.users(id) on delete cascade
role text not null check (role in ('owner', 'member'))
created_at timestamptz not null default now()
primary key (room_id, user_id)
```

访问规则：

1. 成员可读取同房间成员列表。
2. 自助加入走 `join_room(target_room_id)` RPC（SECURITY DEFINER，幂等）：任意
   活跃用户可把自己加入任意房间，role 固定为 `member`。房间开放，无需邀请。
3. owner 可移除 member（创建房间时 owner 通过现有 policy 把自己加为成员）。
4. owner 不能移除自己，除非先转让 owner。MVP 可以不做转让。

### 5.4 messages

保存聊天消息。

字段：

```text
id uuid primary key default gen_random_uuid()
room_id uuid not null references rooms(id) on delete cascade
sender_id uuid not null references auth.users(id)
sender_display_name text not null  -- 插入时由 trigger 冗余写入
sender_display_color text not null default 'white'  -- 同上
kind text not null check (kind in ('text', 'system'))
body text not null check (char_length(body) <= 2000)
metadata jsonb not null default '{}'
created_at timestamptz not null default now()
```

索引：

```text
(room_id, created_at desc)
(sender_id, created_at desc)
```

访问规则：

1. 成员可读取所在房间消息。
2. 成员可向所在房间插入自己的消息。
3. 普通用户不可更新或删除消息。删除能力放到后续版本。
4. 服务端 trigger 限制发送频率：每 sender 每 10 秒最多 10 条，超出
   抛 `rate_limited`。

语义说明：`sender_display_name` 和 `sender_display_color` 是发送时由
trigger 写入的快照（IRC 风格）。用户之后改名或改色不会回写历史消息，
这是有意决策：聊天记录保留当时的身份呈现，避免读路径 join 和实时
payload 复杂化。`/members` 与新消息始终显示最新显示名/颜色。

### 5.5 room_watchlist

保存房间共享股票列表。

字段：

```text
room_id uuid not null references rooms(id) on delete cascade
canonical_symbol text not null
added_by uuid not null references auth.users(id)
created_at timestamptz not null default now()
primary key (room_id, canonical_symbol)
```

访问规则：

1. 成员可读取所在房间 watchlist。
2. 成员可添加或移除 canonical symbol。
3. canonical symbol 统一存储为大写，格式见 Stock Provider Adapter 章节。

### 5.6 stock_quotes

保存股票当前报价缓存。该表不是历史行情表，每个 canonical symbol 只保留一行最新报价，刷新时通过 upsert 覆盖旧值。表规模只随不同 symbol 数量增长，不随时间增长。

字段：

```text
canonical_symbol text primary key
market text not null check (market in ('US', 'HK', 'CN'))
provider_symbol text not null
provider_exchange text
mic_code text
name text
currency text
price numeric
change numeric
change_percent numeric
market_time timestamptz
provider text not null
provider_payload jsonb not null default '{}'
status text not null check (status in ('ok', 'stale', 'error'))
error_message text
cache_expires_at timestamptz not null
last_refresh_attempt_at timestamptz
updated_at timestamptz not null default now()
```

访问规则：

1. 成员只能读取自己房间 watchlist 中 canonical symbol 对应的 quote。
2. terminal client 不直接写入 quote。
3. Edge Function 使用 secret key 或受控数据库函数写入 quote。
4. 不创建 `stock_quote_history` 表，MVP 不保存历史行情。

缓存规则：

1. MVP 默认 `STOCK_QUOTE_CACHE_TTL_SECONDS=60`。
2. cache hit：`now() < cache_expires_at` 且 `status = 'ok'` 时直接返回缓存。
3. cache miss：缓存不存在、过期或用户强制刷新时调用 provider。
4. stale fallback：provider 失败但旧缓存存在时返回旧报价，并把响应状态标记为 `stale` 或 `error`。
5. `provider_payload` 只保留排障必要字段，不保存完整 provider 原始响应。
6. 对不再属于任何 room watchlist 且 `updated_at` 超过 7 天的缓存行，可以由 Cron 清理。

配额防护（防止 provider 免费额度被打爆）：

7. force 节流：`force = true` 但该 symbol 在
   `STOCK_QUOTE_FORCE_MIN_INTERVAL_SECONDS`（默认 30s）内刚刷新过且
   缓存可用时，忽略 force 直接返回缓存。
8. 失败退避：每次 provider 调用（含失败）都更新
   `last_refresh_attempt_at`；距上次尝试不足
   `STOCK_QUOTE_FAILURE_RETRY_SECONDS`（默认 15s）时不再打 provider，
   返回 stale 行。该窗口同时平滑了多成员同时进房间造成的并发踩踏。

## 6. RLS 和 Data API 权限

所有 `public` schema 表必须：

1. 显式 `GRANT` 需要的权限给 `authenticated`。
2. 启用 RLS。
3. 创建按房间成员关系约束的 policy。
4. 不给 `anon` 访问私密数据的权限。

示例策略方向：

```sql
-- messages select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = (select auth.uid())
  )
);

-- messages insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = (select auth.uid())
  )
);
```

安全要求：

1. 不使用 `auth.role()` 判断登录状态，policy 使用 `TO authenticated`。
2. 不基于用户可编辑的 `user_metadata` 做授权。
3. 不在 terminal client 暴露 service role 或 secret key。
4. migration 中把 grant、RLS、policy 作为一组变更提交。

## 7. Realtime 设计

### 7.1 聊天消息

推荐实现：

1. client 调用 Data API 插入 `messages`。
2. Postgres trigger 调用 `realtime.broadcast_changes()`。
3. 房间成员订阅 private topic，例如 `room:<room_id>:messages`。
4. Realtime authorization policy 校验订阅用户是否属于该房间。
5. client 收到 broadcast 后更新本地消息流。

验收方法：

1. 启动两个账号进入同一房间。
2. A 发送消息。
3. B 在 2 秒内收到 broadcast 并展示消息。
4. 非成员尝试订阅 topic 失败。

### 7.2 在线状态

使用 Presence channel：

1. channel topic：`room:<room_id>:presence`。
2. track payload 包含 `user_id`、`display_name`、`active_at`。
3. typing 状态通过 Broadcast event `typing` 发送，不落库。

验收方法：

1. A 和 B 同时在线时，双方在线列表包含两人。
2. B 退出后，A 的在线列表移除 B。
3. A 输入时，B 能看到 typing 状态，停止输入后自动消失。

### 7.3 Watchlist 和 quote 更新

当前实现（方案 A，postgres_changes）：

1. `room_watchlist` 和 `stock_quotes` 都加入 `supabase_realtime`
   publication。
2. 房间 channel 同时订阅 messages（按 room_id 过滤）、room_watchlist
   （按 room_id 过滤）和 stock_quotes（无法按房间过滤，由 RLS 把行
   限制在订阅者 watchlist 内）。
3. watchlist 变化触发房间数据重载；quote 变化直接更新本地
   `quotesBySymbol`。

验收方法：

1. A 添加 symbol 后，B 的股票面板自动出现该 symbol。
2. A `/refresh` 后，B 不做任何操作也能看到新价格。

## 8. Stock Provider Adapter

股票 provider 必须被隔离在 Supabase Edge Function 内部。terminal client、数据库 watchlist、消息命令和 UI 只处理内部 canonical symbol。

### 8.1 Canonical Symbol

内部 symbol 格式：

```text
<CODE>.<MARKET>
```

当前支持：

| 输入示例 | Canonical symbol | Market | Yahoo symbol |
| --- | --- | --- | --- |
| `AAPL`, `AAPL.US` | `AAPL.US` | `US` | `AAPL` |
| `TSLA.US` | `TSLA.US` | `US` | `TSLA` |
| `0700.HK` | `0700.HK` | `HK` | `0700.HK` |
| `9988.HK` | `9988.HK` | `HK` | `9988.HK` |
| `600519.CN` | `600519.CN` | `CN` | `600519.SS` |
| `000001.CN` | `000001.CN` | `CN` | `000001.SZ` |
| `7203.JP` | `7203.JP` | `JP` | `7203.T` |

规则：

1. 用户输入统一 trim、uppercase。
2. 美股允许省略 `.US`，但港股、A 股和日股必须带后缀（`.HK` / `.CN` / `.JP`），避免数字代码歧义。日股代码当前仅支持 4 位数字。
3. A 股 exchange 先按代码前缀推断，再通过 provider symbol search 校验。无法确认时返回候选列表，不直接添加 watchlist。
4. 数据库永远保存 canonical symbol，不保存用户原始输入作为主键。
5. provider symbol、exchange、mic_code 作为 quote metadata 保存，切换 provider 时可重新映射。

### 8.2 Adapter Interface

Edge Function 内部维护 provider adapter。接口目标是隔离 API 差异、限流、错误码和字段格式。

```ts
type Market = 'US' | 'HK' | 'CN';

type CanonicalSymbol = `${string}.${Market}`;

type NormalizedSymbol = {
  canonicalSymbol: CanonicalSymbol;
  market: Market;
  providerSymbol: string;
  providerExchange?: string;
  micCode?: string;
  displayName?: string;
};

type StockQuote = {
  canonicalSymbol: CanonicalSymbol;
  market: Market;
  providerSymbol: string;
  providerExchange?: string;
  micCode?: string;
  name?: string;
  currency?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  marketTime?: string;
  provider: string;
  status: 'ok' | 'stale' | 'error';
  errorMessage?: string;
  providerPayload?: unknown;
};

interface StockProviderAdapter {
  id: string;
  normalize(input: string): Promise<NormalizedSymbol[]>;
  getQuote(symbol: NormalizedSymbol): Promise<StockQuote>;
  getQuotes(symbols: NormalizedSymbol[]): Promise<StockQuote[]>;
}
```

实现要求：

1. `normalize()` 可以返回多个候选，UI 负责让用户选择。
2. `getQuotes()` 可以内部降级为逐个调用，但必须统一处理限流和重试。
3. adapter 返回统一 `StockQuote`，Edge Function 再写入 `stock_quotes`。
4. `provider_payload` 只保存排障必要字段，不保存完整 provider 原始响应，也不参与 UI 主展示字段。
5. provider 错误必须转换为统一错误类型，例如 `rate_limited`、`not_found`、`market_not_supported`、`provider_unavailable`。

### 8.3 Yahoo Finance Adapter

当前实现 `yahoo_finance` adapter（`_shared/stocks/yahoo.ts`），免密钥。

配置：

```text
STOCK_PROVIDER=yahoo_finance
```

能力：

1. 覆盖美股、港股、A 股、日股，单源 `v8/finance/chart` 接口。
2. 将 canonical symbol 映射到 Yahoo symbol（US 无后缀、`.HK`、`.SS`/`.SZ`、`.T`），请求带浏览器 `User-Agent`。
3. 用 `regularMarketPrice` 与 `chartPreviousClose` 计算 `change` / `changePercent`。
4. `chart.error` 或缺少价格时抛错，由 `resolveStockQuotes` 回退到 stale 缓存。
5. 返回结果写入统一 `stock_quotes` 表。

验收方法：

1. `getQuote('AAPL.US')` 请求 `/v8/finance/chart/AAPL`。
2. `getQuote('0700.HK')` 请求 `/v8/finance/chart/0700.HK`。
3. `getQuote('600519.CN')` 请求 `.SS`，`000001.CN` 请求 `.SZ`。
4. `getQuote('7203.JP')` 请求 `/v8/finance/chart/7203.T`。
5. 上述 symbol 返回统一 `StockQuote`，含价格、change% 与 marketTime。

### 8.4 Provider 切换标准

保留 adapter 层后，切换 provider 只允许影响 Edge Function 内部代码和 secrets，不允许影响：

1. terminal 命令格式。
2. `room_watchlist.canonical_symbol`。
3. `stock_quotes` 主展示字段。
4. Realtime quote update payload。
5. 聊天消息格式。

切换触发条件：

1. Twelve Data 免费/付费额度无法满足 watchlist 刷新。
2. 用户明确要求港股/A 股盘中实时行情。
3. 需要 provider 不支持的市场数据，例如更完整的财务指标或 Level 1/Level 2 实时行情。
4. provider SLA 或稳定性无法满足使用。

切换验收：

1. 替换 `STOCK_PROVIDER` 和对应 secret 后，`/watch add AAPL.US`、`/watch add 0700.HK`、`/watch add 600519.CN` 仍然工作。
2. 已存在 watchlist 不需要 migration。
3. `stock_quotes.provider` 记录新 provider。
4. terminal UI 不需要修改。

## 9. Edge Functions

### 9.1 get-stock-quotes

职责：

1. 接收 canonical symbol 列表或 room_id。
2. 校验用户 JWT，并确认用户可访问相关 room 或 symbol 所属 watchlist。
3. 读取 `stock_quotes` 当前缓存。
4. 对 cache hit 直接返回缓存。
5. 对 cache miss、过期缓存或 `force = true` 的 symbol 调用 Stock Provider adapter。
6. 校验 provider 响应并 upsert `stock_quotes`。
7. provider 失败时优先返回旧缓存作为 stale fallback；没有旧缓存时返回错误。

输入：

```json
{
  "symbols": ["AAPL.US", "0700.HK", "600519.CN"],
  "force": false
}
```

输出：

```json
{
  "quotes": [
    {
      "symbol": "AAPL.US",
      "price": 123.45,
      "changePercent": 1.23,
      "cacheStatus": "hit"
    },
    {
      "symbol": "0700.HK",
      "price": 456.7,
      "changePercent": -0.5,
      "cacheStatus": "refreshed"
    }
  ],
  "failed": [{"symbol": "600519.CN", "reason": "rate_limited"}]
}
```

安全：

1. 股票 provider API key 放在 Supabase function secrets。
2. function 日志不得打印 API key 或完整 provider payload 中的敏感字段。
3. function 内部校验调用者 JWT，并要求 `profiles.status = 'active'`。
   未完成 profile（未登录或未注册）的用户不能触发 provider 查询。
4. 不做 per-symbol 的 watchlist 归属校验：`/stock <symbol>` 允许查询
   任意 symbol，已激活用户都是受信的小群体成员。报价本身不是私密数据，
   这里防护的是 provider 配额滥用。
5. 单次请求 symbol 数量上限 50，拒绝空列表和非法 symbol 类型。

验收方法：

1. 第一次使用测试 canonical symbol 调用 function，触发 provider 查询并 upsert `stock_quotes`。
2. 在 TTL 内再次查询同一 symbol，返回 `cacheStatus = "hit"`，不调用 provider。
3. TTL 过期后再次查询，触发刷新并覆盖同一行缓存。
4. provider 失败且旧缓存存在时返回 stale fallback，聊天不受影响。
5. 本地和远端日志中不出现股票 API key。

### 9.2 refresh-stock-quotes

职责：

1. 给手动刷新和可选 Cron 使用。
2. 接收 canonical symbol 列表或 room_id。
3. 设置 `force = true` 调用 `get-stock-quotes` 的刷新逻辑。
4. 只覆盖 `stock_quotes` 当前缓存，不新增历史记录。

## 10. Supabase Cron

股票报价定时刷新策略：

1. MVP 可以不启用报价 Cron，只在用户打开 watchlist、执行 `/stock` 或 `/refresh` 时按需刷新。
2. 如果启用报价 Cron，每 5-15 分钟扫描 active watchlist canonical symbols。
3. 将 symbol 分批调用 `refresh-stock-quotes`。
4. 根据 provider 限流控制并发和批量大小。
5. 失败时保留旧报价并标记 stale 或 error。
6. Cron 不写入历史行情，只更新 `stock_quotes` 当前缓存。
7. 每天清理一次孤儿缓存：删除不再出现在 `room_watchlist` 且 `updated_at` 早于 7 天的 `stock_quotes` 行。

验收方法：

1. 未启用报价 Cron 时，`/stock AAPL.US` 可按需刷新缓存。
2. 启用报价 Cron 后，创建 watchlist 并等待一个 cron 周期，quote 自动更新。
3. provider 失败时 `stock_quotes.status` 更新为 `error` 或保持 `stale`。
4. cron job 单次执行不超过 Supabase 建议的运行时间边界。

## 11. Terminal UI 设计

### 11.1 页面结构

```text
+--------------------------------------------------------------+
| HyChat / room-name                                            |
| members: liudong (owner, rose)  alice (member, cyan)  +N more |
| stocks:  AAPL.US 123.45 +1%   TSLA.US 234.56 -2%              |
+--------------------------------------------------------------+
| message list                                                  |
|                                                                |
+--------------------------------------------------------------+
| input: hello world                                             |
| status bar: session / connection / command feedback            |
+--------------------------------------------------------------+
```

实现说明：当前实现把成员和股票信息放在顶部 info panel 而不是右侧
sidebar，窄 terminal 下更稳定。成员区有固定行数预算，超出部分显示
`+N more`，完整列表通过 `/members` 查看。

已知限制（Ink 全屏渲染的固有代价）：消息区只显示最近若干条，终端
原生滚动缓冲区被接管，用户无法回滚查看更早消息。候选出路：
(a) 自管滚动状态 + 翻页快捷键；(b) 改为追加打印 + 底部输入行的
非全屏模式，牺牲布局换取原生 scrollback。两者都超出 MVP 范围，
列入后续扩展。

### 11.2 状态管理

client 内部状态：

1. `authSession`
2. `rooms`
3. `activeRoom`
4. `messages`
5. `presence`
6. `watchlist`
7. `quotes`
8. `connectionStatus`

### 11.3 命令解析

普通文本发送为消息。以 `/` 开头的输入进入命令解析。

命令验收：

1. `/help` 展示可用命令。
2. `/watch add AAPL` 插入 watchlist。
3. `/stock AAPL` 展示详情。
4. `/quit` 正常关闭 Realtime channel 并退出进程。

## 12. 错误处理

1. Auth 失败：展示登录失败原因，允许重试。
2. Realtime 断线：展示连接状态，并自动重连。
3. 消息发送失败：保留输入或展示失败消息，允许重发。
4. RLS 拒绝：展示权限不足，不展示内部 SQL 信息。
5. 股票 API 限流：展示 stale quote 和错误状态，不影响聊天。
6. terminal 尺寸过小：进入简化布局，只显示消息和输入框。

## 13. 测试和验收计划

### 13.1 单元测试

工具：Vitest。

覆盖：

1. 命令解析。
2. symbol 标准化和校验。
3. quote provider response parser。
4. 本地状态 reducer。
5. 错误消息映射。
6. provider adapter contract。

验收：

```text
pnpm test
```

所有单元测试通过。

### 13.2 数据库测试

工具：Supabase CLI local development。

覆盖：

1. migration 可重复执行。
2. RLS 允许成员读取房间数据。
3. RLS 拒绝非成员读取房间数据。
4. 成员只能以自己的 `sender_id` 插入消息。
5. stock_quotes 只对相关房间成员可见。
6. 同一股票代码在不同 market 下不会主键冲突。

验收：

1. 本地 Supabase 启动成功。
2. seed 两个用户和一个房间。
3. 使用不同 JWT 执行查询，结果符合权限预期。

### 13.3 手动端到端验收

准备：

1. 创建 Supabase project 或启动本地 Supabase。
2. 配置 `.env.local`。
3. 创建两个测试账号。
4. 创建一个房间并把两个账号加入 room_members。

流程：

1. 打开 terminal A，以用户 A 登录并进入房间。
2. 打开 terminal B，以用户 B 登录并进入同一房间。
3. A 发送消息，B 实时收到。
4. B 发送消息，A 实时收到。
5. A 输入但不发送，B 看到 typing 状态。
6. A 执行 `/watch add AAPL.US`，B 的股票侧栏同步更新。
7. A 执行 `/watch add 0700.HK`，B 的股票侧栏同步更新。
8. A 执行 `/watch add 600519.CN`，B 的股票侧栏同步更新。
9. A 执行 `/stock AAPL.US`，展示 quote 详情。
10. 模拟股票 provider 失败，聊天仍可继续。
11. B 退出，A 在线成员列表更新。

通过标准：

1. 全流程不需要离开 terminal。
2. 非授权账号无法读取该房间消息。
3. 股票失败和 Realtime 重连都有可理解的 UI 状态。

## 14. 实施顺序

1. 初始化 Node.js TypeScript 项目和基础 CLI。
2. 添加 Supabase 本地配置和 migration。
3. 实现 Auth 和 session 持久化。
4. 实现房间列表和进入房间。
5. 实现 messages 表、RLS 和历史消息加载。
6. 实现 Realtime Broadcast 聊天。
7. 实现 Presence 和 typing。
8. 实现 watchlist 表、canonical symbol 和命令。
9. 实现 Stock Provider adapter contract。
10. 实现 Twelve Data adapter 和手动刷新。
11. 实现按需刷新，并把 Cron 作为可选缓存预刷新和孤儿缓存清理。
12. 补齐测试和端到端验收脚本。

当前实现状态（2026-06-15）：

1. 已完成 Node.js TypeScript 项目骨架、环境变量解析、命令解析、canonical symbol、quote cache policy。
2. 已完成 Supabase migration、RLS policy、清理函数、邮箱 OTP 登录（email OTP + `ensure_profile` RPC），显示名与身份解耦、可改（`set_display_name`，`/name`）。
3. 已完成 `get-stock-quotes` Edge Function（含 JWT 与 active profile 校验、force 节流、失败退避）、Twelve Data adapter 和当前报价缓存。
4. 已完成 Ink terminal UI（顶部 info panel 布局）、消息历史、Realtime postgres_changes 实时收发（消息、watchlist、quote，方案 A）、本地 session 持久化和 `--profile` 多账号（外加 `scripts/dev-login.mjs` / `pnpm dev:tmux` 免 OTP 本地多账号测试）。
5. 已完成 profile 颜色（`/color` 系列命令、彩色成员列表和消息显示名）。
6. 已完成开放房间：`list_rooms_with_counts()` 发现、`join_room()` 自助加入；邀请码改为只发全局账号注册码（`create_invite_code()`、`/invite-code list|revoke`，已移除 `/invite` 和房间码）；`/logout confirm` 二次确认、消息频率限制 trigger。
7. 尚未实现：Presence 在线状态和 typing（§7.2）、`refresh-stock-quotes` Edge Function（§9.2）、Supabase Cron 调度（§10，清理函数已存在但无调度）、消息内 `$SYMBOL` 识别、`/stock` 详情视图（目前只展示价格和涨跌幅摘要）、消息区回滚/翻页（§11 已知限制）。
8. Broadcast-first（方案 B）尚未启动，`realtime.ts` 中的 messages/presence topic helper 为该升级预留。

## 15. 后续扩展

1. 消息搜索。
2. 消息删除和编辑。
3. 股票小图表或 ASCII sparkline。
4. 多房间通知。
5. 预注册邀请链接。
6. Web 只读展示页。
7. 更细的 owner/admin 权限。
8. Longbridge 或 Futu provider adapter。
