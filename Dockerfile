# 零依赖项目（Node 原生 fetch/http），无需 npm install
FROM node:20-alpine

# 时区：容器默认 UTC，每日 0 点爬取/北京时间展示依赖本地时区
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app

# 源码 + 种子数据（data/ 内含 events.json 等，首启不用等爬取）
COPY . .

EXPOSE 3000

# Server酱 key 等配置用环境变量传入：
#   -e SERVERCHAN_KEY=sctp...        比分变化/局分提醒
#   -e LOCAL_REMINDERS=true          赛前提醒也走本容器（默认 false，交云端 GitHub Actions）
CMD ["node", "server.js"]
