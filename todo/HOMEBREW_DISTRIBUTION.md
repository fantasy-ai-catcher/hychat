# Homebrew Distribution TODO

日期：2026-06-07

目标：把 HyChat 作为 Homebrew CLI 分发。当前代码已经支持生成 release tarball、sha256 和 Formula。

## 1. 你需要准备的账号和仓库

1. GitHub 账号。
2. 主项目仓库，例如 `github.com/<owner>/hychat`。
3. Homebrew tap 仓库，推荐命名为 `github.com/<owner>/homebrew-hychat`。
4. 确认项目许可证。当前代码默认使用 MIT，已写入 `LICENSE`、`package.json` 和 Formula 模板。

## 2. 生成发布物

在主项目仓库运行：

```bash
GITHUB_REPOSITORY=<owner>/hychat pnpm pack:brew
```

如果 release asset URL 不是默认 GitHub release URL，可以显式指定：

```bash
HOMEBREW_TARBALL_URL=https://example.com/hychat-0.1.0.tgz pnpm pack:brew
```

生成结果：

```text
dist/releases/hychat-0.1.0.tgz
dist/homebrew/hychat.rb
```

脚本会自动计算 tarball 的 sha256，并写入 Formula。

## 3. 发布 GitHub Release

1. 创建 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

2. 在 GitHub Release `v0.1.0` 上传：

```text
dist/releases/hychat-0.1.0.tgz
```

3. 确认 release asset URL 和 `dist/homebrew/hychat.rb` 中的 `url` 一致。

## 4. 发布 Homebrew tap

在 tap 仓库中创建：

```text
Formula/hychat.rb
```

内容复制自：

```text
dist/homebrew/hychat.rb
```

提交并推送 tap：

```bash
git add Formula/hychat.rb
git commit -m "Add hychat 0.1.0"
git push
```

## 5. 验证 Homebrew 安装

用户安装：

```bash
brew tap <owner>/hychat
brew install hychat
hychat --version
hychat doctor
```

维护者在 tap 仓库中可以运行：

```bash
ruby -c Formula/hychat.rb
brew audit --strict hychat
brew test hychat
```

注意：当前 Homebrew 版本不允许直接 `brew audit` 本地路径 Formula，必须在 tap 中按 formula name audit。

## 6. Homebrew 安装后的运行配置

安装完成后，用户不需要项目源码目录。创建用户配置：

```bash
mkdir -p ~/.config/hychat
cat > ~/.config/hychat/.env <<'EOF'
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
STOCK_PROVIDER=twelve_data
STOCK_QUOTE_CACHE_TTL_SECONDS=60
EOF
```

然后运行：

```bash
hychat doctor
hychat
```

## 7. 升级流程

1. 修改 `package.json` 版本号。
2. 运行完整验证：

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
GITHUB_REPOSITORY=<owner>/hychat pnpm pack:brew
```

3. 创建新的 tag 和 GitHub Release。
4. 上传新的 `dist/releases/hychat-<version>.tgz`。
5. 把新的 `dist/homebrew/hychat.rb` 复制到 tap 仓库。
6. 在本机测试：

```bash
brew update
brew upgrade hychat
hychat --version
```

## 8. 当前代码已完成的 Homebrew 支持

1. `hychat --version` 不依赖运行时 env，可作为 Formula `test do`。
2. `hychat doctor` 可检查 Supabase env 是否完整。
3. `~/.config/hychat/.env` 支持 Homebrew 安装后的用户级配置。
4. `pnpm pack:brew` 生成 npm-style tarball、sha256 和 Formula。
5. Formula 模板使用 `std_npm_args` 安装 Node CLI，并把 `libexec/bin/*` symlink 到 Homebrew `bin`。
