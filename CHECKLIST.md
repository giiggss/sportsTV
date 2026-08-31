# 新增关注对象检查清单

每次新增**球队 / 联赛 / 运动类别**时，按本清单逐项检查。历史上每次新增都出过问题，全是漏改其中某一处导致的。

## 一、新增球队（如：巴黎、拜仁、中国男篮）

### 必改 4 处

| # | 文件 | 位置 | 作用 | 漏改症状 |
|---|------|------|------|---------|
| 1 | `crawler.js` | `TEAMS` 数组加别名 | 队名→key 映射（爬虫打 teams 标记） | 比赛匹配不到，teams=[] |
| 2 | `crawler.js` | `FOLLOW_TEAM_KEYS` 数组 | 每日卡片 + 赛前/比分推送范围 | 卡片和推送里没有 |
| 3 | `index.html` | `TAB_GROUPS` 的 keys | 页签是否渲染 | **页面上看不到标签** |
| 4 | `index.html` | `NAME` 映射 | 标签显示名 | 标签显示 key 原文 |

### 别名要覆盖全部写法（踩过的坑）
- 直播吧赛程用简称：曼联、申花、上港
- 比分接口用官方全称：曼彻斯特联、上海申花、上海海港
- **两者不是互相包含关系**（"曼彻斯特联"里不含"曼联"子串），必须两条都加
- 示例：`['曼联','manutd']` + `['曼彻斯特联','manutd']`

### 验证（node 跑一遍）
```bash
node crawler.js
node -e "const j=require('./data/events.json');const m=j.events.filter(e=>e.teams&&e.teams.includes('新队key'));console.log(m.length,'场')"
```
数量 > 0 才算成功（除非确实近期没比赛）。

## 二、新增联赛页签（如：足协杯、亚冠）

### 必改 3 处

| # | 文件 | 位置 | 漏改症状 |
|---|------|------|---------|
| 1 | `crawler.js` | `FOOTBALL_KEYWORDS` | 比赛被 classify 归到"其他"，足球大类也不显示 |
| 2 | `crawler.js` | `FOOTBALL_SUBS`（支持 `\|` 分隔多别名） | sub 字段为空，子页签为 0 |
| 3 | `index.html` | `TAB_GROUPS` + `NAME` + `SUB_KEYS` **三处都要** | 标签不显示或计数为 0 |

### 踩过的坑
- 赛事可能有别名：亚冠在赛程里叫"亚精英赛"，别名要用 `|` 都列上
- `index.html` 的 `SUB_KEYS` 决定 `matchCategory` 走 sub 匹配逻辑，漏加会落到 `e.category === key` 永远 false

## 三、新增运动类别（如：篮球之于中国男篮）

### 必改 3 处

| # | 文件 | 位置 | 漏改症状 |
|---|------|------|---------|
| 1 | `score.js` | `matchFollowedLive` 的 `s.type` 过滤 | 比分变化推送收不到 |
| 2 | `history.js` | `collectScoreHistory` 的 `s.type` 过滤 | 完赛比分不落盘，历史比分永远缺 |
| 3 | `history.js` | 合成事件的 `category`/`type` 按 sport 区分 | 篮球历史事件混进足球页签 |

## 四、通用铁律（每次改代码都适用）

1. **改完立即验证再提交**：本项目多次出现编辑被回滚（编辑器旧缓冲区覆盖）。提交前必须跑验证脚本确认关键代码行存在，不能只看 Edit 工具返回成功
2. **比分接口字段名**：客队是 `visit_team` / `visit_score`（不是 away_team / away_score）——曾因此历史比分一条都收不到
3. **页签数字为 0 的排查顺序**：数据里 teams 有没有值 → index.html TEAM_KEYS/SUB_KEYS 加没加 → TAB_GROUPS 加没加
4. **数据验证命令**：
```bash
node crawler.js   # 重新生成 data/events.json
# 检查某 key 匹配数
node -e "const j=require('./data/events.json');console.log(j.events.filter(e=>e.teams&&e.teams.includes('KEY')).length)"
```
5. **推送前最后一步**：`git diff --stat` 确认改动文件数符合预期（比如只加一队却改了 5 个文件或只改了 1 行，都值得怀疑）
