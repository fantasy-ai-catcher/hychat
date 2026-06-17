# 消息时间戳(Ctrl+T 切换)

## 目标

聊天消息默认不显示时间。按 **Ctrl+T** 切换"显示/隐藏"每条消息前的暗色时间戳,
时间用**北京时间**。再次按 Ctrl+T 隐藏。

## 为什么这么设计

- 终端 TUI 没有鼠标 hover,⌘ 修饰键也传不进 stdin,只有 Ctrl 系修饰键可靠。
- `App.tsx` 的 `useInput` 已区分 `key.ctrl`,`Ctrl+T` 天然不跟输入字母 `t` 冲突。
- 默认隐藏、按需切换,保持界面干净(符合"简单优先")。

## 改动

1. **Layer 1(纯函数,先写测试)**:`src/ui/state.ts` 加
   `formatBeijingTime(iso: string): string`,把 ISO 时间转成北京时间 `HH:MM`
   (用 `Intl.DateTimeFormat` + `timeZone: 'Asia/Shanghai'`,与系统时区无关、可确定性测试)。
   非法输入返回 `''`。
2. **Layer 2(UI)**:`src/ui/App.tsx`
   - 新增 `useState` 布尔 `showTimestamps`(默认 `false`)。
   - `useInput` 里加分支:`key.ctrl && value === 't'` → 翻转,`return`(在打字分支之前)。
   - `MessageViewport` 接收 `showTimestamps`,为真时在每条消息前渲染暗色 `HH:MM`。

## 验证

- `pnpm typecheck` + `pnpm test`(含 formatBeijingTime 单测)。
- `pnpm dev:tmux` 冒烟:发消息→按 Ctrl+T 看时间出现/消失、确认还能正常打字母 t。

## 已知取舍 / 终端限制

- 时间戳格式为 `MM-DD HH:MM`(北京时间),跨天也能分清。
- "字更小":终端是等宽固定字号,无法缩小局部文字。改用 `dimColor`(变暗)
  让它弱于正文,这是终端里"更次要"的等价表达。
- "按住才显示、松开消失":终端不上报抬键事件,做不到。沿用 Ctrl+T 开关切换。
