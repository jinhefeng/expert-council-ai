# Version History

这个文件专门记录手动标记的可回退版本。

以后当你说“标记一下”“存档一下”“这个版本先保存”，我会：

1. 确认当前工作区状态。
2. 必要时先提交当前改动。
3. 创建一个清晰的 Git tag。
4. 把 tag、提交号、说明和日期记录到这里。

## How To Roll Back

查看所有标记版本：

```bash
git tag --list "checkpoint-*"
```

临时查看某个版本：

```bash
git switch --detach <tag-name>
```

把项目回到某个版本：

```bash
git reset --hard <tag-name>
```

注意：`git reset --hard` 会丢弃当前未保存改动。真正回退前我会先检查并提醒你。

## Checkpoints

| Date | Tag | Commit | Summary | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-21 00:23 CST | `checkpoint-neutral-collapsible-ui` | `dde0a64` | 中性灰白 UI 改版与左右面板折叠版本 | Apple 字体、侧栏压暗、收起/展开面板、取消专家数量限制；`lint` 和 TypeScript 通过 |
| 2026-05-20 23:39 CST | `checkpoint-before-ui-redesign` | `bc7a7a9` | UI 大改前的聊天布局与附件交互版本 | 已验证本地页面可访问，工作区干净 |
