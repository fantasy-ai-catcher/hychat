# HyChat User Setup TODO

日期：2026-06-06

这个文件列出需要你手动完成的事项。代码不会把 Supabase service role key 或股票 API key 放到 terminal client。

## 1. 准备账号和工具

1. 注册或登录 Supabase：https://supabase.com/
2. 创建一个 Supabase project。
3. 安装 Supabase CLI，并登录：

```bash
supabase login
```

4. 股票报价使用 Yahoo Finance 的免密钥接口，无需注册或申请 API key。

## 2. 配置 Supabase 项目

1. 在 Supabase Dashboard 的 Auth 设置里启用 Anonymous Sign-Ins。
2. 在项目根目录连接远程 Supabase project：

```bash
supabase link --project-ref <your-project-ref>
```

3. 推送数据库 migration：

```bash
supabase db push
```

4. 部署股票报价 Edge Function：

```bash
supabase functions deploy get-stock-quotes
```

5. （可选）调整 Edge Function 报价缓存 TTL。Yahoo 接口无需 API key：

```bash
supabase secrets set STOCK_QUOTE_CACHE_TTL_SECONDS=60
```

不要把 `SUPABASE_SERVICE_ROLE_KEY` 写入本地 `.env`。它只应该由 Supabase Edge Function 在服务端使用。

## 3. 配置本地环境变量

HyChat 会按以下优先级读取配置：

1. shell 已设置的环境变量。
2. 当前目录 `.env`。
3. `~/.config/hychat/.env`。

开发时可以复制 env 模板：

```bash
cp .env.example .env
```

Homebrew 安装后建议使用用户配置目录：

```bash
mkdir -p ~/.config/hychat
cp .env.example ~/.config/hychat/.env
```

在 `.env` 或 `~/.config/hychat/.env` 中填写：

```text
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
STOCK_PROVIDER=yahoo_finance
STOCK_QUOTE_CACHE_TTL_SECONDS=60
```

`SUPABASE_PUBLISHABLE_KEY` 可在 Supabase Dashboard 的 Project Settings -> API Keys 中获取。旧项目如果只有 `anon` key，MVP 也可以临时填入 anon key。

普通 HyChat 用户不需要 email/password。客户端会使用 Supabase Anonymous Auth 创建匿名用户，并用 `profiles.display_name` 作为聊天昵称。

## 4. 本地运行

```bash
pnpm install
pnpm test -- --run
pnpm typecheck
pnpm build
pnpm dev
```

## 5. 手动验收流程

打开第一个 terminal，初始化你自己的 profile。直接 `/start` 会使用本机用户名，例如 `/Users/liudong` 会默认用 `liudong`：

```text
/start
```

也可以显式指定昵称：

```text
/start liudong
```

首次激活的 profile 会成为 admin。然后创建房间：

如果你之前已经用旧版本注册过测试用户，新 migration 会把最早的 active profile 提升为 admin，避免没有人能生成邀请码。

```text
/create Friends
```

生成一个给朋友用的邀请码：

```text
/invite-code
```

打开第二个 terminal，朋友使用昵称和邀请码激活：

```text
/start alice <invite-code>
```

第一个 terminal 用朋友昵称把朋友加入房间：

```text
/invite alice
```

第二个 terminal 刷新房间并进入：

```text
/rooms
/join Friends
```

聊天验收：

```text
hello from account one
```

股票验收：

```text
/watch add AAPL.US
/watch add 0700.HK
/watch add 600519.CN
/refresh
/stock TSLA.US
```

昵称颜色验收：

```text
/color
/color list
/color set rose
```

设置后，新的聊天消息里昵称会使用对应颜色展示。可选颜色保存在 `profiles.display_color`，历史消息会保留发送时的颜色。

退出登录：

```text
/logout
```

## 6. 免费额度和清理

股票数据只缓存最新报价，不保存历史行情。聊天消息会入库，migration 已提供清理函数：

```sql
select public.cleanup_old_messages(1000);
select public.cleanup_orphan_stock_quotes();
```

如果你想自动清理，可以在 Supabase Dashboard 里创建 Cron job，定期执行上面两个 SQL 函数。MVP 默认每个房间保留最近 30 天或至少 5000 条消息，具体受 `rooms.message_retention_days` 和 `rooms.message_retention_min_count` 控制。

## 7. 现有限制

1. MVP 使用 Supabase Postgres Changes 做实时同步，Broadcast/Presence 和 typing 状态后续再升级。
2. 股票 provider 当前默认 Yahoo Finance（免密钥），代码已有 provider/cache 抽象，后续可以切 Longbridge、Futu 或其他 API。
3. terminal client 只使用 publishable/anon key，不应持有 service role key。
4. Homebrew 分发和 tap 发布步骤见 `todo/HOMEBREW_DISTRIBUTION.md`。
